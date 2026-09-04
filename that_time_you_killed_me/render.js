/* ============================================================
   煞有其时 That Time You Killed Me · 界面 + 演出（render.js）
   职责：
   - 菜单/对局/结算三态切换；棋盘构建与点选交互
   - 事件驱动演出：推挤滑步 / 悖论与撞墙爆炸 / 穿越分身 / 屏幕震动与顿帧
   - 人机驱动（aiPlan 分步执行）与自动空过
   配色与动效遵循 game-feel：短暂夸大、分层反馈、按重要度分级
   ============================================================ */
'use strict';
(function () {
  const G = window.TTYKM;
  const $ = sel => document.querySelector(sel);
  const ERA_NAMES = G.ERAS;                    // 过去/现在/未来
  const PLAY = G.NAMES;                        // 黑方/白方
  const DIR_GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };

  let S = null, mode = 'menu', live = false, busy = false, aiStop = false, aiRunning = false;
  let pend = null, pendKey = '';                     // 输入缓冲：busy 期间收下的一次点击（收尾重放）
  let winFired = null;                               // 结算演出只对同一终局触发一次
  let aiSide = 1;                                    // AI 执子（0=黑/1=白）：开局随机，旧存档缺省按白方
  let activeMods = [];                               // 本局启用的模组（弹窗勾选；重开/再来一局沿用）
  let actMode = 'move';                              // 行动模式 UI 态：move(移动·穿越)/sow/pluck
  const isAiTurn = () => mode === 'ai' && S.turn === aiSide;
  const growthOn = () => !!(S && S.mods && S.mods.indexOf('growth') >= 0);
  const actCat = a => (a.t === 'move' || a.t === 'travel') ? 'move' : a.t;
  const seedDelta = evs => evs.some(e => e.k === 'seed' || (e.k === 'poof' && e.pl === 'seed'));
  const timers = [];
  const sleep = ms => new Promise(r => timers.push(setTimeout(r, ms)));
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }
  const turnKey = () => S ? S.turnNo + ':' + S.turn : '';

  /* ---------------- 屏幕震动（trauma 衰减，sin 采样） ---------------- */
  let trauma = 0, shakeT = 0, shakeOn = false;
  const stageEl = () => $('#stage');
  function shakeAdd(a) { trauma = Math.min(1, trauma + a); if (!shakeOn) { shakeOn = true; requestAnimationFrame(shakeLoop); } }
  function shakeLoop(now) {
    if (!shakeOn) return;
    const dt = Math.min(50, now - (shakeLoop._t || now));
    shakeLoop._t = now;
    if (trauma > 0.002) {
      trauma = Math.max(0, trauma - 1.15 * dt / 1000);
      const s = trauma * trauma;
      shakeT += dt;
      stageEl().style.transform =
        'translate(' + Math.round(Math.sin(shakeT * 0.023) * 11 * s) + 'px,' +
        Math.round(Math.sin(shakeT * 0.031 + 1.7) * 8 * s) + 'px)' +
        'rotate(' + Math.round(Math.sin(shakeT * 0.017) * 0.6 * s * 10) / 10 + 'deg)';
    } else {
      trauma = 0; stageEl().style.transform = '';
      shakeOn = false; shakeLoop._t = 0;
    }
    if (shakeOn) requestAnimationFrame(shakeLoop);
  }

  /* ---------------- 演出层（事件驱动 + 顿帧） ---------------- */
  const fxEl = () => $('#fx');
  const fxTweens = [];
  let fxClock = 0, fxRunning = false, fxHold = 0, fxLast = 0;

  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function easeInQuad(p) { return p * p; }
  function easeBack(p) { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }

  /* 通用 tween：start({t, dur, upd, ease})，t/fxClock 受顿帧冻结 */
  function tween(o) { fxTweens.push({ t0: fxClock + (o.t || 0), dur: o.dur, upd: o.upd, ease: o.ease || easeOutCubic, done: false }); }
  function tweenPos(el, from, to, dur, o) {
    const dx = to.x - from.x, dy = to.y - from.y;
    el.style.left = from.x + 'px'; el.style.top = from.y + 'px';
    tween({
      t: (o && o.t) || 0, dur,
      ease: (o && o.ease) || easeOutCubic,
      upd(p) { el.style.transform = 'translate3d(' + (dx * p).toFixed(2) + 'px,' + (dy * p).toFixed(2) + 'px,0)'; },
    });
  }
  function fxPieceGhost(c, era, i) {
    const r = cellPx(era, i);
    const el = document.createElement('div');
    el.className = 'fxpiece c' + c;
    const w = Math.round(r.w * 0.62), h = Math.round(r.h * 0.62);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.left = Math.round(r.x + (r.w - w) / 2) + 'px';
    el.style.top = Math.round(r.y + (r.h - h) / 2) + 'px';
    fxEl().appendChild(el);
    return { el, r, w, h };
  }
  function cellPx(era, i) {
    const cell = document.querySelector('.era[data-e="' + era + '"] .cell[data-i="' + i + '"]');
    const f = fxEl().getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    return { x: c.left - f.left, y: c.top - f.top, w: c.width, h: c.height };
  }
  function fxCenter(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  const WHY_TAG = {
    paradox: ['悖论！', 'paradox'], wall: ['撞墙！', 'wall'],
    crush: ['压垮！', 'crush'], squash: ['挤死！', 'squash'],
  };
  function blastAt(c, era, i, why) {
    const g = fxPieceGhost(c, era, i);
    const tag = WHY_TAG[why] || WHY_TAG.wall;
    const d = 520;
    const c0 = { x: 0, y: 0, s: 1, r: 0 }, c1 = { x: 0, y: -rndSign(8), s: 2.4, r: rndSign(26) };
    tween({ t: 0, dur: d, ease: easeInQuad, upd(p) {
      const s = c0.s + (c1.s - c0.s) * p, r = c0.r + (c1.r - c0.r) * p;
      g.el.style.transform = 'translate3d(' + c0.x + 'px,' + (c0.y + (c1.y - c0.y) * p) + 'px,0) rotate(' + r + 'deg) scale(' + s + ')';
      g.el.style.opacity = String(Math.max(0, 1 - p * 1.15));
    } });
    tween({ t: 0, dur: d + 120, upd(p) { if (p >= 1) g.el.remove(); } });
    const lbl = floatLabel(fxCenter(g.r), tag[0], tag[1]);
    return { lbl };
  }
  function rndSign(v) { return Math.random() < 0.5 ? -v : v; }
  function floatLabel(pt, text, cls) {
    const el = document.createElement('div');
    el.className = 'fxlabel ' + (cls || '');
    el.innerHTML = '<span class="tag">' + text + '</span>';
    el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
    fxEl().appendChild(el);
    const s = el.getBoundingClientRect();
    el.style.left = (pt.x - s.width / 2) + 'px'; el.style.top = (pt.y - 26 - s.height) + 'px';
    tween({ t: 60, dur: 720, ease: easeOutCubic, upd(p) {
      el.style.transform = 'translateY(' + (-34 * p) + 'px)';
      el.style.opacity = p < 0.22 ? '1' : String(Math.max(0, 1 - (p - 0.22) / 0.78));
    } });
    tween({ t: 780, dur: 20, upd(p) { if (p >= 1) el.remove(); } });
    return el;
  }
  function ringAt(era, i) {
    const r = cellPx(era, i);
    const el = document.createElement('div');
    el.className = 'fxring';
    const m = 4;
    el.style.left = (r.x - m) + 'px'; el.style.top = (r.y - m) + 'px';
    el.style.width = (r.w + m * 2) + 'px'; el.style.height = (r.h + m * 2) + 'px';
    el.style.borderRadius = '12px';
    fxEl().appendChild(el);
    tween({ t: 0, dur: 420, ease: easeOutCubic, upd(p) {
      el.style.transform = 'scale(' + (1 + p * 1.6) + ')';
      el.style.opacity = String(Math.max(0, 1 - p));
    } });
    tween({ t: 430, dur: 20, upd(p) { if (p >= 1) el.remove(); } });
  }
  function popIn(c, era, i) {   // 分身弹出（驻留到收尾统一清理）
    const g = fxPieceGhost(c, era, i);
    g.el.classList.add('popkey');
    tween({ t: 0, dur: 460, upd(p) { g.el.style.opacity = p < 0.08 ? '0' : '1'; } });
  }

  /* 植物幽灵层：与格同尺寸的 absolute 容器（植物 .pl 节点原样定位在内） */
  function fxPlWrap(era, i) {
    const r = cellPx(era, i);
    const el = document.createElement('div');
    el.className = 'fxpl';
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
    el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
    fxEl().appendChild(el);
    return { el, r };
  }
  /* 把格内真实植物节点搬进幽灵层（树倒起滑 / 拨除消散用，收尾 renderAll 重画） */
  function grabPl(era, i) {
    const wrap = fxPlWrap(era, i);
    const cell = document.querySelector('.era[data-e="' + era + '"] .cell[data-i="' + i + '"]');
    const span = cell ? cell.querySelector('.pl') : null;
    if (span) wrap.el.appendChild(span);
    return wrap;
  }
  /* 演出常量：树倒多米诺（no=距触发侧最近 0 起，逐棵错开） */
  const FALL_STAG = 52, FALL_DUR = 135, FALL_BASE = 20;

  /* 一次推链/穿越/生长演出的编排 */
  function playEvs(evs) {
    return new Promise(done => {
      const slides = [], dies = [], travs = [], clones = [];
      const falls = [], sows = [], grows = [], poofs = [];
      for (const e of evs) {
        if (e.k === 'move' || e.k === 'step') slides.push(e);
        else if (e.k === 'die') dies.push(e);
        else if (e.k === 'travel') travs.push(e);
        else if (e.k === 'clone') clones.push(e);
        else if (e.k === 'fall') falls.push(e);
        else if (e.k === 'seed') sows.push(e);
        else if (e.k === 'grow') grows.push(e);
        else if (e.k === 'poof') poofs.push(e);
      }
      const crushDies = dies.filter(d => d.why === 'crush');   // 压垮：随最远树着地爆破（不进通用 boom）
      const regDies = dies.filter(d => d.why !== 'crush');
      if (!slides.length && !dies.length && !travs.length && !clones.length &&
          !falls.length && !sows.length && !grows.length && !poofs.length) { done(); return; }
      // 只藏"参与动画的格子"的真实棋子（幽灵替身接管），静止棋子全程可见
      const hide = new Set();
      for (const sl of slides) hide.add(sl.era + '-' + sl.from);
      for (const d of dies) hide.add(d.era + '-' + d.idx);
      for (const tv of travs) hide.add(tv.era + '-' + tv.idx);
      stageEl().classList.add('fxrun');
      $('#stagewrap').style.overflow = 'hidden';
      document.querySelectorAll('.era .cell').forEach(cel => {
        if (hide.has(cel.dataset.e + '-' + cel.dataset.i)) cel.classList.add('fxhide');
      });
      // 植物接管：树倒源格 & 拨除格把真实植物节点搬进幽灵层（演出期间棋盘不重影）
      const fallWraps = falls.map(f => grabPl(f.era, f.from));
      const poofWraps = poofs.map(p2 => grabPl(p2.era, p2.idx));
      const hit = dies.length || slides.length > 1;
      const slideDur = dies.length ? 175 : 200;
      const crushT = FALL_BASE + Math.max(0, falls.length - 1) * FALL_STAG + FALL_DUR - 20;  // 最远树着地前一刻
      for (const sl of slides) {                       // 推链整体滑步：幽灵到点后驻留，收尾统一清理
        const g = fxPieceGhost(sl.c, sl.era, sl.from);
        const to = cellPx(sl.era, sl.to);
        tweenPos(g.el, { x: g.r.x + (g.r.w - g.w) / 2, y: g.r.y + (g.r.h - g.h) / 2, }, { x: to.x + (to.w - g.w) / 2, y: to.y + (to.h - g.h) / 2 }, slideDur);
      }
      let boomT = slideDur;
      if (regDies.length && hit) {
        fxHold = Math.max(fxHold, regDies.length >= 2 ? 90 : 46);   // 顿帧：死亡瞬间冻结
        boomT = slideDur + (regDies.length >= 2 ? 130 : 74);
      } else if (hit) {
        fxHold = Math.max(fxHold, 30);                            // 纯推挤轻微顿帧
        shakeAdd(0.10);
      }
      for (const d of regDies) {
        tween({ t: boomT, dur: 5, upd(p) { if (p >= 1) blastAt(d.c, d.era, d.idx, d.why); } });
      }
      const tier = regDies.length >= 2 ? 0.5 : regDies.length === 1 ? 0.3 : 0;
      if (tier) tween({ t: boomT, dur: 5, upd(p) { if (p >= 1) shakeAdd(tier); } });
      for (const d of crushDies) {                      // 压垮：树着地瞬间爆破 + 顿帧
        tween({ t: crushT, dur: 5, upd(p) { if (p >= 1) { blastAt(d.c, d.era, d.idx, 'crush'); shakeAdd(0.2); fxHold = Math.max(fxHold, 26); } } });
      }
      for (let j = 0; j < falls.length; j++) {          // 树倒：逐棵错开滑步 + 落地躺倒（真实节点已搬入，滑 wrapper）
        const f = falls[j];
        const wrap = fallWraps[j].el;
        const src = cellPx(f.era, f.from), dst = cellPx(f.era, f.to);
        const dx = dst.x - src.x, dy = dst.y - src.y;
        tween({ t: FALL_BASE + (f.no | 0) * FALL_STAG, dur: FALL_DUR, ease: easeOutCubic, upd(p) {
          wrap.style.transform = 'translate3d(' + (dx * p).toFixed(2) + 'px,' + (dy * p).toFixed(2) + 'px,0)';
        } });
        tween({ t: FALL_BASE + (f.no | 0) * FALL_STAG + FALL_DUR, dur: 5, upd(p) { if (p >= 1) {
          wrap.innerHTML = '<span class="pl k-tree down landpop"></span>';
        } } });
      }
      for (const s of sows) {                           // 播种：种子落点弹现（格内若有己子则叠在其上）
        const w = fxPlWrap(s.era, s.idx);
        w.el.innerHTML = '<span class="pl k-seed growIn"></span>';
      }
      for (let k = 0; k < grows.length; k++) {          // 生长级联：灌木丛 → 大树，逐级向未来延后
        const g2 = grows[k];
        const w = fxPlWrap(g2.era, g2.idx);
        tween({ t: 130 + k * 130, dur: 5, upd(p) { if (p >= 1) w.el.innerHTML = '<span class="pl k-' + g2.pl + ' growIn"></span>'; } });
      }
      for (let k = 0; k < poofs.length; k++) {          // 拨除：自拨除格向未来逐级消散
        const w = poofWraps[k].el;
        tween({ t: k * 70, dur: 5, upd(p) { if (p >= 1 && w.firstChild) w.firstChild.className += ' poofOut'; } });
      }
      for (const tv of travs) {                         // 穿越：跨时空滑步，幽灵驻留到收尾
        const from = cellPx(tv.era, tv.idx), to = cellPx(tv.toEra, tv.idx);
        const g = fxPieceGhost(tv.c, tv.era, tv.idx);
        tweenPos(g.el,
          { x: from.x + (from.w - g.w) / 2, y: from.y + (from.h - g.h) / 2 },
          { x: to.x + (to.w - g.w) / 2, y: to.y + (to.h - g.h) / 2 }, 220,
          { ease: easeOutCubic });
        tween({ t: 210, dur: 5, upd(p) { if (p >= 1) ringAt(tv.toEra, tv.idx); } });
        tween({ t: 210, dur: 5, upd(p) { if (p >= 1) shakeAdd(0.12); } });
      }
      for (const cl of clones) {                        // 分身弹出
        tween({ t: 30, dur: 5, upd(p) { if (p >= 1) popIn(cl.c, cl.era, cl.idx); } });
        tween({ t: 260, dur: 5, upd(p) { if (p >= 1) floatLabel(fxCenter(cellPx(cl.era, cl.idx)), '分身', 'clone'); } });
        bumpSpare();
      }
      // 结束时刻 = 最晚可见 tween 完成 + 余量（fxRunUntil 另有 alive 门槛兜底帧漂移）。
      // 必须相对本局起点（fxClock 全程累计，跨行动/跨回合不归零）
      let fxEnd = slides.length ? slideDur : 0;
      if (falls.length) fxEnd = Math.max(fxEnd, FALL_BASE + (falls.length - 1) * FALL_STAG + FALL_DUR + 340);  // 躺倒动画收尾
      if (regDies.length) fxEnd = Math.max(fxEnd, boomT + 810);   // 撞墙/悖论爆炸 + 标签 ≈ boomT+800 收尾
      if (crushDies.length) fxEnd = Math.max(fxEnd, crushT + 810);
      if (sows.length) fxEnd = Math.max(fxEnd, 380);
      if (grows.length) fxEnd = Math.max(fxEnd, 260 + 380);
      if (poofs.length) fxEnd = Math.max(fxEnd, (poofs.length - 1) * 70 + 460);
      if (travs.length) fxEnd = Math.max(fxEnd, 665);          // 穿越滑步 + 时空环扩散/移除 ≈ 665
      if (clones.length) fxEnd = Math.max(fxEnd, 1065);        // “分身”标签飘字移除 ≈ 1065
      fxRunUntil(fxClock + fxEnd + 50).then(() => {
        fxEl().innerHTML = '';                          // 驻留幽灵在此移除（随后 renderAll 画真实棋子）
        stageEl().classList.remove('fxrun');
        document.querySelectorAll('.cell.fxhide').forEach(el => el.classList.remove('fxhide'));
        $('#stagewrap').style.overflow = '';
        done();
      });
    });
  }
  function bumpSpare() {
    const el = $('#topbar .spare-cnt');
    if (el) { el.classList.remove('sparepop'); void el.offsetWidth; el.classList.add('sparepop'); }
  }

  /* 顿帧主循环：fxClock 在 hold 期间不走动 */
  function fxRunUntil(end) {
    return new Promise(res => {
      const step = now => {
        if (!fxRunning) { fxRunning = true; fxLast = now; requestAnimationFrame(loop); }
        function loop(now) {
          let dt = now - fxLast; fxLast = now;
          if (dt > 50) dt = 50;
          if (fxHold > 0) fxHold -= dt; else fxClock += dt;
          let alive = false;
          for (const tw of fxTweens) {
            if (tw.done) continue;
            const p = Math.min(1, (fxClock - tw.t0) / tw.dur);
            if (p < 0) { alive = true; continue; }
            tw.upd(tw.ease ? tw.ease(p) : p);
            if (p >= 1) tw.done = true; else alive = true;
          }
          if (fxClock < end || alive || fxHold > 0) requestAnimationFrame(loop);
          else { fxRunning = false; res(); }
        }
      };
      step(performance.now());
    });
  }

  /* ---------------- 渲染 ---------------- */
  const noBadge = i => String(i + 1);
  /* 一屏缩放：以 --cell=96 试量，按溢出比例反推最大可用格宽 */
  const fitMQ = window.matchMedia('(max-width: 899px)');
  let fitQueued = false;
  function scheduleFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fitBoards(); });
  }
  let stripKey = null, fitLast = null;
  function fitBoards() {
    const st = stageEl(), wrap = $('#stagewrap'), boards = $('#boards');
    if (!st || !wrap || !boards || !S || !$('#screen-game').classList.contains('on')) return;
    const MEAS = 96, MINC = 26, MAXC = 96;
    const row = getComputedStyle(boards).flexDirection === 'row';
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (fitLast && fitLast.row === row && fitLast.cw === cw && fitLast.ch === ch) {
      wrap.style.overflowY = fitLast.fits ? 'hidden' : 'auto';   // 视口未变：只回放滚动决策
      return;
    }
    const dH = row ? 4 : 12, dW = row ? 12 : 4;   // --cell +1px 使内容 高/宽 各 +dH/+dW
    st.style.setProperty('--cell', MEAS + 'px');
    const fixedH = wrap.scrollHeight - dH * MEAS;
    const fixedW = wrap.scrollWidth - dW * MEAS;
    const era = document.querySelector('.era');
    const eraW = era ? era.getBoundingClientRect().width : 0;
    const eraCap = eraW ? Math.floor((eraW - 8) / 4) : MAXC;
    let cell = Math.max(MINC, Math.min(MAXC, eraCap,
      Math.floor((wrap.clientHeight - fixedH - 1) / dH),
      Math.floor((wrap.clientWidth - fixedW - 1) / dW)));
    st.style.setProperty('--cell', cell + 'px');
    for (let i = 0; i < 2; i++) {                 // 线性近似后的二次校正
      if (wrap.scrollHeight > wrap.clientHeight + 1 && cell > MINC) {
        cell = Math.max(MINC, cell - Math.ceil((wrap.scrollHeight - wrap.clientHeight) / dH));
        st.style.setProperty('--cell', cell + 'px');
      }
      if (wrap.scrollWidth > wrap.clientWidth + 1 && cell > MINC) {
        cell = Math.max(MINC, cell - Math.ceil((wrap.scrollWidth - wrap.clientWidth) / dW));
        st.style.setProperty('--cell', cell + 'px');
      }
    }
    const fits = wrap.scrollHeight <= wrap.clientHeight + 1 && wrap.scrollWidth <= wrap.clientWidth + 1;
    wrap.style.overflowY = fits ? 'hidden' : 'auto';
    fitLast = { row, cw, ch, fits };
  }
  function eraFocusDots(e) {
    const d = [];
    for (let c = 0; c < 2; c++) if (S.focus[c] === e) d.push('<i class="c' + c + '"></i>');
    return d.join('');
  }
  /* 行动模式：当前选中子在各类别下的可用行动数；当前模式枯竭时自动切到首个非空类别 */
  const CAT_TAGS = { move: '移动·穿越', sow: '播种', pluck: '拨除' };
  let actAvail = { move: 0, sow: 0, pluck: 0 };
  function syncActMode() {
    if (!growthOn() || S.stage !== 'act' || !S.sel) { actMode = 'move'; actAvail = { move: 0, sow: 0, pluck: 0 }; return; }
    const cnt = { move: 0, sow: 0, pluck: 0 };
    for (const a of G.legalActions(S, S.sel.era, S.sel.i)) cnt[actCat(a)]++;
    actAvail = cnt;
    if (cnt[actMode] === 0) {
      for (const k of ['move', 'sow', 'pluck']) if (cnt[k] > 0) { actMode = k; break; }
    }
  }
  function applyModUI() {
    const el = $('#rulesMod');
    if (el) el.classList.toggle('hidden', !growthOn());
  }
  function renderAll() {
    if (!S) return;
    syncActMode();
    applyModUI();
    renderTurn();
    renderNote();
    renderBoards();
    renderPanel();
    renderOverlay();
    scheduleFit();
  }
  function renderTurn() {
    const k = S.turnNo + ':' + S.turn + ':' + (S.over ? 1 : 0);
    if (stripKey === k) return;                       // 无真实回合变化：跳过重写与弹动
    stripKey = k;
    const strip = $('#turnstrip');
    const who = PLAY[S.turn] + (mode === 'ai' ? (isAiTurn() ? '（AI）' : '（你）') : '');
    strip.innerHTML =
      '<div class="who c' + S.turn + '"><span class="dot"></span>' + who + '</div>' +
      '<div class="meta"><b>回合 ' + S.turnNo + '</b>焦点 · ' + ERA_NAMES[S.focus[S.turn]] +
      (S.over ? '' : '') + '</div>';
    strip.classList.remove('strippop'); void strip.offsetWidth; strip.classList.add('strippop');
  }
  function renderNote() {
    const last = S.log.length ? S.log[S.log.length - 1] : null;
    const t = last ? last.text : '';
    const el = $('#notebar .nb-t');
    el.textContent = t.length > 60 ? t.slice(0, 60) + '…' : t;
  }
  function openLog() {
    const list = $('#logList');
    list.textContent = '';
    const log = S ? S.log : [];
    if (!log.length) {
      const d = document.createElement('div');
      d.className = 'log-empty';
      d.textContent = '还没有任何对局记录';
      list.appendChild(d);
    } else {
      for (let k = log.length - 1; k >= 0; k--) {   // 倒序：最新在上
        const en = log[k];
        const row = document.createElement('div');
        row.className = 'log-item';
        const no = document.createElement('span'); no.className = 'log-no'; no.textContent = 'R' + en.no;
        const who = document.createElement('span'); who.className = 'log-p p' + en.p; who.textContent = PLAY[en.p];
        const tx = document.createElement('span'); tx.className = 'log-t'; tx.textContent = en.text;
        row.appendChild(no); row.appendChild(who); row.appendChild(tx);
        list.appendChild(row);
      }
    }
    $('#logMask').classList.remove('hidden');
  }
  function renderBoards() {
    const box = $('#boards');
    const selKey = S.sel ? S.sel.era + '-' + S.sel.i : null;
    const selActs = (S.stage === 'act' && S.sel) ? G.legalActions(S, S.sel.era, S.sel.i) : [];
    const mvMap = {}, tvMap = {}, owMap = {};
    for (const a of selActs) {
      if (growthOn() && actCat(a) !== actMode) continue;   // 非生长模组 actMode 恒 move：不产生过滤
      if (a.t === 'move') mvMap[S.sel.era + '-' + a.to] = a.d;
      else if (a.t === 'travel') tvMap[a.e2 + '-' + S.sel.i] = { d: a.e2 < S.sel.era };
      else owMap[S.sel.era + '-' + a.to] = a.t;            // sow/pluck：点目标格即行动
    }
    const picks = new Set();
    if (S.stage === 'select') for (const p of G.selectablePieces(S)) picks.add(p.era + '-' + p.i);
    const myEra = S.focus[S.turn];
    let html = '';
    for (let e = 0; e < 3; e++) {
      const isFocus = e === myEra && !S.over;
      const isOpt = S.stage === 'focus' && e !== myEra;
      html += '<section class="era' + (isFocus ? ' is-myfocus' : '') + (isOpt ? ' is-opt' : '') + '" data-e="' + e + '">';
      html += '<div class="era-head"><div class="era-chip">' + ERA_NAMES[e] + '<span class="en"></span></div>';
      html += '<div class="fmark"><span class="lab">焦点</span>' + eraFocusDots(e) + '</div></div>';
      html += '<div class="board">';
      for (let i = 0; i < 16; i++) {
        const p = S.boards[e].cell[i];
        const key = e + '-' + i;
        let cls = 'cell';
        if (picks.has(key)) cls += ' pick';
        if (key === selKey) cls += ' sel';
        const mv = mvMap[key];
        if (mv) {
          cls += p ? ' hint-push' : ' hint-move';
          html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' +
            '<span class="arrow"><span>' + DIR_GLYPH[mv] + '</span></span>' +
            (p ? pieceHtml(p.c, i) : '') + plantHtml(e, i) + '</div>';
          continue;
        }
        const tv = tvMap[key];
        if (tv) {
          cls += ' hint-trv' + (tv.d ? ' clone' : '');
          html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' + (p ? pieceHtml(p.c, i) : '') + plantHtml(e, i) + '</div>';
          continue;
        }
        const ow = owMap[key];
        if (ow) {
          cls += ow === 'sow' ? ' hint-sow' : ' hint-pluck';
          html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' +
            (p ? pieceHtml(p.c, i) : '') + plantHtml(e, i) + '</div>';
          continue;
        }
        html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' + (p ? pieceHtml(p.c, i) : '') + plantHtml(e, i) + '</div>';
      }
      html += '</div></section>';
    }
    box.innerHTML = html;
    rebuildSpare();
  }
  function pieceHtml(c, i) { return '<div class="piece c' + c + '" data-p="' + c + '-' + i + '"></div>'; }
  /* 格内植物/种子节点（种子可叠在棋子/倒树上，故画在棋子之后；非生长模组恒为空串） */
  function plantHtml(e, i) {
    if (!growthOn()) return '';
    const b = S.boards[e];
    if (!b || !b.pl || !b.sd) return '';
    const pl = b.pl[i], sd = b.sd[i];
    let s = '';
    if (pl) s += '<span class="pl k-' + pl.k + (pl.k === 'tree' && pl.down ? ' down' : '') + '"></span>';
    if (sd) s += '<span class="pl k-seed"></span>';
    return s;
  }
  /* 种子托盘：5 点槽（顶栏角标 + 窄屏悬浮窗一行），非生长模组不创建 */
  const seedDots = n => { let s = ''; for (let k = 0; k < 5; k++) s += '<i' + (k < n ? ' class="on"' : '') + '></i>'; return s; };
  function seedTray(n) {
    if (!growthOn()) {
      const chip = $('#seedCnt'); if (chip) chip.remove();
      const fr = $('#seedFloat'); if (fr) fr.remove();
      return;
    }
    let el = $('#seedCnt');
    if (!el) {
      el = document.createElement('div');
      el.id = 'seedCnt';
      el.className = 'seed-cnt';
      $('#topbar').appendChild(el);
    }
    el.innerHTML = '<span class="lab">种子</span>' + seedDots(n);
    let fr = $('#seedFloat');
    if (!fr) {
      fr = document.createElement('div');
      fr.id = 'seedFloat';
      fr.className = 'fl-seed';
      fr.innerHTML = '<span class="st">种子</span><span class="dots"></span>';
      $('#spareFloat').appendChild(fr);
    }
    fr.querySelector('.dots').innerHTML = seedDots(n);
  }
  function bumpSeeds() {
    const el = $('#seedCnt');
    if (el) { el.classList.remove('seedpop'); void el.offsetWidth; el.classList.add('seedpop'); }
  }
  function rebuildSpare() {
    const html = '分身 <b class="s0">黑×' + S.spares[0] + '</b> <b class="s1">白×' + S.spares[1] + '</b>';
    let el = $('#topbar .spare-cnt');
    if (!el) {
      el = document.createElement('div');
      el.className = 'spare-cnt';
      $('#topbar').appendChild(el);
    }
    el.innerHTML = html;
    // 窄屏顶栏无空位：同一份余量画进右侧悬浮窗（pointer-events:none，不挡棋盘点选）；竖排 3 行
    let fl = $('#spareFloat');
    if (!fl) {
      fl = document.createElement('div');
      fl.id = 'spareFloat';
      fl.className = 'spare-float';
      $('#screen-game').appendChild(fl);
    }
    fl.innerHTML = '<span class="fl-t">分身</span><b class="s0">黑×' + S.spares[0] + '</b><b class="s1">白×' + S.spares[1] + '</b>';
    seedTray(S.seeds);                                   // 必须在 fl.innerHTML 之后（重建会被清掉）
  }
  function renderPanel() {
    const pan = $('#panel');
    let html = '';
    const aiTurn = isAiTurn();
    if (S.stage === 'select') {
      html += '<div class="phint">' + (aiTurn ? PLAY[S.turn] + '（AI）思考中…' : '轮到' + PLAY[S.turn] + '，在焦点时空（' + ERA_NAMES[S.focus[S.turn]] + '）选一枚可行动的棋子') + '</div>';
    } else if (S.stage === 'act') {
      const left = 2 - S.acted;
      if (G.canEnd(S)) {
        html += '<button class="btn-end" id="btnEnd">✓ 结束行动</button>';
        html += '<div class="hint-inline">该子已无路可走，结束本轮行动</div>';
      } else {
        if (growthOn()) {
          html += '<div class="actmode-row">';
          for (const k of ['move', 'sow', 'pluck']) {
            const dis = actAvail[k] === 0;
            html += '<button class="am-btn' + (actMode === k ? ' on' : '') + (dis ? ' dis' : '') + '" data-cat="' + k + '"' +
              (dis ? ' disabled' : '') + '>' + CAT_TAGS[k] + '</button>';
          }
          html += '</div>';
        }
        const sub = !growthOn()
          ? '穿越：点相邻时空没有子的同号格；移动：向上/下/左/右移动，若有子则推挤'
          : actMode === 'sow'
            ? '播种：种子播在己子所在格或相邻格（已有种子/植物/对方棋子的格不可播）'
            : actMode === 'pluck'
              ? '拨除：回收任意 1 粒种子（可拨对方的），其朝未来的灌木丛/大树随之消逝'
              : '穿越：点相邻时空没有子的同号格移动：向上/下/左/右移动，若有子则推挤';
        const main = growthOn()
          ? (actMode === 'sow' ? '选择播种格（第 ' + (S.acted + 1) + ' 次行动）'
            : actMode === 'pluck' ? '选择要拨除的种子（第 ' + (S.acted + 1) + ' 次行动）'
              : S.acted === 0 ? '选择移动方向或穿越目标（第 1 次行动）'
                : '同一棋子继续第 ' + (S.acted + 1) + ' 次行动，剩余 ' + left + ' 次')
          : (S.acted === 0 ? '选择移动方向或穿越目标（第 1 次行动）' : '同一棋子继续第 ' + (S.acted + 1) + ' 次行动，剩余 ' + left + ' 次');
        html += '<div class="phint">' + main +
          (growthOn() && actMode === 'sow'
            ? '<small>种子沿时间线生长：下一时空同号格长出灌木丛，再下一时空长出大树</small>'
            : '<small>' + sub + '</small>') + '</div>';
      }
    } else if (S.stage === 'focus') {
      const cur = S.focus[S.turn];
      html += '<div class="phint">' + (isAiTurn() ? PLAY[S.turn] + '（AI）选择下一时空…' : '把焦点移到：') +
          // '<small>移动后换对方回合并在回合末判定胜负</small>'+
        '</div>';
      html += '<div class="focus-row">';
      for (let e = 0; e < 3; e++) {
        html += e === cur
          ? '<button class="fbtn cur" data-e="' + e + '" disabled><span class="swatch"></span>' + ERA_NAMES[e] + '</button>'
          : '<button class="fbtn" data-e="' + e + '"><span class="swatch"></span>' + ERA_NAMES[e] + '</button>';
      }
      html += '</div>';
    } else if (!S.over) {
      html += '<div class="phint">…</div>';
    }
    pan.innerHTML = html;
  }
  function renderOverlay() {
    const ov = $('#overlay-win');
    if (!S.over) { ov.classList.add('hidden'); ov.innerHTML = ''; return; }
    ov.classList.remove('hidden');
    let title, sub;
    if (S.over.draw) {
      title = '平局！';
      sub = '黑白双方在 ≥2 个时空都已没有棋子<br>——两条时间线，同归于尽。';
    } else {
      const win = S.over.winner;
      title = PLAY[win] + ' 获胜！';
      sub = PLAY[1 - win] + ' 在 ≥2 个时空已没有棋子<br>——现在的你，杀死了过去的我。';
    }
    ov.innerHTML =
      '<div class="win-card"><div class="w-title">' + title + '</div>' +
      '<div class="w-sub">' + sub + '</div>' +
      '<button class="btn-main primary" id="btnAgain">再来一局</button>' +
      '<button class="btn-main" id="btnHome">返回菜单</button></div>';
  }

  /* ---------------- 操作与流程 ---------------- */
  async function doOp(op) {
    if (busy) return;
    busy = true; live = true;
    try {
      if (op.op === 'select') {
        const r = G.selectPiece(S, op.era, op.i);
        if (r) { actMode = 'move'; renderAll(); }
      } else if (op.op === 'act') {
        const r = G.applyAction(S, op.act);
        if (!r.ok) { busy = false; drainPending(); return; }   // 过期缓冲点选：引擎自校验拦下，静默丢弃
        actMode = 'move';                        // 行动后回默认模式（renderAll 的 sync 会按需再切）
        saveGame();                              // 演出耗时：先落盘，中途关页不丢步
        await playEvs(r.evs);
        renderAll();
        if (seedDelta(r.evs)) bumpSeeds();
      } else if (op.op === 'end') {
        G.endActions(S); renderAll();
      } else if (op.op === 'pass') {
        G.doPass(S); saveGame(); renderAll(); await sleep(150);
      } else if (op.op === 'focus') {
        G.moveFocus(S, op.e);
        saveGame();                              // 换手/终局节点落盘
        await sleep(120);
        renderAll();
      }
    } catch (e) { console.error(e); }
    busy = false;
    saveGame();                                  // 兜底：任何成功操作都以最新局面落盘
    afterChange();
    drainPending();
  }
  function playWin() {
    shakeAdd(0.35);
    const card = $('#overlay-win .win-card');
    if (card) { card.classList.remove('winPop'); void card.offsetWidth; card.classList.add('winPop'); }
  }
  function afterChange() {
    if (!live) return;
    if (S.over) {                                // 行动结束/移焦点均可当场终局 → 结算演出统一在此收口
      if (winFired !== S.over) { winFired = S.over; playWin(); }
      return;
    }
    winFired = null;
    if (S.stage === 'select') {
      if (G.needPass(S)) {
        if (isAiTurn()) return;                                  // AI 由 aiRun 处理
        sleep(650).then(() => { if (live && !busy && S.stage === 'select' && G.needPass(S)) doOp({ op: 'pass' }); });
        return;
      }
      if (isAiTurn()) aiRun();
    } else if (S.stage === 'focus' && isAiTurn()) {
      aiRun();                                               // 换手后 AI 需空过移焦点
    }
  }
  async function aiRun() {
    if (S.over) return;
    aiStop = false; aiRunning = true;
    const ops = G.aiPlan(S);
    await sleep(560);
    if (aiStop || S.over) { aiRunning = false; return; }
    for (const op of ops) {
      if (aiStop || S.over) break;
      if (busy) { await sleep(80); }
      busy = true;
      try {
        if (op.op === 'select') {
          if (G.selectPiece(S, op.era, op.i)) { actMode = 'move'; renderAll(); saveGame(); }
          await sleep(150);
        } else if (op.op === 'act') {
          const r = G.applyAction(S, op.act);
          if (r.ok) { actMode = 'move'; saveGame(); await playEvs(r.evs); renderAll(); if (seedDelta(r.evs)) bumpSeeds(); }
        } else if (op.op === 'end') { G.endActions(S); renderAll(); }
        else if (op.op === 'pass') { G.doPass(S); saveGame(); renderAll(); await sleep(140); }
        else if (op.op === 'focus') { G.moveFocus(S, op.e); saveGame(); await sleep(90); renderAll(); }
      } catch (e) { console.error('AI', e); }
      busy = false;
      saveGame();                                // AI 每步落盘（含 select/end 等无异步缝隙操作）
      await sleep(540);                          // 每条 op 后留观察时间（第 1 行动后多看 300ms）
    }
    aiRunning = false;
    saveGame();
    afterChange();
    drainPending();
  }

  /* ---------------- 点击路由（busy 期间收下缓冲，演出结束重放） ---------------- */
  function bindBoards() {
    $('#boards').addEventListener('click', e => {
      if (!S || S.over) return;
      if (isAiTurn()) return;                                  // AI 回合：人类点击一律忽略
      const cell = e.target.closest('.cell');
      if (!cell) return;
      if (busy) { pend = { cell: { e: +cell.dataset.e, i: +cell.dataset.i } }; pendKey = turnKey(); return; }
      handleCellNow(cell);
    });
    $('#panel').addEventListener('click', e => {
      if (!S || S.over) return;
      if (isAiTurn()) return;
      const end = e.target.closest('#btnEnd');
      if (end) { if (busy) { pend = { op: { op: 'end' } }; pendKey = turnKey(); } else doOp({ op: 'end' }); return; }
      const fb = e.target.closest('.fbtn');
      if (fb) { if (busy) { pend = { op: { op: 'focus', e: +fb.dataset.e } }; pendKey = turnKey(); } else doOp({ op: 'focus', e: +fb.dataset.e }); return; }
      const am = e.target.closest('.am-btn');
      if (am) { if (!busy && !am.disabled) { actMode = am.dataset.cat; renderAll(); } }
    });
  }
  /* 重放收下的点击：棋盘格按"当前"DOM 状态重新解释；面板操作交引擎自校验 */
  function drainPending() {
    if (!pend) return;
    if (!S || S.over || busy || aiRunning || pendKey !== turnKey()) { pend = null; pendKey = ''; return; }
    const p = pend; pend = null; pendKey = '';
    if (p.cell) {
      const el = document.querySelector('.cell[data-e="' + p.cell.e + '"][data-i="' + p.cell.i + '"]');
      if (el) handleCellNow(el);
    } else if (p.op) {
      doOp(p.op);
    }
  }
  function handleCellNow(cell) {
    const era = +cell.dataset.e, i = +cell.dataset.i;
    if (S.stage === 'select') {
      if (cell.classList.contains('pick')) doOp({ op: 'select', era, i });
      else warn();
    } else if (S.stage === 'act' && S.sel) {
      if (cell.classList.contains('hint-trv')) doOp({ op: 'act', act: { t: 'travel', e2: era } });
      else if (cell.classList.contains('hint-move') || cell.classList.contains('hint-push')) {
        const d = i - S.sel.i === 4 ? 'down' : i - S.sel.i === -4 ? 'up' : i - S.sel.i === 1 ? 'right' : 'left';
        doOp({ op: 'act', act: { t: 'move', d, to: i } });
      } else if (cell.classList.contains('hint-sow')) doOp({ op: 'act', act: { t: 'sow', to: i } });
      else if (cell.classList.contains('hint-pluck')) doOp({ op: 'act', act: { t: 'pluck', to: i } });
    }
  }
  function warn() {
    const nb = $('#notebar');
    nb.classList.remove('warn'); void nb.offsetWidth; nb.classList.add('warn');
  }

  /* ---------------- 断点续玩（localStorage 自动存档） ----------------
     key 沿用仓库惯例 <项目名>-state；存 {v, mode, aiSide, S}，S 即引擎局面（含对局记录）。
     每次引擎变更后立即落盘：演出较长的操作先存后演，中途关页也不丢步。 */
  const SAVE_KEY = 'that_time_you_killed_me-state';
  const SAVE_V = 2;
  const saveGame = () => {
    if (!S || mode === 'menu') return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_V, mode, aiSide, S })); }
    catch (e) { /* 隐私模式/配额：存档失败不打断对局 */ }
  };
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function readSave() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { clearSave(); return null; }
    const st = d && d.S;
    const bad = () => { clearSave(); return null; };
    if (!d || (d.v !== 1 && d.v !== SAVE_V) || (d.mode !== 'ai' && d.mode !== 'local2p') ||
        !st || typeof st !== 'object' ||
        !Array.isArray(st.boards) || st.boards.length !== 3 ||
        !st.boards.every(b => b && Array.isArray(b.cell) && b.cell.length === 16) ||
        (st.turn !== 0 && st.turn !== 1) || typeof st.turnNo !== 'number' || st.turnNo < 1 ||
        !['select', 'act', 'focus', 'over'].includes(st.stage) ||
        !Array.isArray(st.focus) || st.focus.length !== 2 ||
        !Array.isArray(st.spares) || st.spares.length !== 2 ||
        !Array.isArray(st.dead) || st.dead.length !== 2) return bad();
    if (st.stage === 'over' && !(st.over && (st.over.winner === 0 || st.over.winner === 1 || st.over.draw === true))) return bad();
    if (!Array.isArray(st.log)) st.log = [];
    const mods = Array.isArray(st.mods)
      ? st.mods.filter(id => typeof id === 'string' && G.MODULES.some(m => m.id === id))
      : [];                                         // v1 旧档无 mods → 迁移为经典规则
    st.mods = mods;
    if (mods.indexOf('growth') >= 0) {              // v2 生长档：校验植物/种子层
      for (const b of st.boards) {
        if (!Array.isArray(b.pl) || b.pl.length !== 16 ||
            !Array.isArray(b.sd) || b.sd.length !== 16) return bad();
        for (const p of b.pl) {
          if (!p) continue;
          if (p.k !== 'bush' && p.k !== 'tree') return bad();
          if (p.k === 'tree' && p.down !== 0 && p.down !== 1) return bad();
        }
        for (const v of b.sd) if (v !== 0 && v !== 1) return bad();
      }
    }
    G.hydrateMods(st);                            // 池/种子守恒重算 + 各模组数据层补齐
    st.mode = d.mode;
    const aiS = (d.aiSide === 0 || d.aiSide === 1) ? d.aiSide : 1;  // 旧档无 aiSide：按 1（AI 白方）兼容
    return { mode: d.mode, aiSide: aiS, S: st };
  }
  function tryRestore() {
    const d = readSave();
    if (!d) return;
    mode = d.mode;
    aiSide = d.aiSide;
    activeMods = (d.S.mods || []).slice();
    actMode = 'move';
    live = false; clearTimers(); aiStop = true; aiRunning = false; busy = false;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
    S = d.S;
    resetFxDom();
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    renderAll();
    if (S.over) return;                                   // 终局：停在结算画面即可
    live = true;
    if (isAiTurn() && (S.stage === 'act' || (S.stage === 'select' && G.needPass(S)))) aiRun();
    else afterChange();                                   // select/focus：空过与选子由 afterChange 触发
  }

  /* ---------------- 屏幕/菜单 ---------------- */
  function requestStart(m) {                       // 菜单按钮：有可勾选模组先弹窗，无则直接开局
    if (!G.MODULES.length) { startGame(m, []); return; }
    const box = $('#modList');
    box.textContent = '';
    for (const mod of G.MODULES) {
      const lab = document.createElement('label');
      lab.className = 'mod-item';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.value = mod.id;
      lab.appendChild(chk);
      const body = document.createElement('span');
      body.className = 'mod-body';
      const name = document.createElement('span');
      name.className = 'mod-name';
      const sq = document.createElement('i');
      sq.className = 'sprout';
      name.appendChild(sq);
      name.appendChild(document.createTextNode(mod.name));
      const desc = document.createElement('span');
      desc.className = 'mod-desc';
      desc.textContent = mod.desc;
      body.appendChild(name); body.appendChild(desc);
      lab.appendChild(body);
      box.appendChild(lab);
    }
    $('#modMask').dataset.pick = m;
    $('#modMask').classList.remove('hidden');
  }
  function startGame(m, mods) {
    mode = m;
    activeMods = mods ? mods.slice() : [];
    actMode = 'move';
    clearTimers(); aiStop = true; aiRunning = false; busy = false; live = true;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
    if (mode === 'ai') aiSide = Math.random() < 0.5 ? 1 : 0;  // 随机分色；先后手由 newGame 随机
    else aiSide = 1;
    S = G.newGame(mode, Math.random, activeMods);
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    renderAll();
    afterChange();
    saveGame();                                  // 开局即入档：中途关页回来仍是这盘
  }
  function start(m) {                            // 重开/再来一局：沿用本局已启用模组
    startGame(m, activeMods);
  }
  function goMenu() {
    live = false; clearTimers(); aiStop = true; aiRunning = false; busy = false;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
    activeMods = []; actMode = 'move';
    S = null;
    $('#screen-game').classList.remove('on');
    $('#screen-menu').classList.remove('hidden');
    $('#overlay-win').classList.add('hidden');
    $('#logMask').classList.add('hidden');
    resetFxDom();
    clearSave();                                 // 回菜单 = 放弃本局，下次进封面
  }
  function resetFxDom() {
    fxEl().innerHTML = '';
    fxTweens.length = 0; fxClock = 0; fxHold = 0; fxRunning = false;
    trauma = 0; stageEl().style.transform = '';
  }
  function bindShell() {
    $('#btnAI').addEventListener('click', () => requestStart('ai'));
    $('#btn2P').addEventListener('click', () => requestStart('local2p'));
    $('#btnMenu').addEventListener('click', goMenu);
    $('#btnRestart').addEventListener('click', () => start(mode));
    $('#btnRules').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnRulesGame').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnCloseRules').addEventListener('click', () => $('#rulesMask').classList.add('hidden'));
    $('#rulesMask').addEventListener('click', e => { if (e.target.id === 'rulesMask') $('#rulesMask').classList.add('hidden'); });
    $('#btnModStart').addEventListener('click', () => {
      const ids = [...$('#modList').querySelectorAll('input:checked')].map(i => i.value);
      const m = $('#modMask').dataset.pick || 'local2p';
      $('#modMask').classList.add('hidden');
      startGame(m, ids);
    });
    $('#btnModCancel').addEventListener('click', () => $('#modMask').classList.add('hidden'));
    $('#modMask').addEventListener('click', e => { if (e.target.id === 'modMask') $('#modMask').classList.add('hidden'); });
    $('#notebar').addEventListener('click', openLog);
    $('#btnCloseLog').addEventListener('click', () => $('#logMask').classList.add('hidden'));
    $('#logMask').addEventListener('click', e => { if (e.target.id === 'logMask') $('#logMask').classList.add('hidden'); });
    $('#overlay-win').addEventListener('click', e => {
      if (e.target.closest('#btnAgain')) start(mode);
      else if (e.target.closest('#btnHome')) goMenu();
    });
    bindBoards();
  }

  /* ---------------- 测试/调试钩子 ---------------- */
  const UI = {
    G, start, startGame, requestStart, goMenu, saveKey: SAVE_KEY,
    save: saveGame, clear: clearSave, restore: tryRestore,
    mods: () => activeMods.slice(),
    state: () => S,
    mode: () => mode,
    busy: () => busy,
    setState(obj, opts) {          // 注入局面（截图走查用）
      live = false; clearTimers(); aiStop = true; aiRunning = false; busy = false;
      pend = null; pendKey = ''; stripKey = null; fitLast = null;
      S = obj;
      resetFxDom();
      $('#screen-menu').classList.add('hidden');
      $('#screen-game').classList.add('on');
      renderAll();
      if (opts && opts.live) { live = true; afterChange(); }
      return S;
    },
    doOp,                            // 带演出的单步操作（await 至演出结束）
    fire: op => { doOp(op); },       // 不等待演出结束（截图取中途帧）
    noFx: async op => { live = true; busy = true; try { execOpNow(op); } finally { busy = false; } renderAll(); },
    renderAll,
  };
  function execOpNow(op) {
    if (op.op === 'select') G.selectPiece(S, op.era, op.i);
    else if (op.op === 'act') G.applyAction(S, op.act);
    else if (op.op === 'end') G.endActions(S);
    else if (op.op === 'pass') G.doPass(S);
    else if (op.op === 'focus') G.moveFocus(S, op.e);
  }
  window.TTYKM_UI = UI;

  window.addEventListener('resize', scheduleFit);
  if (fitMQ.addEventListener) fitMQ.addEventListener('change', scheduleFit);
  document.addEventListener('DOMContentLoaded', () => {
    bindShell();
    renderAll();
    tryRestore();                                  // 有存档：自动载入上次对局（AI 回合中断则续跑）
  });
})();
