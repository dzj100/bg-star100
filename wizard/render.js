/* 《巫师牌》UI + 演出编排
   依赖方向：game.js（规则/几何）→ ai.js（策略）→ 本文件（DOM + fx）；audio.js 独立。
   fx 引擎沿用仓库那一套（tween / fxRunUntil / spawn / vanish），「时钟」做成可变速：
   rate() 乘在 fxClock 上，于是加速 / 慢放会一并作用于已在飞的补间与等待。

   三旋钮别合并（SPEC §6.2）：
     SPEED —— 玩家按出来的绝对倍速（1× / 3×），跨轮保留；
     PACE  —— 演出的基础节奏；
     SLOW  —— 结算四步（收墩 / 本轮计分 / 终局）的慢放档 0.4。
   rate() = SPEED > 1 ? SPEED : PACE —— 玩家一按快进就立刻夺回控制权。

   死锁红线：只要还有 fxWaits，主循环就必须继续跑 —— 见 frame() 的 resolve 分支。
   存档红线：结果先落盘、演出后开演。stage='show' 的档读回来不重放动画，只重放结果。 */
'use strict';
(function (root) {
  const WZ = root.WZ, AI = root.WZAI, SFX = root.WZSFX;
  if (!WZ || !AI) return;

  /* ================= 小工具 ================= */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const WU = n => 'calc(' + n + ' * var(--wu))';
  const clamp = WZ.clamp;
  const pad2 = n => (n < 10 ? '0' : '') + n;
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  function place(node, x, y, w, h) {
    node.style.left = WU(x); node.style.top = WU(y);
    if (w != null) node.style.width = WU(w);
    if (h != null) node.style.height = WU(h);
  }
  /* 到点执行一次（延迟挂在 fx 时钟上，跟着 rate() 走）。
     必须「p 到 1 才跑」：写成 upd: fn 的话，p 落进 [0,1) 的那一帧就会提前开跑 ——
     回调里若有 hitStop（终局名次那一串），时钟会被冻在窗口里，此后每帧重放、永久卡死 */
  function after(ms, fn) { tween({ t: ms, dur: 1, upd(p) { if (p >= 1) fn(); } }); }

  /* ================= 缓动 ================= */
  const linear = t => t;
  const easeOutQuad = t => 1 - (1 - t) * (1 - t);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  const easeInQuad = t => t * t;
  const easeInOutQuad = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = t => {
    const c = 2.2;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  };

  /* ================= fx 引擎 ================= */
  const SPEED = { v: 1 };
  const PACE = { v: 1 }, SLOW = 0.4;
  const rate = () => (SPEED.v > 1 ? SPEED.v : PACE.v);
  /* 不吃 fx 时钟的过场（CSS transition / animation）靠 --fx-pace 跟同一个节奏 */
  function syncPace() { document.documentElement.style.setProperty('--fx-pace', String(1 / rate())); }
  function setPace(v) { PACE.v = v; syncPace(); }

  let fxTweens = [], fxWaits = [], fxClock = 0, fxHold = 0, raf = 0;
  let fxOn = true, trauma = 0, shakeScale = 0.8;
  let lastNow = 0;
  const fxEl = () => $('#fx');

  function tween(o) {
    /* 关掉演出时不能直接 return：补间里的 Promise 靠 after() 兑现，漏了会永久挂起 */
    if (!fxOn) { if (o.upd) o.upd(1); if (o.after) o.after(); return; }
    /* o.t 是「从现在起算的延迟」，起手一律锚在当前 fxClock 上（仓库补间锚点红线） */
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

    /* 等待器只认时钟：「还没到点」也必须算活着，否则等待器永久挂起 */
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

    if (alive || trauma > 0.002) raf = requestAnimationFrame(frame);
    else raf = 0;
  }

  function fxRunUntil(end) {
    return new Promise(res => {
      if (!fxOn) { res(); return; }
      fxWaits.push({ end: end, res: res });
      kick();
    });
  }
  /* 唯一的等待闸门：参数是「演出毫秒」；真实时长 = 演出毫秒 / rate()（fxClock 自己按 rate() 走） */
  function fxWait(ms) { return fxRunUntil(fxClock + (ms || 0)); }
  /* hitStop 要的是「真实毫秒的一记顶住」：fxHold 走演出钟，速率越低钟越慢，
     不乘 rate 的话 SLOW(0.4) 档下 45ms 会冻成 112ms 的真卡顿 */
  function hitStop(ms) { if (fxOn && ms) fxHold = Math.max(fxHold, ms * rate()); }
  function shakeAdd(v) { if (!fxOn) return; trauma = Math.min(1, trauma + v * shakeScale); kick(); }

  function clearFx() {
    const box = fxEl();
    if (box) box.innerHTML = '';
    fxTweens = [];
    fxWaits.splice(0).forEach(w => w.res());
    fxClock = 0; fxHold = 0; trauma = 0;
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
        t: o.t || 0, dur: o.dur || 360, ease: o.ease || easeInOutQuad,
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
  function flashScreen(strength, cls) {
    const node = spawn('', 'flashLayer' + (cls ? ' ' + cls : ''), { x: 0, y: 0 });
    tween({ dur: 260, upd(p) { node.style.opacity = ((1 - p) * (strength || 0.55)).toFixed(2); } });
    vanish(node, 0, 270);
  }
  function bannerAt(txt, cls) {
    const node = document.createElement('div');
    node.className = 'fxc banner' + (cls ? ' ' + cls : '');
    node.textContent = txt;
    fxEl().appendChild(node);
    sfx('whoosh');
    tween({ dur: 420, ease: easeOutBack, upd(p) { node.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + 0.3 * p).toFixed(3) + ')'; node.style.opacity = p < 0.3 ? (p / 0.3).toFixed(2) : '1'; } });
    vanish(node, 1000, 420);
  }

  /* ================= 音效 ================= */
  const sfxOn = { v: true };
  /* audio.js 只合成 14 个音。这四个语义上借最接近的那一发 —— play() 对未知名是静默返回，
     不借就成了按下没声的哑点（confirm=按钮、whoosh=掠过、warn=决战低鸣、score=跳字） */
  const SFX_ALIAS = { confirm: 'tap', whoosh: 'flip', warn: 'deny', score: 'pip' };
  /* 慢放时把持续过程的声音一并拉长（stretch = 1/rate()），只拉长不缩短 */
  function sfx(name, o) {
    if (!sfxOn.v || !SFX || !SFX.play) return;
    const r = rate();
    try { SFX.play(SFX_ALIAS[name] || name, r < 1 ? Object.assign({}, o, { stretch: 1 / r }) : o); }
    catch (e) { /* 音效永不阻塞玩法 */ }
  }

  /* ================= 运行日志 / 存档 =================
     热座局出怪事时只有这台手机知道发生过什么，所以日志必须落盘。环形缓冲，查看时倒序。 */
  const SAVE_KEY = 'wz.save.v1';
  const LOG = { max: 300, list: [] };
  const saveStageRef = { v: 'setup' };
  let S = null, rng = null, seed = 0;

  function logLine(kind, text) {
    LOG.list.push({ t: Date.now(), r: (S && S.round) || 0, k: kind, s: String(text) });
    if (LOG.list.length > LOG.max) LOG.list.splice(0, LOG.list.length - LOG.max);
    if ($('#logbox') && $('#logbox').classList.contains('on')) renderLog();
    updateLogStrip();
  }
  function logClock(t) {
    const d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  /* 顶栏下的常驻横条：只报最新一条，点开才是日志面板 */
  function updateLogStrip() {
    const t = $('#tbLogT'), s = $('#tbLogS');
    if (!t || !s) return;
    const e = LOG.list[LOG.list.length - 1];
    if (!e) { t.textContent = '--:--:--'; s.textContent = '暂无日志'; s.className = 'tb-log-s'; return; }
    t.textContent = logClock(e.t);
    s.textContent = e.s;
    s.className = 'tb-log-s' + (e.k === 'err' ? ' err' : (e.k === 'round' || e.k === 'trick' ? ' hit' : (e.k === 'trump' ? ' trump' : '')));
  }

  function saveNow(stage) {
    if (stage) saveStageRef.v = stage;
    if (!S) {
      try {
        root.localStorage.setItem(SAVE_KEY, JSON.stringify({
          v: 1, t: Date.now(), stage: 'setup', seed: seed,
          draft: draft, log: LOG.list, speed: SPEED.v,
        }));
      } catch (e) { /* 隐私模式 / 配额满：存不下也不能影响这一局 */ }
      return;
    }
    try {
      root.localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, t: Date.now(), stage: saveStageRef.v, seed: seed,
        rng: rng && rng.state ? rng.state() : null,
        speed: SPEED.v, draft: draft, S: S, log: LOG.list,
      }));
    } catch (e) { /* 同上 */ }
  }
  function loadSave() {
    try {
      const raw = root.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.v !== 1) return null;
      if (o.stage === 'setup') return o.draft ? o : null;
      return (o.S && o.S.players && o.S.players.length) ? o : null;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { root.localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
  }
  function stageName(s) {
    return { setup: '名单', pick: '对局中', show: '待计分', over: '已排名' }[s] || s;
  }
  function saveInfoText() {
    const o = loadSave();
    if (!o) return '无';
    const d = new Date(o.t);
    const when = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + logClock(o.t);
    if (o.stage === 'setup') return '名单已定 · 未开桌 · ' + when;
    return '第 ' + Math.max(1, o.S.round) + ' 轮 · ' + stageName(o.stage) + ' · ' + when;
  }
  function makeSeed() { return (Date.now() ^ 0x9e3779b9) >>> 0; }

  function renderLog() {
    const body = $('#logBody');
    if (!body) return;
    const n = $('#logCount');
    if (n) n.textContent = LOG.list.length + ' 条 · 倒序';
    const si = $('#logSaveInfo');
    if (si) si.textContent = saveInfoText();
    if (!LOG.list.length) { body.innerHTML = '<div class="log-empty">还没有记录</div>'; return; }
    let html = '';
    for (let i = LOG.list.length - 1; i >= 0; i--) {
      const e = LOG.list[i];
      html += '<div class="log-row ' + esc(e.k) + '"><i>' + logClock(e.t) + '</i><b>' +
        (e.r ? 'R' + e.r : '—') + '</b><span>' + esc(e.s) + '</span></div>';
    }
    body.innerHTML = html;
    body.scrollTop = 0;
  }
  function openLog() { renderLog(); $('#logbox').classList.add('on'); }

  /* ================= 美术：SVG 与卡面 ================= */
  const SEAT_C = ['#e0432f', '#f0b32b', '#4aa3dd', '#7cb342', '#c77dff', '#2fd4c4'];
  const AI_NAMES = ['学徒', '术士', '占星', '游侠', '炼金'];
  const GLYPHS = ['◆', '★', '▲', '■'];

  function hatPaths(fill, star) {
    return '<path d="M12 2.4 16.4 13.2H7.6Z" fill="' + fill + '"/>' +
      '<path d="M2.8 15.8c0-1.6 4.1-2.7 9.2-2.7s9.2 1.1 9.2 2.7-4.1 2.5-9.2 2.5-9.2-.9-9.2-2.5Z" fill="' + fill + '"/>' +
      '<path d="M12 5.4l1 2.3 2.5.2-1.9 1.6.6 2.4L12 10.6l-2.2 1.3.6-2.4L8.5 7.9l2.5-.2z" fill="' + star + '"/>';
  }
  const hatSVG = (fill, star) => '<svg viewBox="0 0 24 24">' + hatPaths(fill, star) + '</svg>';
  const CROWN = '<svg viewBox="0 0 24 24"><path d="M2.6 17.6 4.4 7.6l4.4 3.8L12 4.6l3.2 6.8 4.4-3.8 1.8 10z" fill="#f0c247" stroke="#a97b28" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const JESTER_ART = '<svg viewBox="0 0 24 24">' +
    '<path d="M6.4 18.4C3.9 13.8 5.1 7.8 7 6c.9-.8 2.3 0 2.1 1.2l-.7 5.2z" fill="#fdf3ea"/>' +
    '<path d="M17.6 18.4C20.1 13.8 18.9 7.8 17 6c-.9-.8-2.3 0-2.1 1.2l.7 5.2z" fill="#fdf3ea"/>' +
    '<circle cx="7.4" cy="5.2" r="1.9" fill="#f0c247"/><circle cx="16.6" cy="5.2" r="1.9" fill="#f0c247"/>' +
    '<path d="M12 6.8l1.1 2.5 2.7.3-2 1.8.5 2.7L12 12.8l-2.3 1.3.5-2.7-2-1.8 2.7-.3z" fill="#f0c247"/></svg>';
  const WIZ_ART = '<svg viewBox="0 0 24 24">' + hatPaths('#d9a441', '#2a1f08') + '</svg>';

  function cardHTML(id, cls, size) {
    const c = WZ.card(id);
    let inner, cc;
    if (c.kind === 'wizard') {
      cc = 'c-wizard';
      inner = '<span class="c-art">' + WIZ_ART + '</span><span class="c-tag">巫师</span>';
    } else if (c.kind === 'jester') {
      cc = 'c-jester';
      inner = '<span class="c-art">' + JESTER_ART + '</span><span class="c-tag">小丑</span>';
    } else {
      cc = 'c' + c.color;
      inner = '<span class="c-corner"><b class="c-rank">' + c.rank + '</b><span class="c-glyph">' + GLYPHS[c.color] + '</span></span>' +
        '<span class="c-mid">' + c.rank + '</span>';
    }
    return '<div class="card ' + cc + ' ' + (size || 'sz-trick') + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
  }
  const backHTML = size => '<div class="card c-back ' + (size || 'sz-trick') + '"></div>';

  function scenerySVG() {
    const cracks = [
      'M-8 118 30 96 58 130 92 110',
      'M-8 168 22 156 44 178 70 170',
      'M368 92 336 78 314 100 286 88',
      'M368 150 344 140 322 158 300 150',
      'M-8 512 26 528 52 506 86 520',
      'M368 528 338 542 310 520 282 534',
      'M120 -8 134 22 118 46 132 68',
      'M244 -8 232 20 248 44 236 64',
    ];
    let g = '';
    cracks.forEach(d => {
      g += '<path d="' + d + '" fill="none" stroke="#ff6a3d" stroke-opacity=".15" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="' + d + '" fill="none" stroke="#ff8a52" stroke-opacity=".36" stroke-width="1.4" stroke-linecap="round"/>';
    });
    const rune = (x, y, ch, col) =>
      '<text x="' + x + '" y="' + y + '" font-size="13" fill="' + col + '" fill-opacity=".3" text-anchor="middle">' + ch + '</text>';
    return '<svg class="scenery-svg" viewBox="0 0 360 640" preserveAspectRatio="none">' +
      '<defs>' +
      '<linearGradient id="wzBg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#28324e"/><stop offset=".55" stop-color="#1b2437"/><stop offset="1" stop-color="#131b2b"/></linearGradient>' +
      '<radialGradient id="wzVig" cx=".5" cy=".46" r=".74">' +
      '<stop offset=".5" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.42)"/></radialGradient>' +
      '</defs>' +
      '<rect width="360" height="640" fill="url(#wzBg)"/>' +
      g +
      '<circle cx="180" cy="296" r="152" fill="none" stroke="rgba(217,164,65,.14)" stroke-width="1"/>' +
      '<circle cx="180" cy="296" r="159" fill="none" stroke="rgba(210,59,47,.14)" stroke-width=".8"/>' +
      rune(73, 181, '◆', '#e0432f') + rune(287, 181, '★', '#f0b32b') +
      rune(287, 419, '▲', '#4aa3dd') + rune(73, 419, '■', '#7cb342') +
      '<rect width="360" height="640" fill="url(#wzVig)"/></svg>';
  }
  /* 封面徽记：帽子 + 光环 + 四色符号，紧凑一块（不再是铺满整屏的底图）；
     在 #screen-menu 的纵向流里居上，下面才是标题与按钮 */
  function menuArtSVG() {
    const rune = (x, y, ch, col, size) =>
      '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + col + '" text-anchor="middle" font-weight="700">' + ch + '</text>';
    return '<svg viewBox="0 0 240 232">' +
      '<defs><radialGradient id="wzHalo" cx=".5" cy=".5" r=".5">' +
      '<stop offset="0" stop-color="rgba(232,180,74,.26)"/><stop offset="1" stop-color="rgba(232,180,74,0)"/>' +
      '</radialGradient></defs>' +
      '<circle cx="120" cy="116" r="86" fill="url(#wzHalo)"/>' +
      '<ellipse cx="120" cy="170" rx="78" ry="17" fill="rgba(96,216,255,.08)"/>' +
      '<circle cx="120" cy="112" r="92" fill="none" stroke="rgba(217,164,65,.16)" stroke-width="1.4"/>' +
      '<circle cx="120" cy="112" r="80" fill="none" stroke="rgba(210,59,47,.20)" stroke-width="1"/>' +
      '<g transform="translate(120 112) scale(6.8) translate(-12 -12)">' + hatPaths('#e8b44a', '#2a1f08') + '</g>' +
      rune(120, 26, '◆', '#e0432f', 18) + rune(120, 218, '■', '#7cb342', 18) +
      rune(20, 120, '★', '#f0b32b', 18) + rune(220, 120, '▲', '#4aa3dd', 18) +
      '</svg>';
  }

  /* ================= 版面（world → 视口） ================= */
  const K = { v: 1 };
  let ORIG = { x: 0, y: 0 };
  const DECK_AT = { x: 10, y: 15 };       /* 牌库（舞台左上·道具角）：顶与指示牌坑位对齐 */
  const IND_AT = { x: 50, y: 4, w: 76 };  /* 指示牌（紧邻牌库右侧）：上签下药丸的纵排容器 */

  function fitStage() {
    const wrap = $('#stagewrap'), st = $('#stage');
    if (!wrap || !st) return;
    const aw = wrap.clientWidth, ah = wrap.clientHeight;
    /* 舞台藏起来时量到的是 0×0：钳到 0.2 会把 --k 写坏，且露出来后自己回不来 */
    if (aw <= 0 || ah <= 0) return;
    const k = Math.max(0.2, Math.min(aw / 360, ah / 640));
    K.v = k;
    st.style.width = Math.round(360 * k) + 'px';
    st.style.height = Math.round(640 * k) + 'px';
    document.documentElement.style.setProperty('--k', k.toFixed(5));
    measureOrigin();
    layoutHand();
  }
  function measureOrigin() {
    const r = $('#stage').getBoundingClientRect();
    ORIG.x = r.left; ORIG.y = r.top;
  }
  const toScreen = (wx, wy) => ({ x: ORIG.x + wx * K.v, y: ORIG.y + wy * K.v });

  /* ================= 舞台家具 ================= */
  let slots = [], deckEl = null, indEl = null, deckN = null, indSlot = null, indPill = null;

  function buildTable() {
    const table = $('#table');
    table.innerHTML = '';
    table.appendChild(el('<div class="tl-glow"></div>'));
    table.appendChild(el('<div class="tl-rim"></div>'));
    table.appendChild(el('<div class="tl-rim2"></div>'));
    table.appendChild(el('<div class="tl-felt"></div>'));

    slots = [];
    for (let i = 0; i < S.N; i++) {
      const sp = WZ.slotPos(i, S.N);
      const s = el('<div class="trick-slot"></div>');
      place(s, sp.x - 22, sp.y - 30, 44, 60);
      table.appendChild(s);
      slots.push(s);
    }

    /* 牌库 = 3 张实体牌背叠（与对手手牌同一套 c-back 画法）+ 剩余数徽章 */
    deckEl = el('<div class="deckpile">' + backHTML('sz-ind') + backHTML('sz-ind') + backHTML('sz-ind') + '<span class="dp-n">0</span></div>');
    place(deckEl, DECK_AT.x, DECK_AT.y, 40, 56);
    deckN = deckEl.querySelector('.dp-n');
    table.appendChild(deckEl);

    indEl = el('<div class="indwrap"><span class="ind-cap">指示牌</span><div class="ind-slot"></div><span class="ind-pill pn">无王牌</span></div>');
    place(indEl, IND_AT.x, IND_AT.y, IND_AT.w);
    indSlot = indEl.querySelector('.ind-slot');
    indPill = indEl.querySelector('.ind-pill');
    table.appendChild(indEl);
  }
  function updateDeckN() {
    if (!deckN) return;
    const n = S ? S.deck.length : 0;
    deckN.textContent = n;
    deckEl.classList.toggle('empty', n === 0);   /* 最后一轮 60 张全发完：整摞淡出 */
  }

  function pillFor(trumps) {
    const p = indPill;
    if (!p) return;
    if (trumps.mode === 'choose') { p.className = 'ind-pill pw pulse'; p.textContent = '先手选色…'; }
    else if (trumps.mode === 'none') { p.className = 'ind-pill pn'; p.textContent = '无王牌'; }
    else { p.className = 'ind-pill p' + trumps.color; p.textContent = '王牌 ' + WZ.labelColor(trumps.color); }
  }

  /* ================= 座位 ================= */
  let seats = [];

  function seatAnchor(i) {
    const p = WZ.seatPos(i, S.N);
    const dx = (p.x - WZ.CENTER.x) / WZ.RX, dy = (p.y - WZ.CENTER.y) / WZ.RY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    return {
      x: clamp(p.x + ux * 34, 62, 298),
      y: clamp(p.y + uy * (uy < 0 ? 44 : 32), 34, 502),
      up: uy < -0.05,
    };
  }

  function buildSeats() {
    const box = $('#seats');
    box.innerHTML = '';
    seats = [];
    for (let i = 0; i < S.N; i++) {
      const p = S.players[i];
      const a = seatAnchor(i);
      const seat = el('<div class="seat' + (i === 0 ? ' me' : '') + (a.up ? ' up' : '') + '"></div>');
      place(seat, a.x, a.y);
      seat.style.transform = 'translateX(-50%)';
      seat.innerHTML =
        '<div class="sc-backs"></div>' +
        '<div class="seat-in">' +
          '<span class="sc-avatar">' + hatSVG(SEAT_C[p.avatar % SEAT_C.length], '#1a1206') + '</span>' +
          '<span class="sc-mid">' +
            '<b class="sc-name">' + esc(p.name) + '</b>' +
            '<span class="sc-score">总分 <i>0</i></span>' +
          '</span>' +
          '<span class="sc-badges">' +
            '<span class="sc-badge sc-bid"><em>预</em><b>…</b></span>' +
            '<span class="sc-badge sc-won"><em>墩</em><b>0</b></span>' +
          '</span>' +
          '<span class="sc-crown">' + CROWN + '</span>' +
        '</div>' +
        '<div class="sc-bubble"></div>';
      box.appendChild(seat);
      seats.push(seat);
    }
    updateSeatUI();
  }

  const seatEl = i => seats[i];
  const chipPt = i => {
    const a = seatAnchor(i);
    return toScreen(a.x, a.y);
  };

  function updateSeatUI() {
    if (!S || !seats.length) return;
    const noTrump = S.trumps.mode === 'none';
    S.players.forEach(function (p, i) {
      const seat = seats[i];
      if (!seat) return;
      const bid = seat.querySelector('.sc-bid'), won = seat.querySelector('.sc-won');
      const known = p.bid !== null;
      bid.classList.toggle('wait', !known);
      bid.querySelector('b').textContent = known ? p.bid : '…';
      bid.classList.toggle('noring', known && noTrump && S.k > 1);
      won.querySelector('b').textContent = p.won;
      won.classList.toggle('hit', known && p.won === p.bid);
      won.classList.toggle('over', known && p.won > p.bid);
      seat.querySelector('.sc-score i').textContent = p.score;
      seat.classList.toggle('turn', S.turn === i && S.phase === 'play' && !pendingPlay);
      const crown = seat.querySelector('.sc-crown');
      crown.style.display = (S.leader === i && S.round > 0) ? '' : 'none';
      const backs = seat.querySelector('.sc-backs');
      if (i === 0) { backs.style.display = 'none'; }
      else {
        backs.style.display = '';
        const n = p.hand.length;
        const shown = Math.min(3, n);
        let html = '';
        for (let j = 0; j < shown; j++) html += backHTML('sz-mini mini');
        if (n > 0) html += '<b>×' + n + '</b>';
        if (backs.dataset.n !== String(n)) {
          backs.innerHTML = html;
          backs.dataset.n = String(n);
        }
      }
      seat.classList.toggle('me', i === 0);
    });
  }
  function chipPunch(i) {
    const s = seats[i];
    if (!s) return;
    s.classList.remove('punch');
    void s.offsetWidth;
    s.classList.add('punch');
  }
  function bubble(pid, txt, ms, cls) {
    const b = seats[pid] && seats[pid].querySelector('.sc-bubble');
    if (!b) return;
    b.textContent = txt;
    b.className = 'sc-bubble on' + (cls ? ' ' + cls : '');
    if (ms !== 0) {
      after(ms || 900, function () {
        if (b.textContent === txt) b.className = 'sc-bubble';
      });
    }
  }
  function clearBubbles() { seats.forEach(s => { const b = s.querySelector('.sc-bubble'); if (b) b.className = 'sc-bubble'; }); }

  /* ================= 手牌 ================= */
  const HAND_BOTTOM = 630, CW = 46, CH = 64;
  let handActive = false, selId = null, playable = null, pendingPlay = null;

  function renderHand() {
    const box = $('#hand');
    box.innerHTML = '';
    if (!S) return;
    const ids = WZ.sortHand(S.players[0].hand);
    ids.forEach(function (id) {
      const hc = el('<div class="hc" data-id="' + id + '"></div>');
      hc.innerHTML = cardHTML(id, '', 'sz-hand');
      box.appendChild(hc);
    });
    selId = null;
    hidePreview();
    layoutHand();
    refreshHandStates();
  }
  function handCards() { return $$('#hand .hc'); }

  function layoutHand() {
    const hcs = handCards(), n = hcs.length;
    const step = n <= 1 ? 0 : Math.min(30, (300 - CW) / (n - 1));
    const total = step * (n - 1);
    const x0 = 180 - total / 2;
    const maxRot = n <= 1 ? 0 : Math.min(5, 44 / (n - 1));
    hcs.forEach(function (hc, i) {
      const t = n <= 1 ? 0 : i - (n - 1) / 2;
      const half = Math.max(1, (n - 1) / 2);
      const edge = Math.abs(t) / half;
      const rot = t * maxRot;
      /* 轴心在底边中点：旋转后最低的角比牌底再低 (CW/2)·sinθ（±22° 时约 8.6 世界单位）。
         边缘下压量以此为上限（目标给舞台底留 2 世界单位，倾角太大时先保不越界）——
         不然大牌量时外角会被 #stage 的 overflow 裁掉 */
      const rad = Math.abs(rot) * Math.PI / 180;
      const dip = (CW / 2) * Math.sin(rad);
      const lift = Math.max(0, Math.min(edge * edge * 7, (640 - HAND_BOTTOM - 2) - dip));
      hc._base = {
        x: x0 + i * step,
        y: HAND_BOTTOM - CH / 2 + lift,
        rot: rot,
      };
      applyCardTF(hc);
    });
  }
  function applyCardTF(hc) {
    const b = hc._base;
    if (!b) return;
    const sel = hc.classList.contains('sel');
    const y = b.y - (sel ? 15 : 0);
    hc.style.transform =
      'translate3d(' + ((b.x - CW / 2) * K.v).toFixed(1) + 'px,' + ((y - CH / 2) * K.v).toFixed(1) + 'px,0)' +
      ' rotate(' + b.rot.toFixed(2) + 'deg)' + (sel ? ' scale(1.1)' : '');
  }
  function refreshHandStates() {
    if (!S) return;
    const my = handActive && S.turn === 0 && S.phase === 'play';
    handCards().forEach(function (hc) {
      const id = Number(hc.dataset.id);
      const ok = !my || !playable || playable.indexOf(id) >= 0;
      hc.classList.toggle('locked', !ok);
      hc.classList.toggle('playable', my && ok);
      if (!ok && hc.classList.contains('sel')) { hc.classList.remove('sel'); applyCardTF(hc); }
    });
    if (selId !== null && my && playable.indexOf(selId) < 0) hidePreview();
  }
  function handCardEl(id) { return $('#hand .hc[data-id="' + id + '"]'); }

  function selectCard(hc) {
    const id = Number(hc.dataset.id);
    if (selId !== null) {
      const prev = handCardEl(selId);
      if (prev) { prev.classList.remove('sel'); applyCardTF(prev); }
    }
    selId = id;
    hc.classList.add('sel');
    applyCardTF(hc);
    $('#pvCard').innerHTML = cardHTML(id, '', 'sz-pv');
    $('#preview').classList.remove('off');
    sfx('tap');
  }
  function hidePreview() {
    selId = null;
    $('#preview').classList.add('off');
    handCards().forEach(hc => { if (hc.classList.contains('sel')) { hc.classList.remove('sel'); applyCardTF(hc); } });
  }

  /* 点了不能出的牌：先把这张牌送往椭圆桌面、再弹回手里。
     不能原地抖 —— 抖动关键帧会顶掉扇形内联 transform，牌会瞬移到桌面左上角 */
  let denyBusy = false;
  function denyBounce(hc) {
    const card = hc.querySelector('.card');
    if (!card || denyBusy || !S) return;
    denyBusy = true;
    const sp = WZ.slotPos(0, S.N);
    const at = toScreen(sp.x, sp.y);
    const r = card.getBoundingClientRect();
    const dx = at.x - (r.left + r.width / 2);
    const dy = at.y - (r.top + r.height / 2);
    hc.style.zIndex = '9';
    const leg = function (k0, k1, dur, ease) {
      return new Promise(function (res) {
        tween({
          dur: dur, ease: ease,
          upd(p) {
            const k = k0 + (k1 - k0) * p;
            const lift = 18 * Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
            card.style.transform = 'translate3d(' + (dx * k).toFixed(1) + 'px,' + (dy * k - lift).toFixed(1) + 'px,0) rotate(' + (7 * k).toFixed(2) + 'deg)';
          },
          after: res,
        });
      });
    };
    leg(0, 1, 180, easeOutQuad)
      .then(function () { return fxWait(60); })
      .then(function () { return leg(1, 0, 280, easeOutBack); })
      .then(function () { card.style.transform = ''; hc.style.zIndex = ''; denyBusy = false; });
  }

  function onHandClick(e) {
    const hc = e.target.closest ? e.target.closest('.hc') : null;
    if (!hc) return;
    if (!handActive || !S || S.turn !== 0 || S.phase !== 'play' || !pendingPlay) return;
    const id = Number(hc.dataset.id);
    if (playable && playable.indexOf(id) < 0) {
      denyBounce(hc);
      sfx('deny');
      const c = WZ.mustFollow(S, 0);
      setPrompt(c === null ? '这张现在不能出' : '必须跟 <span class="hl">' + WZ.labelColor(c) + '</span>');
      return;
    }
    if (selId === id) { commitPlay(id); return; }
    selectCard(hc);
  }

  function beginHumanTurn() {
    playable = WZ.legalPlays(S, 0);
    handActive = true;
    pendingPlay = null;
    refreshHandStates();
    const c = WZ.mustFollow(S, 0);
    if (c === null) {
      $('#followHint').classList.add('off');
      setPrompt('轮到你出牌 · 任意出', true);
    } else {
      $('#fhColor').textContent = WZ.labelColor(c);
      $('#followHint').classList.remove('off');
      setPrompt('轮到你出牌 · 必须跟同色', true);
    }
    updateSeatUI();
  }
  function endHumanTurn() {
    handActive = false;
    playable = null;
    hidePreview();
    refreshHandStates();
    $('#followHint').classList.add('off');
    updateSeatUI();
  }
  function commitPlay(id) {
    const res = pendingPlay;
    pendingPlay = null;
    handActive = false;
    hidePreview();
    $('#preview').classList.add('off');
    if (res) res(id);
  }

  /* ================= 提示 / 屏幕 ================= */
  function setPrompt(html, mine) {
    const n = $('#hudPrompt');
    n.innerHTML = html;
    n.classList.toggle('mine', !!mine);
  }
  const SCREENS = ['screen-menu', 'screen-setup', 'screen-game', 'screen-over'];
  function show(id) { SCREENS.forEach(s => $('#' + s).classList.toggle('on', s === id)); updateLogStrip(); }
  const name = pid => (S && S.players[pid] ? S.players[pid].name : '');

  function updateTopbar() {
    if (!S) return;
    $('#tbRound').textContent = S.round > 0 ? ('第 ' + S.round + '/' + S.rounds + ' 轮') : '准备发牌';
    const t = S.trumps;
    const pill = $('#tbTrump');
    if (t.mode === 'choose') { pill.className = 'pill pill-choose'; pill.textContent = '选色中…'; }
    else if (t.mode === 'none') { pill.className = 'pill pill-none'; pill.textContent = '无王牌'; }
    else { pill.className = 'pill pill-c' + t.color; pill.textContent = '王牌 ' + WZ.labelColor(t.color); }
    updateDeckN();
    pillFor(t);
  }

  function closeAll() {
    ['bidpanel', 'trumppanel', 'summary', 'rules', 'scorebox', 'logbox'].forEach(id => $('#' + id).classList.remove('on'));
  }

  /* ================= 计分榜（唯一数据源：WZ.scoreTable + S.hist 的明细细读） ================= */
  function histRows(r) {
    for (let i = S.hist.length - 1; i >= 0; i--) if (S.hist[i].round === r) return S.hist[i].rows;
    return null;
  }
  function ptsCls(p, exact) { return exact ? 'exact' : (p > 0 ? 'pos' : (p < 0 ? 'neg' : 'zero')); }
  function signed(p) { return (p > 0 ? '+' : '') + p; }

  function boardHTML(mode) {
    const tbl = WZ.scoreTable(S);
    let rows = tbl.rounds;
    if (mode === 'mini' && rows.length > 1) rows = rows.slice(-1);
    let h = '<table class="board"><thead><tr><th class="bd-first">轮</th>';
    S.players.forEach(p => { h += '<th>' + esc(p.name) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      const cur = r.live ? ' cur' : '';
      h += '<tr class="' + cur + '"><th>第 ' + r.r + ' 轮</th>';
      const det = histRows(r.r);
      for (let i = 0; i < S.N; i++) {
        if (r.pts === null) { h += '<td><span class="bd-live">进行中</span></td>'; continue; }
        const p = r.pts[i];
        const d = det ? det[i] : null;
        h += '<td><i class="bd-pts ' + ptsCls(p, d && d.exact) + '">' + signed(p) + '</i>' +
          (d ? '<span class="bd-sub"><em>预 ' + d.bid + '</em><em>实 ' + d.won + '</em></span>' : '') + '</td>';
      }
      h += '</tr>';
    });
    h += '</tbody><tfoot><tr><th>总分</th>';
    tbl.totals.forEach(t => { h += '<td>' + t + '</td>'; });
    h += '</tr></tfoot></table>';
    return h;
  }

  function openScore() {
    if (!S) return;
    $('#scoreSub').textContent = '第 ' + Math.max(1, S.round) + '/' + S.rounds + ' 轮 · 得分 / 预判 · 实际';
    $('#scoreBody').innerHTML = boardHTML('full');
    $('#scorebox').classList.add('on');
    const box = $('#scoreBody');
    const cur = box.querySelector('tr.cur');
    if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
    sfx('tap');
  }

  /* ================= 预判 / 选色 / 计分 面板 ================= */
  /* 预判面板可收起：桌面上的公开信息（指示牌、别人的预判）得能看。
     收起后底部提示条变成「点这里继续」的开关，点它（或点面板外）再展开。 */
  let bidSheet = null;

  function humanBid() {
    return new Promise(function (res) {
      const box = $('#bidChips');
      box.innerHTML = '';
      let pick = null;
      for (let n = 0; n <= S.k; n++) {
        const b = el('<button class="bid-chip" type="button">' + n + '</button>');
        b.addEventListener('click', function () {
          pick = n;
          $$('#bidChips .bid-chip').forEach(c => c.classList.remove('on'));
          b.classList.add('on');
          $('#bidOk').disabled = false;
          sfx('tap');
        });
        box.appendChild(b);
      }
      $('#bidSub').textContent = '第 ' + S.round + ' 轮 · 每人 ' + S.k + ' 张';
      $('#bidOk').disabled = true;
      function open() {
        $('#bidpanel').classList.add('on');
        $('#hudPrompt').classList.remove('tap');
        setPrompt('轮到你预判', true);
      }
      function close() {
        $('#bidpanel').classList.remove('on');
        setPrompt('轮到你预判 · <span class="hl">点这里继续</span>', true);
        $('#hudPrompt').classList.add('tap');
        sfx('tap');
      }
      bidSheet = { open: open, close: close };
      open();
      sfx('pip');
      function ok() {
        if (pick === null) return;
        $('#bidOk').removeEventListener('click', ok);
        $('#bidShrink').removeEventListener('click', close);
        bidSheet = null;
        $('#hudPrompt').classList.remove('tap');
        $('#bidpanel').classList.remove('on');
        sfx('confirm');
        res(pick);
      }
      $('#bidOk').addEventListener('click', ok);
      $('#bidShrink').addEventListener('click', close);
    });
  }
  function humanTrump() {
    return new Promise(function (res) {
      const box = $('#trumpRow');
      box.innerHTML = '';
      for (let c = 0; c < 4; c++) {
        const b = el('<button class="trump-btn tb-c' + c + '" type="button"><span class="tb-glyph">' + GLYPHS[c] + '</span>' + WZ.CN[c] + '</button>');
        b.addEventListener('click', function () {
          $('#trumppanel').classList.remove('on');
          sfx('confirm');
          res(c);
        });
        box.appendChild(b);
      }
      $('#trumppanel').classList.add('on');
      sfx('pip');
    });
  }
  function humanSum() {
    return new Promise(function (res) {
      function ok() {
        $('#sumOk').removeEventListener('click', ok);
        $('#summary').classList.remove('on');
        sfx('confirm');
        res();
      }
      $('#sumOk').addEventListener('click', ok);
    });
  }

  /* ================= 演出：发牌 ================= */
  function deckPt() {
    return toScreen(DECK_AT.x + 20, DECK_AT.y + 28);
  }
  function fxCard(id, at, size) {
    const holder = spawn('', 'flycard', at);
    holder.innerHTML = (id === null || id === undefined) ? backHTML() : cardHTML(id);
    const card = holder.firstChild;
    const cw = (size && size.w ? size.w : 46) * K.v;
    const ch = (size && size.h ? size.h : 64) * K.v;
    card.style.setProperty('--cw', cw.toFixed(2) + 'px');
    card.style.setProperty('--ch', ch.toFixed(2) + 'px');
    holder.style.marginLeft = (-cw / 2).toFixed(1) + 'px';
    holder.style.marginTop = (-ch / 2).toFixed(1) + 'px';
    return holder;
  }

  function preHideHand() {
    handCards().forEach(function (hc) {
      hc.style.opacity = '0';
      hc.dataset.dealt = '0';
    });
  }

  async function dealAnim(ev) {
    const from = deckPt();
    const order = [];
    for (let i = 0; i < ev.k; i++) for (let pid = 0; pid < S.N; pid++) order.push(pid);
    const chunks = WZ.chunked(order, 4);
    const stagger = Math.min(70, 1500 / Math.max(1, chunks.length));
    const hcs = handCards();

    chunks.forEach(function (ch, ci) {
      after(ci * stagger, function () {
        sfx('deal', { gain: 0.8 });
        ch.forEach(function (pid, j) {
          const a = seatAnchor(pid);
          const seedJit = ((ci * 7 + j * 13 + pid * 3) % 11) - 5;
          /* 手牌槽位 = 真人在全局发牌序里数到第几张（N=3 时 4 张切一块，不等于块内序号） */
          const hc = pid === 0 ? hcs[Math.floor((ci * 4 + j) / S.N)] : null;
          let to;
          if (hc && hc._base) to = toScreen(hc._base.x + seedJit * 1.2, hc._base.y - 10);
          else if (pid === 0) to = toScreen(180 + seedJit * 2, HAND_BOTTOM - 30);
          else {
            const pt = toScreen(a.x, a.y);
            to = { x: pt.x + seedJit * 1.6, y: pt.y + (a.up ? 6 : -6) + (ci % 2) * 2 };
          }
          const node = fxCard(null, from, { w: 30, h: 42 });
          flyTo(node, to, { dur: 250 + (ci % 3) * 20, ease: easeOutQuad, lift: 10 + (j * 7) % 14 })
            .then(function () {
              node.remove();
              if (hc && hc.dataset.dealt === '0') {
                hc.dataset.dealt = '1';
                hc.classList.add('dealt');
                hc.style.opacity = '1';
                sfx('pip', { gain: 0.5 });
              }
            });
        });
      });
    });
    await fxWait(chunks.length * stagger + 300);
    hcs.forEach(function (hc) { hc.style.opacity = '1'; hc.classList.remove('dealt'); });
    updateSeatUI();
  }

  /* ================= 演出：翻指示牌 ================= */
  async function indicatorAnim(ev) {
    const from = deckPt();
    if (ev.indicator === null) {
      /* 最后一轮：60 张全部发完，没有指示牌 */
      indSlot.innerHTML = '';
      pillFor({ mode: 'none' });
      updateTopbar();
      bannerAt('无王牌 · 决战轮', 'bannerLast');
      flashScreen(0.5, 'lava');
      sfx('warn');
      shakeAdd(0.45);
      logLine('trump', '最后一轮 · 无指示牌 · 本轮无王牌');
      await fxWait(900);
      return;
    }
    /* 槽心 = 签 9.6 + 缝 1.4 + 半坑 28 = IND_AT.y + 39；起飞点与落点同高 → 水平小弧线 */
    const dest = toScreen(IND_AT.x + IND_AT.w / 2, IND_AT.y + 11 + 28);
    const node = fxCard(null, from, { w: 40, h: 56 });
    await flyTo(node, { x: dest.x, y: dest.y }, { dur: 300, ease: easeOutQuad, lift: 16 });
    /* 翻面：scaleX 收 → 换面 → 放（不用 3D，省得在某些机型上闪） */
    const holder = node.firstChild;
    await new Promise(function (res) {
      tween({
        dur: 130, ease: easeInOutQuad,
        upd(p) { holder.style.transform = 'scaleX(' + (1 - 0.94 * p).toFixed(3) + ')'; },
        after: function () {
          holder.innerHTML = cardHTML(ev.indicator, '', 'sz-trick');
          sfx('flip');
          hitStop(40);
          ringAt(dest, 46, 'ringHit');
          tween({ dur: 160, ease: easeOutBack, upd(p) { holder.style.transform = 'scaleX(' + (0.06 + 0.94 * p).toFixed(3) + ')'; }, after: res });
        },
      });
    });
    node.remove();

    /* 落进指示牌位 */
    indSlot.innerHTML = cardHTML(ev.indicator, '', 'sz-ind');
    const t = ev.trump;
    pillFor(t);
    updateTopbar();
    const cc = WZ.card(ev.indicator);
    const nodePt = toScreen(IND_AT.x + IND_AT.w / 2, IND_AT.y + 39);
    if (cc.kind === 'color') {
      burst(nodePt, 12, 'lava', 34);
      floatAt({ x: nodePt.x, y: nodePt.y - 24 }, '王牌 ' + WZ.labelColor(cc.color), 'hit');
      shakeAdd(0.18);
      logLine('trump', '指示牌 = ' + WZ.label(ev.indicator) + ' → 王牌 ' + WZ.labelColor(cc.color));
      await fxWait(560);
    } else if (cc.kind === 'wizard') {
      flashScreen(0.35);
      burst(nodePt, 16, 'gold', 40);
      sfx('wizard');
      logLine('trump', '指示牌 = 巫师 → 先手看完手牌后指定王牌色');
      await fxWait(520);
    } else {
      /* 小丑：铃铛颤音 —— 摇的是刚落位的那张（flycard 那个已经 node.remove 了） */
      const landed = indSlot.firstChild;
      if (landed) {
        tween({
          dur: 420,
          upd(p) { landed.style.transform = 'rotate(' + (6 * Math.sin(p * Math.PI * 6)).toFixed(2) + 'deg)'; },
          after() { landed.style.transform = ''; },
        });
      }
      sfx('jester');
      logLine('trump', '指示牌 = 小丑 → 本轮无王牌');
      await fxWait(520);
    }
  }

  /* ================= 演出：出牌 / 收墩 ================= */
  async function playAnim(pid, id) {
    const sp = WZ.slotPos(pid, S.N);
    const to = toScreen(sp.x, sp.y);
    let from;
    if (pid === 0) {
      const hc = handCardEl(id);
      if (hc) {
        const r = hc.getBoundingClientRect();
        from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        hc.remove();
        /* 剩余手牌立刻收拢补位（.hc 自带 transform 过渡，会自己滑过去） */
        layoutHand();
      } else {
        const a = seatAnchor(0);
        from = toScreen(a.x, a.y);
      }
    } else {
      const a = seatAnchor(pid);
      from = toScreen(a.x, a.y - (a.up ? -6 : 6));
    }
    const node = fxCard(id, from, { w: 40, h: 56 });
    sfx('slap');
    await flyTo(node, to, { dur: 280, ease: easeOutQuad, lift: 22 });
    node.remove();
    const slot = slots[pid];
    const card = el(cardHTML(id, '', 'sz-trick'));
    slot.appendChild(card);
    slot.classList.remove('live');
    hitStop(30);
    const cc = WZ.card(id);
    if (cc.kind === 'wizard') {
      burst(to, 12, 'gold', 34);
      sfx('wizard', { gain: 0.8 });
      shakeAdd(0.16);
    } else if (cc.kind === 'jester') {
      sfx('jester', { gain: 0.8 });
    }
    tween({
      dur: 150, ease: easeOutBack,
      upd(p) { card.style.transform = 'scale(' + (1 + 0.14 * (1 - p)).toFixed(3) + ')'; },
      after() { card.style.transform = ''; },
    });
  }

  const KIND_CN = { wizard: '巫师', trump: '王牌', led: '跟色', jesterLed: '小丑定色', jesterAll: '全小丑' };

  async function trickAnim(ev) {
    const w = ev.winner;
    ev.plays.forEach(function (pl) {
      const card = slots[pl.pid] && slots[pl.pid].querySelector('.card');
      if (!card) return;
      if (pl.pid === w) card.classList.add('glow-hit');
      else card.classList.add('trick-faded');
    });
    sfx('trick');
    updateSeatUI();
    await fxWait(PACE.v < 1 ? 260 : 200);

    const a = seatAnchor(w);
    const to = toScreen(a.x, a.y - 6);
    ev.plays.forEach(function (pl, i) {
      const slot = slots[pl.pid];
      const card = slot && slot.querySelector('.card');
      if (!card) return;
      const sp = WZ.slotPos(pl.pid, S.N);
      const pt = toScreen(sp.x, sp.y);
      const node = fxCard(pl.card, pt, { w: 40, h: 56 });
      card.remove();
      after(i * 45, function () {
        flyTo(node, { x: to.x + i * 3 - 4, y: to.y }, { dur: 260, ease: easeInQuad, fadeOut: true, to: 0.72 })
          .then(function () { node.remove(); });
      });
    });
    await fxWait(260 + ev.plays.length * 45);
    floatAt(to, '+1 墩', 'hit');
    chipPunch(w);
    sfx('pip');
    updateSeatUI();
    if (w === 0) setPrompt('你拿下了这一墩', true);
    else setPrompt(name(w) + ' 拿下这一墩（' + (KIND_CN[ev.kind] || '') + '）');
    await fxWait(320);
  }

  /* ================= 演出：本轮计分 ================= */
  async function roundSummary(ev) {
    const rows = ev.rows;
    $('#sumTitle').textContent = '第 ' + S.round + ' 轮 · 本轮计分';
    let h = '';
    rows.forEach(function (r) {
      const p = S.players[r.pid];
      h += '<div class="sum-row' + (r.exact ? ' exact' : '') + '" data-pid="' + r.pid + '" style="opacity:0">' +
        '<span class="sr-mark">' + (r.exact ? '✓' : '✗') + '</span>' +
        '<span class="sr-name">' + esc(p.name) + '</span>' +
        '<span class="sr-detail">预判 ' + r.bid + ' · 实际 ' + r.won + '</span>' +
        '<span class="sr-pts ' + ptsCls(r.pts, r.exact) + '">' + signed(r.pts) + '</span></div>';
    });
    $('#sumRows').innerHTML = h;
    $('#sumBoard').innerHTML = boardHTML('mini');
    $('#sumHint').textContent = WZ.checkEnd(S) ? '确认后揭晓终局排名' : '确认后重新洗牌发牌 · 进入下一轮';
    /* 行先亮、榜后揭：榜与榜题先压住（占着位，揭开时不跳布局） */
    const boardEls = [$('#summary .board-title'), $('#sumBoard')];
    const boardOp = function (v) { boardEls.forEach(function (n) { n.style.opacity = String(v); }); };
    boardOp(0);
    $('#summary').classList.add('on');
    setPace(SLOW);
    sfx('round');
    updateSeatUI();

    const rowEls = $$('#sumRows .sum-row');
    await fxWait(220);
    for (let i = 0; i < rowEls.length; i++) {
      const node = rowEls[i];
      const r = rows[i];
      const pts = node.querySelector('.sr-pts');
      pts.textContent = '0';
      tween({ dur: 200, upd(p) { node.style.opacity = String(p); } });
      sfx(r.exact ? 'score' : 'deny', { gain: r.exact ? 0.9 : 0.7 });
      tween({
        dur: 420, ease: easeOutCubic,
        upd(p) { pts.textContent = signed(Math.round(r.pts * p)); },
        after() { pts.textContent = signed(r.pts); },
      });
      await fxWait(300);
    }
    logLine('round', '第 ' + S.round + ' 轮计分 · ' + rows.map(function (r) {
      return name(r.pid) + ' 预' + r.bid + '实' + r.won + '(' + signed(r.pts) + ')';
    }).join(' · '));
    /* 行满 → 揭计分榜 */
    tween({ dur: 300, ease: easeOutCubic, upd(p) { boardOp(p); } });
    await fxWait(360);
    await humanSum();
    setPace(1);
  }

  /* ================= 演出：终局排名 ================= */
  async function showOver() {
    show('screen-over');
    saveNow('over');
    clearBubbles();
    const rk = WZ.rank(S);
    const list = $('#rankList');
    list.innerHTML = '';
    $('#overBoard').innerHTML = boardHTML('full');
    setPace(SLOW);
    for (let i = 0; i < rk.length; i++) {
      const r = rk[i];
      const p = S.players[r.pid];
      const row = el('<div class="rank-row' + (i === 0 ? ' champ' : '') + '">' +
        '<span class="rk-place">' + r.place + (r.tied ? '=' : '') + '</span>' +
        '<span class="rk-hat">' + hatSVG(SEAT_C[p.avatar % SEAT_C.length], '#1a1206') + '</span>' +
        '<span class="rk-name">' + esc(p.name) + '</span>' +
        '<span class="rk-sub">' + (p.pid === 0 ? '你' : 'AI') + '</span>' +
        '<span class="rk-score">0</span></div>');
      row.style.opacity = '0';
      list.appendChild(row);
      const sc = row.querySelector('.rk-score');
      tween({ dur: 220, upd(pp) { row.style.opacity = String(pp); } });
      tween({ dur: 460, ease: easeOutCubic, upd(pp) { sc.textContent = String(Math.round(r.total * pp)); } });
      sfx(i === 0 ? 'win' : 'pip', { gain: i === 0 ? 1 : 0.7 });
      if (i === 0) {
        after(200, function () {
          const rr = row.getBoundingClientRect();
          const pt = { x: rr.left + 22, y: rr.top + rr.height / 2 };
          burst(pt, 14, 'gold', 46);
          floatAt(pt, '冠军', 'hit big');
          flashScreen(0.4);
          shakeAdd(0.35);
          bannerAt('冠军 · ' + p.name, 'bannerWin');
        });
      }
      await fxWait(i === 0 ? 700 : 380);
    }
    logLine('sys', '终局 · ' + rk.map(function (r) {
      return '#' + r.place + ' ' + name(r.pid) + ' ' + r.total;
    }).join(' · '));
    setPace(1);
    sfx('fanfare');
  }

  /* ================= 轮流程 ================= */
  let flowId = 0;
  const DEV = (function () {
    try {
      const q = new URLSearchParams(root.location.search);
      return {
        n: parseInt(q.get('n'), 10) || 0,
        seed: parseInt(q.get('seed'), 10) || 0,
        from: parseInt(q.get('from'), 10) || 0,
        fast: q.get('fast') === '1',
      };
    } catch (e) { return { n: 0, seed: 0, from: 0, fast: false }; }
  })();
  const DEV_ANY = DEV.n || DEV.seed || DEV.from || DEV.fast;

  function devCheck() {
    if (!DEV_ANY) return;
    const v = WZ.validate(S);
    if (!v.ok) logLine('err', 'validate: ' + v.errs.join('；'));
  }

  function think(base) {
    const ms = DEV.fast ? 70 : (base || 480) + Math.random() * 240;
    return fxWait(ms);
  }

  function resetRoundVisuals() {
    slots.forEach(s => { s.innerHTML = ''; s.classList.remove('live'); });
    indSlot.innerHTML = '';
    clearBubbles();
    $('#followHint').classList.add('off');
    renderHand();
    updateTopbar();
    updateSeatUI();
  }

  async function enterRound() {
    const id = ++flowId;
    if (!S || S.phase !== 'deal') return;
    const ev = WZ.startRound(S, rng);
    logLine('deal', '第 ' + S.round + '/' + S.rounds + ' 轮 · 每人 ' + ev.k + ' 张 · 先手 ' + name(ev.leader));
    resetRoundVisuals();
    preHideHand();
    setPrompt('发牌…');
    sfx('deal');
    saveNow('pick');
    await dealAnim(ev);
    if (id !== flowId) return;
    setPrompt('翻指示牌…');
    await indicatorAnim(ev);
    if (id !== flowId) return;
    await afterTrump();
  }

  async function afterTrump() {
    const id = flowId;
    if (S.phase === 'trump') {
      const leader = S.leader;
      updateTopbar();
      updateSeatUI();
      if (S.players[leader].ai) {
        setPrompt(name(leader) + ' 正在看手牌选色…');
        await think(620);
        if (id !== flowId) return;
        const c = AI.trump(S, leader);
        WZ.chooseTrump(S, leader, c);
        logLine('trump', name(leader) + ' 指定王牌 → ' + WZ.labelColor(c));
        bubble(leader, '王牌 → ' + WZ.labelColor(c));
        sfx('confirm');
        updateTopbar();
        pillFor(S.trumps);
        await fxWait(420);
      } else {
        bubble(0, '看完手牌，指定一色…');
        setPrompt('指示牌是「巫师」· 由你指定王牌色', true);
        const c = await humanTrump();
        WZ.chooseTrump(S, 0, c);
        logLine('trump', '你 指定王牌 → ' + WZ.labelColor(c));
        bubble(0, '王牌 → ' + WZ.labelColor(c));
        updateTopbar();
        pillFor(S.trumps);
        sfx('whoosh');
      }
      if (id !== flowId) return;
    }
    await bidPhase();
  }

  async function bidPhase() {
    const id = flowId;
    while (S.bidQueue.length) {
      const pid = S.bidQueue[0];
      if (S.players[pid].ai) {
        setPrompt(name(pid) + ' 正在预判…');
        await think(520);
        if (id !== flowId) return;
        const n = AI.bid(S, pid, rng);
        WZ.placeBid(S, pid, n);
        logLine('bid', name(pid) + ' 预判 ' + n);
        updateSeatUI();
        bubble(pid, '预判 ' + n);
        sfx('pop');
        saveNow('pick');
        await fxWait(340);
      } else {
        setPrompt('轮到你预判', true);
        const n = await humanBid();
        WZ.placeBid(S, 0, n);
        logLine('bid', '你 预判 ' + n);
        updateSeatUI();
        bubble(0, '预判 ' + n);
        sfx('pop');
        saveNow('pick');
        await fxWait(300);
      }
    }
    await playPhase();
  }

  async function playPhase() {
    const id = flowId;
    while (S.phase === 'play' || S.phase === 'trick') {
      if (S.phase === 'trick') {
        const ev = WZ.resolveTrick(S);
        logLine('trick', '第 ' + S.played.length + ' 墩 · ' + name(ev.winner) + ' 得（' + (KIND_CN[ev.kind] || '') + '）' +
          ' · ' + ev.plays.map(pl => name(pl.pid) + ':' + WZ.label(pl.card)).join(' '));
        saveNow('pick');
        devCheck();
        await trickAnim(ev);
        if (id !== flowId) return;
        continue;
      }
      const pid = S.turn;
      const sp = WZ.slotPos(pid, S.N);
      if (slots[pid]) slots[pid].classList.add('live');
      updateSeatUI();
      if (S.players[pid].ai) {
        setPrompt(name(pid) + ' 正在出牌…');
        await think(560);
        if (id !== flowId) return;
        const cid = AI.play(S, pid);
        WZ.playCard(S, pid, cid);
        saveNow('pick');
        await playAnim(pid, cid);
        devCheck();
        if (id !== flowId) return;
        await fxWait(140);
      } else {
        beginHumanTurn();
        const cid = await new Promise(function (res) { pendingPlay = res; });
        WZ.playCard(S, 0, cid);
        saveNow('pick');
        endHumanTurn();
        await playAnim(0, cid);
        devCheck();
        if (id !== flowId) return;
        await fxWait(140);
      }
    }
    await roundEnd();
  }

  /* 计分卡关掉之后去哪：揭排名或者下一轮。读档重开的计分卡也要接着走这条路，
     不然确认一下之后整局就悬在半空（rshow 停着、没人推进） */
  async function advanceAfterSummary() {
    if (WZ.checkEnd(S)) { await fxWait(200); await showOver(); return; }
    await fxWait(240);
    enterRound();
  }

  async function roundEnd() {
    if (!S || S.phase !== 'rshow') return;
    const ev = WZ.endRound(S);
    saveNow('show');
    updateSeatUI();
    logLine('sys', '本轮结束 · 总分 ' + ev.totals.map(t => name(t.pid) + ' ' + t.score).join(' / '));
    await roundSummary(ev);
    await advanceAfterSummary();
  }

  /* 开发参数：一路快进到第 target 轮（无演出；真人那手也交给 AI 代打） */
  function fastForwardTo(target) {
    let guard = 0;
    while (S.round < target - 1 && S.phase !== 'over' && guard++ < 200) {
      if (S.phase === 'deal') WZ.startRound(S, rng);
      if (S.phase === 'trump') WZ.chooseTrump(S, S.leader, AI.trump(S, S.leader));
      while (S.phase === 'bid') { const pid = S.bidQueue[0]; WZ.placeBid(S, pid, AI.bid(S, pid, rng)); }
      while (S.phase === 'play' || S.phase === 'trick') {
        if (S.phase === 'play') WZ.playCard(S, S.turn, AI.play(S, S.turn));
        else WZ.resolveTrick(S);
      }
      if (S.phase === 'rshow') WZ.endRound(S);
    }
    logLine('sys', 'dev · 快进到第 ' + S.round + ' 轮前');
  }

  /* ================= 读档 ================= */
  function rebuildRoundVisuals() {
    /* 指示牌 */
    if (S.indicator !== null && S.indicator !== undefined) {
      indSlot.innerHTML = cardHTML(S.indicator, '', 'sz-ind');
    }
    pillFor(S.trumps);
    /* 手牌与桌面 */
    renderHand();
    S.table.forEach(function (pl) {
      if (slots[pl.pid]) slots[pl.pid].appendChild(el(cardHTML(pl.card, '', 'sz-trick')));
    });
    updateTopbar();
    updateSeatUI();
  }

  function resume(o) {
    seed = o.seed; rng = WZ.seeded(seed);
    if (o.rng != null && rng.set) rng.set(o.rng);
    S = o.S;
    draft = o.draft || draft;
    LOG.list = o.log || [];
    if (o.speed) { SPEED.v = o.speed; $('#btnSpeed').classList.toggle('on', SPEED.v > 1); syncPace(); }
    show('screen-game');
    buildTable();
    buildSeats();
    rebuildRoundVisuals();
    logLine('sys', '读档 · 第 ' + Math.max(1, S.round) + ' 轮 · ' + stageName(o.stage));
    clearFx();
    if (o.stage === 'over') { showOver(); return; }
    if (o.stage === 'show') {
      const last = S.hist[S.hist.length - 1];
      if (last) {
        roundSummary({ rows: last.rows, totals: S.players.map(p => ({ pid: p.pid, score: p.score })), leaderNext: S.leader })
          .then(advanceAfterSummary);
        return;
      }
    }
    if (S.phase === 'deal') { enterRound(); return; }
    if (S.phase === 'trump') { setPrompt('继续 · 先手正在选色…'); afterTrump(); return; }
    if (S.phase === 'bid') { setPrompt('继续 · 预判中…'); bidPhase(); return; }
    if (S.phase === 'play' || S.phase === 'trick') { setPrompt('继续这局…'); playPhase(); return; }
    if (S.phase === 'rshow') { roundEnd(); return; }
    showOver();
  }

  /* ================= 开局 / 名单 ================= */
  let draft = { N: 4, name: '你', avatar: 0 };

  function renderSetup() {
    const seg = $('#cntSeg');
    seg.innerHTML = '';
    [3, 4, 5, 6].forEach(function (n) {
      const b = el('<button class="seg-btn' + (n === draft.N ? ' on' : '') + '" type="button">' + n + ' 人</button>');
      b.addEventListener('click', function () {
        draft.N = n;
        renderSetup();
        saveNow('setup');
        sfx('tap');
      });
      seg.appendChild(b);
    });
    const av = $('#avRow');
    av.innerHTML = '';
    SEAT_C.forEach(function (c, i) {
      const b = el('<button class="sw' + (i === draft.avatar ? ' on' : '') + '" type="button">' + hatSVG(c, '#1a1206') + '</button>');
      b.addEventListener('click', function () {
        draft.avatar = i;
        renderSetup();
        saveNow('setup');
        sfx('tap');
      });
      av.appendChild(b);
    });
    const roster = $('#roster');
    roster.innerHTML = '';
    for (let i = 0; i < draft.N; i++) {
      const me = i === 0;
      const nm = me ? (draft.name || '你') : AI_NAMES[(i - 1) % AI_NAMES.length];
      const avIdx = me ? draft.avatar : (draft.avatar + i) % SEAT_C.length;
      roster.appendChild(el('<div class="roster-row' + (me ? ' me' : '') + '">' +
        '<span class="rr-hat">' + hatSVG(SEAT_C[avIdx], '#1a1206') + '</span>' +
        '<span class="rr-name">' + esc(nm) + '</span>' +
        '<span class="rr-tag">' + (me ? '你' : 'AI · 正常') + '</span></div>'));
    }
    $('#menuFoot').textContent = draft.N + ' 人局 · 共 ' + WZ.roundsFor(draft.N) + ' 轮 · 最后一轮没有王牌';
  }

  function beginGame() {
    SFX.init();
    seed = DEV.seed || makeSeed();
    rng = WZ.seeded(seed);
    const aiAvatars = [];
    for (let i = 1; i < draft.N; i++) aiAvatars.push((draft.avatar + i) % SEAT_C.length);
    S = WZ.newGame({
      N: draft.N, humanName: draft.name || '你', humanAvatar: draft.avatar,
      aiNames: AI_NAMES, aiAvatars: aiAvatars, seed: seed,
    });
    saveStageRef.v = 'pick';
    show('screen-game');
    clearFx();
    fxClock = 0;
    logLine('sys', '开局 · ' + S.N + ' 人 · 种子 ' + seed + ' · 共 ' + S.rounds + ' 轮');
    buildTable();
    buildSeats();
    renderHand();
    updateTopbar();
    updateSeatUI();
    $('#btnSpeed').classList.toggle('on', SPEED.v > 1);
    syncPace();
    saveNow('pick');
    if (DEV.from > 1) fastForwardTo(DEV.from);
    fitStage();
    enterRound();
  }

  /* ================= 接线 ================= */
  function wire() {
    $('#btnStart').addEventListener('click', function () { SFX.init(); sfx('tap'); renderSetup(); show('screen-setup'); saveNow('setup'); });
    $('#btnRules').addEventListener('click', function () { $('#rules').classList.add('on'); sfx('tap'); });
    $('#rulesClose').addEventListener('click', function () { $('#rules').classList.remove('on'); sfx('tap'); });
    $('#btnHelp').addEventListener('click', function () { $('#rules').classList.add('on'); sfx('tap'); });
    $$('.js-log').forEach(b => b.addEventListener('click', function () { sfx('tap'); openLog(); }));
    $('#logClose').addEventListener('click', function () { $('#logbox').classList.remove('on'); sfx('tap'); });
    $('#logClear').addEventListener('click', function () { LOG.list = []; renderLog(); updateLogStrip(); sfx('tap'); });
    $('#logCopy').addEventListener('click', function () {
      const txt = LOG.list.map(e => logClock(e.t) + ' [' + (e.r ? 'R' + e.r : '—') + '/' + e.k + '] ' + e.s).join('\n');
      try {
        root.navigator.clipboard.writeText(txt).then(function () { sfx('confirm'); }, function () {});
      } catch (e) { /* 忽略 */ }
    });
    $('#logWipe').addEventListener('click', function () {
      clearSave();
      LOG.list = [];
      S = null; rng = null; flowId++;
      $('#logbox').classList.remove('on');
      closeAll();
      clearFx();
      show('screen-menu');
      sfx('deny');
    });
    $('#btnSetupBack').addEventListener('click', function () { show('screen-menu'); sfx('tap'); });
    $('#inpName').addEventListener('input', function () { draft.name = this.value.trim() || '你'; });
    $('#inpName').addEventListener('change', function () { renderSetup(); saveNow('setup'); });
    $('#btnBegin').addEventListener('click', function () { draft.name = ($('#inpName').value.trim() || '你'); sfx('confirm'); beginGame(); });
    $('#btnAgain').addEventListener('click', function () { sfx('tap'); beginGame(); });
    $('#btnBackHome').addEventListener('click', function () {
      clearSave();
      S = null; rng = null; flowId++;
      sfx('tap');
      show('screen-menu');
    });
    $('#btnScore').addEventListener('click', openScore);
    $('#scoreClose').addEventListener('click', function () { $('#scorebox').classList.remove('on'); sfx('tap'); });
    $('#btnSpeed').addEventListener('click', function () {
      SPEED.v = SPEED.v > 1 ? 1 : 3;
      $('#btnSpeed').classList.toggle('on', SPEED.v > 1);
      syncPace();
      fxKick();
      sfx('tap');
    });
    $('#btnLog').addEventListener('click', function () { sfx('tap'); openLog(); });
    /* 预判面板的半收半留：点面板外的暗底收起，点底部提示条展开 */
    $('#bidpanel').addEventListener('click', function (e) { if (e.target === this && bidSheet) bidSheet.close(); });
    $('#hudPrompt').addEventListener('click', function () { if (bidSheet) { bidSheet.open(); sfx('tap'); } });
    $('#hand').addEventListener('click', onHandClick);
    $('#pvPlay').addEventListener('click', function () { if (selId !== null && pendingPlay) { sfx('slap', { gain: 0.6 }); commitPlay(selId); } });
    $('#pvCancel').addEventListener('click', function () { sfx('tap'); hidePreview(); });
    $('#rules').addEventListener('click', function (e) { if (e.target === this) $('#rules').classList.remove('on'); });
    $('#scorebox').addEventListener('click', function (e) { if (e.target === this) $('#scorebox').classList.remove('on'); });
    $('#logbox').addEventListener('click', function (e) { if (e.target === this) $('#logbox').classList.remove('on'); });
    root.addEventListener('resize', () => { fitStage(); });
    root.addEventListener('orientationchange', () => { setTimeout(fitStage, 120); });
    if (root.ResizeObserver) {
      try {
        new ResizeObserver(function () {
          const st = $('#stage'), wrap = $('#stagewrap');
          if (!wrap || !st || wrap.clientWidth <= 0) return;
          if (st.clientWidth !== 0) {
            /* 顶栏/HUD 高度一变（比如顶栏折行），舞台要跟着重新适配 ——
               不然旧尺寸的舞台会压到日志条和 HUD 身上 */
            const k = Math.max(0.2, Math.min(wrap.clientWidth / 360, wrap.clientHeight / 640));
            if (Math.abs(k - K.v) < 0.002) return;
          }
          fitStage();
        }).observe($('#stagewrap'));
      } catch (e) { /* 忽略 */ }
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { measureOrigin(); layoutHand(); } });
  }

  /* ================= 启动 ================= */
  function boot() {
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        fxOn = false;
        document.documentElement.style.setProperty('--shake-scale', '0');
      }
    } catch (e) { /* 忽略 */ }
    $('#menuArt').innerHTML = menuArtSVG();
    $('#scenery').innerHTML = scenerySVG();
    if (DEV.n >= 3 && DEV.n <= 6) draft.N = DEV.n;
    $('#inpName').value = draft.name === '你' ? '' : draft.name;
    wire();
    const o = loadSave();
    if (o && o.stage === 'setup') {
      draft = o.draft;
      if (o.log) LOG.list = o.log;
      renderSetup();
      $('#inpName').value = draft.name === '你' ? '' : draft.name;
      show('screen-setup');
      fitStage();
      return;
    }
    if (o) { resume(o); fitStage(); return; }
    show('screen-menu');
    fitStage();
  }

  root.WZUI = {
    state: () => S, speed: () => SPEED.v, pace: () => rate(), fxOn: () => fxOn,
    log: () => LOG.list, save: () => loadSave(),
    sfx: sfx, fxWait: fxWait, logLine: logLine, DEV: DEV,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : null);
