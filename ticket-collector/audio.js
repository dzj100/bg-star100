/* 《车票收藏家》程序化音效 —— 零音频文件，全部由 WebAudio 现场合成。
   window.TC_SFX ／ <script src> 直接加载；无模块、无网络请求。
   未初始化、无 WebAudio、被系统挂起、已静音时，公开方法一律静默降级。 */
'use strict';
(function (root) {
  const SFX = {};

  const MASTER = 0.5;                // 总音量：6 个音效叠加仍不刺耳
  const MAX_VOICES = 14;             // 同时存活的声音数上限
  const MAX_SAME = 10;               // 同名音效 100ms 内最多 10 发，连发不会糊成蜂鸣

  let ctx = null, master = null, noiseBuf = null, muted = false, shotEnd = 0;
  const voices = [];                 // 各发声音的收尾时刻（秒，真实时间）
  const hits = {};                   // 同名音效的最近触发时刻
  const SOUNDS = {};                 // name → builder(t0, gainMul)

  /* 慢放支持：builder 全在「本发开始的那一刻」上算偏移（t0 + 0.25 之类），
     于是用一条锚在起点上的线性映射把逻辑时间换算成真实时间。
     ⚠ T 只吃**绝对时刻**，时长要用 D —— 两者不能混：锚定映射对时长是没有意义的
     （T(0.13) 会算出「起点 + (0.13 - 起点) × S」这种鬼东西）。
     恒等映射（S = 1）时 T 与 D 都是恒等，所以不慢放与改动前逐样本一致。 */
  let tsBase = 0, TS = 1;
  const T = t => tsBase + (t - tsBase) * TS;
  const D = d => d * TS;

  function live() { return !!(ctx && ctx.state !== 'closed' && ctx.state !== 'suspended'); }
  function safeResume() {
    try { const p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  /* ---------------- 上下文与总线 ---------------- */

  SFX.init = function () {
    if (!root) return false;
    try {
      if (!ctx) {                                  // 全局只建一个 AudioContext：Safari 建第二个会硬失败
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER;
        master.connect(ctx.destination);
        /* 白噪声只生成一次，所有噪声音效切同一缓冲的不同片段，免得反复分配大数组。
           3 秒是慢放换算后的上限：最长的噪声段是 0.5s 的汽笛，×5 = 2.5s。 */
        const n = Math.max(1, Math.floor(ctx.sampleRate * 3));
        noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') safeResume();  // iOS/Safari 只在用户手势里才解锁
      return true;
    } catch (e) {
      ctx = null; master = null; noiseBuf = null;   // 构造失败退回未初始化，下次手势可重试
      return false;
    }
  };

  SFX.setMuted = function (v) {
    muted = !!v;
    /* 用 setTargetAtTime 平滑压掉总线，直接跳变会「啪」一声 */
    try { if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02); } catch (e) {}
    return muted;
  };
  SFX.toggle = function () { return SFX.setMuted(!muted); };

  /* ready / muted 用访问器实时反映内部状态；极老环境 defineProperty 失败就退回静态字段 */
  try {
    Object.defineProperty(SFX, 'muted', {
      get: function () { return muted; }, set: function (v) { SFX.setMuted(v); }, enumerable: true,
    });
  } catch (e) { SFX.muted = false; }
  try { Object.defineProperty(SFX, 'ready', { get: live, enumerable: true }); } catch (e) { SFX.ready = false; }

  /* ---------------- 合成原语 ---------------- */
  /* 每段波形都必须 ≥3ms 起振、收尾归零：增益突变的样本跳变就是爆音 */

  function env(t0, atk, end, peak, dest) {
    const s0 = T(t0), a = Math.max(0.003, D(atk)), e = Math.max(a + 0.005, D(end));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s0);
    g.gain.linearRampToValueAtTime(peak, s0 + a);
    g.gain.exponentialRampToValueAtTime(0.0002, s0 + e);
    g.gain.linearRampToValueAtTime(0, s0 + e + D(0.006));
    g.connect(dest); return g;
  }

  /* 每发音效的出口增益：opt.gain 是整发倍率；收尾时刻记在 shotEnd，省去每个 builder 各自 return */
  function shot(t0, dur, mul) {
    const s0 = T(t0), d = D(dur);
    const g = ctx.createGain(), peak = 0.9 * mul, rel = Math.min(0.04 * TS, d * 0.25);
    g.gain.setValueAtTime(0, s0);
    g.gain.linearRampToValueAtTime(peak, s0 + D(0.004));
    g.gain.setValueAtTime(peak, s0 + d - rel);
    g.gain.linearRampToValueAtTime(0, s0 + d);
    g.connect(master); shotEnd = s0 + d; return g;
  }

  function osc(type, f0, t0, dur, dest, f1) {
    const s0 = T(t0), d = D(dur);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, s0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, s0 + d);   // 指数滑音的终点必须为正
    o.connect(dest); o.start(s0); o.stop(s0 + d + D(0.02));
    return o;
  }

  function note(type, f, t0, dur, peak, dest) {
    return osc(type, f, t0, dur, env(t0, Math.min(0.02, dur * 0.2), dur, peak, dest));
  }
  function detune(o, cents) { if (o.detune) o.detune.value = cents; }

  function noise(t0, dur, dest) {
    const s0 = T(t0), d = D(dur);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    /* 只取缓冲里随机一小段；offset 按缓冲实长留余量，免得慢放拉长后唱到末尾提前静音 */
    s.start(s0, Math.random() * Math.max(0, noiseBuf.duration - d - 0.05), d + 0.02);
    s.stop(s0 + d + D(0.03));
    s.connect(dest); return s;
  }

  function bq(type, f, q, dest) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f;
    if (q != null) b.Q.value = q;
    b.connect(dest); return b;
  }

  /* 低频冲击：正弦下滑 + 低通；slide / slideShut / bag / stamp 共用 */
  function thump(t0, f0, f1, dur, peak, cut, dest) {
    return osc('sine', f0, t0, dur, bq('lowpass', cut, 1, env(t0, 0.004, dur, peak, dest)), f1);
  }

  /* 噪声带通掠过 f0→f1；返回滤波器，方便 whoosh 追加第二次折返 */
  function swish(t0, f0, f1, dur, peak, atk, q, dest) {
    const bp = bq('bandpass', f0, q, env(t0, atk, dur, peak, dest));
    bp.frequency.setValueAtTime(f0, T(t0));
    bp.frequency.linearRampToValueAtTime(f1, T(t0 + dur));
    noise(t0, dur, bp); return bp;
  }

  /* ---------------- 限流与声部 ---------------- */

  function throttled(name) {
    const t = ctx.currentTime, a = hits[name] || (hits[name] = []);
    let k = 0; for (let i = 0; i < a.length; i++) if (t - a[i] < 0.1) a[k++] = a[i];
    a.length = k;
    if (k >= MAX_SAME) return true;
    a.push(t); return false;
  }

  function room() {
    const t = ctx.currentTime; let k = 0;
    for (let i = 0; i < voices.length; i++) if (voices[i] > t) voices[k++] = voices[i];
    voices.length = k;
    return k < MAX_VOICES;
  }

  /* ---------------- 入口 ---------------- */
  /* opt 可选：{ gain: 0..1.5 本发倍率, stretch: 慢放倍率（>1 才生效） } */

  SFX.play = function (name, opt) {
    try {
      const build = SOUNDS[name];
      if (!build || muted || !live() || !room() || throttled(name)) return;
      const g = opt && typeof opt.gain === 'number' ? Math.max(0, Math.min(1.5, opt.gain)) : 1;
      const st = opt && typeof opt.stretch === 'number' && opt.stretch > 1 ? Math.min(12, opt.stretch) : 1;
      const now = ctx.currentTime + 0.005;
      tsBase = now; TS = st;
      /* build 是同步跑完的，所以这两个模块级变量在这段里独占，不会串到别的发音上 */
      build(now, g);
      voices.push(shotEnd);
    } catch (e) { /* 合成失败绝不能影响游戏主流程 */ }
    finally { TS = 1; }
  };

  /* ---------------- 音效表 ---------------- */

  SOUNDS.tap = function (t0, mul) {
    const g = shot(t0, 0.05, mul);
    osc('triangle', 1250, t0, 0.04, env(t0, 0.003, 0.04, 0.1, g), 900);
    noise(t0, 0.02, bq('highpass', 3000, 0.7, env(t0, 0.003, 0.02, 0.05, g)));
  };
  SOUNDS.confirm = function (t0, mul) {
    const g = shot(t0, 0.25, mul);
    note('triangle', 659.25, t0, 0.09, 0.16, g);                   // E5 → A5 上行二音
    note('triangle', 880, t0 + 0.07, 0.16, 0.17, g);
  };
  SOUNDS.deny = function (t0, mul) {
    const g = shot(t0, 0.3, mul), lp = bq('lowpass', 620, 6, g);   // 低通把方波磨成闷响
    osc('square', 196, t0, 0.1, env(t0, 0.006, 0.1, 0.09, lp));
    osc('square', 147, t0 + 0.09, 0.17, env(t0 + 0.09, 0.006, 0.17, 0.1, lp));
  };
  SOUNDS.slide = function (t0, mul) {
    const g = shot(t0, 0.3, mul);
    swish(t0, 380, 2400, 0.25, 0.3, 0.07, 0.9, g);                 // 门缝张开：噪声带一路上扬
    thump(t0 + 0.2, 96, 44, 0.09, 0.22, 300, g);
  };
  SOUNDS.slideShut = function (t0, mul) {
    const g = shot(t0, 0.38, mul);
    swish(t0, 2100, 300, 0.31, 0.3, 0.025, 0.9, g);                // 关门：噪声带向下收拢
    thump(t0 + 0.25, 82, 36, 0.11, 0.34, 260, g);                  // 落点比开门更重
  };
  SOUNDS.locker = function (t0, mul) {
    const g = shot(t0, 0.16, mul), hp = bq('highpass', 900, 0.7, g);
    osc('triangle', 1730, t0, 0.13, env(t0, 0.003, 0.13, 0.07, hp));   // 非谐波分音 → 金属味
    osc('triangle', 2610, t0, 0.1, env(t0, 0.003, 0.1, 0.05, hp));
    noise(t0, 0.03, bq('bandpass', 4200, 1.2, env(t0, 0.003, 0.03, 0.07, g)));
  };
  SOUNDS.paper = function (t0, mul) {
    const g = shot(t0, 0.1, mul);
    swish(t0, 2000, 5200, 0.09, 0.16, 0.008, 0.8, g);
  };
  SOUNDS.bag = function (t0, mul) {
    const g = shot(t0, 0.2, mul);
    thump(t0, 130, 62, 0.13, 0.26, 420, g);                        // 闷在包里的低频
    noise(t0 + 0.03, 0.06, bq('highpass', 2600, 0.7, env(t0 + 0.03, 0.006, 0.06, 0.06, g)));
  };
  SOUNDS.spin = function (t0, mul) {
    const d = 0.6, g = shot(t0, d + 0.02, mul);
    const o = osc('triangle', 820, t0, d, env(t0, 0.02, d, 0.16, g), 190);
    /* 13Hz LFO 扫音高：不用波表就得到打转的滑稽抖颤 */
    const lfo = ctx.createOscillator(), amt = ctx.createGain();
    lfo.frequency.value = 13; amt.gain.value = 42;
    lfo.connect(amt); amt.connect(o.frequency);
    lfo.start(T(t0)); lfo.stop(T(t0 + d) + D(0.02));
  };
  SOUNDS.stamp = function (t0, mul) {
    const g = shot(t0, 0.19, mul);
    thump(t0, 220, 46, 0.13, 0.3, 900, g);                         // 快速下滑的「砸」
    noise(t0, 0.07, bq('lowpass', 1400, 0.8, env(t0, 0.003, 0.07, 0.24, g)));
  };
  SOUNDS.pip = function (t0, mul) {
    const g = shot(t0, 0.06, mul);
    note('sine', 1320, t0, 0.055, 0.14, g);
  };
  SOUNDS.tick = function (t0, mul) {    // 附加：长数字滚动与 pip 交替触发，绕开同名限流
    const g = shot(t0, 0.05, mul);
    swish(t0, 2600, 2600, 0.045, 0.16, 0.003, 1.4, g);
  };
  SOUNDS.score = function (t0, mul) {
    const g = shot(t0, 0.45, mul);
    note('triangle', 880, t0, 0.1, 0.14, g);
    note('triangle', 1108.73, t0 + 0.08, 0.1, 0.14, g);
    note('triangle', 1318.51, t0 + 0.16, 0.25, 0.15, g);
  };
  SOUNDS.fanfare = function (t0, mul) {
    const g = shot(t0, 0.95, mul), seq = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < seq.length; i++) {
      const last = i === seq.length - 1, dt = t0 + i * 0.11, dur = last ? 0.6 : 0.3;
      /* 每音两枚 ±7 音分失谐的振荡器：最省事也最有效的合唱厚度 */
      detune(note('triangle', seq[i], dt, dur, last ? 0.12 : 0.1, g), -7);
      detune(note('triangle', seq[i], dt, dur, last ? 0.09 : 0.08, g), 8);
    }
  };
  SOUNDS.whoosh = function (t0, mul) {
    const g = shot(t0, 0.4, mul);
    const bp = swish(t0, 320, 2200, 0.36, 0.34, 0.09, 1.1, g);
    bp.frequency.linearRampToValueAtTime(420, T(t0 + 0.37));        // 去而复返才有过场感
  };
  SOUNDS.warn = function (t0, mul) {
    const g = shot(t0, 0.85, mul);
    osc('sine', 196, t0, 0.8, env(t0, 0.13, 0.8, 0.17, g));        // 慢起振 → 钟的呼吸感
    detune(osc('sine', 294, t0, 0.7, env(t0, 0.16, 0.7, 0.1, g)), 9);
    detune(osc('sine', 392.5, t0, 0.55, env(t0, 0.18, 0.55, 0.05, g)), -14);
  };
  SOUNDS.whistle = function (t0, mul) {  // 附加：发车汽笛（开局 / 收尾过场）
    const g = shot(t0, 0.6, mul);
    swish(t0, 1650, 2100, 0.5, 0.22, 0.07, 4, g);
    const o = note('sine', 1180, t0, 0.5, 0.07, g);
    o.frequency.exponentialRampToValueAtTime(1560, T(t0 + 0.45));
  };

  if (root) root.TC_SFX = SFX;
})(typeof window !== 'undefined' ? window : null);
