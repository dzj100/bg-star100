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
  function blastAt(c, era, i, why) {
    const g = fxPieceGhost(c, era, i);
    const d = 520;
    const c0 = { x: 0, y: 0, s: 1, r: 0 }, c1 = { x: 0, y: -rndSign(8), s: 2.4, r: rndSign(26) };
    tween({ t: 0, dur: d, ease: easeInQuad, upd(p) {
      const s = c0.s + (c1.s - c0.s) * p, r = c0.r + (c1.r - c0.r) * p;
      g.el.style.transform = 'translate3d(' + c0.x + 'px,' + (c0.y + (c1.y - c0.y) * p) + 'px,0) rotate(' + r + 'deg) scale(' + s + ')';
      g.el.style.opacity = String(Math.max(0, 1 - p * 1.15));
    } });
    tween({ t: 0, dur: d + 120, upd(p) { if (p >= 1) g.el.remove(); } });
    const lbl = floatLabel(fxCenter(g.r), why === 'paradox' ? '悖论！' : '撞墙！', why === 'paradox' ? 'paradox' : 'wall');
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

  /* 一次推链/穿越演出的编排 */
  function playEvs(evs) {
    return new Promise(done => {
      const slides = [], dies = [], travs = [], clones = [];
      for (const e of evs) {
        if (e.k === 'move' || e.k === 'step') slides.push(e);
        else if (e.k === 'die') dies.push(e);
        else if (e.k === 'travel') travs.push(e);
        else if (e.k === 'clone') clones.push(e);
      }
      if (!slides.length && !dies.length && !travs.length && !clones.length) { done(); return; }
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
      const hit = dies.length || slides.length > 1;
      const slideDur = dies.length ? 175 : 200;
      for (const sl of slides) {                       // 推链整体滑步：幽灵到点后驻留，收尾统一清理
        const g = fxPieceGhost(sl.c, sl.era, sl.from);
        const to = cellPx(sl.era, sl.to);
        tweenPos(g.el, { x: g.r.x + (g.r.w - g.w) / 2, y: g.r.y + (g.r.h - g.h) / 2, }, { x: to.x + (to.w - g.w) / 2, y: to.y + (to.h - g.h) / 2 }, slideDur);
      }
      let boomT = slideDur;
      if (dies.length && hit) {
        fxHold = Math.max(fxHold, dies.length >= 2 ? 90 : 46);   // 顿帧：死亡瞬间冻结
        boomT = slideDur + (dies.length >= 2 ? 130 : 74);
      } else if (hit) {
        fxHold = Math.max(fxHold, 30);                            // 纯推挤轻微顿帧
        shakeAdd(0.10);
      }
      for (const d of dies) {
        tween({ t: boomT, dur: 5, upd(p) { if (p >= 1) blastAt(d.c, d.era, d.idx, d.why); } });
      }
      const tier = dies.length >= 2 ? 0.5 : dies.length === 1 ? 0.3 : 0;
      if (tier) tween({ t: boomT, dur: 5, upd(p) { if (p >= 1) shakeAdd(tier); } });
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
      // 结束时刻 = 最晚可见 tween 完成 + 余量（fxRunUntil 另有 alive 门槛兜底帧漂移）
      let fxEnd = slides.length ? slideDur : 0;
      if (dies.length) fxEnd = Math.max(fxEnd, boomT + 810);   // 撞墙/悖论爆炸 + 标签 ≈ boomT+800 收尾
      if (travs.length) fxEnd = Math.max(fxEnd, 665);          // 穿越滑步 + 时空环扩散/移除 ≈ 665
      if (clones.length) fxEnd = Math.max(fxEnd, 1065);        // “分身”标签飘字移除 ≈ 1065
      fxRunUntil(fxEnd + 50).then(() => {
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
  function renderAll() {
    if (!S) return;
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
    const who = PLAY[S.turn] + (mode === 'ai' && S.turn === 1 ? '（AI）' : '');
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
    const mvMap = {}, tvMap = {};
    for (const a of selActs) {
      // 移动行动不携带 era（隐含为所选子所在时空）；穿越仅同编号格可入
      if (a.t === 'move') mvMap[S.sel.era + '-' + a.to] = a.d;
      else tvMap[a.e2 + '-' + S.sel.i] = { d: a.e2 < S.sel.era };
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
            (p ? pieceHtml(p.c, i) : '') + '</div>';
          continue;
        }
        const tv = tvMap[key];
        if (tv) {
          cls += ' hint-trv' + (tv.d ? ' clone' : '');
          html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' + (p ? pieceHtml(p.c, i) : '') + '</div>';
          continue;
        }
        html += '<div class="' + cls + '" data-e="' + e + '" data-i="' + i + '"><span class="no">' + noBadge(i) + '</span>' + (p ? pieceHtml(p.c, i) : '') + '</div>';
      }
      html += '</div></section>';
    }
    box.innerHTML = html;
    rebuildSpare();
  }
  function pieceHtml(c, i) { return '<div class="piece c' + c + '" data-p="' + c + '-' + i + '"></div>'; }
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
  }
  function renderPanel() {
    const pan = $('#panel');
    let html = '';
    const aiTurn = mode === 'ai' && S.turn === 1;
    if (S.stage === 'select') {
      html += '<div class="phint">' + (aiTurn ? '白方（AI）思考中…' : '轮到' + PLAY[S.turn] + '，在焦点时空（' + ERA_NAMES[S.focus[S.turn]] + '）选一枚可行动的棋子') + '</div>';
    } else if (S.stage === 'act') {
      const left = 2 - S.acted;
      if (G.canEnd(S)) {
        html += '<button class="btn-end" id="btnEnd">✓ 结束行动</button>';
        html += '<div class="hint-inline">该子已无路可走，结束本轮行动</div>';
      } else {
        html += '<div class="phint">' + (S.acted === 0 ? '选择移动方向或穿越目标（第 1 次行动）' : '同一棋子继续第 ' + (S.acted + 1) + ' 次行动，剩余 ' + left + ' 次') +
          '<small>穿越：点相邻时空没有子的同号格<br>移动：向上/下/左/右移动，若有子则推挤</small></div>';
      }
    } else if (S.stage === 'focus') {
      const cur = S.focus[S.turn];
      const aiTurn = mode === 'ai' && S.turn === 1;
      html += '<div class="phint">' + (aiTurn ? '白方（AI）选择下一时空…' : '把焦点移到：') +
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
        if (r) renderAll();
      } else if (op.op === 'act') {
        const r = G.applyAction(S, op.act);
        if (!r.ok) { busy = false; drainPending(); return; }   // 过期缓冲点选：引擎自校验拦下，静默丢弃
        saveGame();                              // 演出耗时：先落盘，中途关页不丢步
        await playEvs(r.evs);
        renderAll();
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
      const aiTurn = mode === 'ai' && S.turn === 1;
      if (G.needPass(S)) {
        if (aiTurn) return;                                  // AI 由 aiRun 处理
        sleep(650).then(() => { if (live && !busy && S.stage === 'select' && G.needPass(S)) doOp({ op: 'pass' }); });
        return;
      }
      if (aiTurn) aiRun();
    } else if (S.stage === 'focus' && mode === 'ai' && S.turn === 1) {
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
          if (G.selectPiece(S, op.era, op.i)) { renderAll(); saveGame(); }
          await sleep(150);
        } else if (op.op === 'act') {
          const r = G.applyAction(S, op.act);
          if (r.ok) { saveGame(); await playEvs(r.evs); renderAll(); }
        } else if (op.op === 'end') { G.endActions(S); renderAll(); }
        else if (op.op === 'pass') { G.doPass(S); saveGame(); renderAll(); await sleep(140); }
        else if (op.op === 'focus') { G.moveFocus(S, op.e); saveGame(); await sleep(90); renderAll(); }
      } catch (e) { console.error('AI', e); }
      busy = false;
      saveGame();                                // AI 每步落盘（含 select/end 等无异步缝隙操作）
      await sleep(240);
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
      if (mode === 'ai' && S.turn === 1) return;            // AI 回合：人类点击一律忽略
      const cell = e.target.closest('.cell');
      if (!cell) return;
      if (busy) { pend = { cell: { e: +cell.dataset.e, i: +cell.dataset.i } }; pendKey = turnKey(); return; }
      handleCellNow(cell);
    });
    $('#panel').addEventListener('click', e => {
      if (!S || S.over) return;
      if (mode === 'ai' && S.turn === 1) return;
      const end = e.target.closest('#btnEnd');
      if (end) { if (busy) { pend = { op: { op: 'end' } }; pendKey = turnKey(); } else doOp({ op: 'end' }); return; }
      const fb = e.target.closest('.fbtn');
      if (fb) { if (busy) { pend = { op: { op: 'focus', e: +fb.dataset.e } }; pendKey = turnKey(); } else doOp({ op: 'focus', e: +fb.dataset.e }); }
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
      }
    }
  }
  function warn() {
    const nb = $('#notebar');
    nb.classList.remove('warn'); void nb.offsetWidth; nb.classList.add('warn');
  }

  /* ---------------- 断点续玩（localStorage 自动存档） ----------------
     key 沿用仓库惯例 <项目名>-state；存 {v, mode, S}，S 即引擎局面（含对局记录）。
     每次引擎变更后立即落盘：演出较长的操作先存后演，中途关页也不丢步。 */
  const SAVE_KEY = 'that_time_you_killed_me-state';
  const SAVE_V = 1;
  const saveGame = () => {
    if (!S || mode === 'menu') return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_V, mode, S })); }
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
    if (!d || d.v !== SAVE_V || (d.mode !== 'ai' && d.mode !== 'local2p') ||
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
    st.mode = d.mode;
    return { mode: d.mode, S: st };
  }
  function tryRestore() {
    const d = readSave();
    if (!d) return;
    mode = d.mode;
    live = false; clearTimers(); aiStop = true; aiRunning = false; busy = false;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
    S = d.S;
    resetFxDom();
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    renderAll();
    if (S.over) return;                                   // 终局：停在结算画面即可
    live = true;
    const aiTurn = mode === 'ai' && S.turn === 1;
    if (aiTurn && (S.stage === 'act' || (S.stage === 'select' && G.needPass(S)))) aiRun();
    else afterChange();                                   // select/focus：空过与选子由 afterChange 触发
  }

  /* ---------------- 屏幕/菜单 ---------------- */
  function start(m) {
    mode = m;
    clearTimers(); aiStop = true; aiRunning = false; busy = false; live = true;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
    S = G.newGame(mode, mode === 'ai' ? () => 0 : Math.random);
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    renderAll();
    afterChange();
    saveGame();                                  // 开局即入档：中途关页回来仍是这盘
  }
  function goMenu() {
    live = false; clearTimers(); aiStop = true; aiRunning = false; busy = false;
    pend = null; pendKey = ''; stripKey = null; fitLast = null;
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
    $('#btnAI').addEventListener('click', () => start('ai'));
    $('#btn2P').addEventListener('click', () => start('local2p'));
    $('#btnMenu').addEventListener('click', goMenu);
    $('#btnRestart').addEventListener('click', () => start(mode));
    $('#btnRules').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnRulesGame').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnCloseRules').addEventListener('click', () => $('#rulesMask').classList.add('hidden'));
    $('#rulesMask').addEventListener('click', e => { if (e.target.id === 'rulesMask') $('#rulesMask').classList.add('hidden'); });
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
    G, start, goMenu, saveKey: SAVE_KEY,
    save: saveGame, clear: clearSave, restore: tryRestore,
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
