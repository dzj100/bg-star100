/* ============================================================
   渗透因子 · 联机模式 界面 + 演出（render_ol.js）
   与单机版 render.js 的分工相同，但：
   - 无 AI：桌面区右上换成「玩家区」——每人一块夜枭区式面板（名字 / 手牌张数 / 盯梢位 / 两行情报区 / 回合灯）
     自己的盯梢目标正面可见（只有本机能看到），他人的为牌背 '?'
   - 五种行动人人可用：盯梢 / 情报 / 通讯 / 潜伏 / 铲除（情报打给自己目标，通讯打给队友目标）
   - 铲除只能指认他人盯梢的目标（自己的目标不可铲除）
   - 多目标行动（通讯 / 铲除 / 推论）由发起者在抽屉里选择目标
   - 不写任何单机 localStorage；状态权威 = 房主/行动方推送的房间行（online.js 负责收发）
   演出分级、震屏、顿帧、印章等手感与单机一致（game-feel 分级不变）
   ============================================================ */
'use strict';
(function () {
  const G = window.INFIL_OL;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let S = null, live = false, busy = false, fxOn = true;
  let mySeat = -1;                     // 本机座位（online.js 通过 setSeat 注入）
  let roomCode = '';
  let sel = -1;                        // 选中的手牌下标
  let pend = null;                     // 演出期间点下的手牌，收尾重放
  let acting = null;                   // 演出期间的显示行动座位（null 跟随 S.turnSeat）
  let intelSeat = -1, boardSeat = -1;  // 抽屉当前目标
  let pickC = -1, pickN = -1, pickT = -1, pickIdx = -1;   // 铲除 / 目标选择
  let autoHold = false;
  let overKey = null;
  let lastIntroId = null, introTimer = null;
  let lastHands = [];                  // 手牌张数变化时的轻弹提示

  const timers = [];
  const sleep = ms => new Promise(r => timers.push(setTimeout(r, ms)));
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

  const myOf = () => (mySeat >= 0 ? mySeat : 0);
  const seatName = seat => (S && S.seats[seat] ? S.seats[seat].name : '座位 ' + (seat + 1));

  /* 行动键 → 中文标签（房间快照里 _act 是英文键，横幅展示用） */
  const ACT_LABEL = { stake: '盯梢', intel: '情报', comm: '通讯', lurk: '潜伏', elim: '铲除', draw: '摸牌', pick: '拾牌', skip: '跳过' };

  /* 演出期间点下的手牌：收下最后一次，收尾若仍轮到自己且手牌未变则采纳 */
  function drainPending() {
    const p = pend; pend = null;
    if (!p || !live || !S || S.over || busy || S.pending || S.turnSeat !== myOf()) return;
    if (p.hand !== S.hands[myOf()].join(',')) return;
    if (p.idx < 0 || p.idx >= S.hands[myOf()].length) return;
    sel = p.idx;
    renderAll();
  }

  /* ---------------- 屏幕震动：trauma 衰减 + sin 采样 ---------------- */
  let trauma = 0, shakeT = 0, shakeOn = false;
  function shakeAdd(a) {
    trauma = Math.min(1, trauma + a);
    if (!shakeOn) {
      shakeOn = true;
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
  const fxWaits = [];
  let fxClock = 0, fxRunning = false, fxHold = 0;
  const easeOutCubic = p => 1 - Math.pow(1 - p, 3);
  const easeBack = p => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const easeOutQuint = p => 1 - Math.pow(1 - p, 5);

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
      /* 等待到点即各自兑现：横幅 / 印章等收尾补间会活到 1 秒开外，
         若攒到「整层空闲」才统一放行，后面的 await（亮牌、盖章）会被硬拖到淡出之后 */
      for (let i = fxWaits.length - 1; i >= 0; i--) {
        if (fxClock >= fxWaits[i].end) fxWaits.splice(i, 1)[0].res();
      }
      if (fxWaits.length || alive || fxHold > 0) requestAnimationFrame(loop);
      else { fxRunning = false; fxTweens.length = 0; }
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
    fxWaits.splice(0).forEach(w => w.res());
    fxRunning = false;
    killFz = null;
    trauma = 0; $('#screen-game').style.transform = ''; $('#screen-game').style.willChange = '';
  }
  const rectOf = el => el ? el.getBoundingClientRect() : null;
  const centerOf = el => { const r = rectOf(el); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 }; };
  const localPt = el => { const r = rectOf(el); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };

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
  /* 到点隐没：不透明度钉到 0 再下一帧移除（收尾不回闪） */
  function vanish(el, t, dur) {
    const at = (t || 0) + (dur || 120);
    tween({ t: at, dur: 1, upd() { el.style.opacity = '0'; } });
    tween({ t: at + 1, dur: 1, upd() { el.remove(); } });
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
  /* 玩家区紧凑迷你牌：与飞出/飞入克隆同尺寸（--pwc/--pch 由 #players、#fx 共享） */
  const microHtml = (id, cls) => cardHtml(id, 'micro' + (cls ? ' ' + cls : ''));
  const microBox = () => {
    const cs = getComputedStyle($('#players'));
    return { w: parseFloat(cs.getPropertyValue('--pwc')) || 22, h: parseFloat(cs.getPropertyValue('--pch')) || 30 };
  };
  /* 盯梢位牌面与弃牌堆同档（--mwc×--mch）：飞出克隆读同一对值，落点尺寸才严丝合缝 */
  const miniBox = () => {
    const cs = getComputedStyle($('#players'));
    return { w: parseFloat(cs.getPropertyValue('--mwc')) || 34, h: parseFloat(cs.getPropertyValue('--mch')) || 47 };
  };
  const cardBack = cls => '<div class="card ' + (cls || '') + ' facedown"></div>';

  const cfgReadHtml = function (cfg, n) {
    const d = G.difficultyOf(cfg, n), bul = G.bulletsOf(G.normCfg(cfg));
    return '牌库 <b>' + d.deck + '</b> 张 · 叛徒 <b>' + cfg.traitors + '</b> 名 · 子弹 <b>' + bul + '</b> 发 · ' +
      '<span class="tag-diff tag-' + d.tag + '">' + d.tag + '</span>';
  };

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
    const tv = acting == null ? S.turnSeat : acting;
    const mine = tv === myOf();
    const turn = $('#turnsign');
    turn.className = 'c' + (mine ? 0 : 1);
    turn.textContent = S.over ? '任务结束'
      : (mine ? '你的回合 · 第 ' + S.round + ' 轮' : esc(seatName(tv)) + ' 的回合 · 第 ' + S.round + ' 轮');
    const alert = $('#alertbar');
    alert.classList.toggle('over', !!S.over);
    if (S.over) {
      alert.classList.remove('hidden');
      alert.classList.remove('turn-ai');
      alert.textContent = '任务结束 · 点这里查看结算';
    } else if (left > 0 && S.bullets <= left) {
      alert.classList.remove('hidden');
      alert.classList.remove('turn-ai');
      alert.textContent = '⚠ 弹药告急：剩 ' + left + ' 名叛徒 > ' + Math.max(0, S.bullets) + ' 发子弹 —— 再落空就完了';
    } else if (S.pending && S.pendingSeat !== myOf()) {
      alert.classList.remove('hidden');
      alert.classList.add('turn-ai');
      alert.textContent = esc(seatName(S.pendingSeat)) + (S.pending === 'draw' ? ' 正在决定是否摸牌…' : ' 正在拾取战利品…');
    } else if (!mine) {
      alert.classList.remove('hidden');
      alert.classList.add('turn-ai');
      alert.textContent = '等待 ' + esc(seatName(tv)) + ' 行动…';
    } else {
      alert.classList.add('hidden');
      alert.classList.remove('turn-ai');
    }
  }

  /* 玩家区：每人一行紧凑三栏（左=昵称+手牌张数 / 中=盯梢位 / 右=有关·无关两行）
     差异：自己的盯梢目标正面可见（只有本机能看到），他人的仍为牌背 '?' */
  function renderPlayers() {
    const tv = acting == null ? S.turnSeat : acting;
    const my = myOf();
    $('#players').innerHTML = S.seats.map((st, i) => {
      const me = i === my;
      const watch = S.watches[i];
      const hasWatch = watch != null;
      const z = S.intel[i] || { rel: [], unrel: [] };
      const on = !S.over && tv === i;
      const deciding = !S.over && S.pending && S.pendingSeat === i;
      const slotBody = !hasWatch ? '' :
        (me ? miniHtml(watch) : '<span class="watch-back">?</span>');
      const zone = (key, label, cls) =>
        '<button class="intel-row" data-seat="' + i + '" data-zone="' + key + '" title="' +
          (me ? '你' : esc(st.name)) + ' 的' + label + '情报（公开区）">' +
          '<span class="stamp ' + cls + '">' + label + '</span>' +
          '<span class="intel-cards" data-seat="' + i + '" data-zone="' + key + '">' + z[key].map(id => microHtml(id)).join('') + '</span>' +
          '<span class="intel-n">' + z[key].length + '</span>' +
        '</button>';
      return '<div class="pl-row' + (me ? ' me' : '') + (on ? ' on' : '') + '" data-seat="' + i + '">' +
        '<i class="turn-lamp' + (on ? ' on' : '') + '" title="' + (on ? '当前行动方' : '') + '"></i>' +
        '<div class="pl-left">' +
          '<span class="pl-id">' +
            '<b class="pl-name">' + esc(st.name) + '</b>' +
            (me ? '<i class="pl-you">你</i>' : '') +
            (deciding ? '<i class="pl-pending">决策中</i>' : '') +
          '</span>' +
          '<span class="ai-hand pl-hand" data-seat="' + i + '" title="手牌张数（内容隐藏）"><i></i><b>' + S.hands[i].length + '</b></span>' +
        '</div>' +
        '<div class="pl-mid">' +
          '<span class="ai-role">盯梢</span>' +
          '<button class="watch pl-watch' + (hasWatch ? ' set' : '') + (me && hasWatch ? ' mine' : '') + '" data-seat="' + i + '" ' +
            'title="' + (me ? '你的盯梢目标' + (hasWatch ? '（只有你能看到内容）' : '') : esc(st.name) + ' 的盯梢目标（内容保密）') + '">' +
            slotBody +
            '<span class="watch-tag">' + (hasWatch ? '已布控' : '待布控') + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="pl-right">' + zone('rel', '有关', 'rel') + zone('unrel', '无关', 'unrel') + '</div>' +
      '</div>';
    }).join('');
    /* 情报卡条滚到最右（最新一张可见）+ 手牌张数变化的轻弹 */
    $$('#players .intel-cards').forEach(el => { el.scrollLeft = el.scrollWidth; });
    S.seats.forEach((st, i) => {
      const n = S.hands[i].length;
      if (lastHands[i] != null && lastHands[i] !== n) {
        const chip = $('#players .pl-hand[data-seat="' + i + '"]');
        if (chip) { chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop'); }
      }
      lastHands[i] = n;
    });
  }

  function fitHand() {
    const hand = $('#hand');
    hand.classList.remove('fit');
    hand.style.removeProperty('--hs');
    const n = hand.children.length, first = hand.firstElementChild;
    if (n < 2 || !first || !hand.clientWidth) return;
    const gap = parseFloat(getComputedStyle(hand).columnGap) || 0;
    const need = n * first.offsetWidth + (n - 1) * gap;
    if (need > hand.clientWidth) {
      hand.classList.add('fit');
      hand.style.setProperty('--hs', Math.max(.6, hand.clientWidth / need).toFixed(3));
    }
  }
  function renderHand() {
    const my = myOf();
    const acts = G.legal(S, my);
    const can = S.turnSeat === my && !S.over && !busy && !S.pending;
    $('#hand').innerHTML = S.hands[my].map((id, i) =>
      cardHtml(id, (i === sel ? 'pick ' : '') + (can && (acts.intel || acts.comm) ? '' : 'dead'))).join('');
    $('#handtip').classList.toggle('hidden', !(can && (acts.intel || acts.comm)) || sel >= 0);
    fitHand();
  }
  function renderAct() {
    const my = myOf();
    const acts = G.legal(S, my);
    const can = S.turnSeat === my && !S.over && !busy && !S.pending;
    const bs = $('#btnStake'), bi = $('#btnIntel'), bc = $('#btnComm'), bl = $('#btnLurk'), be = $('#btnElim');
    bs.disabled = !can || !acts.stake;
    bi.disabled = !can || !acts.intel;
    bc.disabled = !can || !acts.comm;
    bl.disabled = !can || acts.lurkMax <= 0;
    be.disabled = !can || !acts.eliminate;
    bi.classList.toggle('on', can && sel >= 0 && acts.intel);
    bc.classList.toggle('on', can && sel >= 0 && acts.comm);
    bs.querySelector('span').textContent =
      acts.stake ? '布控后暗弃1' : (S.watches[my] != null ? '已有目标' : '叛徒区已空');
    bi.querySelector('span').textContent =
      acts.intel ? '打给自己目标' : (S.watches[my] == null ? '需先盯梢' : '手牌已空');
    bc.querySelector('span').textContent =
      acts.comm ? '打给队友目标' : (S.hands[my].length ? '队友暂无目标' : '手牌已空');
    bl.querySelector('span').textContent =
      acts.lurkMax > 0 ? '摸牌并暗弃 1' :
        (S.hands[my].length >= G.HAND_MAX ? '手牌已满' : '牌库不足');
    be.querySelector('span').textContent =
      acts.eliminate ? '剩' + Math.max(0, S.bullets) + '发' :
        (S.watches[myOf()] != null && G.watchSeats(S).length === 1 ? '只有你的目标' : '暂无队友目标');
  }
  function renderNote() {
    const last = S.log.length ? S.log[S.log.length - 1] : null;
    $('#nbText').textContent = last ? last.text : '任务开始';
  }
  function renderRoom() {
    $('#tbRoom').textContent = roomCode ? '房间 ' + roomCode + ' · ' + (S ? S.n + ' 人' : '') : '联机';
  }
  function renderAll() {
    if (!S) return;
    renderTop(); renderPlayers(); renderHand(); renderAct(); renderNote(); renderRoom();
    reapplyKillFz();
  }

  /* ---------------- 吐司 ---------------- */
  function toast(msg) {
    const wrap = $('#toasts');
    let el = wrap.lastElementChild;
    if (el && el.dataset.msg === msg) {
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

  /* ---------------- 行动：本机（行动方即权威） ---------------- */
  async function doAct(a) {
    if (!S || S.over || busy) return { ok: false };
    const my = myOf();
    if (S.turnSeat !== my) return { ok: false };
    const isReward = a.act === 'pick' || a.act === 'skip';
    const isDraw = a.act === 'draw';
    if (isReward ? (S.pending !== 'reward' || S.pendingSeat !== my)
      : isDraw ? (S.pending !== 'draw' || S.pendingSeat !== my)
        : !!S.pending) return { ok: false };
    busy = true; acting = my; renderAll();
    let r;
    if (a.act === 'stake') r = G.stake(S, my);
    else if (a.act === 'intel') r = G.intel(S, my, a.idx);
    else if (a.act === 'comm') r = G.comm(S, my, a.idx, a.target);
    else if (a.act === 'lurk') r = G.lurk(S, my, a.k);
    else if (a.act === 'elim') r = G.eliminate(S, my, a.target, a.c, a.n);
    else if (a.act === 'draw') r = G.drawPick(S, my, a.take);
    else if (a.act === 'pick') r = G.rewardPick(S, my, a.pile, a.idx);
    else if (a.act === 'skip') r = G.rewardSkip(S, my);
    if (!r || !r.ok) { busy = false; acting = null; renderAll(); return { ok: false }; }
    sel = -1;
    closeAllSheets();
    /* 命中事件带 reveal：此刻 DOM 还是行动前画面，先冻结目标座位的盯梢牌与情报区 */
    if (fxOn) { const rv = r.evs.find(e => e.k === 'reveal'); if (rv) freezeKill(rv.seat); }
    pushLocal(a.act, r.evs);          // 上报房间：先推送再演出（他人即时跟上，刷新不丢步）
    await playEvs(r.evs);
    acting = null;
    renderAll();
    busy = false;
    drainPending();
    afterChange();
    return r;
  }
  function pushLocal(act, evs) {
    if (typeof window.onlinePushState === 'function') window.onlinePushState(act, evs);
  }
  function afterChange() {
    if (!live || !S) return;
    if (S.over) { showOver(); return; }
    if (S.pending === 'reward' && S.pendingSeat === myOf()) { openReward(); return; }
    if (S.pending === 'draw' && S.pendingSeat === myOf()) { openDraw(); return; }
    renderAll();
  }

  function actStake() {
    if (!S || S.over || busy) return;
    if (!G.legal(S, myOf()).stake) { toast(S.watches[myOf()] != null ? '你已经有盯梢目标了' : '叛徒区已空'); return; }
    doAct({ act: 'stake' });
  }
  function actIntel() {
    if (!S || S.over || busy) return;
    if (sel < 0) { toast('先选中一张手牌再【情报】'); return; }
    doAct({ act: 'intel', idx: sel });
  }
  function actComm() {
    if (!S || S.over || busy) return;
    const acts = G.legal(S, myOf());
    if (!acts.comm) { toast(S.hands[myOf()].length ? '队友都还没有盯梢目标' : '手牌已空'); return; }
    if (sel < 0) { toast('先选中一张手牌再【通讯】'); return; }
    if (acts.commTargets.length === 1) { doAct({ act: 'comm', idx: sel, target: acts.commTargets[0] }); return; }
    pickIdx = sel;
    openPick('comm');
  }
  function openLurk() {
    if (!S || S.over || busy) return;
    if (S.deck.length < 2) { toast(S.deck.length ? '牌库不足，无法潜伏' : '牌库已空，无法潜伏'); return; }
    const max = G.legal(S, myOf()).lurkMax;
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
  /* 通用目标选择抽屉（通讯等多目标行动） */
  function openPick(kind) {
    const acts = G.legal(S, myOf());
    const list = kind === 'comm' ? acts.commTargets : acts.elimTargets;
    if (!list.length) { toast('现在没有可选目标'); return; }
    $('#pickTitleTxt').textContent = '通讯 · 选择目标';
    $('#pickSub').textContent = '打出 1 张手牌，判定结果计入所选玩家的盯梢情报区';
    $('#pickList').innerHTML = list.map(i =>
      '<button class="pick-row" data-seat="' + i + '">' +
        '<b>' + esc(seatName(i)) + '</b><span>已布控 1 名目标（内容保密）</span>' +
      '</button>').join('');
    $('#pickMask').classList.remove('hidden');
  }
  function openElim() {
    if (!S || S.over || busy) return;
    const acts = G.legal(S, myOf());
    if (!acts.eliminate) {
      toast(G.watchSeats(S).length ? '只能铲除其他队友盯梢的目标' : '场上还没有盯梢目标');
      return;
    }
    pickT = acts.elimTargets.length === 1 ? acts.elimTargets[0] : -1;
    pickC = -1; pickN = -1;
    renderPick();
    $('#elimMask').classList.remove('hidden');
  }
  function renderPick() {
    const acts = G.legal(S, myOf());
    $('#elimTargets').innerHTML = acts.elimTargets.map(i =>
      '<button class="tchip' + (pickT === i ? ' on' : '') + '" data-seat="' + i + '">' +
        esc(seatName(i)) + '目标</button>').join('') ||
      '<span class="zone-empty">场上没有可铲除的盯梢目标</span>';
    const cols = [];
    for (let c = 0; c < S.cfg.colors; c++) {
      cols.push('<button class="pc c' + c + (pickC === c ? ' on' : '') + '" data-c="' + c + '">' +
        '<small>' + G.GLYPH[c] + '</small>' + G.COLORS[c] + '</button>');
    }
    $('#pickColors').innerHTML = cols.join('');
    const nums = [];
    for (let n = S.cfg.one ? 1 : 2; n <= 15; n++) nums.push('<button class="pn' + (pickN === n ? ' on' : '') + '" data-n="' + n + '">' + n + '</button>');
    $('#pickNums').innerHTML = nums.join('');
    const ok = pickT >= 0 && pickC >= 0 && pickN > 0;
    $('#pickState').innerHTML = ok
      ? '指认：<b>' + esc(seatName(pickT)) + '的目标 ' + G.COLORS[pickC] + ' ' + pickN + '</b> · 消耗 1 发（剩 ' + S.bullets + ' → ' + (S.bullets - 1) + '）'
      : '未选择 · 剩 ' + S.bullets + ' 发 · 未铲除 ' + G.traitorsLeft(S) + ' 名';
    $('#btnFire').disabled = !ok;
  }
  function fireElim() {
    if (pickT < 0 || pickC < 0 || pickN <= 0) return;
    $('#elimMask').classList.add('hidden');
    doAct({ act: 'elim', target: pickT, c: pickC, n: pickN });
  }

  /* ---------------- 演出：事件流 ---------------- */
  async function playEvs(evs) {
    for (const ev of evs || []) {
      renderAll();
      await animEv(ev);
    }
    clearKillFz();
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
  const watchEl = seat => $('#players .pl-watch[data-seat="' + seat + '"]');
  const handEl = seat => (seat === myOf() ? $('#hand') : $('#players .pl-hand[data-seat="' + seat + '"]'));
  const chipEl = (seat, zone) => $('#players .intel-cards[data-seat="' + seat + '"][data-zone="' + zone + '"]');

  /* 铲除命中的「先揭示、后清空」：房间状态是整盘一次到位，直接重绘会让盯梢的叛徒牌在枪响前先消失。
     命中瞬间把目标座位的盯梢牌与两行情报区冻结成 DOM 快照，每次重绘后原样贴回；
     揭示时放行盯梢牌（让位给翻出的大牌），清扫时放行情报区（卡片从原处飞入明弃堆），事件收尾整体解冻 */
  let killFz = null;
  function freezeKill(seat) {
    const w = watchEl(seat);
    const row = z => { const c = chipEl(seat, z); return c ? c.closest('.intel-row') : null; };
    const rel = row('rel'), unrel = row('unrel');
    killFz = {
      seat,
      watchHTML: w ? w.innerHTML : null, watchCls: w ? w.className : null,
      relHTML: rel ? rel.innerHTML : null, unrelHTML: unrel ? unrel.innerHTML : null,
    };
  }
  function reapplyKillFz() {
    if (!killFz) return;
    const w = watchEl(killFz.seat);
    if (w && killFz.watchHTML != null) { w.innerHTML = killFz.watchHTML; w.className = killFz.watchCls; }
    [['rel', 'relHTML'], ['unrel', 'unrelHTML']].forEach(pair => {
      if (killFz[pair[1]] == null) return;
      const c = chipEl(killFz.seat, pair[0]);
      const r = c ? c.closest('.intel-row') : null;
      if (!r) return;
      r.innerHTML = killFz[pair[1]];
      const ic = r.querySelector('.intel-cards');
      if (ic) ic.scrollLeft = ic.scrollWidth;      // 复原后滚回最右：最新一张仍在视野里
    });
  }
  function unfreezeKillWatch() { if (killFz) { killFz.watchHTML = null; killFz.watchCls = null; } }
  function unfreezeKillIntel() { if (killFz) { killFz.relHTML = null; killFz.unrelHTML = null; } }
  function clearKillFz() { killFz = null; }

  async function animStake(ev) {
    const mine = ev.seat === myOf();
    const rect = localPt(watchEl(ev.seat));
    const box = rect ? { w: rect.w, h: rect.h } : miniBox();
    const to = rect || { x: innerWidth / 2, y: 120, w: box.w, h: box.h };
    const from = localPt($('#pileTrait')) || to;
    const sx = from.x + from.w / 2 - box.w / 2, sy = from.y + from.h / 2 - box.h / 2;
    const gx = to.x + to.w / 2 - box.w / 2, gy = to.y + to.h / 2 - box.h / 2;
    const el = spawn(mine && ev.card != null ? cardHtml(ev.card, 'mini') : cardBack('mini'), 'fxc-c',
      { x: sx, y: sy }, { w: box.w, h: box.h });
    if (!mine) {
      const q = spawn('<div class="qmark">?</div>', '', { x: to.x + to.w / 2 - 8, y: to.y - 2 });
      q.style.opacity = '0';
      tween({ t: 330, dur: 460, ease: easeOutCubic, upd(p) {
        q.style.opacity = (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75).toFixed(2);
        q.style.transform = 'translate(0,' + (-16 * p).toFixed(1) + 'px)';
      } });
      vanish(q, 800, 1);
    }
    $('#pileTrait').classList.remove('hot'); void $('#pileTrait').offsetWidth; $('#pileTrait').classList.add('hot');
    fly(el, { x: 0, y: 0 }, { x: gx - sx, y: gy - sy }, 420, { ease: easeOutCubic, lift: 26, r0: -14, r1: 0 });
    hitStop(35);
    await fxRunUntil(fxClock + 460);
    vanish(el, 400, 120);
    ringAt({ x: to.x + to.w / 2, y: to.y + to.h / 2 }, 40);
    // floatAt({ x: to.x + to.w / 2, y: to.y - 6 },
    //   mine ? (ev.card != null ? '你的目标 · ' + G.cardName(ev.card) : '你的目标') : esc(seatName(ev.seat)) + ' 的目标',
    //   mine ? '' : 'dim');
    await sleep(160);
  }
  async function animPlay(ev) {
    const card = ev.card, zone = ev.zone === 'rel' ? 'rel' : 'unrel';
    const row = chipEl(ev.to, zone);
    /* 目标 = 区域里已渲染的最后一张牌（刚打出的这张）：占位牌先隐，飞行牌落位再亮 */
    const cells = row ? row.querySelectorAll('.card') : [];
    const targetEl = cells[cells.length - 1];
    const box = microBox();
    const to = localPt(targetEl) || localPt(row) || { x: innerWidth / 2, y: 220, w: box.w, h: box.h };
    const srcEl = ev.seat === myOf() ? $('#hand') : handEl(ev.seat);
    const from = localPt(srcEl) || { x: innerWidth / 2, y: innerHeight - 140, w: 56, h: 78 };
    const el = spawn(cardHtml(card, 'micro'), '', { x: to.x, y: to.y }, { w: to.w, h: to.h });
    el.style.left = from.x + from.w / 2 - to.w / 2 + 'px';
    el.style.top = from.y + from.h / 2 - to.h / 2 + 'px';
    if (targetEl) targetEl.style.visibility = 'hidden';
    const tx = to.x - (from.x + from.w / 2 - to.w / 2);
    const ty = to.y - (from.y + from.h / 2 - to.h / 2);
    tween({
      dur: 380, ease: easeOutCubic,
      upd(p) {
        el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 20 * Math.sin(Math.PI * p)).toFixed(1) + 'px)' +
          ' scale(' + (1 + 0.25 * Math.sin(Math.PI * p)).toFixed(3) + ') rotate(' + (-10 + 10 * p).toFixed(1) + 'deg)';
        el.style.opacity = (0.35 + 0.65 * Math.min(1, p * 2)).toFixed(2);
      },
    });
    await fxRunUntil(fxClock + 390);
    el.remove();
    if (targetEl) targetEl.style.visibility = '';
    const pt = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    stampAt(pt, zone === 'rel' ? '有关' : '无关', zone, true);
    shakeAdd(zone === 'rel' ? 0.24 : 0.3);
    floatAt({ x: pt.x, y: pt.y + 20 }, (zone === 'rel' ? '同色/同数/倍数' : '完全无关'), 'dim');
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
  /* 新手牌先隐形占位（保留布局故牌格坐标可作飞行落点），落点到位再亮牌 */
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
    const mine = ev.to === myOf();
    const to = mine ? localPt($('#hand')) : localPt(handEl(ev.to));
    if (!from || !to) return;
    const cards = ev.cards || [];
    const slots = mine ? hideHandTail(cards) : [];
    $('#pileDeck').classList.remove('hot'); void $('#pileDeck').offsetWidth; $('#pileDeck').classList.add('hot');
    const n = Math.min(3, cards.length || 1);
    for (let i = 0; i < n; i++) {
      const html = (mine && cards[i] != null) ? cardHtml(cards[i], 'mini') : cardBack('');
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
    burst(centerOf(mine ? $('#hand') : handEl(ev.to)), 5, 'spark', 30);
    await sleep(140);
  }
  async function animShot(ev) {
    const slot = localPt(watchEl(ev.target));
    const aim = slot ? { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 } : { x: innerWidth / 2, y: 140 };
    const gun = spawn('<div class="pistolFx">' + $('#gunbar .gun svg').outerHTML + '</div>', '', { x: innerWidth / 2 - 22, y: innerHeight + 20 });
    const gEnd = { x: innerWidth / 2 - 22, y: innerHeight - 190 };
    const gy = gEnd.y - (innerHeight + 20);
    fly(gun, { x: 0, y: 0 }, { x: 0, y: gy }, 280, { ease: easeOutCubic, r0: 0, r1: 0 });
    await fxRunUntil(fxClock + 290);
    const gc = { x: gEnd.x + 22, y: gEnd.y + 15 };
    const aimDeg = Math.atan2(aim.y - gc.y, aim.x - gc.x) * 180 / Math.PI;
    const rad = aimDeg * Math.PI / 180, cosA = Math.cos(rad), sinA = Math.sin(rad);
    tween({ dur: 80, ease: easeOutCubic, upd(p) { gun.style.transform = 'translate(0px,' + gy.toFixed(1) + 'px) rotate(' + (aimDeg * p).toFixed(1) + 'deg)'; } });
    await fxRunUntil(fxClock + 90);
    const muzzle = { x: gc.x + 15.4 * cosA + 7.3 * sinA, y: gc.y + 15.4 * sinA - 7.3 * cosA };
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
    const sh = spawn('', 'shell', { x: muzzle.x - 6, y: muzzle.y - 6 });
    fly(sh, { x: 0, y: 0 }, { x: 54 + Math.random() * 22, y: 74 }, 520, { ease: easeOutCubic, r0: 0, r1: 320, fadeOut: true });
    vanish(sh, 0, 540);
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
    const pips = $('#pips').querySelectorAll('i:not(.spent)');
    if (pips.length) { const last = pips[pips.length - 1]; last.classList.add('spent'); last.style.animation = 'none'; }
    $('#bcount').textContent = Math.max(0, S.bullets);
    await sleep(120);
  }
  async function animReveal(ev) {
    /* 揭示：盯梢位的小牌到这一刻才让位给翻出的大牌（此前靠冻结顶住，枪响时叛徒还在场） */
    unfreezeKillWatch(); renderAll();
    const slot = localPt(watchEl(ev.seat)) || { x: innerWidth / 2, y: 120, w: 30, h: 42 };
    const el = spawn(cardHtml(ev.card, ''), '', { x: slot.x + slot.w / 2 - 28, y: slot.y + slot.h / 2 - 39 }, { w: 56, h: 78 });
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
    const cards = ev.cards || [];
    const seat = ev.seat == null ? myOf() : ev.seat;
    /* 冻结中的情报区还在场：先按每张卡的原位拍快照，解冻重绘后再从原位飞入明弃堆 */
    const snap = [];
    for (const z of ['rel', 'unrel']) {
      const row = chipEl(seat, z);
      if (!row) continue;
      for (const c of row.querySelectorAll('.card')) {
        const r = localPt(c);
        if (r) snap.push({ html: c.outerHTML, x: r.x, y: r.y });
      }
    }
    unfreezeKillIntel(); renderAll();
    const box = microBox();
    const src = localPt(chipEl(seat, 'rel')) || localPt(chipEl(seat, 'unrel')) || localPt($('#players')) || { x: innerWidth / 2, y: 220, w: 60, h: 20 };
    const list = snap.length ? snap : cards.map(id => ({ html: microHtml(id), x: src.x, y: src.y }));
    for (let i = 0; i < list.length; i++) {
      const el = spawn(list[i].html, '', { x: list[i].x, y: list[i].y }, { w: box.w, h: box.h });
      const r = localPt(el) || src;
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
    if (list.length) { $('#pileUp').classList.remove('hot'); void $('#pileUp').offsetWidth; $('#pileUp').classList.add('hot'); }
    await fxRunUntil(fxClock + 320 + list.length * 45);
    burst(centerOf($('#pileUp')), 6, 'spark', 30);
    await sleep(140);
  }
  async function animBack(ev) {
    const up = localPt($('#pileDeck'));
    const from = localPt(chipEl(ev.seat, 'rel')) || { x: innerWidth / 2, y: 120, w: 30, h: 42 };
    const box = microBox();
    const sx = from.x + from.w / 2 - box.w / 2, sy = from.y + from.h / 2 - box.h / 2;
    const gx = (up ? up.x + up.w / 2 : innerWidth - 80) - box.w / 2;
    const gy = (up ? up.y + up.h / 2 : 60) - box.h / 2;
    const el = spawn(cardHtml(ev.card, 'micro'), '', { x: sx, y: sy }, { w: box.w, h: box.h });
    tween({ dur: 400, ease: easeOutCubic, upd(p) { el.style.transform = 'translate(' + ((gx - sx) * p).toFixed(1) + 'px,' + ((gy - sy) * p - 30 * Math.sin(Math.PI * p)).toFixed(1) + 'px) rotate(' + (360 * p).toFixed(0) + 'deg) scale(' + (1 - 0.35 * p).toFixed(2) + ')'; el.style.opacity = p > 0.85 ? ((1 - p) / 0.15).toFixed(2) : 1; } });
    await fxRunUntil(fxClock + 410);
    vanish(el, 0, 60);
    $('#pileDeck').classList.remove('hot'); void $('#pileDeck').offsetWidth; $('#pileDeck').classList.add('hot');
    bannerAt('重新加入牌库', 'back');
    await sleep(320);
  }
  async function animPick(ev) {
    const seat = ev.seat == null ? myOf() : ev.seat;
    const mine = seat === myOf();
    /* 落点跟随拾牌人：自己 → 手牌；他人 → 其座位的手牌叠（曾写死 #hand，他人拾牌会飞进自己手里） */
    const targetEl = handEl(seat);
    const hand = localPt(targetEl);
    const src = ev.from === 'up' ? localPt($('#pileUp')) : localPt($('#pileDown'));
    if (!hand || !src) return;
    const slot = mine ? (hideHandTail(ev.card != null ? [ev.card] : [])[0] || null) : null;
    /* 明弃堆拾取是公开信息（日志带牌名）→ 露牌面；暗弃盲抽对他方只露牌背 */
    const face = mine || ev.from === 'up';
    const el = spawn(face ? cardHtml(ev.card, 'mini') : cardBack('mini'), '', { x: src.x + src.w / 2 - 17, y: src.y + src.h / 2 - 23 }, { w: 34, h: 47 });
    const hit = slot ? localPt(slot) : null;
    const cx = hit ? hit.x + hit.w / 2 : hand.x + hand.w / 2;
    const cy = hit ? hit.y + hit.h / 2 : hand.y + hand.h / 2;
    const tx = cx - 17 - (src.x + src.w / 2 - 17);
    const ty = cy - 23 - (src.y + src.h / 2 - 23);
    tween({ dur: 340, ease: easeOutCubic, upd(p) { el.style.transform = 'translate(' + (tx * p).toFixed(1) + 'px,' + (ty * p - 24 * Math.sin(Math.PI * p)).toFixed(1) + 'px) scale(' + (1 + 0.3 * p).toFixed(2) + ')'; el.style.opacity = p < 0.12 ? (p / 0.12).toFixed(2) : (p > 0.8 ? ((1 - p) / 0.2).toFixed(2) : 1); } });
    tween({ t: 340, dur: 1, upd() { if (slot) { slot.classList.remove('incoming'); slot.classList.add('arrive'); } } });
    await fxRunUntil(fxClock + 350);
    vanish(el, 0, 60);
    burst(centerOf(targetEl), 5, 'spark', 26);
    await sleep(140);
  }

  /* ---------------- 抽屉 ---------------- */
  const cdot = c => '<i class="cdot" style="background:var(--c' + c + ')"></i>';
  /* 叛徒信息：盯梢区只有自己的目标正面可见（其他按持有者署名 + 牌背），结算后翻开真相 */
  function openTraitor() {
    const watches = [];
    S.watches.forEach((w, i) => { if (w != null) watches.push({ by: i === myOf() ? '你' : seatName(i), card: w, mine: i === myOf() }); });
    const caught = S.caughtCards && S.caughtCards.length === S.caught ? S.caughtCards : S.deck.slice(0, S.caught);
    const over = !!S.over;
    $('#traitSub').textContent = over ? '任务已结束 · 叛徒信息公开' : '执行任务中 · 只有你自己的盯梢目标可见';
    $('#tPileN').textContent = S.traitorPile.length + ' 名';
    $('#tWatchN').textContent = watches.length + ' 名';
    $('#tCaughtN').textContent = caught.length + ' 名';
    $('#tPileCards').innerHTML = zoneCards(S.traitorPile.map(card => ({ card })), over);
    $('#tWatchCards').innerHTML = zoneCards(watches, over);
    $('#tCaughtCards').innerHTML = zoneCards(caught.map(card => ({ card })), true);
    $('#traitorMask').classList.remove('hidden');
  }
  function zoneCards(items, faceUp) {
    if (!items.length) return '<div class="zone-empty">暂无</div>';
    return items.map(it => '<span class="zcell">' +
      (it.by ? '<i class="wtag">' + esc(it.by) + '</i>' : '') +
      (faceUp || it.mine ? cardHtml(it.card, 'mini') : cardBack('mini')) + '</span>').join('');
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
  /* 情报区明细：按玩家查看（公开区，含判定结果） */
  function openIntel(seat, zone) {
    intelSeat = seat == null ? intelSeat : seat;
    if (intelSeat < 0 || intelSeat >= S.n) intelSeat = myOf();
    const z = S.intel[intelSeat];
    $('#intelSub').textContent = (intelSeat === myOf() ? '你' : esc(seatName(intelSeat))) + ' 的盯梢目标情报（公开区）';
    const block = (rel) => {
      const ids = rel ? z.rel : z.unrel;
      return '<div class="zone-block"><div class="pick-title">' +
        '<span class="stamp ' + (rel ? 'rel' : 'unrel') + '">' + (rel ? '有关' : '无关') + '</span>' +
        '<span>' + ids.length + ' 张</span></div>' +
        (ids.length ? '<div class="zone-cards">' + ids.map(id => cardHtml(id, 'mini')).join('') + '</div>' : '<div class="zone-empty">暂无</div>') +
        '</div>';
    };
    $('#intelBody').innerHTML = block(true) + block(false);
    $('#intelMask').classList.remove('hidden');
  }
  /* 推论板：先选分析谁的盯梢目标（多目标时由发起者选择） */
  function openBoard() {
    const watched = G.watchSeats(S);
    if (!watched.includes(boardSeat)) boardSeat = watched.length ? watched[0] : -1;
    const chips = watched.length ? watched.map(i =>
      '<button class="tchip' + (boardSeat === i ? ' on' : '') + '" data-seat="' + i + '">' +
        (i === myOf() ? '你的目标' : esc(seatName(i)) + '的目标') + '</button>').join('')
      : '<span class="zone-empty">场上还没有盯梢目标</span>';
    $('#boardTargets').innerHTML = chips;
    if (boardSeat < 0) {
      $('#candN').textContent = '0';
      $('#autoHold').classList.toggle('on', autoHold);
      $('#boardGrid').innerHTML = '<div class="zone-empty">还没有可分析的盯梢目标。</div>';
      $('#boardMask').classList.remove('hidden');
      return;
    }
    const a = G.analyze(S, boardSeat, myOf(), autoHold);
    const my = myOf();
    const inHand = new Set(S.hands[my]);
    const inIntel = new Set();
    for (const z of S.intel) { z.rel.forEach(x => inIntel.add(x)); z.unrel.forEach(x => inIntel.add(x)); }
    const inDisc = new Set(S.discardUp);
    const cand = new Set(a.cand);
    const mineW = boardSeat === my;
    $('#candN').textContent = a.cand.length + (mineW ? '' : '');
    $('#autoHold').classList.toggle('on', autoHold);
    const nums = [];
    for (let n = S.cfg.one ? 1 : 2; n <= 15; n++) nums.push(n);
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
    $('#boardGrid').innerHTML = rows.join('');
    $('#boardMask').classList.remove('hidden');
  }
  function openReward() {
    const up = S.discardUp.map((id, i) => ({ id, i }));
    const my = myOf();
    $('#rewardUp').innerHTML = up.length
      ? up.map(o => '<button class="card mini c' + G.cOf(o.id) + '" data-i="' + o.i + '">' +
        '<div class="band"><span class="glyph">' + G.GLYPH[G.cOf(o.id)] + '</span><span>' + G.COLORS[G.cOf(o.id)] + '</span></div><div class="num">' + G.nOf(o.id) + '</div></button>').join('')
      : '<div class="zone-empty">明弃堆是空的（只能盲抽或跳过）。</div>';
    $('#btnBlind').disabled = !S.discardDown.length || S.hands[my].length >= G.HAND_MAX;
    $('#btnSkipReward').textContent = S.hands[my].length >= G.HAND_MAX ? '手牌已满 · 跳过' : '跳过';
    $('#rewardHandN').textContent = S.hands[my].length + '/' + G.HAND_MAX;
    $('#rewardHand').innerHTML = S.hands[my].length
      ? S.hands[my].map(id => miniHtml(id)).join('')
      : '<div class="zone-empty">手牌已空</div>';
    $('#rewardMask').classList.remove('hidden');
  }
  function openDraw() {
    $('#drawInfo').innerHTML = '牌库剩余 <b>' + S.deck.length + '</b> 张 · 手牌 ' + S.hands[myOf()].length + '/' + G.HAND_MAX;
    $('#drawMask').classList.remove('hidden');
  }
  function openLog() {
    const items = S.log.slice().reverse().map(l =>
      '<div class="log-item ' + (typeof l.who === 'number' && l.who === myOf() ? 'you' : l.who === 'sys' ? 'sys' : 'ai') + '">' +
      '<span class="lg-no">R' + l.no + '</span><span>' + esc(l.text) + '</span></div>');
    $('#logList').innerHTML = items.join('') || '<div class="zone-empty">暂无记录</div>';
    $('#logMask').classList.remove('hidden');
  }
  const SHEETS = ['#rulesMask', '#logMask', '#boardMask', '#discMask', '#elimMask', '#rewardMask', '#drawMask', '#lurkMask', '#intelMask', '#traitorMask', '#pickMask'];
  const closeAllSheets = () => {
    autoHold = false;
    SHEETS.forEach(s => $(s).classList.add('hidden'));
  };
  /* 远端状态到达时，把开着的抽屉按新状态重画（免得看到过期牌面） */
  function refreshOpenSheets() {
    if (!S) return;
    if (!$('#boardMask').classList.contains('hidden')) openBoard();
    if (!$('#intelMask').classList.contains('hidden')) openIntel(intelSeat, null);
    if (!$('#traitorMask').classList.contains('hidden')) openTraitor();
    if (!$('#discMask').classList.contains('hidden')) openDisc();
    if (!$('#logMask').classList.contains('hidden')) openLog();
    if (!$('#rewardMask').classList.contains('hidden') && S.pending === 'reward' && S.pendingSeat === myOf()) openReward();
  }

  /* ---------------- 开局弹窗（配置 + 发牌演出 + 先手，倒计时自动关闭） ---------------- */
  function showIntro() {
    if (!S) return;
    const n = S.n, first = S.firstSeat;
    $('#introSub').textContent = n + ' 人协作 · ' + (S.cfg.colors === 5 ? '5 色' : '4 色') + '牌库';
    $('#introCfg').innerHTML = cfgReadHtml(S.cfg, n);
    $('#introFirst').innerHTML = '🎲 随机先手：<b>' + esc(seatName(first)) + '</b>' +
      (first === myOf() ? '（就是你，先手！）' : '');
    $('#introSeats').innerHTML = S.seats.map((st, i) => {
      let cards = '';
      for (let k = 0; k < 5; k++) cards += '<span class="icard" style="--i:' + (i * 5 + k) + '">' + cardBack('mini') + '</span>';
      return '<div class="intro-seat' + (i === first ? ' first' : '') + (i === myOf() ? ' me' : '') + '">' +
        '<b>' + esc(st.name) + (i === myOf() ? '（你）' : '') + (i === first ? '<i class="isfirst">先手</i>' : '') + '</b>' +
        '<span class="iseat-cards">' + cards + '</span></div>';
    }).join('');
    $('#introMask').classList.remove('hidden');
    if (fxOn) requestAnimationFrame(dealAnim); else $$('#introSeats .icard').forEach(el => el.classList.add('deal'));
    introLeft = 5;
    $('#introCount').textContent = introLeft;
    clearInterval(introTimer);
    introTimer = setInterval(() => {
      introLeft--;
      if (introLeft <= 0) { closeIntro(); return; }
      $('#introCount').textContent = introLeft;
    }, 1000);
  }
  let introLeft = 5;
  /* 发牌演出：每张牌背自牌库图标飞向自己的牌格（错峰落位） */
  function dealAnim() {
    const deck = $('#introDeck');
    if (!deck) return;
    const d = deck.getBoundingClientRect();
    $$('#introSeats .icard').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--dx', (d.left + d.width / 2 - (r.left + r.width / 2)).toFixed(1) + 'px');
      el.style.setProperty('--dy', (d.top + d.height / 2 - (r.top + r.height / 2)).toFixed(1) + 'px');
      el.style.animationDelay = (i * 80) + 'ms';
      el.classList.add('deal');
    });
  }
  function closeIntro() {
    clearInterval(introTimer); introTimer = null;
    $('#introMask').classList.add('hidden');
    const wrap = $('#introSeats');
    if (wrap) wrap.innerHTML = '';
  }

  /* ---------------- 结算 ---------------- */
  function showOver() {
    const key = S.over ? JSON.stringify(S.over) : '';
    if (overKey === key) { $('#overlay-win').classList.remove('hidden'); return; }
    overKey = key;
    const w = S.over.win, st = S.over.stats;
    const pips = [];
    for (let i = 0; i < S.cfg.traitors; i++) pips.push('<i class="' + (i < st.caught ? 'on' : 'gone') + '"></i>');
    const why = w ? '全部 ' + S.cfg.traitors + ' 名叛徒已铲除，收队。'
      : S.over.why === 'stuck' ? '行动全部枯竭 —— 死局，还有 ' + (S.cfg.traitors - st.caught) + ' 名叛徒没抓到。'
        : '弹药告急：未铲除的叛徒比子弹还多。';
    const host = (window.OL && OL.isHost) || myOf() === 0;
    $('#overlay-win').innerHTML =
      '<div class="win-card">' +
      '<div class="win-stamp ' + (w ? 'ok' : 'no') + '">' + (w ? '任务成功' : '任务失败') + '</div>' +
      '<div class="vs-dots">' + pips.join('') + '</div>' +
      '<div class="win-why">' + why + '</div>' +
      '<div class="win-stats">回合 ' + st.rounds + ' · 开枪 ' + st.shots + '（中 ' + st.hits + ' / 落 ' + st.misses + '）<br>' +
      '铲除 ' + st.caught + '/' + st.traitors + ' · 子弹余 ' + Math.max(0, st.bullets) + ' · 牌库余 ' + st.deck + '</div>' +
      (host ? '<button class="btn-main primary" id="btnAgain">再来一局</button>' : '') +
      '<button class="btn-main' + (host ? '' : ' primary') + '" id="btnBackRoom">' + (host ? '返回房间改配置' : '返回房间等待') + '</button>' +
      '<button class="btn-main" id="btnHome">退出房间</button>' +
      '<div class="win-tip">点遮罩可收起本面板，查看日志 / 叛徒信息</div>' +
      '</div>';
    $('#overlay-win').classList.remove('hidden');
    if (w) { flashScreen(0.5); shakeAdd(0.4); }
    else shakeAdd(0.5);
  }

  /* ---------------- 远端状态应用（online.js 调用） ---------------- */
  async function applyRemote(st, opts) {
    opts = opts || {};
    if (!st || !G.validate(st)) { console.warn('[ol-ui] 收到非法状态，已忽略'); return false; }
    const prev = S;
    const evs = (opts.replay && st._evs && st._evs.length) ? st._evs : null;
    const actor = typeof st._src === 'number' ? st._src : null;
    const act = st._act || '';
    if (busy && prev && prev.n === st.n) {
      /* 本机演出中：直接采纳权威状态，跳过回放（避免两段演出踩在一起） */
      S = st; live = true; sel = -1;
      renderAll(); refreshOpenSheets();
      if (S.over) showOver();
      return true;
    }
    clearTimers(); clearFx(); clearToasts();
    S = st; live = true; busy = !!evs; sel = -1; acting = evs ? actor : null;
    if (S.introId !== lastIntroId && opts.intro === false) lastIntroId = S.introId;
    /* 远端同一拍：重绘前先冻结被铲除目标的盯梢牌与情报区，别让它们在枪响前先消失 */
    if (evs && fxOn) { const rv = evs.find(e => e.k === 'reveal'); if (rv) freezeKill(rv.seat); }
    renderAll(); refreshOpenSheets();
    if (evs) {
      if (actor != null && actor !== myOf()) {
        bannerAt(seatName(actor) + ' ' + (ACT_LABEL[act] || '行动'), 'act');
        /* 人多时玩家区会滚动：把行动方的座位行带进视野，演出别发生在屏幕外 */
        const row = $('#players .pl-row[data-seat="' + actor + '"]');
        if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      await playEvs(evs);
    }
    acting = null; busy = false;
    renderAll(); refreshOpenSheets();
    if (S.introId && S.introId !== lastIntroId && opts.intro !== false && !S.over) {
      lastIntroId = S.introId;
      showIntro();
    }
    afterChange();
    return true;
  }

  /* ---------------- 屏幕切换 ---------------- */
  function showGame() {
    closeIntro();
    $('#screen-menu').classList.add('hidden');
    $('#screen-game').classList.add('on');
  }
  function showMenu() {
    clearTimers(); clearFx(); clearToasts(); closeAllSheets(); closeIntro();
    live = false; busy = false; sel = -1; sel = -1; pend = null; acting = null; overKey = null; lastHands = [];
    S = null;
    $('#screen-game').classList.remove('on');
    $('#screen-game').style.transform = '';
    $('#overlay-win').classList.add('hidden');
    $('#screen-menu').classList.remove('hidden');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    window.addEventListener('resize', () => { if (S) fitHand(); });
    /* 菜单 */
    $('#btnStart').addEventListener('click', () => { if (window.olEnterLobby) window.olEnterLobby(); else showOnlineHint(); });
    $('#btnResume').addEventListener('click', () => { if (window.olManualReconnect) window.olManualReconnect(); });
    $('#btnRules').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    $('#btnRulesGame').addEventListener('click', () => $('#rulesMask').classList.remove('hidden'));
    /* 顶栏 / 桌面 */
    $('#btnLeave').addEventListener('click', () => { if (window.olConfirmQuit) window.olConfirmQuit(); });
    $('#btnBoard').addEventListener('click', openBoard);
    $('#pileUp').addEventListener('click', openDisc);
    $('#pileDeck').addEventListener('click', () => toast('牌库剩 ' + S.deck.length + ' 张，潜伏必暗弃 1 张'));
    $('#pileTrait').addEventListener('click', openTraitor);
    $('#pileDown').addEventListener('click', () => toast('暗弃堆 ' + S.discardDown.length + ' 张（只见张数）'));
    $('#notebar').addEventListener('click', openLog);
    $('#alertbar').addEventListener('click', () => { if (S && S.over) showOver(); });
    /* 玩家区：情报行 / 盯梢位 */
    $('#players').addEventListener('click', e => {
      const row = e.target.closest('.intel-row');
      if (row) { openIntel(+row.dataset.seat, row.dataset.zone); return; }
      const w = e.target.closest('.pl-watch');
      if (w) {
        const seat = +w.dataset.seat;
        if (S.over) { openTraitor(); return; }
        const card = S.watches[seat];
        if (seat === myOf()) toast(card != null ? '你的盯梢目标：' + G.cardName(card) + '（只有你能看到）' : '你还没有盯梢目标');
        else toast(card != null ? esc(seatName(seat)) + ' 的盯梢目标内容保密' : esc(seatName(seat)) + ' 还未盯梢');
        return;
      }
      const pl = e.target.closest('.pl-row');
      if (pl) openIntel(+pl.dataset.seat, null);
    });
    /* 手牌 */
    $('#hand').addEventListener('click', e => {
      if (!S || S.over || S.pending) return;
      const c = e.target.closest('.card[data-id]');
      const idx = c ? [...$('#hand').children].indexOf(c) : -1;
      if (idx < 0) return;
      if (busy || S.turnSeat !== myOf()) { pend = { idx, hand: S.hands[myOf()].join(',') }; return; }
      sel = (sel === idx) ? -1 : idx;
      renderAll();
    });
    /* 五类行动 */
    $('#btnStake').addEventListener('click', actStake);
    $('#btnIntel').addEventListener('click', actIntel);
    $('#btnComm').addEventListener('click', actComm);
    $('#btnLurk').addEventListener('click', openLurk);
    $('#btnElim').addEventListener('click', openElim);
    $('#btnCancelLurk').addEventListener('click', () => $('#lurkMask').classList.add('hidden'));
    $('#btnCancelElim').addEventListener('click', () => $('#elimMask').classList.add('hidden'));
    $('#btnFire').addEventListener('click', fireElim);
    $('#elimMask').addEventListener('click', e => {
      const tc = e.target.closest('.tchip'), pc = e.target.closest('.pc'), pn = e.target.closest('.pn');
      if (tc) { pickT = +tc.dataset.seat; renderPick(); }
      else if (pc) { pickC = +pc.dataset.c; renderPick(); }
      else if (pn) { pickN = +pn.dataset.n; renderPick(); }
    });
    /* 目标选择抽屉 */
    $('#pickList').addEventListener('click', e => {
      const b = e.target.closest('.pick-row[data-seat]');
      if (!b) return;
      $('#pickMask').classList.add('hidden');
      doAct({ act: 'comm', idx: pickIdx, target: +b.dataset.seat });
    });
    $('#btnCancelPick').addEventListener('click', () => $('#pickMask').classList.add('hidden'));
    /* 推论板目标切换 + 长按分析 */
    $('#boardTargets').addEventListener('click', e => {
      const b = e.target.closest('.tchip[data-seat]');
      if (!b) return;
      boardSeat = +b.dataset.seat;
      openBoard();
    });
    $('#autoHold').addEventListener('pointerdown', e => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      autoHold = true; openBoard();
    });
    $('#autoHold').addEventListener('pointerup', () => { autoHold = false; openBoard(); });
    $('#autoHold').addEventListener('pointercancel', () => { autoHold = false; openBoard(); });
    $('#autoHold').addEventListener('contextmenu', e => e.preventDefault());
    /* 拾牌 / 摸牌子阶段 */
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
    /* 抽屉关闭 */
    ['#btnCloseRules', '#btnCloseBoard', '#btnCloseDisc', '#btnCloseIntel', '#btnCloseLog', '#btnCloseTraitor']
      .forEach(id => $(id).addEventListener('click', () => { const m = $(id).closest('.sheet-mask'); if (m) m.classList.add('hidden'); }));
    /* 点遮罩收起；拾牌 / 摸牌 / 开局弹窗是必选或全程演出，不收起 */
    $$('.sheet-mask').forEach(m => m.addEventListener('click', e => {
      if (e.target === m && m.id !== 'rewardMask' && m.id !== 'drawMask' && m.id !== 'introMask') m.classList.add('hidden');
    }));
    $('#btnIntroGo').addEventListener('click', closeIntro);
    /* 结算面板 */
    $('#overlay-win').addEventListener('click', e => {
      if (e.target.closest('#btnAgain')) { $('#overlay-win').classList.add('hidden'); if (window.olRematch) olRematch(); }
      else if (e.target.closest('#btnBackRoom')) { $('#overlay-win').classList.add('hidden'); if (window.olBackToRoom) olBackToRoom(); }
      else if (e.target.closest('#btnHome')) { if (window.olConfirmQuit) olConfirmQuit(); }
      else if (e.target === e.currentTarget) $('#overlay-win').classList.add('hidden');
    });
  }
  function showOnlineHint() { toast('联机模块未加载，请从 index_ol.html 进入'); }

  /* ---------------- 对外接口（online.js 调用） ---------------- */
  const OLUI = {
    G,
    state: () => S,
    busy: () => !!busy,
    cfgReadHtml,
    setSeat(i) { mySeat = i | 0; if (S) renderAll(); },
    setRoom(code, n) { roomCode = code || ''; if (S) { S.n = S.n || n; renderRoom(); } },
    setFx(v) { fxOn = !!v; },
    applyRemote,
    showGame, showMenu,
    clearFx, clearToasts, closeAllSheets,
    resetIntro() { lastIntroId = null; },
    renderAll: () => renderAll(),
    toast,
    onAgain: null, onBackRoom: null, onExit: null,
  };
  window.INFIL_OL_UI = OLUI;

  /* 测试钩子（无需网络即可驱动整局 UI） */
  window.INFIL_OL_TEST = {
    setSeat: i => OLUI.setSeat(i),
    setRoom: c => OLUI.setRoom(c, 0),
    state: () => S,
    setState(S2, opts) {
      clearTimers(); clearFx(); clearToasts(); closeAllSheets(); closeIntro();
      live = false; busy = false; sel = -1; pend = null; acting = null; overKey = null; lastHands = [];
      S = S2;
      showGame();
      $('#overlay-win').classList.add('hidden');
      renderAll();
      if (opts && opts.intro) { lastIntroId = null; }
      if (opts && opts.live) { live = true; afterChange(); }
      return S;
    },
    showIntro: () => { lastIntroId = null; showIntro(); },
    closeIntro,
    openBoard, openDisc, openLog, openElim, openReward, openDraw, openIntel, openLurk, openTraitor, openPick, renderPick,
    pick: (seat, c, n) => { pickT = seat; pickC = c; pickN = n; renderPick(); },
    doAct, fire: a => doAct(a),
    renderAll,
  };

  document.addEventListener('DOMContentLoaded', () => {
    bind();
  });
})();
