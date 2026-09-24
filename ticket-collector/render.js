/* 《车票收藏家》UI + 演出编排
   依赖方向：art.js（模板串）→ game.js（规则/几何）→ 本文件（DOM + fx）。
   fx 引擎沿用仓库其它游戏那一套（tween / fxRunUntil / spawn / vanish），但把「时钟」做成可变速：
   rate() 乘在 fxClock 上，于是加速/跳过/慢放会一并作用于已在飞的补间与等待，不会把角色丢在半路。
   死锁红线：只要还有 fxWaits，主循环就必须继续跑 —— 见 frame() 的 resolve 分支。 */
'use strict';
(function (root) {
  const TC = root.TC, ART = root.TC_ART;
  if (!TC || !ART) return;

  /* ================= 小工具 ================= */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const sfxOn = { v: true };
  /* 慢放时音效跟着拉长（stretch = 1/rate）：滑门、原地打转这类「有持续过程」的声音
     才不会比动画早收尾。只拉长不缩短 —— 快进/跳过时保持原样，限流与声部上限本来就挡得住重叠。 */
  function sfx(name, o) {
    const s = root.TC_SFX;
    if (!sfxOn.v || !s || !s.play) return;
    const r = rate();
    try { s.play(name, r < 1 ? Object.assign({}, o, { stretch: 1 / r }) : o); }
    catch (e) { /* 音效永不阻塞玩法 */ }
  }
  const wu = n => 'calc(' + n + ' * var(--wu))';
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstChild;
  }
  function place(node, x, y, w, h) {
    node.style.left = wu(x); node.style.top = wu(y);
    if (w != null) node.style.width = wu(w);
    if (h != null) node.style.height = wu(h);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ================= 缓动 ================= */
  const linear = t => t;
  const easeOutQuad = t => 1 - (1 - t) * (1 - t);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  const easeInQuad = t => t * t;
  const easeInCubic = t => t * t * t;
  const easeInOutQuad = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = t => {
    const c = 2.2;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  };

  /* ================= fx 引擎 ================= */
  const SPEED = { v: 1 };
  /* 两个旋钮，别合并：SPEED 是**玩家按出来的绝对倍率**（1 / 3，快进按钮切换），PACE 是**演出的基础节奏**。
     结算四步慢放到 40%（SLOW = 0.4），玩家一按快进/跳过就立刻回到绝对倍速 —— 所以 rate() 取大的那个。
     一个变量既当档位又当播放率的话，慢放会顺手改掉按钮的语义（按一下快进反而慢 5 倍）。 */
  const PACE = { v: 1 }, SLOW = 0.4;
  const rate = () => (SPEED.v > 1 ? SPEED.v : PACE.v);
  /* 结算里也有不吃 fx 时钟的过场（车厢熄灯、无人光顾药丸、气泡弹出走 CSS transition），
     它们靠 --fx-pace 跟同一个节奏；不写的话动画放慢了这些还是一闪而过。 */
  function syncPace() { document.documentElement.style.setProperty('--fx-pace', String(1 / rate())); }
  function setPace(v) { PACE.v = v; syncPace(); }

  /* ================= 运行日志 =================
     热座局里出怪事时，只有这台手机知道发生过什么，所以日志必须落盘。
     环形缓冲：满了丢最旧的；查看时倒序（最新一条在最上面）。 */
  const SAVE_KEY = 'tc.save.v1';
  const LOG = { max: 400, list: [] };
  function logLine(kind, text) {
    LOG.list.push({ t: Date.now(), r: (S && S.round) || 0, k: kind, s: String(text) });
    if (LOG.list.length > LOG.max) LOG.list.splice(0, LOG.list.length - LOG.max);
    if ($('#logbox') && $('#logbox').classList.contains('on')) renderLog();
  }
  const pad2 = n => (n < 10 ? '0' : '') + n;
  function logClock(t) {
    const d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function logText() {
    return LOG.list.map(function (e) {
      return logClock(e.t) + ' [' + (e.r ? 'R' + e.r : '—') + '/' + e.k + '] ' + e.s;
    }).join('\n');
  }

  /* ================= 存档 =================
     stage 记的是「这一步之后刷新，该从哪里接上」：
       setup 名单没发车 / lobby 已发车未补票 / pick 本轮在选人 / show 本轮已结算待演出 / over 已排名
     ⚠ show 这一档是关键：结算结果在**演出开演之前**就落盘了，所以演出中途刷新，
       这一轮的车票、名次、分数一个都不会丢 —— 重放不了动画，但绝不丢结果。 */
  let saveStage = 'lobby';
  function saveNow(stage) {
    if (stage) saveStage = stage;
    if (!S && !draft.rows.length) return;                  // 什么都没发生，不必写盘
    try {
      root.localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, t: Date.now(), stage: saveStage, seed: seed,
        rng: RNG && RNG.state ? RNG.state() : null,
        speed: SPEED.v, S: S, draft: draft.rows, log: LOG.list,
      }));
    } catch (e) { /* 隐私模式 / 配额满：存不下也不能影响这一局 */ }
  }
  function loadSave() {
    try {
      const raw = root.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.v !== 1) return null;
      if (o.stage === 'setup') return (o.draft && o.draft.length >= 3) ? o : null;
      return (o.S && o.S.players && o.S.players.length && o.S.players[0].colors) ? o : null;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { root.localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
  }
  function stageName(s) {
    return { setup: '名单', lobby: '候车', pick: '选择中', show: '待结算', over: '已排名' }[s] || s;
  }
  function saveInfoText() {
    const o = loadSave();
    if (!o) return '无';
    const d = new Date(o.t);
    const when = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + logClock(o.t);
    if (o.stage === 'setup') return '名单未发车 · ' + when;
    return '第 ' + Math.max(1, o.S.round) + ' 轮 · ' + stageName(o.stage) + ' · ' + when;
  }
  function makeSeed() { return (Date.now() ^ 0x9e3779b9) >>> 0; }

  /* ================= 日志面板 ================= */
  function renderLog() {
    const body = $('#logBody');
    if (!body) return;
    const n = $('#logCount');
    if (n) n.textContent = LOG.list.length + ' 条 · 倒序';
    const si = $('#logSaveInfo');
    if (si) si.textContent = saveInfoText();
    if (!LOG.list.length) { body.innerHTML = '<div class="log-empty">还没有记录</div>'; return; }
    let html = '';
    for (let i = LOG.list.length - 1; i >= 0; i--) {          // 倒序：最新一条在最上面
      const e = LOG.list[i];
      html += '<div class="log-row ' + ART.esc(e.k) + '">' +
        '<i>' + logClock(e.t) + '</i>' +
        '<b>' + (e.r ? 'R' + e.r : '—') + '</b>' +
        '<span>' + ART.esc(e.s) + '</span></div>';
    }
    body.innerHTML = html;
    body.scrollTop = 0;
  }
  function openLog() { renderLog(); show('logbox'); }
  const fxEl = () => $('#fx');
  let fxTweens = [], fxWaits = [], fxClock = 0, fxHold = 0, raf = 0;
  let fxOn = true, trauma = 0, shakeScale = 0.8;
  let lastNow = 0;

  function tween(o) {
    /* 关掉演出时不能直接 return：补间里的 Promise 靠 after() 兑现，漏了会永久挂起 */
    if (!fxOn) { if (o.upd) o.upd(1); if (o.after) o.after(); return; }
    /* o.t 是「从现在起算的延迟」，不是绝对时刻 —— 起手一律锚在**当前** fxClock 上。
       锚错成 0 的话，一轮跑到后面 fxClock 早就大于 dur 了，p 第一帧就 ≥1，
       所有位移（走位、飞票、滑门、落地 squash）都会变成瞬移，而终点还是对的，
       于是只有肉眼看得出来 —— 仓库契约见 infiltraitors/render.js 的 t0。 */
    fxTweens.push({ t0: fxClock + (o.t || 0), dur: Math.max(1, o.dur || 1), ease: o.ease || linear, upd: o.upd, after: o.after });
    kick();
  }
  function kick() { if (!raf) { lastNow = 0; raf = requestAnimationFrame(frame); } }
  function fxKick() { kick(); }

  function frame(now) {
    if (!lastNow) lastNow = now;
    let dt = now - lastNow;
    lastNow = now;
    if (dt > 60) dt = 60;
    const vdt = dt * rate();

    if (fxHold > 0) fxHold -= vdt; else fxClock += vdt;

    /* 补间：跑满 1 的当场摘掉。done 的留在数组里会让每帧成本只涨不消。 */
    let alive = false;
    const keep = [];
    for (let i = 0; i < fxTweens.length; i++) {
      const tw = fxTweens[i];
      const p = (fxClock - tw.t0) / tw.dur;
      if (p < 0) { keep.push(tw); alive = true; continue; }
      tw.upd(tw.ease(p >= 1 ? 1 : p));
      if (p >= 1) { if (tw.after) tw.after(); }
      else { keep.push(tw); alive = true; }
    }
    fxTweens = keep;

    /* 等待器只认时钟，不认补间：`await` 的语义就是「等这么久」，跟别人在不在飞无关。
       而且「还没到点」也必须算活着 —— 否则下面的 else 一关循环，等待器就永久挂起，
       整局演出死在这里（trainArrive 的第一次 fxWait 就踩过这个坑）。 */
    if (fxWaits.length) {
      const due = [], rest = [];
      for (let i = 0; i < fxWaits.length; i++) {
        if (fxClock >= fxWaits[i].end) due.push(fxWaits[i]); else rest.push(fxWaits[i]);
      }
      fxWaits = rest;
      for (let i = 0; i < due.length; i++) due[i].res();
      if (fxWaits.length) alive = true;
    }

    if (trauma > 0.002) {
      const amp = trauma * trauma * 17 * shakeScale;
      const g = $('#screen-game');
      if (g) {
        g.style.willChange = 'transform';
        g.style.transform = 'translate3d(' + ((Math.random() * 2 - 1) * amp).toFixed(2) + 'px,' +
          ((Math.random() * 2 - 1) * amp * 0.7).toFixed(2) + 'px,0) rotate(' + ((Math.random() * 2 - 1) * amp * 0.13).toFixed(3) + 'deg)';
      }
      trauma *= Math.pow(0.9, vdt / 16);
    } else if (trauma !== 0) {
      trauma = 0;
      const g = $('#screen-game');
      if (g) { g.style.transform = ''; g.style.willChange = ''; }
    }

    lobbyTick(dt);

    if (alive || trauma > 0.002 || lobby.on) raf = requestAnimationFrame(frame);
    else raf = 0;
  }

  function fxRunUntil(end) {
    return new Promise(res => {
      if (!fxOn) { res(); return; }
      fxWaits.push({ end: end, res: res });
      kick();
    });
  }
  /* 唯一的等待闸门。参数是「演出毫秒」—— 补间 dur、fxWait、bubble、hitStop 用的是同一把尺子，
     真实时长一律 = 演出毫秒 / rate()：fxClock 自己已经按 rate() 走了，这里再除一次就成了 25 倍慢放。
     `end` 本身是 fxClock 上的绝对时刻，调用方别自己算。 */
  function fxWait(ms) { return fxRunUntil(fxClock + (ms || 0)); }

  function hitStop(ms) { if (fxOn && ms) fxHold = Math.max(fxHold, ms); }
  function shakeAdd(v) { if (!fxOn) return; trauma = Math.min(1, trauma + v * shakeScale); kick(); }

  function clearFx() {
    const box = fxEl();
    if (box) box.innerHTML = '';
    fxTweens = [];
    fxWaits.splice(0).forEach(w => w.res());
    fxClock = 0; fxHold = 0;
    trauma = 0;
    const g = $('#screen-game');
    if (g) { g.style.transform = ''; g.style.willChange = ''; }
  }

  function spawn(html, cls, at) {
    const node = document.createElement('div');
    node.className = 'fxc' + (cls ? ' ' + cls : '');
    node.innerHTML = html;
    node.style.left = Math.round(at.x) + 'px';
    node.style.top = Math.round(at.y) + 'px';
    fxEl().appendChild(node);
    return node;
  }
  function vanish(node, t, dur) {
    const at = (t || 0) + (dur || 120);
    tween({ t: at, dur: 1, upd() { node.style.opacity = '0'; } });
    tween({ t: at + 1, dur: 1, upd() { node.remove(); } });
  }
  function flyTo(node, to, o) {
    o = o || {};
    const x0 = parseFloat(node.style.left) || 0, y0 = parseFloat(node.style.top) || 0;
    const dx = to.x - x0, dy = to.y - y0;
    return new Promise(res => {
      tween({
        dur: o.dur || 360, ease: o.ease || easeInOutQuad,
        upd(p) {
          const arc = (o.lift || 0) * Math.sin(Math.PI * p);
          node.style.transform = 'translate3d(' + (dx * p).toFixed(1) + 'px,' + (dy * p - arc).toFixed(1) + 'px,0)' +
            (o.rot ? ' rotate(' + (o.rot * p).toFixed(1) + 'deg)' : '') +
            (o.to ? ' scale(' + (1 + (o.to - 1) * p).toFixed(3) + ')' : '');
          if (o.fadeOut) node.style.opacity = p > 0.7 ? (1 - (p - 0.7) / 0.3).toFixed(2) : '1';
        },
        after: res,
      });
    });
  }
  function ringAt(pt, size, cls) {
    const node = spawn('', 'ringFx ' + (cls || ''), { x: pt.x - size / 2, y: pt.y - size / 2 });
    node.style.width = size + 'px'; node.style.height = size + 'px';
    tween({ dur: 320, ease: easeOutQuint, upd(p) { node.style.transform = 'scale(' + (0.5 + p * 1.6).toFixed(2) + ')'; node.style.opacity = (1 - p).toFixed(2); } });
    vanish(node, 0, 330);
  }
  function burst(pt, n, cls, spread) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.7;
      const d = (spread || 42) * (0.5 + Math.random() * 0.8);
      const node = spawn('', 'fx-dot ' + (cls || 'dust'), { x: pt.x, y: pt.y });
      flyTo(node, { x: pt.x + Math.cos(a) * d, y: pt.y + Math.sin(a) * d - 12 }, { dur: 320 + Math.random() * 220, ease: easeOutQuint, fadeOut: true });
      vanish(node, 0, 560);
    }
  }
  function floatAt(pt, txt, cls) {
    const node = spawn('<div class="floatTxt' + (cls ? ' ' + cls : '') + '">' + txt + '</div>', '', { x: pt.x - 40, y: pt.y - 12 });
    node.style.width = '80px'; node.style.textAlign = 'center';
    tween({ dur: 760, ease: easeOutCubic, upd(p) { node.style.transform = 'translate(0,' + (-34 * p).toFixed(1) + 'px)'; node.style.opacity = (1 - p * p).toFixed(2); } });
    vanish(node, 0, 800);
  }
  function stampAt(pt, txt, cls, small) {
    const node = spawn('<div class="stampFx ' + cls + (small ? ' small' : '') + '">' + txt + '</div>', '', { x: pt.x, y: pt.y });
    node.style.transform = 'translate(-50%,-50%) rotate(-16deg) scale(2.2)';
    hitStop(small ? 45 : 75);
    sfx('stamp');
    tween({ dur: small ? 170 : 220, ease: easeOutBack, upd(p) { node.style.transform = 'translate(-50%,-50%) rotate(-16deg) scale(' + (2.2 - 1.2 * p).toFixed(3) + ')'; node.style.opacity = p < 0.6 ? (p / 0.6).toFixed(2) : '1'; } });
    tween({ t: 150, dur: 110, upd(p) { node.style.transform = 'translate(-50%,-50%) rotate(' + (-16 + 8 * p).toFixed(1) + 'deg) scale(' + (1 + 0.03 * Math.sin(Math.PI * p)).toFixed(3) + ')'; } });
    ringAt(pt, 46, 'ringStamp');
    vanish(node, 1150, 380);
  }
  function flashScreen(strength) {
    const node = spawn('', 'flashLayer', { x: 0, y: 0 });
    tween({ dur: 260, upd(p) { node.style.opacity = ((1 - p) * (strength || 0.55)).toFixed(2); } });
    vanish(node, 0, 270);
  }
  /* 横幅直接挂进 #fx：百分比定位要以整层为参照 */
  function bannerAt(txt, cls) {
    const node = document.createElement('div');
    node.className = 'fxc banner' + (cls ? ' ' + cls : '');
    node.textContent = txt;
    fxEl().appendChild(node);
    sfx('whoosh');
    tween({ dur: 420, ease: easeOutBack, upd(p) { node.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + 0.3 * p).toFixed(3) + ')'; node.style.opacity = p < 0.3 ? (p / 0.3).toFixed(2) : '1'; } });
    vanish(node, 900, 420);
  }

  /* ================= 版面 ================= */
  const K = { v: 1 };
  let ORIG = { x: 0, y: 0 };

  function fitStage() {
    const wrap = $('#stagewrap'), st = $('#stage');
    if (!wrap || !st) return;
    const aw = wrap.clientWidth, ah = wrap.clientHeight;
    /* 舞台藏起来时（封面 / 名单压在上面，游戏屏 display:none）量到的是 0×0：钳到 0.2
       会把 --k 写成正常值的 1/5，名单上的头像跟着缩水，而且名单自己不重量、缩了回不来。
       露出真尺寸后再量 —— 从隐藏变可见时 ResizeObserver 会补一次（见 boot）。 */
    if (aw <= 0 || ah <= 0) return;
    const k = Math.max(0.2, Math.min(aw / TC.WORLD.w, ah / TC.WORLD.h));
    K.v = k;
    st.style.width = Math.round(TC.WORLD.w * k) + 'px';
    st.style.height = Math.round(TC.WORLD.h * k) + 'px';
    document.documentElement.style.setProperty('--k', k.toFixed(5));
    measureOrigin();
    figs.forEach(f => applyFig(f, f.wx, f.wy));
  }
  function measureOrigin() {
    const r = $('#stage').getBoundingClientRect();
    ORIG.x = r.left; ORIG.y = r.top;
  }
  /* 世界坐标 → 视口坐标（纯算术，不测 DOM；ORIG 只在 resize / 每轮开始时刷新） */
  const toScreen = (wx, wy) => ({ x: ORIG.x + wx * K.v, y: ORIG.y + wy * K.v });

  /* ================= 角色 ================= */
  const MARK = ['#3f8fd8', '#e0503f', '#3fae6b', '#d8a02a', '#9b5fd0', '#2fa8a8'];
  let S = null, figs = [], view = { packs: [], lockers: [], cars: [] };
  let RNG = null, seed = 0, lobby = { on: false, pid: -1, tx: 0, ty: 0, up: false };
