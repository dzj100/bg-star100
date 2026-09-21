/* ============================================================
   渗透因子 Infiltraitors · 界面 + 演出（render.js）
   职责：
   - 菜单/配置/对局/结算四态；手牌点选、行动栏、四堆与情报区渲染
   - 事件驱动演出：摸牌飞入 / 判定印章砸下 / 开枪（枪口火光·弹道·抛壳·震屏·顿帧）
     / 叛徒公示与洗回 / 弃牌拾取 / 胜负结算
   - 人机驱动（夜枭回合）与断点续玩
   演出分级遵循 game-feel：小(摸牌) / 中(判定) / 大(开枪命中·终局)，短暂夸大后回到静止
   ============================================================ */
'use strict';
(function () {
  const G = window.INFIL;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const MAIN = 'c0';                                  // 玩家主色（回合提示）

  let S = null, live = false, busy = false, fxOn = true;
  let sel = -1, pickC = -1, pickN = -1, autoHold = false, lastAiHand = -1;
  let pend = null, overFired = null;
  /* 演出期间的显示行动方（0 玩家 / 1 夜枭），null 跟随 S.turn。
     引擎在行动结算时就会换手（铲除命中要等拾牌、开局布控也属夜枭），
     顶部回合指示若直接读 S.turn，会在演出未完时就提前切换 */
  let acting = null;
  const timers = [];
  const sleep = ms => new Promise(r => timers.push(setTimeout(r, ms)));
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }
  /* 演出期间点下的手牌：收下最后一次，收尾若仍是己方回合且手牌未变则采纳 */
  function drainPending() {
    const p = pend; pend = null;
    if (!p || !live || !S || S.over || busy || S.pending || S.turn !== 0) return;
    if (p.hand !== S.hand.join(',')) return;
    if (p.idx < 0 || p.idx >= S.hand.length) return;
    sel = p.idx;
    renderAll();
  }

  /* ---------------- 屏幕震动：trauma 衰减 + sin 采样 ---------------- */
  let trauma = 0, shakeT = 0, shakeOn = false;
  function shakeAdd(a) {
    trauma = Math.min(1, trauma + a);
    if (!shakeOn) {
      shakeOn = true;
      /* 震动期间整屏每帧 transform：先提升为合成层，避免全屏重绘 */
      $('#screen-game').style.willChange = 'transform';
      requestAnimationFrame(shakeLoop);
    }
  }
  function shakeLoop(now) {
    if (!shakeOn) return;
    const dt = Math.min(50, now - (shakeLoop._t || now));
    shakeLoop._t = now;
    const root = $('#screen-game');
    if (trauma > 0.002 && fxOn) {
      trauma = Math.max(0, trauma - 1.15 * dt / 1000);
      const s = trauma * trauma;
      shakeT += dt;
      root.style.transform =
        'translate(' + (Math.sin(shakeT * 0.024) * 10 * s).toFixed(1) + 'px,' +
        (Math.sin(shakeT * 0.032 + 1.7) * 7 * s).toFixed(1) + 'px)';
    } else {
      trauma = 0; root.style.transform = ''; root.style.willChange = '';
      shakeOn = false; shakeLoop._t = 0;
    }
    if (shakeOn) requestAnimationFrame(shakeLoop);
  }

  /* ---------------- 演出层：tween + 顿帧 ---------------- */
  const fxEl = () => $('#fx');
  const fxTweens = [];
  const fxWaits = [];                                 // 等待推进的 fxRunUntil 承诺
  let fxClock = 0, fxRunning = false, fxHold = 0;
  const easeOutCubic = p => 1 - Math.pow(1 - p, 3);
  const easeInQuad = p => p * p;
  const easeBack = p => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const easeOutQuint = p => 1 - Math.pow(1 - p, 5);

  /* 自启循环：新增 tween 时若循环已停就重新点火（否则收尾补的 tween 永远不跑） */
  function tween(o) {
    fxTweens.push({ t0: fxClock + (o.t || 0), dur: Math.max(1, o.dur), upd: o.upd, ease: o.ease || easeOutCubic, done: false });
    fxKick();
  }
  function hitStop(ms) { if (fxOn) fxHold += ms; }
  function fxKick() {
    if (!fxOn || fxRunning) return;
    fxRunning = true;
    let last = performance.now();
    function loop(now) {
      let dt = now - last; last = now;
      if (dt > 50) dt = 50;
      if (fxHold > 0) fxHold -= dt; else fxClock += dt;
      let alive = false;
      for (const tw of fxTweens) {
        if (tw.done) continue;
        const p = Math.min(1, (fxClock - tw.t0) / tw.dur);
        if (p < 0) { alive = true; continue; }
        tw.upd(tw.ease(p));
        if (p >= 1) tw.done = true; else alive = true;
      }
      const waiting = fxWaits.some(w => fxClock < w.end);
      if (waiting || alive || fxHold > 0) requestAnimationFrame(loop);
      else { fxRunning = false; fxTweens.length = 0; fxWaits.splice(0).forEach(w => w.res()); }
    }
    requestAnimationFrame(loop);
  }
  function fxRunUntil(end) {
    return new Promise(res => {
      if (!fxOn) { res(); return; }
      fxWaits.push({ end, res });
      fxKick();
    });
  }
  function clearFx() {
    fxEl().innerHTML = '';
    fxTweens.length = 0; fxClock = 0; fxHold = 0;
    fxWaits.splice(0).forEach(w => w.res());          // 放掉在等的演出，避免调用方永久挂起
    fxRunning = false;
    intelGhosts = [];
    trauma = 0; $('#screen-game').style.transform = ''; $('#screen-game').style.willChange = '';
  }
  const rectOf = el => el ? el.getBoundingClientRect() : null;
  const centerOf = el => { const r = rectOf(el); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 }; };
  const localPt = el => { const r = rectOf(el); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };

  /* 造一个演出元素（fx 层 fixed 定位，坐标直接用视口坐标） */
  function spawn(html, cls, at, size) {
    const el = document.createElement('div');
    el.className = 'fxc' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    el.style.left = at.x + 'px'; el.style.top = at.y + 'px';
    if (size && size.w) { el.style.width = size.w + 'px'; el.style.height = size.h + 'px'; }
    fxEl().appendChild(el);
    return el;
  }
  function fly(el, from, to, dur, o) {
    o = o || {};
    const dx = to.x - from.x, dy = to.y - from.y;
    const s0 = o.s0 == null ? 1 : o.s0, s1 = o.s1 == null ? 1 : o.s1;
    const r0 = o.r0 || 0, r1 = o.r1 || 0;
    tween({
      t: o.t || 0, dur, ease: o.ease,
      upd(p) {
        const k = 1 - p;
        el.style.transform = 'translate(' + (dx * p).toFixed(1) + 'px,' + (dy * p - (o.lift || 0) * Math.sin(Math.PI * p)).toFixed(1) + 'px)' +
          ' scale(' + (s0 + (s1 - s0) * p).toFixed(3) + ') rotate(' + (r0 + (r1 - r0) * p).toFixed(1) + 'deg)';
        el.style.opacity = (o.fadeIn && p < 0.25) ? (p / 0.25).toFixed(2) : (o.fadeOut ? Math.max(0, 1 - Math.max(0, (p - 0.7) / 0.3)).toFixed(2) : 1);
      },
    });
  }
  /* 到点隐没：不透明度直接钉到 0，再下一帧移除。
     原先用 1ms 补间收尾 (1-p)：帧落在 (at, at+1) 时会按 1-p 把已淡出的元素拉回近全亮 —— 收尾回闪的根源 */
  function vanish(el, t, dur) {
    const at = (t || 0) + (dur || 120);
    tween({ t: at, dur: 1, upd() { el.style.opacity = '0'; } });
    tween({ t: at + 1, dur: 1, upd() { el.remove(); } });
  }

  /* 铲除命中瞬间冻结情报区视觉：把两区卡片原样克隆进 fx 层，待叛徒牌揭示后再飞入明弃堆 */
  let intelGhosts = [];
  function freezeIntel() {
    clearIntelGhosts();
    for (const c of $$('#relCards .card, #unrelCards .card')) {
      const r = localPt(c);
      if (!r) continue;
      intelGhosts.push(spawn(c.outerHTML, 'intel-ghost', { x: r.x, y: r.y }, { w: r.w, h: r.h }));
    }
  }
  function clearIntelGhosts() {
    intelGhosts.forEach(el => el.remove());
    intelGhosts = [];
  }

  function burst(pt, n, cls, spread) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.7;
      const d = (spread || 42) * (0.5 + Math.random() * 0.8);
      const el = spawn('', 'c fx-dot ' + (cls || 'dust'), { x: pt.x, y: pt.y });
      fly(el, { x: 0, y: 0 }, { x: Math.cos(a) * d, y: Math.sin(a) * d - 12 }, 320 + Math.random() * 220, { ease: easeOutQuint, fadeOut: true, s1: 0.4 });
      vanish(el, 0, 560);
    }
  }
  function ringAt(pt, size, cls) {
    const el = spawn('', 'fxc ringFx ' + (cls || ''), { x: pt.x - size / 2, y: pt.y - size / 2 }, { w: size, h: size });
    tween({ dur: 320, ease: easeOutQuint, upd(p) { const k = 0.5 + p * 1.6; el.style.transform = 'scale(' + k.toFixed(2) + ')'; el.style.opacity = (1 - p).toFixed(2); } });
    vanish(el, 0, 330);
  }
  function floatAt(pt, txt, cls) {
    const el = spawn('<div class="floatTxt">' + txt + '</div>', '', { x: pt.x - 40, y: pt.y - 12 });
    el.style.width = '80px'; el.style.textAlign = 'center';
    tween({ dur: 760, ease: easeOutCubic, upd(p) { el.style.transform = 'translate(0,' + (-34 * p).toFixed(1) + 'px)'; el.style.opacity = (1 - p * p).toFixed(2); } });
    vanish(el, 0, 800);
  }
  /* 印章砸下：scale 2.2 → 1 + 定角旋转 + 顿帧 + 冲击环 */
  function stampAt(pt, txt, cls, small) {
    const el = spawn('<div class="stampFx ' + cls + '">' + txt + '</div>', '', { x: pt.x, y: pt.y });
    el.style.transform = 'translate(-50%,-50%) rotate(-16deg) scale(2.2)';
    el.style.fontSize = small ? '15px' : '';
    hitStop(small ? 45 : 75);
    tween({ dur: small ? 170 : 220, ease: easeBack, upd(p) { el.style.transform = 'translate(-50%,-50%) rotate(-16deg) scale(' + (2.2 - 1.2 * p).toFixed(3) + ')'; el.style.opacity = p < 0.6 ? (p / 0.6).toFixed(2) : 1; } });
    tween({ t: 150, dur: 110, upd(p) { el.style.transform = 'translate(-50%,-50%) rotate(' + (-16 + 8 * p).toFixed(1) + 'deg) scale(' + (1 + 0.03 * Math.sin(Math.PI * p)).toFixed(3) + ')'; } });
    ringAt(pt, 46, 'ringStamp');
    vanish(el, 1150, 380);
  }
  function flashScreen(strength) {
    const el = spawn('', 'flashLayer', { x: 0, y: 0 });
    tween({ dur: 260, upd(p) { el.style.opacity = ((1 - p) * (strength || 0.55)).toFixed(2); } });
    vanish(el, 0, 270);
  }
  /* 横幅直接挂进 #fx：百分比偏移必须以整层为参照，套 spawn 的 0×0 包裹层会把它顶到视口左上角 */
  function bannerAt(txt, cls) {
    const el = document.createElement('div');
    el.className = 'fxc banner' + (cls ? ' ' + cls : '');
    el.textContent = txt;
    fxEl().appendChild(el);
    tween({ dur: 420, ease: easeBack, upd(p) { el.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + 0.3 * p).toFixed(3) + ')'; el.style.opacity = p < 0.3 ? (p / 0.3).toFixed(2) : 1; } });
    vanish(el, 900, 420);
  }

  /* ---------------- 片段渲染 ---------------- */
  function cardHtml(id, cls) {
    const c = G.cOf(id), n = G.nOf(id);
    return '<div class="card c' + c + (cls ? ' ' + cls : '') + '" data-id="' + id + '">' +
      '<div class="band"><span class="glyph">' + G.GLYPH[c] + '</span><span>' + G.COLORS[c] + '</span></div>' +
      '<div class="num">' + n + '</div>' +
      '<div class="cname">' + G.COLORS[c] + n + '</div></div>';
  }
  const miniHtml = (id, cls) => cardHtml(id, 'mini' + (cls ? ' ' + cls : ''));
  const cardBack = cls => '<div class="card ' + (cls || '') + ' facedown"></div>';

  function renderTop() {
    const left = G.traitorsLeft(S);
    $('#dcount').textContent = S.deck.length;
    $('#tcount').textContent = left + '/' + S.cfg.traitors;
    $('#dncount').textContent = S.discardDown.length;
    $('#upcount').textContent = S.discardUp.length;
    $('#bcount').textContent = Math.max(0, S.bullets);
    const gun = $('#gunbar');
    gun.classList.toggle('low', left > 0 && S.bullets <= left);
    const pips = [];
    for (let i = 0; i < S.bulletsMax; i++) pips.push('<i class="' + (i < S.bullets ? '' : 'spent') + '"></i>');
    $('#pips').innerHTML = pips.join('');
    const tv = acting == null ? S.turn : acting;
    const turn = $('#turnsign');
    turn.className = 'c' + tv;
    turn.textContent = S.over ? '任务结束'
      : tv === 0 ? '你的回合 · 第 ' + S.round + ' 轮' : '夜枭行动 · 第 ' + S.round + ' 轮';
    $('#aiTurnLamp').classList.toggle('on', !S.over && tv === 1);
    const alert = $('#alertbar');
    if (!S.over && left > 0 && S.bullets <= left) {
      alert.classList.remove('hidden');
      alert.textContent = '⚠ 弹药告急：剩 ' + left + ' 名叛徒 > ' + Math.max(0, S.bullets) + ' 发子弹 —— 再落空就完了';
    } else if (tv === 1 && !S.over) {
      alert.classList.remove('hidden');
      alert.classList.add('turn-ai');
      alert.textContent = '夜枭正在行动…';
    } else {
      alert.classList.add('hidden');
      alert.classList.remove('turn-ai');
    }
  }
  function renderAI() {
    const slot = $('#watchSlot');
    slot.classList.toggle('set', !!S.aiWatch);
    $('#watchTag').textContent = S.aiWatch ? '已布控' : '待布控';
    const chip = $('#aiHandChip'), n = S.aiHand.length;
    if (lastAiHand >= 0 && lastAiHand !== n) { chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop'); }
    lastAiHand = n;
    $('#aiHandN').textContent = n;
    $('#relCards').innerHTML = S.intel.rel.map(id => miniHtml(id)).join('');
    $('#unrelCards').innerHTML = S.intel.unrel.map(id => miniHtml(id)).join('');
    $('#relN').textContent = S.intel.rel.length;
    $('#unrelN').textContent = S.intel.unrel.length;
    ['#relCards', '#unrelCards'].forEach(s => { const el = $(s); el.scrollLeft = el.scrollWidth; });
  }
  /* 手牌单行放不下时给整行统一缩放：先按自然宽度量一次，超出可用宽度才挂 .fit */
  function fitHand() {
    const hand = $('#hand');
    hand.classList.remove('fit');
    hand.style.removeProperty('--hs');
    const n = S.hand.length, first = hand.firstElementChild;
    if (n < 2 || !first || !hand.clientWidth) return;      // 隐藏/未布局时跳过
    const gap = parseFloat(getComputedStyle(hand).columnGap) || 0;
    const need = n * first.offsetWidth + (n - 1) * gap;
    if (need > hand.clientWidth) {
      hand.classList.add('fit');
      hand.style.setProperty('--hs', Math.max(.6, hand.clientWidth / need).toFixed(3));
    }
  }
  function renderHand() {
    const acts = G.playerActions(S);
    const my = S.turn === 0 && !S.over && !busy;
    $('#hand').innerHTML = S.hand.map((id, i) =>
      cardHtml(id, (i === sel ? 'pick ' : '') + (my && acts.probe ? '' : 'dead'))).join('');
    $('#handtip').classList.toggle('hidden', !(my && acts.probe) || sel >= 0);
    fitHand();
  }
  function renderAct() {
    const acts = G.playerActions(S);
    const my = S.turn === 0 && !S.over && !busy && !S.pending;
    const bp = $('#btnProbe'), bl = $('#btnLurk'), be = $('#btnElim');
    const lurkOk = acts.lurkMax > 0;
    bp.disabled = !my || !acts.probe;
    bl.disabled = !my || !lurkOk;
    be.disabled = !my || !acts.eliminate;
    bp.classList.toggle('on', my && sel >= 0 && acts.probe);
    bl.querySelector('span').textContent =
      acts.lurkMax <= 0 ? (S.hand.length >= G.HAND_MAX ? '手牌已满' : '牌库不足') :
      '摸 1~' + acts.lurkMax + ' 张 · 暗弃 1';
    be.querySelector('span').textContent = acts.eliminate ? '指认 · 剩 ' + Math.max(0, S.bullets) + ' 发' : '需先有目标';
  }
  function renderNote() {
    const last = S.log.length ? S.log[S.log.length - 1] : null;
    $('#nbText').textContent = last ? last.text : '任务开始';
  }
  function renderAll() {
    if (!S) return;
    renderTop(); renderAI(); renderHand(); renderAct(); renderNote();
  }

  /* ---------------- 行动：玩家 ---------------- */
  /* 吐司提示：底部浮层短暂展示后自动消隐，不占用日志条 */
  function toast(msg) {
    const wrap = $('#toasts');
    let el = wrap.lastElementChild;
    if (el && el.dataset.msg === msg) {               // 连点同一条：重播动画并续时
      el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    } else {
      el = document.createElement('div');
      el.className = 'toast in';
      el.dataset.msg = msg;
      el.textContent = msg;
      wrap.appendChild(el);
      while (wrap.children.length > 3) wrap.removeChild(wrap.firstElementChild);
    }
    clearTimeout(el._hide); clearTimeout(el._gone);
    el._hide = setTimeout(() => {
      el.classList.remove('in'); el.classList.add('out');
      el._gone = setTimeout(() => el.remove(), 260);
    }, 2300);
  }
  function clearToasts() {
    const wrap = $('#toasts');
    if (!wrap) return;
    [...wrap.children].forEach(el => { clearTimeout(el._hide); clearTimeout(el._gone); });
    wrap.textContent = '';
  }
  async function doAct(a) {
    const isReward = a.act === 'pick' || a.act === 'skip';
    const isDraw = a.act === 'draw';
    if (!S || S.over || busy || S.turn !== 0) return { ok: false };
    if (isReward ? S.pending !== 'reward' : isDraw ? S.pending !== 'draw' : !!S.pending) return { ok: false };
    busy = true; acting = 0; renderAll();                  // 玩家发起的整段演出（含结算）都显示己方回合
    let r;
    if (a.act === 'probe') r = G.playerProbe(S, a.idx);
    else if (a.act === 'draw') r = G.drawPick(S, a.take);
    else if (a.act === 'lurk') r = G.playerLurk(S, a.k);
    else if (a.act === 'elim') r = G.playerEliminate(S, a.c, a.n);
    else if (a.act === 'pick') r = G.rewardPick(S, a.pile, a.idx);
    else if (a.act === 'skip') r = G.rewardSkip(S);
    if (!r || !r.ok) { busy = false; acting = null; renderAll(); return { ok: false }; }
    sel = -1;
    /* 命中且将清扫情报区：此刻 DOM 尚未重绘，先冻结情报区副本，揭示后演出清空 */
    if (fxOn && r.evs.some(e => e.k === 'sweep')) freezeIntel();
    saveGame(true);                               // 先落盘再演出：中途刷新不丢步（含终局，落结算见 showOver 清档）
    closeAllSheets();
    await playEvs(r.evs);
    acting = null;                                // 结算演出完毕，之后显示交还引擎实际回合
    clearIntelGhosts();
    renderAll();
    busy = false;
    drainPending();
    afterChange();
    return r;
  }
  function probe() {
    if (!S || S.over || busy) return;
    if (sel < 0) { toast('先选中一张手牌再【通讯】'); return; }
    doAct({ act: 'probe', idx: sel });
  }
  function openLurk() {
    /* 潜伏必暗弃 1 张：牌库至少留 1 张给弃牌，摸 k 张需牌库 ≥ k+1 */
    if (S.deck.length < 2) { toast(S.deck.length ? '牌库不足，无法潜伏' : '牌库已空，无法潜伏'); return; }
    const max = G.playerActions(S).lurkMax;
    if (max <= 0) return;
    const box = $('#lurkOpts');
    box.textContent = '';
    for (let k = 1; k <= max; k++) {
      const b = document.createElement('button');
      b.className = 'lurk-opt';
      b.innerHTML = '<b>' + k + '</b><small>摸 ' + k + ' 张<br>牌库 -' + (k + 1) + ' 张</small>';
      b.addEventListener('click', () => { $('#lurkMask').classList.add('hidden'); doAct({ act: 'lurk', k }); });
      box.appendChild(b);
    }
    $('#lurkMask').classList.remove('hidden');
  }
  function openElim() {
    if (!S || S.over || busy || !S.aiWatch) return;
    pickC = -1; pickN = -1;
    renderPick();
    $('#elimMask').classList.remove('hidden');
  }
  function renderPick() {
    const cols = [];
    for (let c = 0; c < S.cfg.colors; c++) {
      cols.push('<button class="pc c' + c + (pickC === c ? ' on' : '') + '" data-c="' + c + '">' +
        '<small>' + G.GLYPH[c] + '</small>' + G.COLORS[c] + '</button>');
    }
    $('#pickColors').innerHTML = cols.join('');
    const nums = [];
    for (let n = S.cfg.one ? 1 : 2; n <= 15; n++) nums.push('<button class="pn' + (pickN === n ? ' on' : '') + '" data-n="' + n + '">' + n + '</button>');
    $('#pickNums').innerHTML = nums.join('');
    const ok = pickC >= 0 && pickN > 0;
    $('#pickState').innerHTML = ok
      ? '指认：<b>' + G.COLORS[pickC] + ' ' + pickN + '</b> · 消耗 1 发（剩 ' + S.bullets + ' → ' + (S.bullets - 1) + '）'
      : '未选择 · 剩 ' + S.bullets + ' 发 · 未铲除 ' + G.traitorsLeft(S) + ' 名';
    $('#btnFire').disabled = !ok;
  }
  function fireElim() {
    if (pickC < 0 || pickN <= 0) return;
    $('#elimMask').classList.add('hidden');
    doAct({ act: 'elim', c: pickC, n: pickN });
  }

  /* ---------------- 演出：事件流 ---------------- */
  async function playEvs(evs) {
    for (const ev of evs || []) {
      renderAll();
      await animEv(ev);
    }
    renderAll();
  }
  async function animEv(ev) {
    if (!fxOn) return;
    if (ev.k === 'stake') return animStake(ev);
    if (ev.k === 'play') return animPlay(ev);
    if (ev.k === 'mill') return animMill();
    if (ev.k === 'draw') return animDraw(ev);
    if (ev.k === 'shot') return animShot(ev);
    if (ev.k === 'reveal') return animReveal(ev);
    if (ev.k === 'sweep') return animSweep(ev);
    if (ev.k === 'back') return animBack(ev);
    if (ev.k === 'pick') return animPick(ev);
  }
  async function animStake(ev) {
    const to = localPt($('#watchSlot')) || { x: innerWidth / 2, y: 120, w: 30, h: 42 };
    const from = localPt($('#pileTrait')) || to;
    const el = spawn(cardBack(''), 'fxc-c', { x: from.x + from.w / 2 - 15, y: from.y + from.h / 2 - 21 }, { w: 30, h: 42 });
    const q = spawn('<div class="qmark">?</div>', '', { x: to.x + to.w / 2 - 8, y: to.y - 2 });
    q.style.opacity = '0';
    tween({ t: 330, dur: 460, ease: easeOutCubic, upd(p) {
      q.style.opacity = (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75).toFixed(2);
      q.style.transform = 'translate(0,' + (-16 * p).toFixed(1) + 'px)';
    } });
    vanish(q, 800, 1);
    $('#pileTrait').classList.remove('hot'); void $('#pileTrait').offsetWidth; $('#pileTrait').classList.add('hot');
    fly(el, { x: 0, y: 0 }, { x: to.x + to.w / 2 - 15 - (from.x + from.w / 2 - 15), y: to.y + to.h / 2 - 21 - (from.y + from.h / 2 - 21) }, 420, { ease: easeOutCubic, lift: 26, r0: -14, r1: 0 });
    hitStop(35);
    await fxRunUntil(fxClock + 460);
    vanish(el, 400, 120);
    ringAt({ x: to.x + to.w / 2, y: to.y + to.h / 2 }, 40);
    await sleep(160);
  }
  async function animPlay(ev) {
    const zone = ev.zone === 'rel' ? '#relCards' : '#unrelCards';
    const row = $(zone);
    const targets = row.querySelectorAll('.card');
    const targetEl = targets[targets.length - 1];
    const to = localPt(targetEl) || localPt(row) || { x: innerWidth / 2, y: 200, w: 34, h: 47 };
    const srcEl = ev.from === 'hand' ? null : $('#aiarea .ai-name');
    const from = localPt(srcEl || $('#hand')) || { x: innerWidth / 2, y: innerHeight - 140, w: 56, h: 78 };
    const el = spawn(cardHtml(ev.card, 'mini'), '', { x: to.x, y: to.y }, { w: to.w, h: to.h });
    el.style.left = from.x + from.w / 2 - to.w / 2 + 'px';
    el.style.top = from.y + from.h / 2 - to.h / 2 + 'px';
    if (targetEl) targetEl.style.visibility = 'hidden';
    const dx = to.x - (from.x + from.w / 2 - to.w / 2);
    const dy = to.y - (from.y + from.h / 2 - to.h / 2);
    tween({
      dur: 380, ease: easeOutCubic,
      upd(p) {
        el.style.transform = 'translate(' + (dx * p).toFixed(1) + 'px,' + (dy * p - 18 * Math.sin(Math.PI * p)).toFixed(1) + 'px)' +
          ' scale(' + (1 + 0.25 * Math.sin(Math.PI * p)).toFixed(3) + ') rotate(' + (-10 + 10 * p).toFixed(1) + 'deg)';
        el.style.opacity = (0.35 + 0.65 * Math.min(1, p * 2)).toFixed(2);
      },
    });
    await fxRunUntil(fxClock + 390);
    el.remove();
    if (targetEl) targetEl.style.visibility = '';
    const pt = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    stampAt(pt, ev.zone === 'rel' ? '有关' : '无关', ev.zone, true);
    shakeAdd(ev.zone === 'rel' ? 0.24 : 0.3);
    floatAt({ x: pt.x, y: pt.y - 6 }, ev.zone === 'rel' ? '同色/同数/倍数' : '完全无关', 'dim');
    burst(pt, 6, 'dust', 26);
    if (row) row.scrollLeft = row.scrollWidth;
    await sleep(360);
  }
  async function animMill() {
    const from = localPt($('#pileDeck')), to = localPt($('#pileDown'));
    if (!from || !to) return;
    const el = spawn(cardBack(''), '', { x: from.x + from.w / 2 - 15, y: from.y + from.h / 2 - 21 }, { w: 30, h: 42 });
    $('#pileDeck').classList.remove('hot'); void $('#pileDeck').offsetWidth; $('#pileDeck').classList.add('hot');
    fly(el, { x: 0, y: 0 }, { x: to.x + to.w / 2 - 15 - (from.x + from.w / 2 - 15), y: to.y + to.h / 2 - 21 - (from.y + from.h / 2 - 21) }, 350, { lift: 20, r0: 10, r1: -8 });
    await fxRunUntil(fxClock + 360);
    vanish(el, 0, 80);
    $('#pileDown').classList.remove('hot'); void $('#pileDown').offsetWidth; $('#pileDown').classList.add('hot');
    await sleep(120);
  }
  /* 新手牌先隐形占位（visibility 保持布局，slot 坐标可作飞行落点），
     落点到位那一帧再亮牌 —— 渲染顺序反过来会与飞行动画同帧出现（先飞入、后入手） */
  function hideHandTail(ids) {
    const els = [];
    for (const id of ids || []) {
      const el = $('#hand [data-id="' + id + '"]');
      if (el) { el.classList.add('incoming'); els.push(el); }
    }
    return els;
  }
  async function animDraw(ev) {
    const from = localPt($('#pileDeck'));
    const to = ev.to === 'aiHand' ? localPt($('#aiarea')) : localPt($('#hand'));
    if (!from || !to) return;
    const cards = ev.cards || [];
    const slots = ev.to === 'hand' ? hideHandTail(cards) : [];
    $('#pileDeck').classList.remove('hot'); void $('#pileDeck').offsetWidth; $('#pileDeck').classList.add('hot');
    const n = Math.min(3, cards.length || 1);
    for (let i = 0; i < n; i++) {
      const html = (ev.to === 'hand' && cards[i] != null) ? cardHtml(cards[i], 'mini') : cardBack('');
      const el = spawn(html, '', { x: from.x + from.w / 2 - 17, y: from.y + from.h / 2 - 23 }, { w: 34, h: 47 });
      const hit = slots[i] ? localPt(slots[i]) : null;
      const cx = hit ? hit.x + hit.w / 2 : to.x + to.w / 2 + (i - (n - 1) / 2) * 22;
      const cy = hit ? hit.y + hit.h / 2 : to.y + to.h / 2;
      const tx = cx - 17 - (from.x + from.w / 2 - 17);
      const ty = cy - 23 - (from.y + from.h / 2 - 23);
      const land = i * 70 + 300;
      tween({
        dur: 300, t: i * 70, ease: easeOutCubic,
        upd(p) {
          el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 26 * Math.sin(Math.PI * p)).toFixed(1) + 'px) scale(' + (1 - 0.2 * p).toFixed(3) + ') rotate(' + (-12 + 12 * p).toFixed(1) + 'deg)';
          el.style.opacity = p < 0.15 ? (p / 0.15).toFixed(2) : (p > 0.8 ? ((1 - p) / 0.2).toFixed(2) : 1);
        },
      });
      tween({ t: land, dur: 1, upd() { if (slots[i]) { slots[i].classList.remove('incoming'); slots[i].classList.add('arrive'); } } });
      vanish(el, land, 60);
    }
    await fxRunUntil(fxClock + 300 + n * 70);
    burst(centerOf($('#hand')), 5, 'spark', 30);
    await sleep(140);
  }
  async function animShot(ev) {
    const slot = localPt($('#watchSlot'));
    const aim = slot ? { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 } : { x: innerWidth / 2, y: 140 };
    /* 手枪自底部滑入并抬枪瞄准（图形与顶部弹药条共用） */
    const gun = spawn('<div class="pistolFx">' + $('#gunbar .gun svg').outerHTML + '</div>', '', { x: innerWidth / 2 - 22, y: innerHeight + 20 });
    const gEnd = { x: innerWidth / 2 - 22, y: innerHeight - 190 };
    const gy = gEnd.y - (innerHeight + 20);
    /* 平举滑入：进场时枪口朝右、无偏移角 */
    fly(gun, { x: 0, y: 0 }, { x: 0, y: gy }, 280, { ease: easeOutCubic, r0: 0, r1: 0 });
    await fxRunUntil(fxClock + 290);
    /* 瞄准：开火前绕枪身中心甩向盯梢位（快甩 80ms），枪管方向与弹道一致 */
    const gc = { x: gEnd.x + 22, y: gEnd.y + 15 };
    const aimDeg = Math.atan2(aim.y - gc.y, aim.x - gc.x) * 180 / Math.PI;
    const rad = aimDeg * Math.PI / 180, cosA = Math.cos(rad), sinA = Math.sin(rad);
    tween({ dur: 80, ease: easeOutCubic, upd(p) { gun.style.transform = 'translate(0px,' + gy.toFixed(1) + 'px) rotate(' + (aimDeg * p).toFixed(1) + 'deg)'; } });
    await fxRunUntil(fxClock + 90);
    /* 枪口 = 中心 + 随枪身旋转后的枪管口偏移（44×30 内枪口在 (37.4,7.7)） */
    const muzzle = { x: gc.x + 15.4 * cosA + 7.3 * sinA, y: gc.y + 15.4 * sinA - 7.3 * cosA };
    /* 枪口火光 + 弹道 */
    const mz = spawn('', 'muzzle', { x: muzzle.x - 13, y: muzzle.y - 13 });
    tween({ dur: 130, upd(p) { mz.style.transform = 'scale(' + (1.6 - 0.9 * p).toFixed(2) + ')'; mz.style.opacity = (1 - p).toFixed(2); } });
    vanish(mz, 0, 140);
    const dist = Math.hypot(aim.x - muzzle.x, aim.y - muzzle.y);
    const ang = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x) * 180 / Math.PI;
    const tr = spawn('', 'tracer', { x: muzzle.x, y: muzzle.y - 1.5 }, { w: dist, h: 3 });
    tr.style.transformOrigin = '0 50%';
    tr.style.transform = 'rotate(' + ang.toFixed(1) + 'deg) scaleX(0)';
    tween({ dur: 110, ease: easeOutQuint, upd(p) { tr.style.transform = 'rotate(' + ang.toFixed(1) + 'deg) scaleX(' + p.toFixed(3) + ')'; tr.style.opacity = (1 - Math.max(0, (p - 0.6) / 0.4)).toFixed(2); } });
    vanish(tr, 0, 130);
    flashScreen(ev.hit ? 0.6 : 0.34);
    /* 抛壳：壳向右后上方弹出并滚落 */
    const sh = spawn('', 'shell', { x: muzzle.x - 6, y: muzzle.y - 6 });
    fly(sh, { x: 0, y: 0 }, { x: 54 + Math.random() * 22, y: 74 }, 520, { ease: easeOutCubic, r0: 0, r1: 320, fadeOut: true });
    vanish(sh, 0, 540);
    /* 后坐（沿枪管后座 + 抬枪口）：位移叠加滑入落位 gy，旋转在瞄准角上再抬 14° */
    const rx = -10 * cosA, ry = -10 * sinA;
    tween({ dur: 90, upd() { gun.style.transform = 'translate(' + rx.toFixed(1) + 'px,' + (gy + ry).toFixed(1) + 'px) rotate(' + (aimDeg - 14).toFixed(1) + 'deg)'; } });
    tween({ t: 95, dur: 200, ease: easeOutCubic, upd(p) { gun.style.transform = 'translate(' + (rx * (1 - p)).toFixed(1) + 'px,' + (gy + ry * (1 - p)).toFixed(1) + 'px) rotate(' + (aimDeg - 14 * (1 - p)).toFixed(1) + 'deg)'; } });
    hitStop(ev.hit ? 120 : 62);
    shakeAdd(ev.hit ? 0.82 : 0.46);
    if (ev.hit) {
      burst(aim, 16, 'dust', 58);
      ringAt(aim, 54, 'ringHit');
      flashScreen(0.34);
    } else {
      burst(aim, 9, 'spark', 40);
      floatAt({ x: aim.x, y: aim.y - 4 }, '落空', 'miss');
    }
    await fxRunUntil(fxClock + 420);
    vanish(gun, 0, 220);
    /* 子弹点阵：最后一颗变空壳 */
    const pips = $('#pips').querySelectorAll('i:not(.spent)');
    if (pips.length) { const last = pips[pips.length - 1]; last.classList.add('spent'); last.style.animation = 'none'; }
    $('#bcount').textContent = Math.max(0, S.bullets);
    await sleep(120);
  }
  async function animReveal(ev) {
    const slot = localPt($('#watchSlot')) || { x: innerWidth / 2, y: 120, w: 30, h: 42 };
    const html = cardHtml(ev.card, '');
    const el = spawn(html, '', { x: slot.x + slot.w / 2 - 28, y: slot.y + slot.h / 2 - 39 }, { w: 56, h: 78 });
    el.style.transform = 'scale(0.4) rotate(0deg)';
    tween({ dur: 300, ease: easeBack, upd(p) { el.style.transform = 'scale(' + (0.4 + 1.5 * p).toFixed(3) + ') rotate(' + (-20 + 14 * p).toFixed(1) + 'deg)'; } });
    await fxRunUntil(fxClock + 310);
    const pt = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
    stampAt(pt, '铲除', 'kill');
    floatAt({ x: pt.x, y: pt.y - 30 }, G.cardName(ev.card), '');
    flashScreen(0.36); shakeAdd(0.5);
    await sleep(520);
    vanish(el, 0, 180);
    ringAt(pt, 70, 'ringHit');
    await sleep(180);
  }
  async function animSweep(ev) {
    const up = localPt($('#pileUp'));
    const ghosts = intelGhosts; intelGhosts = [];
    /* 优先用命中瞬间冻结的情报区副本（「先揭示、后清空」）；无副本时退回按当前区克隆 */
    const list = ghosts.length ? ghosts
      : [...document.querySelectorAll('#relCards .card, #unrelCards .card')].map(node => {
          const rr = localPt(node);
          if (!rr) return null;
          const el = spawn(node.outerHTML, '', { x: rr.x, y: rr.y }, { w: rr.w, h: rr.h });
          node.style.visibility = 'hidden';
          return el;
        }).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const r = localPt(el);
      if (!r) continue;
      const tx = (up ? up.x + up.w / 2 - r.w / 2 : innerWidth - 80) - r.x;
      const ty = (up ? up.y + up.h / 2 - r.h / 2 : 60) - r.y;
      tween({
        dur: 300, t: i * 45, ease: easeOutCubic,
        upd(p) {
          el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 22 * Math.sin(Math.PI * p)).toFixed(1) + 'px) rotate(' + (-16 * p).toFixed(1) + 'deg)';
          el.style.opacity = p < 0.1 ? (p / 0.1).toFixed(2) : 1;
        },
      });
      vanish(el, i * 45 + 296, 60);
    }
    if (list.length) $('#pileUp').classList.remove('hot'), void $('#pileUp').offsetWidth, $('#pileUp').classList.add('hot');
    await fxRunUntil(fxClock + 320 + list.length * 45);
    burst(centerOf($('#pileUp')), 6, 'spark', 30);
    await sleep(140);
  }
  async function animBack(ev) {
    const up = localPt($('#pileDeck'));
    const from = localPt($('#watchSlot')) || { x: innerWidth / 2, y: 120, w: 30, h: 42 };
    const el = spawn(cardHtml(ev.card, 'mini'), '', { x: from.x + from.w / 2 - 17, y: from.y + from.h / 2 - 23 }, { w: 34, h: 47 });
    const tx = (up ? up.x + up.w / 2 - 17 : innerWidth - 80) - (from.x + from.w / 2 - 17);
    const ty = (up ? up.y + up.h / 2 - 23 : 60) - (from.y + from.h / 2 - 23);
    tween({ dur: 400, ease: easeOutCubic, upd(p) { el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 30 * Math.sin(Math.PI * p)).toFixed(1) + 'px) rotate(' + (360 * p).toFixed(0) + 'deg) scale(' + (1 - 0.35 * p).toFixed(2) + ')'; el.style.opacity = p > 0.85 ? ((1 - p) / 0.15).toFixed(2) : 1; } });
    await fxRunUntil(fxClock + 410);
    vanish(el, 0, 60);
    $('#pileDeck').classList.remove('hot'); void $('#pileDeck').offsetWidth; $('#pileDeck').classList.add('hot');
    bannerAt('重新加入牌库', 'back');
    await sleep(320);
  }
  async function animPick(ev) {
    const hand = localPt($('#hand'));
    const src = ev.from === 'up' ? localPt($('#pileUp')) : localPt($('#pileDown'));
    if (!hand || !src) return;
    const slot = hideHandTail(ev.card != null ? [ev.card] : [])[0] || null;
    const el = spawn(cardHtml(ev.card, 'mini'), '', { x: src.x + src.w / 2 - 17, y: src.y + src.h / 2 - 23 }, { w: 34, h: 47 });
    const hit = slot ? localPt(slot) : null;
    const cx = hit ? hit.x + hit.w / 2 : hand.x + hand.w / 2;
    const cy = hit ? hit.y + hit.h / 2 : hand.y + hand.h / 2;
    const tx = cx - 17 - (src.x + src.w / 2 - 17);
    const ty = cy - 23 - (src.y + src.h / 2 - 23);
    tween({ dur: 340, ease: easeOutCubic, upd(p) { el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 24 * Math.sin(Math.PI * p)).toFixed(1) + 'px) scale(' + (1 + 0.3 * p).toFixed(2) + ')'; el.style.opacity = p < 0.12 ? (p / 0.12).toFixed(2) : (p > 0.8 ? ((1 - p) / 0.2).toFixed(2) : 1); } });
    tween({ t: 340, dur: 1, upd() { if (slot) { slot.classList.remove('incoming'); slot.classList.add('arrive'); } } });
    await fxRunUntil(fxClock + 350);
    vanish(el, 0, 60);
    burst(centerOf($('#hand')), 5, 'spark', 26);
    await sleep(140);
  }

  /* ---------------- 结算 ---------------- */
  function showOver() {
    clearSave();                                       // 局终清档：结算界面之后只能重开
    if (overFired === S.over) { $('#overlay-win').classList.remove('hidden'); return; }
    overFired = S.over;
    const w = S.over.win, st = S.over.stats;
    const pips = [];
    for (let i = 0; i < S.cfg.traitors; i++) pips.push('<i class="' + (i < st.caught ? 'on' : 'gone') + '"></i>');
    const why = w ? '全部 ' + S.cfg.traitors + ' 名叛徒已铲除，收队。'
      : S.over.why === 'stuck' ? '行动全部枯竭 —— 死局，还有 ' + (S.cfg.traitors - st.caught) + ' 名叛徒没抓到。'
        : '弹药告急：未铲除的叛徒比子弹还多。';
    $('#overlay-win').innerHTML =
      '<div class="win-card">' +
      '<div class="win-stamp ' + (w ? 'ok' : 'no') + '">' + (w ? '任务成功' : '任务失败') + '</div>' +
      '<div class="vs-dots">' + pips.join('') + '</div>' +
      '<div class="win-why">' + why + '</div>' +
      '<div class="win-stats">回合 ' + st.rounds + ' · 开枪 ' + st.shots + '（中 ' + st.hits + ' / 落 ' + st.misses + '）<br>' +
      '铲除 ' + st.caught + '/' + st.traitors + ' · 子弹余 ' + Math.max(0, st.bullets) + ' · 牌库余 ' + st.deck + '</div>' +
      '<button class="btn-main primary" id="btnAgain">再来一局</button>' +
      '<button class="btn-main" id="btnHome">返回菜单</button>' +
      '</div>';
    $('#overlay-win').classList.remove('hidden');
    if (w) { flashScreen(0.5); shakeAdd(0.4); }
    else shakeAdd(0.5);
  }
  function afterChange() {
    if (!live || !S) return;
    if (S.over) { showOver(); return; }
    if (S.pending === 'reward') { openReward(); return; }
    if (S.pending === 'draw') { openDraw(); return; }
    renderAll();
    if (S.turn === 1) aiRun();
  }
  async function aiRun() {
    if (!S || S.over || S.turn !== 1 || busy) return;
    busy = true; renderAll();
    await sleep(fxOn ? 560 : 20);                     // 演出关闭（走查）时压缩思考时间
    if (!live || !S || S.over || S.turn !== 1) { busy = false; return; }
    acting = 1;                                       // 夜枭行动结算即换手，演出期间显示仍归夜枭
    const t = G.aiTakeTurn(S, Math.random);
    saveGame(true);                                   // 同上：AI 结算演出前落盘（含死局终局）
    await playEvs(t.evs);
    acting = null;
    renderAll();
    busy = false;
    drainPending();
    afterChange();
  }

  /* ---------------- 弃牌 / 情报 / 推论 抽屉 ---------------- */
  const cdot = c => '<i class="cdot" style="background:var(--c' + c + ')"></i>';
  /* ---------------- 叛徒区抽屉：真相 / 盯梢 / 已铲除 ---------------- */
  /* 对局中三区只给张数与牌背；结算后翻开真相 —— 失败时也能看清叛徒分别是谁。
     联机预留：盯梢区收「所有玩家的盯梢牌」列表（by = 持有者名，现仅夜枭一处） */
  function openTraitor() {
    const watches = S.aiWatch != null ? [{ by: '夜枭', card: S.aiWatch }] : [];
    /* 已铲除名单：老档 / 测试构局可能缺 caughtCards，按铲除数从牌库顺位兜底 */
    const caught = S.caughtCards && S.caughtCards.length === S.caught ? S.caughtCards : S.deck.slice(0, S.caught);
    const over = !!S.over;
    $('#traitSub').textContent = over ? '任务已结束 · 叛徒信息公开' : '执行任务中 · 叛徒区、盯梢区信息不公开';
    $('#tPileN').textContent = S.traitorPile.length + ' 名';
    $('#tWatchN').textContent = watches.length + ' 名';
    $('#tCaughtN').textContent = caught.length + ' 名';
    $('#tPileCards').innerHTML = zoneCards(S.traitorPile.map(card => ({ card })), over);
    $('#tWatchCards').innerHTML = zoneCards(watches, over);
    $('#tCaughtCards').innerHTML = zoneCards(caught.map(card => ({ card })), true);
    $('#traitorMask').classList.remove('hidden');
  }
  /* over=false 一律牌背（按持有者补署名）；over=true 翻开正面 */
  function zoneCards(items, faceUp) {
    if (!items.length) return '<div class="zone-empty">暂无</div>';
    return items.map(it => '<span class="zcell">' +
      (it.by ? '<i class="wtag">' + it.by + '</i>' : '') +
      (faceUp ? cardHtml(it.card, 'mini') : cardBack('mini')) + '</span>').join('');
  }
  function openDisc() {
    const groups = [];
    for (let c = 0; c < S.cfg.colors; c++) {
      const ids = S.discardUp.filter(id => G.cOf(id) === c).sort((a, b) => G.nOf(a) - G.nOf(b));
      if (!ids.length) continue;
      groups.push('<div class="dgroup"><span class="dg-label">' + cdot(c) + G.COLORS[c] + '</span>' +
        '<span class="dg-cards">' + ids.map(id => miniHtml(id)).join('') + '</span></div>');
    }
    $('#discUp').innerHTML = groups.join('') || '<div class="zone-empty">明弃堆还是空的。</div>';
    $('#discDownN').textContent = S.discardDown.length + ' 张';
    $('#discSub').textContent = '明弃按颜色分组 · 数字升序 · 共 ' + S.discardUp.length + ' 张';
    $('#discMask').classList.remove('hidden');
  }
  function openIntel(zone) {
    const rel = zone === 'rel';
    const ids = rel ? S.intel.rel : S.intel.unrel;
    $('#intelSub').textContent = rel ? '所有「有关」线索：与目标同色 / 同数 / 互为倍数或因数' : '所有「无关」线索：与目标完全无关';
    $('#intelBody').innerHTML =
      '<div class="zone-block"><div class="pick-title"><span class="stamp ' + (rel ? 'rel' : 'unrel') + '">' + (rel ? '有关' : '无关') + '</span>' +
      '<span>' + ids.length + ' 张</span></div>' +
      (ids.length ? '<div class="zone-cards">' + ids.map(id => cardHtml(id, 'mini')).join('') + '</div>' : '<div class="zone-empty">暂无</div>') +
      '</div>';
    $('#intelMask').classList.remove('hidden');
  }
  function openBoard() {
    const a = G.analyze(S, autoHold);
    const inHand = new Set(S.hand);
    const inIntel = new Set([...S.intel.rel, ...S.intel.unrel]);
    const inDisc = new Set(S.discardUp);
    const cand = new Set(a.cand);
    $('#candN').textContent = a.cand.length;
    $('#autoHold').classList.toggle('on', autoHold);
    const nums = [];
    for (let n = S.cfg.one ? 1 : 2; n <= 15; n++) nums.push(n);
    // const head = '<div class="bRow"><span class="browlabel">色 \\ 数</span>' +
    //   nums.map(n => '<span class="bcell bnumhead" style="border:none;background:none">' + n + '</span>').join('') + '</div>';
    const head = '';
    const rows = [];
    for (let c = 0; c < S.cfg.colors; c++) {
      const cells = nums.map(n => {
        const id = G.mk(c, n);
        let cls = 'bcell';
        if (cand.has(id)) cls += ' cand';
        else if (inHand.has(id)) cls += ' hand';
        else if (inIntel.has(id)) cls += ' intel';
        else if (inDisc.has(id)) cls += ' disc';
        else if (a.judge.has(id)) cls += ' judge';
        else cls += ' dimmed';
        return '<span class="' + cls + '" title="' + G.cardName(id) + '">' + n + '</span>';
      }).join('');
      rows.push('<div class="bRow"><span class="browlabel">' + cdot(c) + G.COLORS[c] + '</span>' + cells + '</div>');
    }
    $('#boardGrid').innerHTML = head + rows.join('');
    $('#boardMask').classList.remove('hidden');
  }
  function openReward() {
    const up = S.discardUp.map((id, i) => ({ id, i }));
    $('#rewardUp').innerHTML = up.length
      ? up.map(o => '<button class="card mini c' + G.cOf(o.id) + '" data-i="' + o.i + '">' +
        '<div class="band"><span class="glyph">' + G.GLYPH[G.cOf(o.id)] + '</span><span>' + G.COLORS[G.cOf(o.id)] + '</span></div><div class="num">' + G.nOf(o.id) + '</div></button>').join('')
      : '<div class="zone-empty">明弃堆是空的（只能盲抽或跳过）。</div>';
    $('#btnBlind').disabled = !S.discardDown.length || S.hand.length >= G.HAND_MAX;
    $('#btnSkipReward').textContent = S.hand.length >= G.HAND_MAX ? '手牌已满 · 跳过' : '跳过';
    $('#rewardHandN').textContent = S.hand.length + '/' + G.HAND_MAX;
    $('#rewardHand').innerHTML = S.hand.length
      ? S.hand.map(id => miniHtml(id)).join('')
      : '<div class="zone-empty">手牌已空</div>';
    $('#rewardMask').classList.remove('hidden');
  }
  function openDraw() {
    $('#drawInfo').innerHTML = '牌库剩余 <b>' + S.deck.length + '</b> 张 · 手牌 ' + S.hand.length + '/' + G.HAND_MAX;
    $('#drawMask').classList.remove('hidden');
  }
  function openLog() {
    const items = S.log.slice().reverse().map(l =>
      '<div class="log-item ' + l.who + '"><span class="lg-no">R' + l.no + '</span><span>' + l.text + '</span></div>');
    $('#logList').innerHTML = items.join('') || '<div class="zone-empty">暂无记录</div>';
    $('#logMask').classList.remove('hidden');
  }
  const closeAllSheets = () => {
    autoHold = false;                                   // 按住途中被收起时，别让自动分析留在开启态
    ['#rulesMask', '#logMask', '#boardMask', '#discMask', '#elimMask', '#rewardMask', '#drawMask', '#lurkMask', '#intelMask', '#traitorMask']
      .forEach(s => $(s).classList.add('hidden'));
  };

  /* ---------------- 存档续玩 ---------------- */
  const SAVE_KEY = 'infiltraitors-state';
  const CFG_KEY = 'infiltraitors-cfg';
  const SAVE_V = 1;
  /* force：终局动作也先落盘（演出中途刷新直接回结算界面）；局终清档由 showOver 负责 */
  function saveGame(force) {
    if (!S || !live || (S.over && !force)) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_V, S, cfg: S.cfg })); } catch (e) { /* 隐私模式：忽略 */ }
  }
  const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } };
  function readSave() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { clearSave(); return null; }
    if (!d || d.v !== SAVE_V || !G.validate(d.S)) { clearSave(); return null; }
    return d.S;
  }
  function tryRestore() {
    const st = readSave();
    if (!st) return false;
    S = st; live = false; busy = false; acting = null; sel = -1; pend = null; overFired = null;
    clearFx(); clearToasts(); closeAllSheets();
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    renderAll();
    if (S.over) { showOver(); return true; }
    live = true;
    afterChange();
    return true;
  }

  /* ---------------- 菜单 ---------------- */
  let cfg = { colors: 4, one: false, traitors: 7, extra: 3 };
  function loadCfg() {
    try {
      const d = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (d) cfg = G.normCfg(d);
    } catch (e) { /* ignore */ }
  }
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };
  function renderCfg() {
    $$('#cfgPanel .seg[data-k]').forEach(seg => {
      const k = seg.dataset.k;
      if (k === 'colors' || k === 'one') {
        [...seg.querySelectorAll('button')].forEach(b => {
          const v = k === 'one' ? (b.dataset.v === '1') : (+b.dataset.v);
          b.classList.toggle('on', cfg[k] === v);
        });
      } else {
        seg.innerHTML = '';
        const lo = k === 'traitors' ? G.TRAIT_MIN : 0, hi = k === 'traitors' ? G.TRAIT_MAX : G.EXTRA_MAX;
        for (let v = lo; v <= hi; v++) {
          const b = document.createElement('button');
          b.textContent = v;
          b.classList.toggle('on', cfg[k] === v);
          b.addEventListener('click', () => { cfg[k] = v; saveCfg(); renderCfg(); });
          seg.appendChild(b);
        }
      }
    });
    const d = G.difficultyOf(cfg), bul = G.bulletsOf(G.normCfg(cfg));
    const read = '牌库 <b>' + d.deck + '</b> 张 · 叛徒 <b>' + cfg.traitors + '</b> 名 · 子弹 <b>' + bul + '</b> 发 · ' +
      '难度 <span class="tag-diff tag-' + d.tag + '">' + d.tag + '</span>';
    $('#cfgRead').innerHTML = read;
    $('#menuMeta').innerHTML = read;
    const hasSave = !!readSave();
    $('#btnResume').classList.toggle('hidden', !hasSave);
    $('#btnStart').classList.toggle('primary', !hasSave);      // 有存档时把「继续」提为主按钮
    $('#btnResume').classList.toggle('primary', hasSave);
    if (hasSave) {
      const st = readSave();
      $('#resumeSub').textContent = '第 ' + st.round + ' 轮 · 已铲除 ' + st.caught + '/' + st.cfg.traitors +
        ' · 牌库 ' + st.deck.length + ' 张';
    }
  }
  const openCfg = () => { renderCfg(); $('#cfgMask').classList.remove('hidden'); };
  const closeCfg = () => $('#cfgMask').classList.add('hidden');
  function startGame() {
    clearTimers(); clearFx(); clearToasts(); live = false; busy = false; sel = -1; pend = null; overFired = null; acting = null;
    S = G.newGame(cfg, Math.random);
    closeAllSheets();
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
    acting = 1;                                        // 开局布控（盯梢+暗弃）是夜枭的演出
    busy = true;                                       // 演出期间不收输入（也让测试的 idle() 覆盖整段布控）
    live = true;
    renderAll();
    saveGame();
    playEvs(S.openEvs).then(() => {
      acting = null; busy = false;
      renderAll(); drainPending(); afterChange();
    });
  }
  function resetGame() {
    if (!S) return;
    const c = S.cfg;
    clearTimers(); clearFx(); clearToasts(); live = false; busy = false; sel = -1; pend = null; overFired = null; acting = null;
    S = G.newGame(c, Math.random);
    closeAllSheets();
    acting = 1;
    busy = true;
    live = true;
    renderAll();
    saveGame();
    playEvs(S.openEvs).then(() => {
      acting = null; busy = false;
      renderAll(); drainPending(); afterChange();
    });
  }
  function goMenu() {
    saveGame();                                        // 回菜单保留存档：靠【继续任务】原样回到牌局
    clearTimers(); clearFx(); clearToasts(); live = false; busy = false; sel = -1; S = null; pend = null; overFired = null; acting = null;
    closeAllSheets();
    $('#screen-menu').classList.remove('hidden');
    $('#screen-game').classList.remove('on');
    $('#screen-game').style.transform = '';
    $('#overlay-win').classList.add('hidden');
    renderCfg();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    window.addEventListener('resize', () => { if (S) fitHand(); });
    $$('#cfgPanel .seg[data-k="colors"] button').forEach(b => b.addEventListener('click', () => { cfg.colors = +b.dataset.v; saveCfg(); renderCfg(); }));
    $$('#cfgPanel .seg[data-k="one"] button').forEach(b => b.addEventListener('click', () => { cfg.one = b.dataset.v === '1'; saveCfg(); renderCfg(); }));
    $('#btnStart').addEventListener('click', openCfg);
    $('#btnCfgGo').addEventListener('click', () => { closeCfg(); startGame(); });
    $('#btnCfgBack').addEventListener('click', closeCfg);
    $('#btnReset').addEventListener('click', () => $('#resetMask').classList.remove('hidden'));
    $('#btnResetGo').addEventListener('click', () => { $('#resetMask').classList.add('hidden'); resetGame(); });
    $('#btnResetBack').addEventListener('click', () => $('#resetMask').classList.add('hidden'));
    $('#btnResume').addEventListener('click', () => { if (!tryRestore()) openCfg(); });
    $('#btnRules').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnRulesGame').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnCloseRules').addEventListener('click', () => $('#rulesMask').classList.add('hidden'));
    $('#btnMenu').addEventListener('click', goMenu);
    $('#btnBoard').addEventListener('click', openBoard);
    $('#btnCloseBoard').addEventListener('click', () => $('#boardMask').classList.add('hidden'));
    /* 自动分析只在按住时临时开启：松开即回到仅已知位置排除（看清了才给答案） */
    $('#autoHold').addEventListener('pointerdown', e => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      autoHold = true; openBoard();
    });
    $('#autoHold').addEventListener('pointerup', () => { autoHold = false; openBoard(); });
    $('#autoHold').addEventListener('pointercancel', () => { autoHold = false; openBoard(); });
    $('#autoHold').addEventListener('contextmenu', e => e.preventDefault());   // 手机长按不弹系统菜单
    $('#btnCloseDisc').addEventListener('click', () => $('#discMask').classList.add('hidden'));
    $('#btnCloseIntel').addEventListener('click', () => $('#intelMask').classList.add('hidden'));
    $('#btnCloseLog').addEventListener('click', () => $('#logMask').classList.add('hidden'));
    $('#btnCancelElim').addEventListener('click', () => $('#elimMask').classList.add('hidden'));
    $('#btnCancelLurk').addEventListener('click', () => $('#lurkMask').classList.add('hidden'));
    /* 点遮罩空白处收起抽屉；拾牌与摸牌选择是必选阶段，收起就没法继续，所以除外 */
    $$('.sheet-mask').forEach(m => m.addEventListener('click', e => {
      if (e.target === m && m.id !== 'rewardMask' && m.id !== 'drawMask') m.classList.add('hidden');
    }));
    $('#btnFire').addEventListener('click', fireElim);
    $$('#elimMask .sheet').forEach(sh => sh.addEventListener('click', e => {
      const pc = e.target.closest('.pc'), pn = e.target.closest('.pn');
      if (pc) { pickC = +pc.dataset.c; renderPick(); }
      else if (pn) { pickN = +pn.dataset.n; renderPick(); }
    }));
    $('#btnBlind').addEventListener('click', () => { $('#rewardMask').classList.add('hidden'); doAct({ act: 'pick', pile: 'down' }); });
    $('#btnSkipReward').addEventListener('click', () => { $('#rewardMask').classList.add('hidden'); doAct({ act: 'skip' }); });
    $('#btnDrawTake').addEventListener('click', () => { $('#drawMask').classList.add('hidden'); doAct({ act: 'draw', take: true }); });
    $('#btnDrawSkip').addEventListener('click', () => { $('#drawMask').classList.add('hidden'); doAct({ act: 'draw', take: false }); });
    $('#rewardUp').addEventListener('click', e => {
      const c = e.target.closest('.card[data-i]');
      if (!c) return;
      $('#rewardMask').classList.add('hidden');
      doAct({ act: 'pick', pile: 'up', idx: +c.dataset.i });
    });
    $('#pileUp').addEventListener('click', openDisc);
    $('#pileDeck').addEventListener('click', () => toast('牌库剩 ' + S.deck.length + ' 张，潜伏必暗弃 1 张'));
    $('#pileTrait').addEventListener('click', openTraitor);
    $('#btnCloseTraitor').addEventListener('click', () => $('#traitorMask').classList.add('hidden'));
    $('#pileDown').addEventListener('click', () => toast('暗弃堆 ' + S.discardDown.length + ' 张（只见张数）'));
    $('#watchSlot').addEventListener('click', () => toast(S.aiWatch ? '夜枭已锁定 1 名目标（内容对你也保密）' : '夜枭还没锁定目标'));
    $('#rowRel').addEventListener('click', () => openIntel('rel'));
    $('#rowUnrel').addEventListener('click', () => openIntel('unrel'));
    $('#notebar').addEventListener('click', openLog);
    $('#btnProbe').addEventListener('click', probe);
    $('#btnLurk').addEventListener('click', openLurk);
    $('#btnElim').addEventListener('click', openElim);
    $('#hand').addEventListener('click', e => {
      if (!S || S.over || S.pending) return;
      const c = e.target.closest('.card[data-id]');
      const idx = c ? [...$('#hand').children].indexOf(c) : -1;
      if (idx < 0) return;
      if (busy || S.turn !== 0) { pend = { idx, hand: S.hand.join(',') }; return; }   // 演出/对方回合：收下最后一次
      sel = (sel === idx) ? -1 : idx;
      renderAll();
    });
    $('#overlay-win').addEventListener('click', e => {
      if (e.target.closest('#btnAgain')) { $('#overlay-win').classList.add('hidden'); startGame(); }
      else if (e.target.closest('#btnHome')) goMenu();
      else if (e.target === e.currentTarget) $('#overlay-win').classList.add('hidden');   // 点遮罩收起：可回看日志 / 推论
    });
  }

  /* ---------------- 测试钩子 ---------------- */
  const UI = {
    G,
    state: () => S,
    busy: () => !!busy,
    saveKey: SAVE_KEY,
    cfgKey: CFG_KEY,
    save: saveGame, clear: clearSave, restore: tryRestore,
    start: startGame, reset: resetGame, openCfg, closeCfg, goMenu,
    cfg: v => { if (v) { cfg = G.normCfg(v); saveCfg(); renderCfg(); } return cfg; },
    setFx: v => { fxOn = !!v; },
    renderAll,
    openBoard, openDisc, openLog, openElim, openReward, openDraw, openIntel, openLurk, openTraitor,
    fire(a) { doAct(a); return S; },
    doAct,
    animShot: ev => animShot(Object.assign({ k: 'shot', hit: true }, ev)),
    setState(obj, opts) {
      clearTimers(); clearFx(); clearToasts();
      live = false; busy = false; sel = -1; pend = null; overFired = null; acting = null;
      S = obj;
      closeAllSheets();
      $('#overlay-win').classList.add('hidden');
      $('#screen-menu').classList.add('hidden');
      $('#screen-game').classList.add('on');
      renderAll();
      if (opts && opts.live) { live = true; afterChange(); }
      return S;
    },
  };
  window.INFIL_UI = UI;

  document.addEventListener('DOMContentLoaded', () => {
    loadCfg(); renderCfg(); bind();
    if (!tryRestore()) renderAll();
  });
})();
