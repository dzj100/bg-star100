/* 《巫师牌》程序化音效 —— 零音频文件，全部由 WebAudio 现场合成。
   window.WZSFX ／ <script src> 直接加载；无模块、无网络请求。
   未初始化、无 WebAudio、已静音时公开方法静默降级；上下文缺失时按需补建、被系统挂起时先唤醒再补发（见 SFX.play）。
   音色取向＝黑曜石桌 + 熔岩裂纹：发牌 / 出牌 / 按钮一律短、闷、石板感（低频收在 60~240Hz），
   亮与暖只留给巫师、小丑、加冕这些高光时刻 —— 一局要响几十次的声音绝不刺耳。 */
'use strict';
(function (root) {
  const SFX = {};

  const MASTER = 0.8;                // 总音量：手机外放也听得清；6 人桌同时响也不糊
  const MAX_VOICES = 14;             // 同时存活的声音数上限
  const MAX_SAME = 10;               // 同名音效 100ms 内最多 10 发；发牌一轮能连甩 20 张，靠这条兜底

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

  /* 能不能现在排声：只有 state 是 'running' 算可发声（Safari 私有的 'interrupted' 也不能）。
     老环境与无头假上下文没有 state，按 running 放行。 */
  function awake() { return !!ctx && (!ctx.state || ctx.state === 'running'); }
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
           3 秒是慢放换算后的上限：最长的噪声段是 flip 的 0.24s，×12 慢放 = 2.88s。 */
        const n = Math.max(1, Math.floor(ctx.sampleRate * 3));
        noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      /* iOS 的静音拨键默认把 WebAudio 也一并静掉；声明成 playback，出音跟音乐一个待遇 */
      try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) {}
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
  try { Object.defineProperty(SFX, 'ready', { get: awake, enumerable: true }); } catch (e) { SFX.ready = false; }

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

  /* 低频冲击：正弦下滑 + 低通；slap（拍桌）用 */
  function thump(t0, f0, f1, dur, peak, cut, dest) {
    return osc('sine', f0, t0, dur, bq('lowpass', cut, 1, env(t0, 0.004, dur, peak, dest)), f1);
  }

  /* 噪声带通掠过 f0→f1；返回滤波器，方便 flip / wizard 追加第二次折返 */
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

  function emit(name, build, g, st) {
    try {
      if (!room() || throttled(name)) return;
      const now = ctx.currentTime + 0.005;
      tsBase = now; TS = st;
      /* build 是同步跑完的，所以这两个模块级变量在这段里独占，不会串到别的发音上 */
      build(now, g);
      voices.push(shotEnd);
    } catch (e) { /* 合成失败绝不能影响游戏主流程 */ }
    finally { TS = 1; }
  }

  SFX.play = function (name, opt) {
    try {
      const build = SOUNDS[name];
      if (!build || muted) return;
      /* 惰性补建：读档续玩 / 刷新重开都没经过菜单，上下文可能从没建过 ——
         不补这一手，整段续玩就是哑的。页面还没被点过就先不建（建了也发不出声，
         浏览器还会记一条自动播放警告）；点过之后（hasBeenActive）随时能合法补出来。 */
      if (!ctx) {
        const ua = root && root.navigator && root.navigator.userActivation;
        if (ua && ua.hasBeenActive === false) return;
        if (!SFX.init() || !ctx) return;
      }
      if (ctx.state === 'closed') return;
      const g = opt && typeof opt.gain === 'number' ? Math.max(0, Math.min(1.5, opt.gain)) : 1;
      const st = opt && typeof opt.stretch === 'number' && opt.stretch > 1 ? Math.min(12, opt.stretch) : 1;
      if (!awake()) {
        /* 上下文被系统挂起过：手机锁屏 / 来电 / 切后台被冻结 / 音频焦点被别的应用抢走。
           挂起时 currentTime 冻住不动，硬排进去的发声会攒到恢复那一刻一起炸，所以先唤醒。
           resume 需要在用户手势里，而 play 的调用点全都来自手势 —— 这里就是最好的唤醒时机，
           唤醒成功后把这一发补上（自动播放的、没手势的那些会被拒，丢掉即可）。 */
        const p = ctx.resume && ctx.resume();
        if (p && p.then) p.then(function () { if (awake()) emit(name, build, g, st); }, function () {});
        return;
      }
      emit(name, build, g, st);
    } catch (e) { /* 合成失败绝不能影响游戏主流程 */ }
  };

  /* ---------------- 音效表 ---------------- */
  /* 名字与 render.js 的调用一一对应，不要改名（见 SPEC §6.3 音效清单） */

  SOUNDS.tap = function (t0, mul) {              // 按钮点按：短、脆，石面轻磕
    const g = shot(t0, 0.05, mul);
    osc('triangle', 1250, t0, 0.04, env(t0, 0.003, 0.04, 0.1, g), 900);
    noise(t0, 0.02, bq('highpass', 3000, 0.7, env(t0, 0.003, 0.02, 0.05, g)));
  };
  SOUNDS.pop = function (t0, mul) {              // 气泡弹出 / 预判宣布：快速上滑的 sine
    const g = shot(t0, 0.09, mul);
    osc('sine', 420, t0, 0.07, env(t0, 0.004, 0.07, 0.22, g), 1180);
    noise(t0, 0.012, bq('bandpass', 1800, 1.2, env(t0, 0.003, 0.012, 0.05, g)));   // 起泡那一下「噗」
  };
  SOUNDS.deal = function (t0, mul) {             // 发牌：极短「嗒」。一轮能连发 20 张，峰值必须压到很低
    const g = shot(t0, 0.045, mul);
    noise(t0, 0.03, bq('bandpass', 3200, 0.9, env(t0, 0.003, 0.03, 0.08, g)));     // 纸蹭石面的沙
    osc('triangle', 900, t0, 0.02, env(t0, 0.003, 0.02, 0.05, g), 620);           // 落定的「嗒」
  };
  SOUNDS.flip = function (t0, mul) {             // 翻指示牌：whoosh 掠过 + 收尾轻点
    const g = shot(t0, 0.3, mul);
    const bp = swish(t0, 480, 2400, 0.24, 0.26, 0.05, 1.0, g);
    bp.frequency.linearRampToValueAtTime(880, T(t0 + 0.24));    // 去而复返：牌翻起来又落回桌面
    osc('triangle', 1500, t0 + 0.23, 0.04, env(t0 + 0.23, 0.003, 0.04, 0.09, g), 1050);
    noise(t0 + 0.23, 0.02, bq('highpass', 4000, 0.8, env(t0 + 0.23, 0.003, 0.02, 0.045, g)));
  };
  SOUNDS.slap = function (t0, mul) {             // 出牌落桌：先「啪」的瞬态，再「咚」的体感，末尾下压＝squash
    const g = shot(t0, 0.2, mul);
    noise(t0, 0.06, bq('lowpass', 1500, 1.1, env(t0, 0.003, 0.06, 0.3, g)));      // 拍在石板上的瞬态
    thump(t0, 190, 62, 0.13, 0.26, 420, g);                                       // 桌面被拍中的闷响
    osc('triangle', 700, t0 + 0.02, 0.05, env(t0 + 0.02, 0.004, 0.05, 0.07, g), 380);  // 回弹下压
  };
  SOUNDS.trick = function (t0, mul) {            // 得墩：上行双音，愉悦但克制（一局要响十几次）
    const g = shot(t0, 0.34, mul);
    note('triangle', 659.25, t0, 0.11, 0.15, g);                                  // E5
    note('triangle', 987.77, t0 + 0.1, 0.22, 0.16, g);                            // B5：纯五度上行
  };
  SOUNDS.wizard = function (t0, mul) {           // 出巫师：高频琶音 + 星屑感
    const g = shot(t0, 0.56, mul), seq = [1046.5, 1318.51, 1567.98, 2093];
    for (let i = 0; i < seq.length; i++) {
      const dt = t0 + i * 0.055;
      note('triangle', seq[i], dt, 0.3 - i * 0.03, 0.1 - i * 0.008, g);
      detune(note('sine', seq[i] * 2, dt, 0.16, 0.03, g), 6);                     // 弱八度泛音：亮而不刺
    }
    swish(t0 + 0.02, 5200, 9200, 0.3, 0.05, 0.12, 1.6, g);                        // 星屑：极轻的高频沙沙
    osc('sine', 2637, t0 + 0.22, 0.3, env(t0 + 0.22, 0.02, 0.3, 0.055, g), 3520); // 收尾的上扬辉光
  };
  SOUNDS.jester = function (t0, mul) {           // 出小丑：铃铛。非谐波分音（≈1 : 2.76 : 5.4）才是铃
    const g = shot(t0, 0.5, mul), f = 880;
    osc('sine', f, t0, 0.42, env(t0, 0.003, 0.42, 0.13, g));
    osc('sine', f * 2.76, t0, 0.3, env(t0, 0.003, 0.3, 0.075, g));
    osc('sine', f * 5.4, t0, 0.18, env(t0, 0.003, 0.18, 0.045, g));
    detune(osc('sine', f * 1.5, t0 + 0.012, 0.22, env(t0 + 0.012, 0.004, 0.22, 0.05, g)), 9);  // 铃舌的颤
    noise(t0, 0.02, bq('bandpass', 5200, 1.4, env(t0, 0.003, 0.02, 0.05, g)));    // 铃舌敲到铃壁的金属尖
  };
  SOUNDS.deny = function (t0, mul) {             // 非法操作 / 点到压暗牌：低鸣。用 sine 不用 square
    const g = shot(t0, 0.3, mul), lp = bq('lowpass', 520, 3, g);                 // 低通磨掉棱角：要「不行」不要「警报」
    osc('sine', 174.61, t0, 0.12, env(t0, 0.02, 0.12, 0.15, lp));                // 慢起振 → 闷、不扎耳
    osc('sine', 146.83, t0 + 0.1, 0.18, env(t0 + 0.1, 0.025, 0.18, 0.16, lp));   // 落下一个全音，像摇头
  };
  SOUNDS.round = function (t0, mul) {            // 本轮结算：短号三音上行，是 fanfare 的「半句」
    const g = shot(t0, 0.44, mul), seq = [523.25, 659.25, 783.99];
    for (let i = 0; i < seq.length; i++) {
      const dt = t0 + i * 0.085, dur = i === 2 ? 0.24 : 0.12;
      detune(note('triangle', seq[i], dt, dur, 0.11, g), -6);
      detune(note('triangle', seq[i], dt, dur, 0.08, g), 7);                      // 两枚失谐叠厚
    }
  };
  SOUNDS.fanfare = function (t0, mul) {          // 终局排名：长号角。锯齿过低通＝铜管的暖，不用请真的小号
    const g = shot(t0, 1.36, mul), seq = [392, 523.25, 659.25, 783.99, 1046.5];
    const lp = bq('lowpass', 2600, 0.9, g);
    for (let i = 0; i < seq.length; i++) {
      const last = i === seq.length - 1, dt = t0 + i * 0.13, dur = last ? 0.8 : 0.22;
      detune(note('sawtooth', seq[i], dt, dur, last ? 0.075 : 0.055, lp), -8);
      detune(note('sawtooth', seq[i], dt, dur, last ? 0.06 : 0.045, lp), 8);
      note('triangle', seq[i] * 2, dt, dur, last ? 0.025 : 0.02, g);              // 弱八度：更亮更远
    }
  };
  SOUNDS.tick = function (t0, mul) {             // 数字滚动：与 pip 交替触发，绕开同名限流
    const g = shot(t0, 0.045, mul);
    swish(t0, 3000, 3000, 0.04, 0.15, 0.003, 1.6, g);
  };
  SOUNDS.pip = function (t0, mul) {              // 徽章 punch / 得分跳字：带上挑的正弦滴答
    const g = shot(t0, 0.07, mul);
    osc('sine', 1180, t0, 0.06, env(t0, 0.003, 0.06, 0.15, g), 1560);
  };
  SOUNDS.win = function (t0, mul) {              // 冠军加冕：明亮辉煌的上行三连，接在 fanfare 后面收尾
    const g = shot(t0, 0.75, mul), seq = [1046.5, 1318.51, 1567.98];
    for (let i = 0; i < seq.length; i++) {
      const last = i === 2, dt = t0 + i * 0.1, dur = last ? 0.5 : 0.16;
      detune(note('triangle', seq[i], dt, dur, last ? 0.13 : 0.1, g), -5);
      detune(note('triangle', seq[i], dt, dur, last ? 0.1 : 0.08, g), 6);
    }
    swish(t0 + 0.02, 4200, 8600, 0.34, 0.05, 0.1, 1.5, g);                        // 金粉洒下来
    osc('sine', 2093, t0 + 0.2, 0.5, env(t0 + 0.2, 0.03, 0.5, 0.05, g), 2637);    // 头顶的辉光，缓缓扬起
  };

  if (root) root.WZSFX = SFX;
})(typeof window !== 'undefined' ? window : null);