const LOBBY_V = 150;                                      /* 候车自由走动：近端口径速度（单位/秒），远处置慢 */

  function buildFigs() {
    const box = $('#figs');
    box.innerHTML = '';
    figs = [];
    S.players.forEach(function (p, i) {
      p.mark = MARK[i % MARK.length];
      const node = el(ART.fig(p, p.mark));
      box.appendChild(node);
      const f = {
        p: p, i: i, el: node, wx: p.pos.x, wy: p.pos.y, z: -1, phase: 0,
        limbs: {
          legL: node.querySelector('[data-limb="legL"]'),
          legR: node.querySelector('[data-limb="legR"]'),
          armL: node.querySelector('[data-limb="armL"]'),
          armR: node.querySelector('[data-limb="armR"]'),
        },
        bag: node.querySelector('[data-bag]'),
        bubble: node.querySelector('.fig-bubble'),
      };
      f.limbs.all = [f.limbs.legL, f.limbs.legR, f.limbs.armL, f.limbs.armR];
      figs.push(f);
      applyFig(f, f.wx, f.wy);
    });
  }

  /* 外层 transform 的唯一写入口。scale 用 (sx,sy) 两轴 —— 原地旋转靠 cos 挤压成「转身」错觉，
     落地缓冲靠 squash，两者都只需要改这两个数。 */
  function applyFig(f, wx, wy, opt) {
    const s = TC.figScale(wy);
    const sx = opt && opt.sx != null ? opt.sx : s;
    const sy = opt && opt.sy != null ? opt.sy : s;
    const py = opt && opt.lift ? wy - opt.lift : wy;
    f.el.style.transform = 'translate3d(' + ((wx - 12) * K.v).toFixed(2) + 'px,' + ((py - 40) * K.v).toFixed(2) + 'px,0)' +
      ' scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    const z = 10 + ((wy / 8) | 0);
    if (z !== f.z) { f.z = z; f.el.style.zIndex = z; }
    /* 走到远端柜前时把头顶名牌收掉：那一带的标签位属于储物柜 */
    const far = wy < 200;
    if (far !== f.far) { f.far = far; f.el.classList.toggle('far', far); }
  }
  function setLimbs(f, mode) {
    const L = ART.LIMB;
    let a = [0, 0, 0, 0];                    /* legL legR armL armR */
    if (mode === 'walk') {
      const s = Math.sin(f.phase);
      a = [26 * s, -26 * s, -17 * s, 17 * s];
    } else if (mode === 'stiff') {
      a = [0, 0, -58, 58];
    } else if (mode === 'cheer') {
      a = [0, 0, -152, 152];
    } else if (mode === 'shock') {
      a = [0, 0, -138, 138];
    } else if (mode === 'reach') {
      a = [0, 0, -96, -12];
    }
    const set = (g, ang, pv) => g.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ',' + pv[0] + ',' + pv[1] + ')');
    set(f.limbs.legL, a[0], L.legL); set(f.limbs.legR, a[1], L.legR);
    set(f.limbs.armL, a[2], L.armL); set(f.limbs.armR, a[3], L.armR);
  }
  function setBag(f, n) {
    const s = Math.min(1.28, Math.pow(1.035, n || 0));
    f.bag.setAttribute('transform', 'translate(' + ART.BAG_PIVOT[0] + ',' + ART.BAG_PIVOT[1] + ') scale(' + s.toFixed(3) + ') translate(' + (-ART.BAG_PIVOT[0]) + ',' + (-ART.BAG_PIVOT[1]) + ')');
  }
  function bubble(f, txt, cls, ms) {
    const b = f.bubble;
    b.textContent = txt || '';
    b.className = 'fig-bubble' + (txt ? ' on ' + (cls || '') : '');
    if (txt && ms !== 0) {
      /* tween 的 t 是延迟、dur 才是时长：气泡停「演出毫秒」，慢放时自然跟着拉长 */
      tween({ dur: ms || 1100, upd(p) { if (p >= 1) b.className = 'fig-bubble'; } });
    }
  }
  /* 「数字变了」的反馈：把背包 / 柜子上的徽章顶一下，印章环落在徽章自己的位置上。
     fx 层是视口坐标（#fx 为 fixed inset:0），量徽章的 rect 比另算一套锚点稳。 */
  function badgePunch(box) {
    const n = box && box.querySelector('.tk-badge');
    if (!n || n.classList.contains('off')) return;
    const r = n.getBoundingClientRect();
    n.style.animation = 'none';          /* 徽章刚被 innerHTML 重建，popIn 会盖掉这次 punch */
    n.style.transform = 'scale(1.45)';
    tween({ dur: 220, ease: easeOutBack, upd(p) { n.style.transform = 'scale(' + (1.45 - 0.45 * p).toFixed(3) + ')'; } });
    ringAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 26, 'ringStamp');
  }

  function walkTo(f, wx, wy, o) {
    o = o || {};
    const x0 = f.wx, y0 = f.wy;
    const dx = wx - x0, dy = wy - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    f.el.classList.add('moving');
    if (dist < 1.2) { f.wx = wx; f.wy = wy; applyFig(f, wx, wy); f.el.classList.remove('moving'); return Promise.resolve(); }
    /* 时长与快慢都交给 walkProfile：速度 = WALK_V × 该处 figScale，逐段积分。
       远处的人屏幕上更慢（与他缩小的比例相同），所以「每秒身长」全场一致，
       不会出现同一次入场里远的人比近的人跑得快。 */
    const plan = TC.walkProfile(x0, y0, wx, wy);
    const dur = o.dur || clamp(plan.total, 130, 2400);
    const seg = plan.t.length - 1;
    const spaceOf = function (p) {          /* 时间进度 → 路程进度 */
      const target = p * plan.total;
      let i = 1;
      while (i < seg && plan.t[i] < target) i++;
      const a = plan.t[i - 1], b = plan.t[i];
      return (i - 1 + (b > a ? (target - a) / (b - a) : 0)) / seg;
    };
    return new Promise(res => {
      tween({
        dur: dur, ease: o.ease || easeInOutQuad,
        upd(p) {
          const s = spaceOf(p);
          f.wx = x0 + dx * s; f.wy = y0 + dy * s;
          f.phase = (s * dist) / 4.2;
          applyFig(f, f.wx, f.wy, o.lift ? { lift: o.lift * Math.sin(Math.PI * s) } : null);
          setLimbs(f, 'walk');
        },
        after() {
          f.wx = wx; f.wy = wy; applyFig(f, wx, wy);
          setLimbs(f, 'idle'); f.el.classList.remove('moving');
          res();
        },
      });
    });
  }
  function squash(f, amt) {
    const s = TC.figScale(f.wy);
    const k = amt == null ? 0.18 : amt;
    return new Promise(res => {
      tween({ dur: 90, ease: easeOutQuad, upd(p) { applyFig(f, f.wx, f.wy, { sx: s * (1 - k * 0.35 * p), sy: s * (1 - k * 0.4 * p) }); } });
      tween({ t: 90, dur: 260, ease: easeOutBack, upd(p) { applyFig(f, f.wx, f.wy, { sx: s * (1 - k * 0.35 + k * 0.35 * p), sy: s * (1 - k * 0.4 + k * 0.4 * p) }); }, after() { applyFig(f, f.wx, f.wy); res(); } });
    });
  }
  function spinInPlace(f, turns, dur) {
    const s = TC.figScale(f.wy);
    return new Promise(res => {
      tween({
        dur: dur || 880, ease: easeOutQuint,
        upd(p) {
          const th = (turns || 2) * Math.PI * 2 * p;
          applyFig(f, f.wx, f.wy, { sx: s * Math.cos(th), sy: s });
          setLimbs(f, 'stiff');
        },
        after() { applyFig(f, f.wx, f.wy); setLimbs(f, 'idle'); res(); },
      });
    });
  }
  function layoutFigs() { figs.forEach(f => applyFig(f, f.wx, f.wy)); }

  /* ================= 站台自由移动（候车阶段） ================= */
  /* 边界交给 TC.clampWalk（站台是个近宽远窄的梯形），这里只拦角色互穿 */
  function blockedByFig(f, nx, ny) {
    for (let i = 0; i < figs.length; i++) {
      const g = figs[i];
      if (g === f) continue;
      const ddx = g.wx - nx, ddy = g.wy - ny;
      if (ddx * ddx + ddy * ddy < 17 * 17) return true;
    }
    return false;
  }
  function lobbyTick(dt) {
    if (!lobby.on || lobby.pid < 0) return;
    const f = figs[lobby.pid];
    if (!f) return;
    const dx = lobby.tx - f.wx, dy = lobby.ty - f.wy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1.4) { if (f.el.classList.contains('moving')) { f.el.classList.remove('moving'); setLimbs(f, 'idle'); } return; }
    /* 自由走动**也**乘该处 figScale —— 和 walkTo 同一条速度律。
       此前这里是定值 150 单位/秒：站台近端与柜前那一带的纵深比差到 1.5 倍，
       同一个世界速度等于「越往远处拖越像在飞奔」（他缩小了，脚下却没慢）。 */
    const step = Math.min(d, (LOBBY_V * TC.figScale(f.wy) * dt) / 1000);
    const nx = f.wx + (dx / d) * step, ny = f.wy + (dy / d) * step;
    let ok = false;
    if (!blockedByFig(f, nx, ny)) { f.wx = nx; f.wy = ny; ok = true; }
    else if (!blockedByFig(f, nx, f.wy)) { f.wx = nx; ok = true; }
    else if (!blockedByFig(f, f.wx, ny)) { f.wy = ny; ok = true; }
    f.phase += step / 4.2;
    applyFig(f, f.wx, f.wy);
    setLimbs(f, ok ? 'walk' : 'idle');
    if (ok) f.el.classList.add('moving');
  }

  /* ================= 锚点（世界 → 视口，纯算术，不测 DOM） ================= */
  /* 车内筹码的中线：补票的落点 —— 也是发牌时票从车里起飞的位置 */
  const carAnchor = function (i) {
    const L = TC.carLane(S.N, i);
    const f = L.floor.at(L.d0 + (L.d1 - L.d0) * 0.30);
    return toScreen((f.l + f.r) / 2, f.y);
  };
  /* 车顶正上方：补票飞入的起飞点 */
  const carAbove = function (i) {
    const L = TC.carLane(S.N, i);
    return toScreen(L.box.x + L.box.w / 2, L.y0 - 18);
  };
  const lockerAnchor = function (i) {
    const b = TC.lockerSpot(S.N, i);
    return toScreen(b.x, b.y);
  };
  const homeStand = i => TC.homeSpot(S.N, i);

  function buildBoard() {
    $('#scenery').innerHTML = ART.scenery(TC);
    const packs = $('#packs'), lockers = $('#lockers'), coach = $('#coach');
    packs.innerHTML = ''; lockers.innerHTML = ''; coach.innerHTML = '';
    view = { packs: [], lockers: [], cars: [], loco: null };
    S.players.forEach(function (p, i) {
      const pb = TC.packSpot(S.N, i), lb = TC.lockerSpot(S.N, i);
      /* 背包随纵深缩放：包身底边压在锚点上。--fs 就是这一处的纵深比本身，
         包上的字与徽章跟着包一起「近大远小」（字号另有可读性地板，见 style.css）。 */
      const pk = el(ART.pack(p));
      place(pk, pb.x - pb.w * pb.s / 2, pb.y - pb.h * pb.s, pb.w * pb.s, pb.h * pb.s);
      pk.style.setProperty('--fs', pb.s.toFixed(3));
      /* 包名墨色跟着包身亮度走：浅包深字、暗包白字（见 game.js 的 inkOn） */
      const io = TC.inkOn(p.colors.bag);
      pk.style.setProperty('--name-ink', io.ink);
      pk.style.setProperty('--name-halo', io.halo);
      packs.appendChild(pk);
      const lk = el(ART.locker(p, lb));
      place(lk, lb.x - lb.w / 2, lb.y - lb.h / 2, lb.w, lb.h);
      lockers.appendChild(lk);
      view.packs.push(pk); view.lockers.push(lk);
    });
    S.cars.forEach(function (car, i) {
      const lane = TC.carLane(S.N, i);
      const cc = document.createElement('div');
      cc.className = 'coach-car';
      cc.innerHTML = ART.carShell(lane) +
        '<div class="cr-chips-box">' + ART.carChips(car.tickets, lane) + '</div>' +
        ART.carNo(lane.label) + ART.carTot(0) +
        '<div class="car-stop">本轮无人光顾</div>' +
        '<div class="car-short">车票已全部放置完</div>';
      place(cc, lane.box.x, lane.box.y, lane.box.w, lane.box.h);
      coach.appendChild(cc);
      view.cars.push({
        lane: lane, node: cc,
        chips: cc.querySelector('.cr-chips-svg'),
        leaves: cc.querySelectorAll('.cr-door'),
        roof: cc.querySelector('.roof-total'),
        shortTimer: 0, shortTold: false,
      });
      refreshCar(i);
    });
    /* 车头也包一层 div：.coach-car 有的它也得有（position:absolute + 吃事件），
       里面的 .lo-svg 靠 inset:0 铺满，和车厢的 .cr-svg 一个套路 */
    const lb = TC.locoBox();
    const lo = document.createElement('div');
    lo.className = 'loco';
    lo.innerHTML = ART.loco(lb);
    place(lo, lb.box.x, lb.box.y, lb.box.w, lb.box.h);
    coach.appendChild(lo);
    view.loco = lo;
  }
  /* 「车票已全部放置完」只是一句**本轮**的通报：药丸正落在筹码带上，一直摊着就看不见车里
     还剩什么票 —— 而「还剩什么票」恰恰是这一手要读的信息。摊几秒就收（挂 `.short-told`：
     药丸淡出、筹码恢复原亮度），`.short` 状态类本身留着 —— 屏幕的类仍与 S.cars[i].short 逐轮
     一致，能摘掉它的只有下一轮补票。计时是墙钟，不跟 --fx-pace：慢放是演出的事，通报的停留
     不该被拉成 8 秒。 */
  const SHORT_TOLD = 3200;
  function refreshCar(i) {
    const car = S.cars[i], v = view.cars[i];
    const tot = TC.total(car.tickets);
    v.node.querySelector('.cr-chips-box').innerHTML = ART.carChips(car.tickets, v.lane);
    v.chips = v.node.querySelector('.cr-chips-svg');
    v.roof.textContent = '共 ' + tot + ' 张';
    /* 关门与「已放完」都是**本轮**的舞台效果，所以每轮都拿 S 重新盖一遍。
       从前这两句是只 add 不 remove，关过一次的车会一直熄着灯到重开。 */
    v.node.classList.toggle('closed', !!car.closed);
    v.node.classList.toggle('short', !!car.short);
    if (car.short) {
      /* 同一个短票回合里 updateAll / refreshCar 会连着刷好几遍，计时只许起一次 */
      if (!v.shortTold && !v.shortTimer) {
        v.shortTimer = setTimeout(function () {
          v.shortTimer = 0;
          v.shortTold = true;
          v.node.classList.add('short-told');
        }, SHORT_TOLD);
      }
    } else {
      if (v.shortTimer) { clearTimeout(v.shortTimer); v.shortTimer = 0; }
      if (v.shortTold) { v.shortTold = false; v.node.classList.remove('short-told'); }
    }
  }
  /* 双开滑门：门叶沿「纵深方向」向自己那一端缩，缝从中间裂开又合拢。
     门轴 data-hy 写在车门组上（一门一个），样式层不许碰 transform。
     dur 只给「无人光顾」那一拍催快用（见 stepCloseCars），其余开合一律走默认时长。 */
  function setDoor(leaf, open, anim, dur) {
    const hy = parseFloat(leaf.getAttribute('data-hy')) || 0;
    const from = leaf.getAttribute('data-open') === '1' ? 0.06 : 1;
    const target = open ? 0.06 : 1;
    leaf.setAttribute('data-open', open ? '1' : '0');
    const write = function (s) {
      leaf.setAttribute('transform',
        'translate(0,' + hy + ') scale(1,' + s.toFixed(4) + ') translate(0,' + (-hy) + ')');
    };
    if (!anim || !fxOn) { write(target); return Promise.resolve(); }
    return new Promise(res => {
      tween({
        dur: dur || (open ? 320 : 260), ease: open ? easeOutQuint : easeInQuad,
        upd(p) { write(from + (target - from) * p); },
        after() { res(); },
      });
    });
  }
  function doorsOf(v, open, anim, dur) {
    const jobs = [];
    Array.prototype.forEach.call(v.leaves, function (leaf) { jobs.push(setDoor(leaf, open, anim, dur)); });
    return Promise.all(jobs);
  }
  function allDoors(open, anim) {
    const jobs = [];
    view.cars.forEach(function (v) { jobs.push(doorsOf(v, open, anim)); });
    return Promise.all(jobs);
  }
  /* 柜门向上卷起：柜内从下往上露出来（门轴在门顶，见 art.js） */
  function setLockerDoor(i, open, anim) {
    const lk = view.lockers[i];
    if (!lk) return Promise.resolve();
    const g = lk.querySelector('.lk-door');
    const hy = parseFloat(g.getAttribute('data-hy')) || 0;
    const write = function (s) {
      g.setAttribute('transform',
        'translate(0,' + hy + ') scale(1,' + s.toFixed(3) + ') translate(0,' + (-hy) + ')');
    };
    const from = open ? 1 : 0.08, target = open ? 0.08 : 1;
    if (!anim || !fxOn) { write(target); return Promise.resolve(); }
    return new Promise(res => {
      tween({
        dur: 320, ease: open ? easeInQuad : easeOutQuad,
        upd(p) { write(from + (target - from) * p); },
        after() { res(); },
      });
    });
  }
  /* 单人的四处信息（角色背包鼓起、背包徽章、柜子徽章、柜内陈列）一次刷新。
     结算里要按人头刷 —— 整块 updateAll 会把车厢筹码一起重画，
     而正在飞票的车厢，筹码正是那一幕的起点，不能提前清空。 */
  function updatePlayer(i) {
    const p = S.players[i];
    setBag(figs[i], TC.total(p.bag));
    const pb = view.packs[i].querySelector('.pk-badge');
    if (pb) pb.innerHTML = ART.badge(p.bag);
    const lb = view.lockers[i].querySelector('.lk-badge');
    if (lb) lb.innerHTML = ART.badge(p.locker);
    const li = view.lockers[i].querySelector('.lk-inner');
    if (li) li.innerHTML = ART.lockerInner(p.locker, TC.lockerSpot(S.N, i));
  }
  function updateAll() {
    for (let i = 0; i < S.players.length; i++) updatePlayer(i);
    S.cars.forEach(function (car, i) { refreshCar(i); });
    $('#tbRound').textContent = '第 ' + Math.max(1, S.round) + ' 轮';
    $('#tbPool').textContent = '票池 ' + TC.poolLeft(S);
    $('#tbRound').setAttribute('data-round', S.round);
  }
  function snapAll() {
    figs.forEach(function (f) {
      /* 站台上的人回自己的站位；站在柜前的人该被摆回柜前 —— 读档续玩时
         把人一律摆回家，会让「下一回合从柜子走回来」变成从站台走回来。 */
      const h = f.p.at === 'locker' ? TC.lockerStand(S.N, f.i) : homeStand(f.i);
      f.wx = h.x; f.wy = h.y;
      applyFig(f, f.wx, f.wy);
      setLimbs(f, 'idle');
      f.el.classList.remove('moving');
    });
  }

  /* ================= 屏幕 / 弹层 ================= */
  function show(id) {
    const n = $('#' + id);
    if (n) n.classList.add('on');
  }
  function hide(id) {
    const n = $('#' + id);
    if (n) n.classList.remove('on');
  }
  function only(id) {
    ['screen-menu', 'screen-setup', 'screen-game', 'screen-over'].forEach(function (s) {
      if (s === id) show(s); else hide(s);
    });
  }
  function curtainFor(pid, kicker, hint) {
    return new Promise(function (res) {
      $('#curtainKicker').textContent = kicker || '请把手机交给';
      $('#curtainName').textContent = S.players[pid].name;
      $('#curtainHint').textContent = hint || '确认后进入你的回合 · 其他人请勿偷看';
      show('curtain');
      $('#curtainOk').onclick = function () { sfx('tap'); hide('curtain'); res(); };
    });
  }

  /* HUD：一句提示 + 一排动作按钮 + 一排选择项。
     带 anchor 的按钮 = 点开选择气泡的那颗，气泡的尖角对准它。 */
  function hud(prompt, btns, list, cls) {
    $('#hudPrompt').className = 'hud-prompt' + (cls ? ' ' + cls : '');
    $('#hudPrompt').textContent = prompt || '';
    const b = $('#hudBtns');
    b.innerHTML = '';
    let anchor = null;
    (btns || []).forEach(function (it) {
      const n = document.createElement('button');
      n.className = 'btn ' + (it.cls || 'btn-ghost');
      if (it.id) n.id = it.id;                       /* 只有结算闸门要 id：测试与外部得认得出它 */
      n.textContent = it.label;
      if (it.dis) n.disabled = true;
      n.onclick = function () { sfx('tap'); it.fn(); };
      if (it.anchor) anchor = n;
      b.appendChild(n);
    });
    const l = $('#hudList'), li = $('#hudListIn');
    li.innerHTML = '';
    (list || []).forEach(function (it) {
      const n = document.createElement('button');
      n.className = 'chip-btn' + (it.on ? ' on' : '') + (it.cls ? ' ' + it.cls : '');
      n.innerHTML = it.label;
      if (it.dis) n.disabled = true;
      n.onclick = function () { sfx('tap'); it.fn(); };
      li.appendChild(n);
    });
    l.classList.toggle('on', li.childElementCount > 0);
    if (anchor && li.childElementCount) {
      /* 气泡摆在点开它的那颗按钮正上方。宽度是筹码说了算（顺走可能只有一颗，
         气泡就窄），光靠左边对齐的话按钮在右边时尖角根本够不着 —— 所以整只气泡
         跟着锚点走，再夹回 HUD 的内容框：--left-x 夹住气泡自己，--tail-x 夹在圆角之内。 */
      const hud = $('#hud'), cs = getComputedStyle(hud), hr = hud.getBoundingClientRect();
      const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
      const padX = parseFloat(cs.paddingLeft);
      const originX = hr.left + bl;                    /* 绝对定位的基准 = HUD 的 padding 盒 */
      const boxW = hr.width - bl - br;
      const a = anchor.getBoundingClientRect(), w = l.offsetWidth;
      const c = a.left + a.width / 2 - originX;        /* 锚点中心，同一个坐标系 */
      const left = Math.min(Math.max(padX, c - w / 2), boxW - padX - w);
      l.style.setProperty('--left-x', Math.round(left) + 'px');
      l.style.setProperty('--tail-x', Math.round(Math.min(Math.max(22, c - left), w - 22)) + 'px');
    }
    syncPeekLift();                                  /* 卡片要叠在选择气泡上面（见那只函数） */
  }

  /* ================= 选车厢 / 存放 / 顺走 ================= */
  function carLabel(i) {
    const car = S.cars[i], t = TC.total(car.tickets);
    return '<b>' + (i + 1) + ' 号</b> ' + (t ? t + ' 张' : '空车');
  }
  function pickOne(pid) {
    return new Promise(function (done) {
      const cur = { type: null, car: null, target: null };
      const p = S.players[pid];
      pickLive = true;                               /* 你的回合 = 可以拍背包 / 开柜子看一眼 */
      function render() {
        /* 站在柜前的人也有回合，但只有一件事可做：走回站台（存放那两个回合的代价）。
           所以这里不摆三选一 —— 一个按钮直接提交，也算「轮到过他」。
           票在柜里，所以连自己柜里的内容都一并告诉他，省得回头去数柜子。 */
        if (TC.atLocker(S, pid)) {
          cur.type = 'return';
          hud(p.name + '，上一回合存放了，本回合只能回到站台', [
            { label: '回到站台', cls: 'btn-primary', fn: submit },
          ], []);
          return;
        }
        const btns = [];
        const storeN = TC.total(p.bag);
        btns.push({ label: '选车厢', cls: cur.type === 'car' ? 'btn-primary' : 'btn-ghost', anchor: cur.type === 'car', fn: function () { cur.type = 'car'; cur.target = null; render(); } });
        btns.push({ label: '存放' + (storeN ? '(' + storeN + ')' : ''), cls: cur.type === 'store' ? 'btn-primary' : 'btn-ghost', dis: !TC.legalStore(S, pid), fn: function () { cur.type = 'store'; cur.car = null; cur.target = null; render(); } });
        const tg = TC.pickableTargets(S, pid);
        btns.push({ label: '顺走', cls: cur.type === 'swipe' ? 'btn-primary' : 'btn-ghost', anchor: cur.type === 'swipe', dis: !tg.length, fn: function () { cur.type = 'swipe'; cur.car = null; render(); } });
        const ok = (cur.type === 'car' && cur.car != null) || cur.type === 'store' || (cur.type === 'swipe' && cur.target != null);
        btns.push({ label: '确认提交', cls: 'btn-primary', dis: !ok, fn: submit });
        let list = [], prompt = p.name + '，选择一个行动（三选一）';
        if (cur.type === 'car') {
          prompt = '上哪节车厢？车上票数公开';
          S.cars.forEach(function (car, i) {
            list.push({ label: carLabel(i), on: cur.car === i, fn: function () { cur.car = i; render(); } });
          });
        } else if (cur.type === 'store') {
          prompt = '把背包里的 ' + storeN + ' 张票存进储物柜，下一回合回到站台';
        } else if (cur.type === 'swipe') {
          prompt = '顺走谁的背包？';
          tg.forEach(function (t) {
            const q = S.players[t];
            list.push({ label: q.name + ' · ' + TC.total(q.bag) + ' 张', on: cur.target === t, fn: function () { cur.target = t; render(); } });
          });
          if (!tg.length) prompt = '现在没有可以顺走的目标';
        }
        hud(prompt, btns, list);
      }
      function submit() {
        const pick = cur.type === 'car' ? { type: 'car', car: cur.car }
          : cur.type === 'store' ? { type: 'store' }
            : cur.type === 'return' ? { type: 'return' }
              : { type: 'swipe', target: cur.target };
        if (!TC.submitPick(S, pid, pick)) { sfx('deny'); return; }
        sfx('confirm');
        pickLive = false;
        closePeek(true);                             /* 立刻放下柜门：下一拍就是结算演出在开它 */
        hud('已提交 · 交给下一位', [], []);
        done();
      }
      render();
    });
  }

  /* ================= 看一眼：点背包 / 柜子看里面有什么 =================
     只在「你的回合」（pickLive）里可点 —— 那正是「选择行动前」那段窗口，也是唯一
     能安心翻看的时刻（结算演出中途门是动画在开的，不能抢）。
     看柜子会把柜门卷上去、收起时放下：柜内那套陈列本来就在柜里画着，卡片只是替它
     放大到读得清。背包没有「打开」这个动作，所以只出卡片。 */
  let peek = null, pickLive = false;

  function syncPeekLift() {
    const l = $('#hudList'), pk = $('#peek');
    if (!pk) return;
    /* 选择气泡也开着的时候，卡片叠在它上面 —— 「顺走」前挨个翻背包正是两只都要用的场景 */
    const lift = 8 + (l && l.classList.contains('on') ? l.offsetHeight + 8 : 0);
    pk.style.setProperty('--peek-b', lift + 'px');
  }
  function closePeek(instant) {
    if (!peek) return;
    const p = peek;
    peek = null;
    $('#peek').classList.remove('on');
    if (p.kind === 'locker') setLockerDoor(p.pid, false, !instant);
  }
  function openPeek(pid, kind) {
    $('#peekBody').innerHTML = ART.peekCard(S.players[pid], kind);
    peek = { pid: pid, kind: kind };
    $('#peek').classList.add('on');
    syncPeekLift();
    if (kind === 'locker') setLockerDoor(pid, true, true);
    sfx('tap');
  }
  /* 舞台上的点是委托给 #stage 的：背包 / 柜子开着 pointer-events，其余层是 none，
     所以落在空地上的一下也收得到 —— 正好拿来当「收起卡片」。 */
  function tapBoard(e) {
    if (!pickLive || !S) return;
    const hit = e.target && e.target.closest ? e.target.closest('.pack, .locker') : null;
    if (!hit) { closePeek(); return; }
    const pid = Number(hit.getAttribute('data-pid'));
    const kind = hit.classList.contains('locker') ? 'locker' : 'bag';
    if (peek && peek.pid === pid && peek.kind === kind) { closePeek(); return; }
    closePeek();
    openPeek(pid, kind);
  }

  /* ================= 补票 ================= */
  async function animRefill(ev) {
    sfx('slide');
    await allDoors(true, true);
    for (let i = 0; i < ev.adds.length; i++) {
      const a = ev.adds[i];
      const from = carAbove(a.car), to = carAnchor(a.car);
      for (let c = 0; c < 4; c++) {
        for (let k = 0; k < a.tokens[c]; k++) {
          const node = spawn(ART.ticket(c), 'fly-tk', { x: from.x + (k - 0.5) * 10, y: from.y });
          sfx('paper');
          flyTo(node, to, { dur: 320, lift: 10, rot: 30 });
          vanish(node, 260, 140);
        }
      }
      const n = a.tokens[0] + a.tokens[1] + a.tokens[2] + a.tokens[3];
      floatAt(to, '+' + n, '');
      await fxWait(160);
    }
    ev.short.forEach(function (s) {
      hud('', [], []);
      bannerAt('车票已全部放置完', '');
      sfx('warn');
    });
    if (ev.adds.length) sfx('paper');
    await fxWait(220);
    if (ev.lastRound) {
      shakeAdd(0.45); hitStop(90); flashScreen(0.3);
      bannerAt('最后一轮', 'bannerLast');
      const bulbs = $$('.lm-bulb');
      bulbs.forEach(function (b) { b.classList.add('flicker'); setTimeout(function () { b.classList.remove('flicker'); }, 1600); });
      sfx('warn');
      await fxWait(1000);
    }
    updateAll();
  }

  /* ================= 结算四步 ================= */
  async function stepStore(ev) {
    if (!ev.store.length && !ev.ret.length) return;
    /* 两股人流在同一个慢放档里对着走：上一轮留在柜前的人从柜子走回站台，这一轮存放的人从站台走到柜前。
       「回站台」是上一回合存放的代价，理当归在这条动线里 —— 于是它在画面上与「去存放」互为镜像。 */
    const backs = ev.ret.map(function (pid) {
      return (async function () {
        const f = figs[pid], h = homeStand(pid);
        bubble(f, '回到站台', '', 900);
        await walkTo(f, h.x, h.y);
      })();
    });
    /* 所有存放者同时起步：走、开门、飞票、关门四拍各自成线，不再一个人演完再换下一个。
       到柜的先后由路程决定（家在前排的离柜子近，会先到、先开柜），但出发是同一拍 ——
       不是谁在等谁。飞票按人头摊预算（总数封顶 16）：6 个人一起开柜时 48 个提升层比等得久更伤低端机，
       而「到底存了几张」由气泡、`存放 N 张` 和柜内陈列补齐，少飞几张看不出来。 */
    const cap = Math.max(3, Math.min(8, Math.round(16 / ev.store.length)));
    /* 每下关门的震动按人头摊：6 个人一起关不该震出 0.6（那是夺冠级），
       摊完总量与单人存放一样是 0.1 */
    const dShake = 0.1 / ev.store.length;
    const jobs = ev.store.map(function (w) {
      return (async function () {
        const f = figs[w.p];
        const stand = TC.lockerStand(S.N, w.p);
        bubble(f, '存放 ' + w.total + ' 张', 'good', 1200);
        await walkTo(f, stand.x, stand.y);
        await setLockerDoor(w.p, true, true);
        sfx('locker');
        await fxWait(120);
        const to = lockerAnchor(w.p);
        const src = toScreen(stand.x, stand.y - 30);
        let idx = 0;
        const flies = [];
        for (let c = 0; c < 4; c++) {
          for (let k = 0; k < w.tokens[c]; k++) {
            flies.push((function (c2, d) {
              return async function () {
                await fxWait(d * 70);
                const node = spawn(ART.ticket(c2), 'fly-tk',
                  { x: src.x + (d % 3 - 1) * 7, y: src.y - (d % 2) * 6 });
                flyTo(node, { x: to.x + (d % 2 ? 7 : -7), y: to.y }, { dur: 300, lift: 22, rot: 40 });
                vanish(node, 250, 160);
                sfx('paper');
              };
            })(c, idx));
            idx++;
          }
        }
        await Promise.all(flies.slice(0, cap).map(fn => fn()));
        await fxWait(200);
        await setLockerDoor(w.p, false, true);
        sfx('locker'); shakeAdd(dShake); hitStop(40);
        updatePlayer(w.p);
        badgePunch(view.lockers[w.p]);
      })();
    });
    await Promise.all(backs.concat(jobs));
  }

  /* 无人光顾的车厢一起关门：这是一拍「这几趟车都没等到人」的合奏，
     逐节排队关门会把一拍拖成好几条慢吞吞的队尾。门比别处快一倍（130 对 260）：
     「啪」地扣上，不是慢慢合拢。状态字「本轮无人光顾」由 .closed 这条 CSS 过场浮起来
     （见 style.css 的 .car-stop），这里只管合门、震屏、顿一下。 */
  async function stepCloseCars(ev) {
    if (!ev.close.length) return;
    hud('无人光顾的车厢即将关门', [], []);
    sfx('slideShut');
    await Promise.all(ev.close.map(function (c) {
      const v = view.cars[c.car];
      return doorsOf(v, false, true, 130).then(function () {
        v.node.classList.add('closed');
      });
    }));
    shakeAdd(0.22);
    hitStop(50);
    await fxWait(240);
  }

  async function stepMove(ev) {
    const jobs = [];
    /* 登车要跨过站台右缘 + 车壁，所以拆成三段：走到车门正的站台边 → 小跳翻过
       车壁落到地板左缘 → 在车里走到自己的站位。一步跨 50 单位会像瞬移。 */
    ev.board.forEach(function (b) {
      const f = figs[b.p];
      jobs.push((async function () {
        bubble(f, '上车', '', 900);
        const L = TC.carLane(S.N, b.car);
        const yDoor = (L.y0 + L.y1) / 2;
        const inner = L.floor.at(TC.depthAt(yDoor)).l;
        const stand = TC.clampWalk(inner, yDoor);
        await walkTo(f, stand.x, stand.y);
        await walkTo(f, inner + 4, yDoor, { lift: 12, dur: 300, ease: easeOutQuad });
        await walkTo(f, b.x, b.y);
        await squash(f, 0.3);
        bubble(f, '', '', 0);
      })());
    });
    /* 顺走：走到目标背包前 */
    const byTarget = {};
    ev.swipe.forEach(function (s) {
      if (!byTarget[s.target]) byTarget[s.target] = [];
      byTarget[s.target].push(s.p);
    });
    Object.keys(byTarget).forEach(function (t) {
      const list = byTarget[t], st = TC.packStand(S.N, Number(t));
      list.forEach(function (pid, k) {
        const f = figs[pid];
        const off = (k - (list.length - 1) / 2) * 24;
        jobs.push((async function () {
          bubble(f, list.length > 1 ? '抢！' : '顺走', 'bad', 900);
          await walkTo(f, st.x + off, st.y);
          setLimbs(f, 'reach');
          await fxWait(220);
          const pk = view.packs[Number(t)];
          pk.style.transform = 'translateX(' + (6 * (k % 2 ? 1 : -1)) + 'px)';
          tween({ dur: 220, upd(p) { pk.style.transform = 'translateX(' + ((k % 2 ? 1 : -1) * 6 * Math.sin(Math.PI * 3 * p)).toFixed(2) + 'px)'; } });
          tween({ t: 240, dur: 1, upd() { pk.style.transform = ''; } });
        })());
      });
    });
    /* 分组并行，同时存活补间不超过 8 个 */
    const chunks = TC.chunked(jobs, 8);
    for (let i = 0; i < chunks.length; i++) await Promise.all(chunks[i]);
  }

  async function stepDeal(ev) {
    const jobs = [];
    ev.deal.forEach(function (d) {
      const v = view.cars[d.car];
      if (d.winner != null) {
        const f = figs[d.winner];
        jobs.push((async function () {
          setLimbs(f, 'cheer'); bubble(f, '全归我！', 'good', 1400);
          sfx('score');
          const from = carAnchor(d.car);
          let idx = 0;
          const tgts = [];
          for (let c = 0; c < 4; c++) for (let k = 0; k < d.tokens[c]; k++) tgts.push(c);
          for (let i = 0; i < tgts.length && i < 8; i++) {
            await fxWait(i * 60);
            const node = spawn(ART.ticket(tgts[i]), 'fly-tk', { x: from.x + (i % 3 - 1) * 10, y: from.y });
            const dest = toScreen(f.wx, f.wy - 26);
            flyTo(node, dest, { dur: 420, lift: 34, rot: 90, fadeOut: true });
            vanish(node, 300, 160);
            sfx('paper');
          }
          await fxWait(260);
          updatePlayer(d.winner);
          badgePunch(view.packs[d.winner]);
          burst(toScreen(f.wx, f.wy), 8, 'gold', 30);
          sfx('bag');
          setLimbs(f, 'idle'); bubble(f, '', '', 0);
        })());
      } else {
        d.contested.forEach(function (pid, k) {
          const f = figs[pid];
          jobs.push((async function () {
            await fxWait(120 + k * 90);
            bubble(f, '空手！', 'bad', 1400);
            shakeAdd(k === 0 ? 0.18 : 0.08); if (k === 0) hitStop(30);
            sfx('spin');
            await spinInPlace(f, 2, 860);
            burst(toScreen(f.wx, f.wy), 7, 'dust', 26);
            bubble(f, '', '', 0);
          })());
        });
      }
    });
    ev.swipe.forEach(function (s) {
      const f = figs[s.p];
      if (s.ok) {
        const tg = figs[s.target];
        jobs.push((async function () {
          sfx('score');
          flashScreen(0.22); shakeAdd(0.3); hitStop(60);
          const from = toScreen(tg.wx, tg.wy - 24);
          let idx = 0;
          for (let c = 0; c < 4; c++) for (let k = 0; k < s.tokens[c]; k++) {
            const node = spawn(ART.ticket(c), 'fly-tk', { x: from.x + (idx % 3 - 1) * 9, y: from.y });
            idx++;
            const dest = toScreen(f.wx, f.wy - 26);
            flyTo(node, dest, { dur: 400, lift: 30, rot: 80, fadeOut: true });
            vanish(node, 300, 160);
            sfx('paper');
          }
          bubble(f, '得手！', 'bad', 1500);
          stampAt(toScreen(tg.wx, tg.wy - 26), '得手', 'stampGot', false);
          await fxWait(300);
          updatePlayer(s.p); updatePlayer(s.target);
          badgePunch(view.packs[s.p]); setLimbs(f, 'idle');
          await fxWait(500);
          bubble(f, '', '', 0);
        })());
      } else {
        jobs.push((async function () {
          bubble(f, '空手！', 'bad', 1400);
          burst(toScreen(f.wx, f.wy), 6, 'dust', 24);
          sfx('spin');
          await spinInPlace(f, 2, 820);
          bubble(f, '', '', 0);
        })());
      }
    });
    const chunks = TC.chunked(jobs, 6);
    for (let i = 0; i < chunks.length; i++) await Promise.all(chunks[i]);
  }

  async function animResolve(ev) {
    measureOrigin();
    hud('结算中…', [], []);
    /* 结算四步按 40% 播：这是整局里最该看清的一段，原速下开门、飞票、抢空全是一晃而过。
       只包住「行动」，回站台的收尾照原速走 —— 那句号不该也跟着拖慢。 */
    setPace(SLOW);
    try {
      await stepStore(ev);
      await stepCloseCars(ev);
      await stepMove(ev);
      await stepDeal(ev);
    } finally {
      /* 出错也要把节奏还回去，否则整局卡在慢动作里再也快不起来 */
      setPace(1);
    }
    /* 全车滑门合拢收尾：这一轮谁上过车都已经站好了，关门就是「本轮结束」的句号。
       到这里「行动」演完了，人就留在各自的位置上 —— 回站台与补票都排在战报的
       「确认」之后（见 sweepHome / playRound），演出与下一轮之间隔着一张本轮战报。 */
    sfx('slideShut');
    await allDoors(false, true);
    updateAll();
  }

  /* 战报确认后的散场：全体走回站台。**刚存放的那几位留在柜前** —— 他下一回合还站在
     那儿等「走回站台」那个动作（见 stepStore 的 backs），一起扫回去，那条两回合的
     动线就断了。 */
  async function sweepHome() {
    hud('回到站台', [], []);
    const backs = figs.map(function (f, i) {
      if (f.p.at === 'locker') return Promise.resolve();
      return (async function () {
        await fxWait(i * 60);
        const h = homeStand(i);
        await walkTo(f, h.x, h.y);
      })();
    });
    for (let i = 0; i < backs.length; i += 4) await Promise.all(backs.slice(i, i + 4));
    updateAll();
  }

  /* ================= 一轮 ================= */

  /* ---- 演出日志文案：只描述发生了什么，不参与任何判定 ---- */
  const CN = TC.TC_COLOR;
  function pickText(pid, pick) {
    const p = S.players[pid];
    if (!pick) return p.name + ' → 无行动';
    if (pick.type === 'car') return p.name + ' → 上 ' + (pick.car + 1) + ' 号车厢';
    if (pick.type === 'store') return p.name + ' → 存放 ' + TC.total(p.bag) + ' 张';
    if (pick.type === 'swipe') return p.name + ' → 顺走 ' + S.players[pick.target].name;
    /* 回站台不在这里记：它的文案由结算的 ret 那条承担（还顺带覆盖「没提交也放回去」的兜底），
       记两遍会让人以为他做了两个动作 */
    if (pick.type === 'return') return null;
    return p.name + ' → ?';
  }
  function tokensText(t) {
    const out = [];
    for (let c = 0; c < 4; c++) if (t[c]) out.push(CN[c] + t[c]);
    return out.length ? out.join(' ') : '空';
  }
  function logRefill(ev) {
    const parts = ev.adds.map(function (a) { return (a.car + 1) + ' 号 +' + TC.total(a.tokens); });
    logLine('act', '第 ' + S.round + ' 轮补票：' + (parts.length ? parts.join('、') : '没有车厢可补') + '，票池剩 ' + TC.poolLeft(S));
    ev.short.forEach(function (s) {
      logLine('warn', (s.car + 1) + ' 号车厢只补了 ' + s.placed + '/' + s.need + ' 张（票池见底）');
    });
    if (ev.lastRound) logLine('warn', '票池已空 · 本轮为最后一轮');
  }
  function logResolve(rev) {
    rev.ret.forEach(function (pid) { logLine('act', S.players[pid].name + ' 从储物柜走回站台（本回合只能做这一件事）'); });
    rev.store.forEach(function (w) { logLine('good', S.players[w.p].name + ' 存放 ' + w.total + ' 张（' + tokensText(w.tokens) + '）'); });
    rev.close.forEach(function (c) { logLine('act', (c.car + 1) + ' 号车厢无人光顾，关门（车内 ' + TC.total(c.tokens) + ' 张留存）'); });
    rev.board.forEach(function (b) { logLine('act', S.players[b.p].name + ' 登上 ' + (b.car + 1) + ' 号车厢'); });
    rev.swipe.forEach(function (s) {
      const t = S.players[s.target].name;
      if (s.ok) logLine('good', S.players[s.p].name + ' 顺走 ' + t + ' 的 ' + TC.total(s.tokens) + ' 张（' + tokensText(s.tokens) + '）');
      else logLine('warn', S.players[s.p].name + ' 顺走 ' + t + ' 失败（' +
        ({ crowd: '多人抢同一目标', stored: '对方已存放', empty: '对方背包已空' }[s.reason] || s.reason) + '）');
    });
    rev.deal.forEach(function (d) {
      if (d.winner != null) logLine('good', (d.car + 1) + ' 号车厢：' + S.players[d.winner].name + ' 独得 ' + d.gain + ' 张（' + tokensText(d.tokens) + '）');
      else logLine('warn', (d.car + 1) + ' 号车厢：' + d.contested.map(function (p) { return S.players[p].name; }).join('、') + ' 相争，全部空手');
    });
  }
  function logRank(rank) {
    logLine('good', '本局结束 · 冠军：' + rank.filter(function (r) { return r.place === 1; }).map(function (r) { return r.name; }).join('、'));
    rank.forEach(function (r) {
      logLine('act', '第 ' + r.place + ' 名 ' + r.name + '：' + r.total + ' 分（柜 ' + TC.total(r.locker) + ' + 背包 ' + TC.total(r.bag) + '）');
    });
  }

  async function playRound() {
    if (!S || S.phase === 'over') return;
    /* 倍速是玩家设定，跨轮保留 —— 否则每轮都要重按一次快进，正是最烦人的那种交互 */
    const ev = TC.placeTickets(S, RNG);
    logRefill(ev);
    updateAll();
    await animRefill(ev);
    if (S.lastRound && TC.poolLeft(S) === 0) bannerAt('最后一轮 · 本票发完即结算', 'bannerLast');
    await runPicks();
  }

  /* 选择 → 结算 → 演出 → 交给下一轮。拆出来是为了读档：pick 档恢复时补票已经发生，
     不能再走一遍 playRound（会重复补票），但后面这一整段完全一样。 */
  async function runPicks() {
    saveNow('pick');
    await pickAll();
    await waitSettle();
    /* 选择一律等结算之后才写进日志：日志随时能打开，不能让它提前泄露尚未揭晓的选择。
       文案也得在结算前抓下来 —— 结算会把背包清空，之后再写就成了「存放 0 张」。
       pickText 对「回到站台」返回 null（那条文案由 logResolve 的 ret 承担），这里滤掉。 */
    const choiceTexts = S.submitted.map(function (pid) { return pickText(pid, S.picks[pid]); }).filter(Boolean);
    const rev = TC.resolveRound(S);
    choiceTexts.forEach(function (t) { logLine('act', t); });
    logResolve(rev);
    /* ⚠ 结果先落盘，演出后开演：演出中途刷新，这一轮也不丢 —— 重放不了动画，但结果已经在手上了 */
    saveNow('show');
    await animResolve(rev);
    clearFx();
    /* 演完摊出本轮战报：此刻大家还站在各自的位置上（车里 / 柜前 / 包边），
       点了「确认」才算散场 —— 回站台、补票、开下一轮。 */
    await waitSummary(rev);
    await sweepHome();
    clearFx();
    if (TC.checkEnd(S)) { finish(); return; }
    playRound();
  }

  async function pickAll() {
    hud('等待大家选择…', [], []);
    const act = TC.activePlayers(S);
    /* 柜前的人不再被跳过（从前是自动替他执行），所以要说明为什么他的回合里只有一件事可做 */
    const back = S.players.filter(function (p) { return p.at === 'locker'; });
    if (back.length) hud(back.map(function (p) { return p.name; }).join('、') + ' 在储物柜前 · 本回合只有「回到站台」一个动作', [], []);
    for (let i = 0; i < act.length; i++) {
      const pid = act[i];
      if (S.submitted.indexOf(pid) >= 0) continue;       // 读档续玩：已经提交过的人不再问第二遍
      await curtainFor(pid, '请把手机交给', TC.atLocker(S, pid) ? '上一回合存放了 · 现在走回站台' : '你的回合 · 做出选择后交给下一位');
      hud('轮到 ' + S.players[pid].name, [], []);
      await pickOne(pid);
      saveNow('pick');
      await fxWait(40);
    }
  }

  /* 全员提交后的闸门：手机还在最后一位手里，桌面也未必收拾好了 —— 结算由人来开演，
     不点就一直停在这一格。读档续玩走到这里同样会摆出它（全员都已提交时 pickAll 直接跳过）。
     数的是 S.submitted 而不是 activePlayers：闸门上那句提示说的是「交上来了几位」。 */
  function waitSettle() {
    return new Promise(function (res) {
      hud(S.submitted.length + ' 位乘客都已提交 · 确认后开始结算', [
        { id: 'btnSettle', label: '开始结算', cls: 'btn-primary', fn: res },
      ], []);
    });
  }

  /* ================= 本轮战报 =================
     结算的「行动」演完之后摊出来的那张卡：谁得了、谁失了、谁白跑一趟。数据全从事件表里
     现算，不另存一份 —— 卡上说不清的地方，就是演出没讲清的地方。
     一张卡管到一个「确认」为止：演出刚演完时人还站在各自的位置上，回站台与补票
     都排在确认之后（sweepHome / playRound），所以这一格也顺带成了停给玩家看的落点。 */
  function roundRows(rev) {
    const rows = S.players.map(function (p) {
      return { name: p.name, cloth: p.colors.top, lines: [], plus: 0, minus: 0, store: false };
    });
    const line = function (pid, txt, cls, t) {
      rows[pid].lines.push({ txt: txt, cls: cls || '', t: t || null });
    };
    rev.store.forEach(function (w) {
      rows[w.p].store = true;
      line(w.p, '存放 ' + w.total + ' 张 · 收进储物柜', 'store', w.tokens);
    });
    rev.deal.forEach(function (d) {
      if (d.winner != null) {
        rows[d.winner].plus += d.gain;
        line(d.winner, '独得 ' + (d.car + 1) + ' 号车厢 ' + d.gain + ' 张', 'good', d.tokens);
      } else {
        d.contested.forEach(function (pid) {
          const others = d.contested.filter(function (x) { return x !== pid; })
            .map(function (x) { return S.players[x].name; }).join('、');
          line(pid, '与 ' + others + ' 同抢 ' + (d.car + 1) + ' 号车厢 · 空手', 'bad');
        });
      }
    });
    rev.swipe.forEach(function (s) {
      const t = S.players[s.target].name, n = TC.total(s.tokens);
      if (s.ok) {
        rows[s.p].plus += n; rows[s.target].minus += n;
        line(s.p, '顺走 ' + t + ' 的 ' + n + ' 张', 'good', s.tokens);
        line(s.target, '被 ' + S.players[s.p].name + ' 顺走 ' + n + ' 张', 'bad', s.tokens);
      } else {
        line(s.p, '顺走 ' + t + ' · ' +
          ({ crowd: '多人抢同一目标', stored: '对方已存放', empty: '对方背包已空' }[s.reason] || s.reason), 'bad');
      }
    });
    rev.ret.forEach(function (pid) { line(pid, '从储物柜走回站台', ''); });
    rows.forEach(function (r) {
      if (!r.lines.length) r.lines.push({ txt: '—', cls: '' });
      const net = r.plus - r.minus;
      /* 存放写「入柜」而不是 0：票没丢、也没进背包，只是换了个地方过夜 */
      if (r.store) { r.net = '入柜'; r.netCls = 'store'; }
      else if (net > 0) { r.net = '+' + net; r.netCls = 'good'; }
      else if (net < 0) { r.net = '−' + (-net); r.netCls = 'bad'; }
      else { r.net = '0'; r.netCls = 'dim'; }
    });
    return rows;
  }
  function waitSummary(rev) {
    /* 演出停在最后一拍（关车门的提示还挂在 HUD 上），战报一摊出来就换成它自己的标题 ——
       底下那行字和卡片说的是同一件事，别让人以为「关门」还没演完 */
    hud('本轮战报', [], []);
    $('#sumRound').textContent = String(S.round);
    $('#sumBody').innerHTML = roundRows(rev).map(ART.sumRow).join('');
    $('#sumHint').textContent = S.lastRound
      ? '确认后大家回到站台 · 票池已空，随后进入最终排名'
      : '确认后大家回到站台 · 车厢补票 · 下一轮开始';
    show('summary');
    return new Promise(function (res) {
      $('#sumOk').onclick = function () {
        sfx('tap');
        hide('summary');
        res();
      };
    });
  }

  /* ================= 结算排名 ================= */
  async function celebrate(rank) {
    const wins = rank.filter(function (r) { return r.place === 1; });
    bannerAt(wins.length > 1 ? '并列冠军' : '冠军', 'bannerLast');
    shakeAdd(0.6); hitStop(90); flashScreen(0.34);
    sfx('fanfare');
    const jobs = wins.map(function (r, k) {
      const f = figs[r.id];
      return (async function () {
        await fxWait(k * 120);
        bubble(f, r.total + ' 分', 'good', 1800);
        for (let j = 0; j < 3; j++) {
          await walkTo(f, f.wx, f.wy - 16, { dur: 180, lift: 16, ease: easeOutQuad });
          await squash(f, 0.34);
        }
        setLimbs(f, 'cheer');
        stampAt(toScreen(f.wx, f.wy - 26), '冠军', 'stampWin', false);
        shakeAdd(0.9); hitStop(120);
      })();
    });
    /* 24 发四色彩带 */
    const colors = ['red', 'yellow', 'green', 'purple'];
    for (let i = 0; i < 24; i++) {
      const node = spawn('', 'fx-dot ' + colors[i % 4], { x: 20 + Math.random() * (innerWidth - 40), y: -14 - Math.random() * 60 });
      flyTo(node, { x: node.offsetLeft + (Math.random() * 60 - 30), y: innerHeight * 0.55 + Math.random() * innerHeight * 0.4 }, { dur: 1200 + Math.random() * 900, ease: linear, rot: 540 * Math.random() });
      vanish(node, 900, 1400);
      await fxWait(40);
    }
    await Promise.all(jobs);
    await fxWait(500);
  }

  async function finish(instant) {
    S.phase = 'over';
    const rank = TC.rank(S);
    logRank(rank);
    saveNow('over');
    hud('本局结束', [], []);
    if (!instant) {
      await celebrate(rank);
      /* 先收尾再起排名：buildRanking 的数字滚动是挂在 fx 时钟上的补间，被下面的 clearFx
         连补间带等待器一起清掉的话，分数会**停在 p 那一刻的中间值**（终点全靠 after 写）。
         顺序反了不会报错，只有结算页的数字是错的。 */
      await fxWait(200);
      clearFx();
    }
    buildRanking(rank, instant);
    only('screen-over');
    if (!instant) sfx('score');
  }

  function buildRanking(rank, instant) {
    const box = $('#overList');
    box.innerHTML = '';
    rank.forEach(function (r) {
      const row = document.createElement('div');
      row.className = 'rank-row' + (r.place === 1 ? ' win' : '');
      const det = [];
      const push = function (title, b) {
        if (!b.rows.length) return;
        det.push('<div class="score-sub">' + title + '</div>');
        b.rows.forEach(function (x) {
          det.push('<div class="score-row"><span>' + x.k + '</span><i>' + x.expr + '</i><b>' + x.pts + ' 分</b></div>');
        });
      };
      /* 计分不分容器（见 TC.rank 的 merged）：背包 + 储物柜先合成一池再列公式 —— 分容器列，
         柜里的 3 张散黄和包里的 1 张就各自「单张不成对」，明明是一对却白扔 2 分。
         标题仍把两个容器各自的张数写出来：「票在哪儿」是看客要知道的，「分从哪来」只有一池。 */
      push('全部车票（储物柜 ' + TC.total(r.locker) + ' 张 + 背包 ' + TC.total(r.bag) + ' 张）',
        TC.breakdown(r.merged));
      if (!det.length) det.push('<div class="score-row"><span>没有收藏到车票</span><i></i><b>0 分</b></div>');
      row.innerHTML =
        '<div class="rank-main">' +
        '<i class="rank-no">' + r.place + '</i>' +
        '<span class="rank-mark" style="--cloth:' + ART.esc(r.colors.top) + '"></span>' +
        '<span class="rank-name">' + ART.esc(r.name) + '</span>' +
        '<span class="rank-score" data-v="' + r.total + '">0</span>' +
        '</div>' +
        '<div class="rank-detail">' + det.join('') +
        '<div class="score-total"><span>合计</span><b>' + r.total + ' 分</b></div></div>';
      const main = row.querySelector('.rank-main');
      main.onclick = function () {
        sfx('tap');
        row.classList.toggle('open');
      };
      box.appendChild(row);
      const sc = row.querySelector('.rank-score');
      if (instant) { sc.textContent = r.total; return; }   // 读档/恢复：分数直接是终值，不滚动
      let cur = 0;
      tween({
        dur: 700 + r.place * 90, ease: easeOutQuad,
        upd(p) {
          const v = Math.round(r.total * p);
          if (v !== cur) { cur = v; sc.textContent = v; sfx('pip'); }
        },
        after() { sc.textContent = r.total; },
      });
    });
  }

  /* ================= 候车阶段 ================= */
  async function trainArrive() {
    /* 列车从远端的隧道口开出来：整列刚性前进一个车头长度，连挂关系不变。
       远端边还在隧道口以北的车厢按位置淡入 —— 否则车厢会画到隧道拱上。 */
    const yTun = TC.depthY(0), lo = TC.locoBox(), dy = lo.h;
    const items = view.cars.map(function (v) { return { n: v.node, y0: v.lane.y0, h: v.lane.h }; });
    items.push({ n: view.loco, y0: lo.y0, h: lo.h });
    const draw = function (p) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i], y = dy * (1 - p);
        it.n.style.transform = 'translate3d(0,' + (y * K.v).toFixed(2) + 'px,0)';
        it.n.style.opacity = clamp((it.y0 - y - yTun + 0.3 * it.h) / (0.6 * it.h), 0, 1).toFixed(3);
      }
    };
    draw(0);
    await fxWait(60);
    sfx('whoosh');
    await new Promise(function (res) {
      tween({
        dur: 780, ease: easeOutCubic, upd: draw,
        after() {
          items.forEach(function (it) { it.n.style.transform = ''; it.n.style.opacity = ''; });
          res();
        },
      });
    });
    shakeAdd(0.34); hitStop(70); sfx('slide');
    await allDoors(true, true);
    sfx('slideShut');
    await fxWait(300);
  }

  async function enterStage() {
    /* 从站台前沿之外走进画面：图上是一条自下而上的斜线，正好把「近大远小」演一遍 ——
       越远的人路程越长、脚下越慢，于是到得也越晚（时长由 walkProfile 按纵深积分，不是一个数）。 */
    const jobs = figs.map(function (f, i) {
      const h = homeStand(i);
      f.wx = h.x; f.wy = TC.WORLD.h + 8 + i * 16;
      applyFig(f, f.wx, f.wy);
      return (async function () {
        await fxWait(i * 110);
        sfx('bag');
        await walkTo(f, h.x, h.y);
      })();
    });
    for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4));
  }

  async function lobbyTurns() {
    lobby.on = true;
    for (let i = 0; i < S.players.length; i++) {
      const pid = S.players[i].id;
      await curtainFor(pid, '候车中 · 请把手机交给', '拖动站台，自由走动你的角色；也可以原地不动');
      lobby.pid = pid; lobby.tx = figs[pid].wx; lobby.ty = figs[pid].wy;
      await new Promise(function (res) {
        hud(figs[pid].p.name + ' 可以自由走动了（拖动站台）', [
          { label: i === S.players.length - 1 ? '开始游戏' : '下一位', cls: 'btn-primary', fn: res },
        ], []);
      });
      lobby.pid = -1;
      setLimbs(figs[pid], 'idle');
      figs[pid].el.classList.remove('moving');
      sfx('confirm');
    }
    lobby.on = false;
    hud('列车进站', [], []);
    await trainArrive();
    snapAll();
    await fxWait(200);
  }

  /* ================= 注册 / 造型 ================= */
  const draft = { rows: [] };
  function newDraft(i) {
    return { name: '乘客 ' + (i + 1), colors: TC.randPalette(RNG) };
  }
  /* 一份铺得出来的名单，来源按优先级：发车前那份（存档 / 内存里的 draft，名字与配色都是
     用户定的原样）→ 这一局的玩家（beginGame 补过空名与去重后缀）→ 全新三人。
     读档续玩与结算页的「再来一局」都靠它：中途刷新过的那一局打完时 draft 还是空的，
     名单空着会直接铺出一屏空白（少于 3 人更是发不了车）。 */
  function rosterFrom(rows, state) {
    if (rows && rows.length >= 3) return rows;
    if (state && state.players && state.players.length >= 3) {
      return state.players.map(function (p) {
        return { name: p.name, colors: Object.assign({}, p.colors) };
      });
    }
    return [newDraft(0), newDraft(1), newDraft(2)];
  }
  function renderRoster() {
    const box = $('#roster');
    box.innerHTML = '';
    draft.rows.forEach(function (row, i) {
      const node = el(
        '<div class="pl-row" data-i="' + i + '">' +
        '<button class="pl-fig" type="button"></button>' +
        '<input class="pl-name" maxlength="6" value="' + ART.esc(row.name) + '" placeholder="乘客名">' +
        '<button class="pl-rand" type="button" title="随机配色">骰</button>' +
        '<button class="pl-del" type="button" title="移除">✕</button>' +
        '</div>');
      const figWrap = node.querySelector('.pl-fig');
      figWrap.appendChild(el(ART.fig({ id: i, name: row.name, colors: row.colors }, MARK[i % MARK.length])));
      node.querySelector('.pl-name').oninput = function (e) {
        row.name = e.target.value.slice(0, 6);
        node.querySelector('.fig-tag').textContent = row.name || '乘客 ' + (i + 1);
        saveNow('setup');
      };
      node.querySelector('.pl-rand').onclick = function () {
        sfx('tap');
        row.colors = TC.randPalette(RNG);
        repaintRow(i);
        saveNow('setup');
      };
      node.querySelector('.pl-del').onclick = function () {
        if (draft.rows.length <= 3) { sfx('deny'); return; }
        sfx('tap');
        draft.rows.splice(i, 1);
        renderRoster();
      };
      figWrap.onclick = function () { sfx('tap'); openPalette(i); };
      box.appendChild(node);
    });
    $('#btnAdd').disabled = draft.rows.length >= 6;
    saveNow('setup');
  }
  function repaintRow(i) {
    const node = $('#roster .pl-row[data-i="' + i + '"]');
    if (!node) return;
    const old = node.querySelector('.pl-fig .fig');
    const row = draft.rows[i];
    old.parentNode.replaceChild(el(ART.fig({ id: i, name: row.name, colors: row.colors }, MARK[i % MARK.length])), old);
  }
  let palIdx = 0;
  const PARTS = [['top', '上衣'], ['bottom', '下装'], ['shoes', '鞋子'], ['hat', '帽子'], ['bag', '包包']];
  function openPalette(i) {
    palIdx = i;
    const row = draft.rows[i];
    $('#palBody').innerHTML = PARTS.map(function (pp) {
      const cur = row.colors[pp[0]];
      return '<div class="sw-group"><div class="sw-label">' + pp[1] + '</div><div class="sw-row">' +
        TC.PALETTE[pp[0]].map(function (c) {
          return '<button class="sw' + (c === cur ? ' on' : '') + '" style="--c:' + c + '" data-part="' + pp[0] + '" data-c="' + c + '"></button>';
        }).join('') + '</div></div>';
    }).join('');
    $('#palBody').onclick = function (e) {
      const b = e.target.closest ? e.target.closest('.sw') : null;
      if (!b) return;
      sfx('tap');
      row.colors[b.getAttribute('data-part')] = b.getAttribute('data-c');
      repaintRow(i);
      openPalette(i);
      saveNow('setup');
    };
    show('palette');
  }

  /* 把一份状态挂到游戏屏上：开局与读档共用（读档时车已经进过站了，不能再放一遍） */
  function mountGame(state) {
    only('screen-game');
    fitStage();
    peek = null; pickLive = false;                   /* 新的一局：柜台上的卡片先收干净 */
    S = state;
    buildBoard();
    buildFigs();
    updateAll();
    hud('', [], []);
    allDoors(true, false);
  }

  function beginGame() {
    const names = draft.rows.map(function (r, i) { return (r.name || '').trim() || '乘客 ' + (i + 1); });
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < i; j++) if (names[j] === names[i]) names[i] = names[i] + '²';
    }
    const colors = draft.rows.map(function (r) { return r.colors; });
    mountGame(TC.newGame({ names: names, colors: colors }, RNG));
    logLine('sys', '开局：' + names.length + ' 人 · ' + TC.carCount(names.length) + ' 节车厢 · 种子 ' + seed);
    saveNow('lobby');
    enterStage().then(lobbyTurns).then(playRound);
  }

  /* 读档续玩：stage 决定从哪一步接上。
     show 这一档不做重演 —— 结算结果在演出前就落盘了，这里直接把结果当作已发生，
     接着走「下一轮 / 结算」两条路之一，绝不重放动画（重放要的「演出前画面」没存）。 */
  function restore(sv) {
    if (sv.stage === 'setup' && sv.draft && sv.draft.length >= 3) {
      logLine('sys', '读取存档：名单未发车，继续填名单');
      draft.rows = sv.draft;
      renderRoster();
      only('screen-setup');
      return;
    }
    /* 续玩也要一份名单：结算页的「再来一局」照 draft.rows 铺名单，中途刷新过的那一局
       打完时点重开就是一屏空白。存档里的 draft 是发车前那份原始名单；老存档缺了它，
       就从这一局的玩家身上还原（名字照抄，配色拷一份，别和 S 共享同一个对象）。 */
    draft.rows = rosterFrom(sv.draft, sv.S);
    logLine('sys', '读取存档：' + stageName(sv.stage) + ' · 第 ' + Math.max(1, sv.S.round) + ' 轮');
    mountGame(sv.S);
    if (sv.stage === 'over') {
      buildRanking(TC.rank(S), true);
      only('screen-over');
      return;
    }
    snapAll();
    if (sv.stage === 'show') {
      hud('已恢复进度 · 上一轮结算生效', [], []);
      if (TC.checkEnd(S)) { finish(true); return; }
      playRound();
      return;
    }
    /* lobby：还没补过票 → 从头走一轮；pick：本轮已补票 → 直接续选 */
    if (S.round > 0) runPicks();
    else playRound();
  }

  /* ================= 顶栏按钮 ================= */
  function refreshSpeedBtn() {
    const b = $('#btnSpeed');
    b.textContent = SPEED.v > 1 ? '×' + SPEED.v : '快进';
    b.classList.toggle('on', SPEED.v > 1);
  }
  function bumpSpeed(n) {
    SPEED.v = n;
    refreshSpeedBtn();
    syncPace();
    /* 时钟变速已让在飞的补间和等待同步加速，这里只需保证循环在跑 */
    kick();
  }

  /* ================= 启动 ================= */
  function boot() {
    seed = makeSeed();
    RNG = TC.seeded(seed);
    /* 出错也要留痕：现场只有这台手机，控制台没人看得到 */
    root.addEventListener('error', function (e) {
      logLine('err', '脚本错误：' + ((e && (e.message || (e.error && e.error.message))) || '未知'));
    });
    root.addEventListener('unhandledrejection', function (e) {
      const r = e && e.reason;
      logLine('err', '未处理的 Promise：' + ((r && (r.message || r)) || '未知'));
    });
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fxOn = false;
    }
    try {
      const sk = root.localStorage && root.localStorage.getItem('tc.shake');
      if (sk != null) shakeScale = parseFloat(sk) || 0.8;
    } catch (e) { /* 隐私模式下 localStorage 会抛，忽略 */ }
    document.documentElement.style.setProperty('--shake-scale', String(shakeScale));

    /* 音效：第一次点按解锁 AudioContext */
    const unlock = function () {
      const s = root.TC_SFX;
      if (s && s.init) { try { s.init(); } catch (e) { /* 忽略 */ } }
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });

    /* 点遮罩关弹窗：落点必须正好是遮罩本身。
       #palette 多一层 .sheet 包装，所以它也算遮罩；点卡片里任何东西都不算。
       ⚠ #curtain 与 #summary 不在其列 —— 前者是传手机关卡（点背景就关会把别人的选择亮给上一个人看），
       后者是结算流程的一半（见 waitSummary）：点背景就关等于替人按了「确认」，散场与补票被一并跳过。 */
    [['rules', null], ['palette', '.sheet'], ['logbox', null]].forEach(function (pair) {
      const box = $('#' + pair[0]);
      if (!box) return;
      box.addEventListener('pointerdown', function (e) {
        const onBackdrop = e.target === box || (pair[1] && e.target.classList && e.target.classList.contains(pair[1].slice(1)));
        if (!onBackdrop) return;
        sfx('tap');
        hide(pair[0]);
      });
    });

    $('#btnStart').onclick = function () {
      sfx('tap');
      draft.rows = [newDraft(0), newDraft(1), newDraft(2)];
      renderRoster();
      only('screen-setup');
    };
    ['#btnRules', '#btnHelp', '.js-log'].forEach(function (sel) {
      $$(sel).forEach(function (b) {
        b.onclick = function () { sfx('tap'); if (sel === '.js-log') openLog(); else show('rules'); };
      });
    });
    $('#btnSetupBack').onclick = function () { sfx('tap'); clearFx(); only('screen-menu'); };
    $('#rulesClose').onclick = function () { sfx('tap'); hide('rules'); };
    $('#palClose').onclick = function () { sfx('tap'); hide('palette'); };
    $('#logClose').onclick = function () { sfx('tap'); hide('logbox'); };
    $('#logClear').onclick = function () { sfx('tap'); LOG.list = []; renderLog(); logLine('sys', '日志已清空'); };
    $('#logCopy').onclick = function () {
      sfx('tap');
      const txt = logText();
      const done = function (okc) { logLine('sys', okc ? '日志已复制到剪贴板' : '复制失败，请长按选择文本'); };
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          root.navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
          return;
        }
      } catch (e) { /* 落到下面的兜底 */ }
      done(false);
    };
    $('#logWipe').onclick = function () {
      sfx('confirm');
      logLine('warn', '清空存档并回到封面');
      clearSave();
      hide('logbox');
      only('screen-menu');
    };
    $('#btnLog').onclick = function () { sfx('tap'); openLog(); };
    $('#btnAdd').onclick = function () {
      if (draft.rows.length >= 6) { sfx('deny'); return; }
      sfx('tap');
      draft.rows.push(newDraft(draft.rows.length));
      renderRoster();
    };
    $('#btnBegin').onclick = function () {
      if (draft.rows.length < 3) { sfx('deny'); return; }
      sfx('confirm');
      beginGame();
    };
    $('#btnAgain').onclick = function () {
      sfx('tap');
      clearFx();
      /* 名单沿用上一局：draft 里就是发车前那份（名字与配色），万一它是空的
         （老存档 / 没走名单就读档进来的旧路径）就从刚打完的这一局还原，绝不铺空白。 */
      draft.rows = rosterFrom(draft.rows, S).map(function (r) {
        return { name: r.name, colors: r.colors };
      });
      renderRoster();
      only('screen-setup');
    };
    $('#btnBackHome').onclick = function () { sfx('tap'); clearFx(); only('screen-menu'); };
    $('#btnSpeed').onclick = function () { sfx('tap'); bumpSpeed(SPEED.v === 1 ? 3 : 1); };

    const stage = $('#stage');
    const toWorld = function (e) {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left) / K.v, y: (e.clientY - r.top) / K.v };
    };
    /* 站台是个近宽远窄的梯形：目标点一律过 TC.clampWalk，别自己写矩形边界 */
    const aim = function (e) {
      const w = toWorld(e), c = TC.clampWalk(w.x, w.y);
      lobby.tx = c.x; lobby.ty = c.y;
    };
    stage.addEventListener('pointerdown', function (e) {
      if (!lobby.on || lobby.pid < 0) return;
      lobby.up = true;
      aim(e);
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
      kick();
    }, { passive: true });
    stage.addEventListener('pointermove', function (e) {
      if (!lobby.on || !lobby.up || lobby.pid < 0) return;
      aim(e);
      kick();
    }, { passive: true });
    const up = function () { lobby.up = false; };
    stage.addEventListener('pointerup', up, { passive: true });
    stage.addEventListener('pointercancel', up, { passive: true });
    stage.addEventListener('click', tapBoard);       /* 看背包 / 开柜子，见 tapBoard */

    let rt = 0;
    root.addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () { rt = 0; fitStage(); }, 120);
    });
    root.addEventListener('orientationchange', function () { setTimeout(fitStage, 260); });

    /* 窗口没动，版面也会变：HUD 一长高（按钮换行、提示折两行），flex:1 的 #stagewrap
       就被挤短，可 #stage 还顶着开局写下的 inline px —— 舞台会往上下各溢出一截，
       压住顶栏和 HUD 的提示行（#hud 是 relative + z:auto，压不过舞台里 z≥1 的层）。
       盯着 stagewrap：谁把它挤了就照新空间重 fit 一次。写 #stage 不会反过来动
       stagewrap（flex:1 + min-height:0，尺寸不看内容），去重只是省掉白跑。 */
    const wrapEl = $('#stagewrap');
    if (wrapEl && typeof ResizeObserver === 'function') {
      let fw = wrapEl.clientWidth, fh = wrapEl.clientHeight;
      new ResizeObserver(function () {
        const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
        if (w === fw && h === fh) return;
        fw = w; fh = h;
        if (w > 0 && h > 0) fitStage();            // 屏幕藏起来时是 0×0，等露出来再 fit
      }).observe(wrapEl);
    }

    only('screen-menu');
    kick();

    /* 进页面就自动续上：有存档就直接回到当时那一步，不必重新发车 */
    const sv = loadSave();
    if (sv) {
      if (sv.log && sv.log.length) LOG.list = sv.log.slice(-LOG.max);
      if (typeof sv.seed === 'number') { seed = sv.seed >>> 0; RNG = TC.seeded(seed); }
      if (sv.rng != null && RNG.set) RNG.set(sv.rng);
      if (sv.speed > 1) { SPEED.v = sv.speed; refreshSpeedBtn(); syncPace(); }
      restore(sv);
    } else {
      logLine('sys', '首次进入 · 无存档');
    }
  }

  /* redraw 是给外部（测试、将来的联机版收到远端状态后）用的整体重画入口 */
  root.TC_UI = {
    boot: boot, fitStage: fitStage, toScreen: toScreen,
    state: () => S, figs: () => figs, fxOn: () => fxOn, redraw: updateAll,
    pace: () => rate(), slow: () => SLOW, clock: () => fxClock,
    log: () => LOG.list, save: () => loadSave(),
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : null);
