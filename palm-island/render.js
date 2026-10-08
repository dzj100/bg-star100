/* ============================================================
   棕榈岛 Palm Island · 界面与演出层
   依赖：game.js（window.PALM）· audio.js（window.SFX）
   约定：render.js 拥有运行态 S；UI 只读 PALM.draw(S) 视图；
        动作统一走 PALM.act(S, action, payload)，成功即落盘再演出
   v0.17 口径：R13 可见最上 2 张（点卡选目标；跳过仅第 1 张）·
   R15 付费收集（费用可 or 任选其一）· R19 资源卡上限 4（满则先重置 1 张）
   ============================================================ */
(function () {
  'use strict';

  var PALM = window.PALM;
  var SFX = window.SFX;

  var STATE_KEY = 'palm-island-state';
  var BEST_KEY = 'palm-island-best';
  var COACH_KEY = 'palm-island-coach';

  /* R10 官方分档（0-9 档待官方确认，暂用「初登海岛」） */
  var RANKS = [[40, '令人惊讶'], [30, '优秀的'], [20, '还过得去'], [10, '任需努力'], [0, '初登海岛']];

  var RES_IC = { f: 'fish', w: 'wood', s: 'stone' };
  var RES_ORDER = ['f', 'w', 's'];

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var screenMenu = $('screen-menu'), screenGame = $('screen-game');
  var btnStart = $('btnStart'), btnResume = $('btnResume'), resumeSub = $('resumeSub');
  var menuMeta = $('menuMeta');
  var btnRules = $('btnRules'), btnRulesGame = $('btnRulesGame'), btnCloseRules = $('btnCloseRules');
  var rulesMask = $('rulesMask');
  var btnMenu = $('btnMenu'), btnReset = $('btnReset');
  var btnMute = $('btnMute'), btnMuteMenu = $('btnMuteMenu');
  var resetMask = $('resetMask'), btnResetGo = $('btnResetGo'), btnResetBack = $('btnResetBack');
  var roundPips = $('roundPips'), roundTxt = $('roundTxt');
  var resFish = $('resFish'), resWood = $('resWood'), resStone = $('resStone');
  var chipFish = $('resFishChip'), chipWood = $('resWoodChip'), chipStone = $('resStoneChip');
  var deckN = $('deckN');
  var focusArea = $('focusCardArea'), focusNote = $('focusNote');
  var deckList = $('decklist'), bankN = $('bankN');
  var actbar = $('actbar');
  var btnCollect = $('btnCollect'), colSub = $('colSub');
  var btnSpin180 = $('btnSpin180'), spinSub = $('spinSub');
  var btnFlip = $('btnFlip'), flipSub = $('flipSub');
  var btnSkip = $('btnSkip'), skipSub = btnSkip.querySelector('.cost');
  var payMask = $('payMask'), payBar = $('payBar'), payNeed = $('payNeed'), payGot = $('payGot'), payRows = $('payRows');
  var payTitle = $('payTitle'), payOpts = $('payOpts');
  var btnPayGo = $('btnPayGo'), btnPayCancel = $('btnPayCancel');
  var resetPickMask = $('resetPickMask'), resetPickRows = $('resetPickRows'), resetPickInfo = $('resetPickInfo');
  var btnResetPickGo = $('btnResetPickGo'), btnResetPickCancel = $('btnResetPickCancel');
  var inspectMask = $('inspectMask'), inspectBox = $('inspectCardBox'), inspectRows = $('inspectRows'), btnCloseInspect = $('btnCloseInspect');
  var logbar = $('logbar'), logText = $('logText');
  var logMask = $('logMask'), logList = $('logList'), btnCloseLog = $('btnCloseLog');
  var overlayWin = $('overlay-win'), winCard = overlayWin.querySelector('.win-card');
  var winKicker = overlayWin.querySelector('.win-kicker');
  var winStamp = overlayWin.querySelector('.win-stamp');
  var winScore = $('winScore'), winBest = $('winBest'), winList = $('winList');
  var btnAgain = $('btnAgain'), btnHome = $('btnHome');
  var toasts = $('toasts'), fx = $('fx');
  var coachEl = $('coach'), coachHole = $('coachHole'), coachTip = $('coachTip');
  var coachStep = $('coachStep'), coachTitle = $('coachTitle'), coachText = $('coachText');
  var coachSkip = $('coachSkip'), coachNext = $('coachNext');

  /* ---------- 状态 ---------- */
  var S = null;                 // 引擎运行态（render 拥有）
  var busy = false;             // 演出中：屏蔽输入
  var autoTimer = null, autoKind = null;
  var settleRecorded = false;   // 本局结算是否已写入最佳成绩
  var pendingPopUid = null;     // 下一次渲染时点亮（pop）的卡
  var targetSel = 0;            // R13：当前行动目标槽位（0/1）
  var paySel = null;            // 支付抽屉 { action, target, options, feeIdx, cost, sel:{idx:true} }
  var resetPick = null;         // R19 重置选择 { action, payload, uid }
  var coach = { active: false, step: 0 };
  var prevTotals = null;        // 资源栏上次读数（增量 → 脉冲）
  var prevPips = null;          // 轮次进度上次读数（完成 → 脉冲）
  var prevFull = null;          // 资源带是否满员（跨线 → 脉冲）
  var winFx = false;            // 结算落章演出只放一次

  var COACH_STEPS = [
    { sel: '#focusCardArea', title: '牌堆顶可见 2 张', text: '每次能同时看到最上面 2 张卡。点卡切换「目标」（带 ✓ 标记），行动默认作用于当前目标；再点一次可看卡牌全貌。' },
    { sel: '#actbar', title: '四种行动', text: '收集＝右转 90° 产资源（部分卡要付费）；转 180°／翻面＝花资源升级；跳过＝第 1 张原样回牌堆底。置灰的按键当前不可用。' },
    { sel: '.stripwrap', title: '横置资源与牌堆位置', text: '收集过的卡会横置着列在这里：每张都标出它此刻在牌堆里的位置（第几张），什么时候轮回来心里有数。横置资源最多 4 张，收集第 5 张前要先重置 1 张。' },
    { sel: '#logbar', title: '航海日志', text: '每步操作都会记在这里，点开可看完整日志。祝航行顺利！' },
  ];

  /* ---------- 小工具 ---------- */
  function ic(name) { return '<svg class="ic"><use href="#ic-' + name + '"/></svg>'; }
  function reduceMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function later(ms, fn) { setTimeout(fn, ms); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

  /* 费用 → "1🪵1🐟" */
  function costHtml(cost) {
    var h = '';
    RES_ORDER.forEach(function (k) { if (cost && cost[k]) h += '<b>' + cost[k] + '</b>' + ic(RES_IC[k]); });
    return h;
  }
  /* 费用多方案 → "1🪵/1🐟" */
  function feeOptsHtml(fee) {
    return (fee || []).map(function (c) { return costHtml(c); }).join('<span class="or">/</span>');
  }
  /* 产出 → 图标串 */
  function makeHtml(make) {
    var h = '';
    RES_ORDER.forEach(function (k) { for (var i = 0; i < ((make && make[k]) || 0); i++) h += ic(RES_IC[k]); });
    return h;
  }

  /* ---------- 卡面构造（纯代码绘制，与设计样板同构） ---------- */
  function cardHtml(c, size, extraCls) {
    var t = PALM.TYPES[c.id];
    var rows = t.faces[c.face].rows;
    var onRow = c.row; // 资源态按底层行态点亮
    var h = '<div class="pcard ' + size + (c.res ? ' res' : '') + (extraCls ? ' ' + extraCls : '') + '" style="--q:' + PALM.qOf(c) + '">';
    h += '<div class="pc-in">';
    if (rows[0].make) h += '<span class="pc-prod t' + (onRow === 0 ? ' on' : '') + '">' + makeHtml(rows[0].make) + '</span>';
    if (rows[1].make) h += '<span class="pc-prod b' + (onRow === 1 ? ' on' : '') + '">' + makeHtml(rows[1].make) + '</span>';
    h += '<div class="pc-body">';
    if (size === 'f' || size === 'g' || size === 'm') {
      h += '<i class="pc-art ' + t.art + '" aria-hidden="true"><svg viewBox="0 0 100 136" preserveAspectRatio="none"><use href="#art-' + t.art + '"/></svg></i>';
    }
    h += barHtml(c, 'top');
    h += '<div class="pc-row r0">' + opsHtml(rows[0]) + '</div>';
    h += '<div class="pc-row r180">' + opsHtml(rows[1]) + '</div>';
    h += barHtml(c, 'bot');
    h += '</div></div></div>';
    return h;
  }

  function barHtml(c, which) {
    var t = PALM.TYPES[c.id];
    var rs = t.faces[c.face].rows[which === 'top' ? 0 : 1];
    return '<div class="pc-bar ' + which + '">' +
      '<span class="pc-bd star' + (rs.star ? '' : ' none') + '">' + (rs.star || 0) + ic('star') + '</span>' +
      '<span class="pc-nm">' + esc(t.name) + '</span>' +
      '<span class="pc-bd lv' + (rs.lv ? '' : ' none') + '">' + (rs.lv || 0) + ic('up') + '</span>' +
      '</div>';
  }

  function opsHtml(rs) {
    var h = '';
    if (rs.spin) {
      h += '<span class="pc-op free"><i class="cic">' + ic('rot') + '</i><i>' +
        (rs.fee ? feeOptsHtml(rs.fee) : 'Free') +
        '</i></span>';
    }
    if (rs.to180) h += '<span class="pc-op spin"><i class="cic">' + ic('rot180') + '</i><i>' + costHtml(rs.to180) + '</i></span>';
    if (rs.flip) h += '<span class="pc-op flip"><i class="cic">' + ic('flip') + '</i><i>' + costHtml(rs.flip) + '</i></span>';
    if (!h) h = '<span class="pc-empty">空行态</span>';
    return h;
  }

  function cardEl(c, size) {
    var w = document.createElement('div');
    w.innerHTML = cardHtml(c, size);
    return w.firstChild;
  }

  /* 结算微型卡：只印该卡「当前朝向」的一条框条（+ 当前行产出标记），其他朝向内容不展示 */
  function winCardHtml(c) {
    var t = PALM.TYPES[c.id];
    var rs = t.faces[c.face].rows[c.row];
    var h = '<div class="pcard x' + (c.res ? ' res' : '') + '" style="--q:' + PALM.qOf(c) + '">';
    h += '<div class="pc-in">';
    if (rs.make) h += '<span class="pc-prod ' + (c.row === 0 ? 't' : 'b') + ' on">' + makeHtml(rs.make) + '</span>';
    h += '<div class="pc-body' + (c.row === 1 ? ' wb1' : '') + '">';
    h += '<div class="pc-bar ' + (c.row === 0 ? 'top' : 'bot') + '">' +
      '<span class="pc-bd star' + (rs.star ? '' : ' none') + '">' + (rs.star || 0) + ic('star') + '</span>' +
      '<span class="pc-nm">' + esc(t.name) + '</span>' +
      '<span class="pc-bd lv' + (rs.lv ? '' : ' none') + '">' + (rs.lv || 0) + ic('up') + '</span>' +
      '</div>';
    h += '</div></div></div>';
    return h;
  }

  /* 当前牌堆内全部资源卡索引 */
  function allResIdx() {
    var out = [];
    if (!S) return out;
    S.deck.forEach(function (c, i) { if (PALM.isCard(c) && c.res) out.push(i); });
    return out;
  }

  /* 默认选中的费用方案（能被现有资源覆盖的第一项） */
  function pickFee(fee) {
    var tot = PALM.resTotals(S, allResIdx());
    for (var i = 0; i < fee.length; i++) if (PALM.covers(tot, fee[i])) return i;
    return 0;
  }

  /* ---------- 存档 / 最佳 ---------- */
  function save() {
    if (!S) return;
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, S: S })); } catch (e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1 || !o.S) return null;
      if (PALM.validate(o.S).length) return null;
      return o.S;
    } catch (e) { return null; }
  }
  function clearState() { try { localStorage.removeItem(STATE_KEY); } catch (e) {} }

  function bestData() {
    try {
      var raw = localStorage.getItem(BEST_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.best !== 'number') return null;
      return o;
    } catch (e) { return null; }
  }
  /* 返回 {isNew, best} */
  function recordBest(total) {
    var b = bestData() || { best: 0, total: 0, games: 0, last: 0 };
    var isNew = total > b.best;
    b.games += 1; b.last = total; b.total += total;
    if (isNew) b.best = total;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) {}
    return { isNew: isNew, best: b.best, games: b.games };
  }

  /* ---------- 吐司 / 演出 ---------- */
  function toast(msg, kind) {
    var d = document.createElement('div');
    d.className = 'toast in' + (kind ? ' ' + kind : '');
    d.innerHTML = msg;
    toasts.appendChild(d);
    while (toasts.children.length > 3) toasts.removeChild(toasts.firstChild);
    later(2100, function () {
      d.classList.remove('in'); d.classList.add('out');
      later(260, function () { if (d.parentNode) d.parentNode.removeChild(d); });
    });
  }

  function shake(el) {
    if (reduceMotion() || !el) return;
    try { el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 200 }); } catch (e) {}
  }

  function floatAt(target, html) {
    if (reduceMotion() || !target) return;
    var r = target.getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'fxc floatTxt';
    d.innerHTML = html;
    d.style.left = (r.left + r.width / 2) + 'px';
    d.style.top = (r.top + r.height / 2) + 'px';
    fx.appendChild(d);
    try {
      d.animate([
        { opacity: 0, transform: 'translate(-50%,-70%) scale(.8)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.06)', offset: .25 },
        { opacity: 0, transform: 'translate(-50%,-150%) scale(1)' },
      ], { duration: 950, easing: 'ease-out' }).onfinish = function () { d.remove(); };
    } catch (e) { d.remove(); }
  }

  function pop(el) {
    if (reduceMotion() || !el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    later(420, function () { el.classList.remove('pop'); });
  }

  /* 通用「跳一下」：数字 / 徽标增量用（.pop 动画只挂在 .pcard 上） */
  function peak(el) {
    if (reduceMotion() || !el) return;
    el.classList.remove('peak');
    void el.offsetWidth;
    el.classList.add('peak');
    later(460, function () { el.classList.remove('peak'); });
  }

  /* 卡从 fromEl 飞到 toEl（克隆演出，不动真实 DOM）。
     .pcard 是方形槽位、朝向由内部 .pc-in 自己转，所以克隆原样复制即带朝向；
     只对“方形槽位”做位移 + 中途轻摆 + 缩小，落点回到 0° 与资源带里的卡一致 */
  function flyTo(fromEl, toEl, done) {
    if (reduceMotion() || !fromEl || !toEl) { if (done) done(); return; }
    var a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    var clone = fromEl.cloneNode(true);
    clone.classList.add('fxc', 'fxcard');
    clone.style.left = a.left + 'px';
    clone.style.top = a.top + 'px';
    clone.style.width = fromEl.offsetWidth + 'px';
    clone.style.height = fromEl.offsetHeight + 'px';
    fx.appendChild(clone);
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    try {
      clone.animate([
        { transform: 'none', opacity: 1 },
        { transform: 'translate(' + (dx * .5).toFixed(1) + 'px,' + (dy * .5 - 40).toFixed(1) + 'px) rotate(-7deg) scale(.74)', opacity: .85, offset: .52 },
        { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(.4)', opacity: .12 },
      ], { duration: 430, easing: 'cubic-bezier(.35,.65,.4,1)' }).onfinish = function () { clone.remove(); if (done) done(); };
    } catch (e) { clone.remove(); if (done) done(); }
  }

  function puffAt(target) {
    if (reduceMotion() || !target) return;
    var r = target.getBoundingClientRect();
    for (var i = 0; i < 3; i++) {
      var d = document.createElement('div');
      d.className = 'fxc puff';
      d.style.left = (r.left + r.width / 2) + 'px';
      d.style.top = (r.top + r.height / 2) + 'px';
      fx.appendChild(d);
      (function (d2, k) {
        try {
          d2.animate([
            { opacity: .9, transform: 'translate(-50%,-50%) scale(.6)' },
            { opacity: 0, transform: 'translate(calc(-50% + ' + ((k - 1) * 22) + 'px), calc(-50% - ' + (18 + k * 8) + 'px)) scale(1.15)' },
          ], { duration: 520, delay: k * 40, easing: 'ease-out' }).onfinish = function () { d2.remove(); };
        } catch (e) { d2.remove(); }
      })(d, i);
    }
  }

  /* 放射金点：结算落章 / 满员用（确定性散布，便于截图复现） */
  function sparkAt(target, count) {
    if (reduceMotion() || !target) return;
    var r = target.getBoundingClientRect();
    var n = count || 12;
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'fxc spark';
      d.style.left = (r.left + r.width / 2) + 'px';
      d.style.top = (r.top + r.height / 2) + 'px';
      fx.appendChild(d);
      (function (d2, k) {
        var ang = (Math.PI * 2 * k) / n + (k % 3) * .35;
        var dist = 54 + (k * 37) % 64;
        var dx = (Math.cos(ang) * dist).toFixed(1), dy = (Math.sin(ang) * dist).toFixed(1);
        try {
          d2.animate([
            { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
            { opacity: 0, transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.35)' },
          ], { duration: 640, delay: (k % 4) * 35, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = function () { d2.remove(); };
        } catch (e) { d2.remove(); }
      })(d, i);
    }
  }

  /* ---------- 渲染：顶栏 / 轮次 / 资源 ---------- */
  function renderChrome(v) {
    var n = v.n;
    var h = '';
    for (var i = 0; i < PALM.RULES.ROUNDS; i++) {
      h += '<span class="pip' + (i < n ? ' done' : (i === n ? ' now' : '')) + '"></span>';
    }
    roundPips.innerHTML = h;
    roundTxt.innerHTML = '第 <b>' + v.round + '</b> / ' + PALM.RULES.ROUNDS + ' 轮';
    if (prevPips != null && n > prevPips) {
      var done = roundPips.querySelectorAll('.pip.done');
      if (done.length) peak(done[done.length - 1]);
    }
    prevPips = n;
    var tot = PALM.resTotals(S);
    if (prevTotals) {
      if (tot.f > prevTotals.f) peak(chipFish);
      if (tot.w > prevTotals.w) peak(chipWood);
      if (tot.s > prevTotals.s) peak(chipStone);
    }
    prevTotals = { f: tot.f, w: tot.w, s: tot.s };
    resFish.textContent = tot.f; resWood.textContent = tot.w; resStone.textContent = tot.s;
    chipFish.classList.toggle('zero', !tot.f);
    chipWood.classList.toggle('zero', !tot.w);
    chipStone.classList.toggle('zero', !tot.s);
    deckN.textContent = v.counts.cards;
  }

  /* ---------- 渲染：焦点区（R13 可见最上 2 张） ---------- */
  function markerTile(n, sub) {
    return '<div class="markercard"><div class="mk-in">' +
      '<div class="mk-sun">' + Math.min(n + 1, PALM.RULES.ROUNDS) + '</div>' +
      '<div class="mk-tx">回合标记</div>' +
      '<div class="mk-sub">' + sub + '</div>' +
      '</div></div>';
  }
  function miniMarkerTile() {
    return '<div class="mktile"><div class="mk-sun">☀</div>' +
      '<div class="mkt-tx">回合标记</div><div class="mkt-sub">即将计数</div></div>';
  }

  function onSlotTap(i, s) {
    if (busy || !S) return;
    if (s.kind === 'card') {
      if (targetSel === i) { openInspect(s.card); return; }
      targetSel = i;
      SFX.tap();
      renderAll();
    } else if (s.kind === 'res') {
      openInspect(s.card);
    } else {
      toast('回合标记卡自动计数', '');
    }
  }

  function renderFocus(v) {
    if (v.kind === 'marker' || v.kind === 'settle') {
      var n = v.n;
      var sub = v.kind === 'settle' ? '航程结束 · 结算中'
        : ((n + 1) < PALM.RULES.ROUNDS ? '第 ' + (n + 1) + ' 轮结束 · 计数 +1' : '第 ' + PALM.RULES.ROUNDS + ' 轮结束 · 结算航程');
      focusArea.innerHTML = markerTile(n, sub);
      focusNote.textContent = v.kind === 'settle' ? '航程结束 · 结算中' : '回合标记 · 自动计数';
      focusNote.classList.remove('warn');
      return;
    }

    /* 目标槽位矫正：优先落在可操作的卡槽 */
    if (v.kind === 'card' && (targetSel >= v.slots.length || !v.slots[targetSel] || v.slots[targetSel].kind !== 'card')) {
      targetSel = (v.slots[0] && v.slots[0].kind === 'card') ? 0 : -1;
    }

    focusArea.innerHTML = '';
    v.slots.forEach(function (s, i) {
      var wrap = document.createElement('div');
      wrap.className = 'fslot';
      if (s.kind !== 'card') wrap.classList.add('viewonly');
      if (s.kind === 'card' && i === targetSel) wrap.classList.add('sel');
      if (s.kind === 'marker') {
        wrap.innerHTML = miniMarkerTile();
        wrap.addEventListener('click', function () { toast('回合标记卡自动计数', ''); });
      } else {
        var el = cardEl(s.card, 'f');
        el.dataset.slot = i;
        el.addEventListener('click', function () { onSlotTap(i, s); });
        wrap.appendChild(el);
        if (pendingPopUid === s.card.uid) { pop(el); pendingPopUid = null; }
      }
      if (v.slots.length > 1) {
        var tag = document.createElement('span');
        tag.className = 'fslot-tag';
        tag.textContent = s.kind === 'card'
          ? (i === targetSel ? '✓ 目标' : '第 ' + (i + 1) + ' 张 · 点选')
          : '第 ' + (i + 1) + ' 张 · 不可操作';
        wrap.appendChild(tag);
      }
      focusArea.appendChild(wrap);
    });

    if (v.kind === 'res') {
      focusNote.textContent = PALM.rowLabel(v.card) + ' · 横置资源中 · 自动复位';
      focusNote.classList.remove('warn');
      return;
    }
    var sc = (v.slots[targetSel] && v.slots[targetSel].kind === 'card') ? v.slots[targetSel] : v.slots[0];
    if (!sc || sc.kind !== 'card') return;
    var rs = sc.rowState;
    var onlySkip = !rs.spin && !rs.to180 && !rs.flip;
    focusNote.textContent = PALM.rowLabel(sc.card) + (onlySkip ? ' · 空行态 · 只能跳过' : '') +
      (v.slots.length > 1 ? ' · 点卡可换目标 · 再点看全貌' : ' · 点卡看全貌');
    focusNote.classList.toggle('warn', onlySkip);
  }

  /* ---------- 渲染：横置资源条（只列资源卡 · 每张标注它在牌堆第几张） ---------- */
  function renderDeckStrip() {
    var resN = 0;
    S.deck.forEach(function (c) { if (PALM.isCard(c) && c.res) resN++; });
    var full = resN >= PALM.RULES.RES_LIMIT;
    bankN.textContent = resN + ' / ' + PALM.RULES.RES_LIMIT;
    bankN.classList.toggle('full', full);
    if (prevFull === false && full && resN) { peak(bankN); sparkAt(bankN, 8); }
    prevFull = full;

    var sl = deckList.scrollLeft;
    deckList.innerHTML = '';
    S.deck.forEach(function (c, i) {
      if (!PALM.isCard(c) || !c.res) return;   /* 只列横置（资源态）卡，不展示整副牌序 */
      var item = document.createElement('div');
      item.className = 'dkitem isres';
      item.dataset.uid = c.uid;
      var el = cardEl(c, 'm');
      el.title = PALM.TYPES[c.id].name + ' · ' + PALM.rowLabel(c) + '（横置）';
      el.addEventListener('click', function () { openInspect(c); });
      item.appendChild(el);
      item.insertAdjacentHTML('beforeend', '<span class="dk-no">第 ' + (i + 1) + ' 张</span>');
      deckList.appendChild(item);
      if (pendingPopUid === c.uid) { pop(el); pendingPopUid = null; }
    });
    if (!deckList.children.length) {
      deckList.innerHTML = '<span class="empty">暂无资源卡 · 收集（右转 90°）后横置到这里，并标注它在牌堆的位置</span>';
    }
    deckList.scrollLeft = sl;
  }

  /* 收集后把横置资源条滚到末尾，展示新加入的资源卡 */
  function scrollDeckEnd() {
    if (!deckList) return;
    try {
      deckList.scrollTo({ left: deckList.scrollWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      deckList.scrollLeft = deckList.scrollWidth;
    }
  }

  /* ---------- 渲染：行动栏（作用于当前目标） ---------- */
  function renderOps(v) {
    function offAll(txt) {
      colSub.innerHTML = txt; spinSub.innerHTML = txt; flipSub.innerHTML = txt;
      skipSub.textContent = '—';
      [btnCollect, btnSpin180, btnFlip, btnSkip].forEach(function (b) { b.classList.add('off'); });
    }
    if (v.kind !== 'card') {
      offAll(v.kind === 'res' ? '顶卡自动复位…' : (v.kind === 'marker' ? '回合标记自动计数…' : '—'));
      return;
    }
    var slot = v.slots[targetSel];
    if (!slot || slot.kind !== 'card') { offAll('—'); return; }
    var rs = slot.rowState, ops = slot.ops;
    colSub.innerHTML = !rs.spin ? '当前行未印出'
      : !ops.collect.ok ? ('资源不足 · 需 ' + feeOptsHtml(rs.fee))
        : rs.fee ? ('付 ' + feeOptsHtml(rs.fee) + ' · 得 ' + makeHtml(rs.make))
          : ('免费 · 得 ' + makeHtml(rs.make));
    spinSub.innerHTML = rs.to180 ? ('付 ' + costHtml(rs.to180) + (ops.to180.ok ? '' : ' · 资源不足')) : '当前行未印出';
    flipSub.innerHTML = rs.flip ? ('付 ' + costHtml(rs.flip) + (ops.flip.ok ? '' : ' · 资源不足')) : '当前行未印出';
    btnCollect.classList.toggle('off', !ops.collect.ok);
    btnSpin180.classList.toggle('off', !ops.to180.ok);
    btnFlip.classList.toggle('off', !ops.flip.ok);
    btnSkip.classList.remove('off');
    skipSub.textContent = targetSel === 0 ? '第 1 张 · 回牌堆底' : '仅第 1 张 · 回牌堆底';
  }

  /* ---------- 渲染：日志 ---------- */
  function logSuffix(e) {
    var h = '';
    if (e.res) h += ' ' + makeHtml(e.res);
    if (e.cost) h += ' · 付 ' + costHtml(e.cost);
    if (e.star != null) h += ' <b>+' + e.star + '</b>' + ic('star');
    if (e.total != null && e.k === 'sys' && e.s.indexOf('结算') >= 0) h += ' · 共 <b>' + e.total + '</b>' + ic('star');
    return h;
  }
  function renderLogbar() {
    var e = S.log[S.log.length - 1];
    logText.innerHTML = e ? (esc(e.s) + logSuffix(e)) : '—';
  }

  /* ---------- 主渲染 ---------- */
  function renderAll() {
    if (!S) return;
    var v = PALM.draw(S);

    screenMenu.classList.add('hidden');
    screenGame.classList.add('on');

    renderChrome(v);
    renderLogbar();

    actbar.classList.toggle('hidden', v.kind === 'settle');

    if (v.kind === 'settle') {
      renderFocus(v);
      renderDeckStrip();
      showWin(v.score);
      return;
    }

    renderFocus(v);
    renderDeckStrip();
    renderOps(v);

    if (v.kind === 'marker') scheduleAuto('marker', 850);
    else if (v.kind === 'res') scheduleAuto('reset', 560);
    else clearAuto();
  }

  /* ---------- 自动阶段（标记 / 资源复位） ---------- */
  function scheduleAuto(kind, ms) {
    if (autoKind === kind && autoTimer) return;
    clearAuto();
    autoKind = kind;
    autoTimer = later(ms, function () { autoTimer = null; autoKind = null; runAuto(kind); });
  }
  function clearAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    autoKind = null;
  }
  function runAuto(kind) {
    if (!S) return;
    if (busy) { scheduleAuto(kind, 260); return; }
    var v = PALM.draw(S);
    if (kind === 'marker' && v.kind !== 'marker') return;
    if (kind === 'reset' && v.kind !== 'res') return;
    var c0 = v.card;
    var res = PALM.act(S, kind === 'marker' ? 'marker' : 'reset');
    if (!res.ok) return;
    busy = true;
    save();
    if (kind === 'marker') SFX.marker();
    if (kind === 'reset') {
      var el = focusArea.querySelector('.pcard');
      if (el) setQ(el, PALM.qOf(c0), true);
      SFX.tap();
    }
    later(kind === 'reset' ? 480 : 300, function () { busy = false; renderAll(); });
  }

  /* ---------- 旋转（同节点更新 --q 触发 CSS 过渡） ---------- */
  function setQ(el, q, animate) {
    var pcIn = el.querySelector('.pc-in');
    if (!pcIn) return;
    if (!animate || reduceMotion()) {
      pcIn.style.transition = 'none';
      el.style.setProperty('--q', q);
      void pcIn.offsetWidth;
      pcIn.style.transition = '';
    } else {
      el.style.setProperty('--q', q);
    }
  }

  /* ---------- 玩家动作 ---------- */
  function actCard(action) {
    if (busy || !S) return;
    var v = PALM.draw(S);
    if (v.kind !== 'card') {
      toast(v.kind === 'res' ? '资源态顶卡会自动复位' : (v.kind === 'marker' ? '回合标记卡自动计数' : '航程已结束'), '');
      return;
    }
    var ti = action === 'skip' ? 0 : (targetSel >= 0 ? targetSel : 0);
    var slot = v.slots[ti] || v.slots[0];
    var btn = action === 'collect' ? btnCollect : action === 'to180' ? btnSpin180 : action === 'flip' ? btnFlip : btnSkip;
    if (!slot || slot.kind !== 'card') {
      toast(slot && slot.kind === 'res' ? '资源态卡不可操作' : '请选择一张可操作的卡', 'bad');
      SFX.bad();
      shake(btn);
      return;
    }
    var op = slot.ops[action];
    if (!op.ok) {
      toast(op.reason || '当前不可用', 'bad');
      SFX.bad();
      shake(btn);
      return;
    }
    var rs = slot.rowState;
    if (action === 'collect') {
      if (rs.fee) {
        var fi = pickFee(rs.fee);
        openPay({ action: 'collect', target: ti, options: rs.fee, feeIdx: fi, cost: rs.fee[fi] });
        return;
      }
      doAction('collect', { target: ti });
      return;
    }
    if (action === 'to180' || action === 'flip') {
      openPay({ action: action, target: ti, cost: op.cost });
      return;
    }
    doAction('skip', null);
  }

  function doAction(action, payload) {
    if (busy || !S) return;
    var v0 = PALM.draw(S);
    if (v0.kind !== 'card') return;
    var ti = (payload && payload.target != null) ? payload.target : 0;
    var slot0 = v0.slots[ti] || v0.slots[0];
    var c0 = slot0 ? slot0.card : v0.card;
    var res = PALM.act(S, action, payload);
    if (!res.ok) {
      if (res.code === 'RES_LIMIT') { openResetPick(action, payload); return; }
      toast(res.err, 'bad');
      SFX.bad();
      return;
    }
    busy = true;
    save();
    var el = focusArea.querySelector('.pcard[data-slot="' + ti + '"]');
    var swapMs = 560;
    if (action === 'collect') {
      if (el) setQ(el, PALM.qOf(c0), true);
      SFX.collect();
      later(340, function () {
        if (el) flyTo(el, deckList, function () { puffAt(deckList); });
        floatAt(el, makeHtml(PALM.rowStateOf(c0).make));
        pendingPopUid = c0.uid;
      });
      swapMs = 620;
    } else if (action === 'to180') {
      if (el) setQ(el, PALM.qOf(c0), true);
      SFX.spin();
      swapMs = 620;
    } else if (action === 'flip') {
      if (el) {
        var ne = cardEl(c0, 'f');
        ne.dataset.slot = ti;
        ne.addEventListener('click', function () { openInspect(c0); });
        el.replaceWith(ne);
        pop(ne);
      }
      SFX.flip();
      swapMs = 620;
    } else if (action === 'skip') {
      SFX.tap();
      if (el && !reduceMotion()) {
        try { el.animate([{ opacity: 1 }, { opacity: .2 }], { duration: 220 }); } catch (e) {}
      }
      swapMs = 320;
    }
    later(swapMs, function () {
      busy = false;
      renderAll();
      if (action === 'collect') scrollDeckEnd();
    });
  }

  /* ---------- 支付（转180°/翻面/付费收集通用） ---------- */
  function renderPayOpts() {
    payOpts.innerHTML = '';
    if (!paySel || !paySel.options || paySel.options.length < 2) {
      payOpts.classList.add('hidden');
      return;
    }
    paySel.options.forEach(function (cost, i) {
      var b = document.createElement('button');
      b.className = 'payopt' + (i === paySel.feeIdx ? ' on' : '');
      b.innerHTML = '付 ' + costHtml(cost);
      b.addEventListener('click', function () {
        paySel.feeIdx = i;
        paySel.cost = paySel.options[i];
        renderPayOpts();
        payNeed.innerHTML = costHtml(paySel.cost);
        refreshPay();
        SFX.tap();
      });
      payOpts.appendChild(b);
    });
    payOpts.classList.remove('hidden');
  }

  function openPay(cfg) {
    if (busy || !S) return;
    var v = PALM.draw(S);
    if (!v.res) return;
    paySel = { action: cfg.action, target: cfg.target, options: cfg.options || null, feeIdx: cfg.feeIdx || 0, cost: cfg.cost, sel: {} };
    payTitle.innerHTML = cfg.action === 'collect' ? '收集 · 支付费用'
      : cfg.action === 'to180' ? '转 180° · 支付' : '翻面 · 支付';
    renderPayOpts();
    payNeed.innerHTML = costHtml(paySel.cost);
    payRows.innerHTML = '';
    v.res.list.forEach(function (it) {
      var fake = { uid: it.uid, id: it.id, face: it.face, row: it.row, res: true };
      var row = document.createElement('button');
      row.className = 'payrow';
      row.dataset.idx = it.idx;
      row.innerHTML = cardHtml(fake, 'm') +
        '<span class="pinfo"><b>' + esc(it.name) + ' · ' + esc(it.label.replace(/ 行$/, '')) + '</b>' +
        '<span>' + makeHtml(it.make) + '</span></span>' +
        '<span class="ck">✓</span>';
      row.addEventListener('click', function () {
        var i = it.idx;
        if (paySel.sel[i]) delete paySel.sel[i]; else paySel.sel[i] = true;
        row.classList.toggle('on', !!paySel.sel[i]);
        refreshPay();
        SFX.tap();
      });
      payRows.appendChild(row);
    });
    btnPayGo.disabled = true;
    payMask.classList.remove('hidden');
    refreshPay();
    SFX.tap();
  }

  function payIdxs() {
    return Object.keys(paySel.sel).map(Number).sort(function (a, b) { return a - b; });
  }
  function refreshPay() {
    if (!paySel) return;
    var idxs = payIdxs();
    var got = PALM.resTotals(S, idxs);
    var ok = PALM.covers(got, paySel.cost);
    payGot.innerHTML = makeHtml(got) || '—';
    payBar.classList.toggle('ok', ok);
    btnPayGo.disabled = !ok;
  }

  function payConfirm() {
    if (!paySel || btnPayGo.disabled) return;
    var cfg = paySel;
    var idxs = payIdxs();
    payMask.classList.add('hidden');
    paySel = null;
    if (cfg.action === 'collect') {
      var p = { target: cfg.target, pay: idxs };
      if (cfg.options) p.fee = cfg.feeIdx;
      doAction('collect', p);
    } else {
      doAction(cfg.action, { target: cfg.target, pay: idxs });
    }
  }

  /* ---------- R19 资源满 4 张：重置选择 ---------- */
  function openResetPick(action, payload) {
    if (!S) return;
    var v = PALM.draw(S);
    var used = {};
    ((payload && payload.pay) || []).forEach(function (i) { used[i] = true; });
    var cand = ((v.res && v.res.list) || []).filter(function (it) { return !used[it.idx]; });
    resetPick = { action: action, payload: payload, uid: null };
    resetPickInfo.textContent = '点选 1 张要重置的资源卡（原位左转，不改顺序）';
    resetPickInfo.classList.remove('ok');
    btnResetPickGo.disabled = true;
    resetPickRows.innerHTML = '';
    cand.forEach(function (it) {
      var fake = { uid: it.uid, id: it.id, face: it.face, row: it.row, res: true };
      var row = document.createElement('button');
      row.className = 'payrow';
      row.dataset.uid = it.uid;
      row.innerHTML = cardHtml(fake, 'm') +
        '<span class="pinfo"><b>' + esc(it.name) + ' · ' + esc(it.label.replace(/ 行$/, '')) + '</b>' +
        '<span>' + makeHtml(it.make) + '</span></span>' +
        '<span class="ck">↺</span>';
      row.addEventListener('click', function () {
        resetPick.uid = it.uid;
        Array.prototype.forEach.call(resetPickRows.children, function (n) { n.classList.toggle('on', n === row); });
        resetPickInfo.innerHTML = '已选：<b>' + esc(it.name) + '</b> · ' + esc(it.label) + ' · 原位复位';
        resetPickInfo.classList.add('ok');
        btnResetPickGo.disabled = false;
        SFX.tap();
      });
      resetPickRows.appendChild(row);
    });
    resetPickMask.classList.remove('hidden');
    SFX.tap();
  }

  function resetPickConfirm() {
    if (!resetPick || !resetPick.uid) return;
    var rp = resetPick;
    resetPickMask.classList.add('hidden');
    resetPick = null;
    var payload = {};
    Object.keys(rp.payload || {}).forEach(function (k) { payload[k] = rp.payload[k]; });
    payload.reset = rp.uid;
    doAction(rp.action, payload);
  }

  /* ---------- 查看全貌 ---------- */
  function openInspect(c) {
    if (!c || !PALM.TYPES[c.id]) return;
    /* 抽屉按可读方向展示：资源态卡不侧放，保留描边提示 */
    var dc = { uid: c.uid, id: c.id, face: c.face, row: c.row, res: false };
    inspectBox.innerHTML = cardHtml(dc, 'g');
    if (c.res) inspectBox.querySelector('.pcard').classList.add('res');
    var t = PALM.TYPES[c.id];
    var h = '';
    [0, 1].forEach(function (face) {
      [0, 1].forEach(function (row) {
        var rs = t.faces[face].rows[row];
        var cur = (face === c.face && row === c.row);
        h += '<div class="insrow' + (cur ? ' cur' : '') + '">' +
          '<span class="orn">' + (face ? '背' : '正') + ' ' + (row ? '180°' : '0°') + ' 行</span>' +
          '<span class="ops">' + opsHtml(rs) + '</span>' +
          '<span class="pr' + (rs.make ? '' : ' none') + '">' + (rs.make ? makeHtml(rs.make) : '—') + '</span>' +
          '<span class="sc">' + (rs.star ? rs.star + ic('star') : '—') + '</span>' +
          '<span class="lv">' + (rs.lv ? rs.lv + ic('up') : '—') + '</span>' +
          '</div>';
      });
    });
    inspectRows.innerHTML = h;
    inspectMask.classList.remove('hidden');
    SFX.tap();
  }

  /* ---------- 日志抽屉 ---------- */
  function openLog() {
    var h = '';
    for (var i = S.log.length - 1; i >= 0; i--) {
      var e = S.log[i];
      h += '<div class="log-item ' + e.k + '"><span class="lg-no">' + (i + 1) + '</span><span>' + esc(e.s) + logSuffix(e) + '</span></div>';
    }
    logList.innerHTML = h || '<div class="log-item"><span>暂无记录</span></div>';
    logMask.classList.remove('hidden');
    SFX.tap();
  }

  /* ---------- 结算 ---------- */
  function rankOf(total) {
    for (var i = 0; i < RANKS.length; i++) if (total >= RANKS[i][0]) return RANKS[i][1];
    return RANKS[RANKS.length - 1][1];
  }

  function showWin(score) {
    var rec = null;
    if (!settleRecorded) {
      settleRecorded = true;
      rec = recordBest(score.total);
      clearState();
      SFX.settle();
      later(650, function () { SFX.win(); });
    }
    winKicker.textContent = '航程结束 · ' + PALM.RULES.ROUNDS + ' 轮';
    winStamp.innerHTML = ic('star') + rankOf(score.total);
    if (rec) {
      winBest.classList.toggle('new', rec.isNew);
      winBest.innerHTML = rec.isNew
        ? '新纪录！' + score.total + ic('star') + ' · 刷新了历史最佳'
        : '最佳纪录 <b>' + rec.best + '</b>' + ic('star') + ' · 再来一次刷新它';
    } else {
      var b = bestData();
      winBest.classList.remove('new');
      winBest.innerHTML = b ? ('最佳纪录 <b>' + b.best + '</b>' + ic('star')) : '';
    }

    var rows = score.rows.slice().sort(function (a, b) { return b.star - a.star; });
    winList.innerHTML = rows.map(function (r) {
      return '<div class="winrow">' + winCardHtml(r) +
        '<span class="grow">' + esc(r.name) + ' · ' + esc(r.label) + '</span>' +
        '<span class="sc">' + r.star + ic('star') + '</span></div>';
    }).join('');

    overlayWin.classList.remove('hidden');
    winCard.classList.remove('winPop');
    void winCard.offsetWidth;
    winCard.classList.add('winPop');
    countUp(winScore, score.total);
    if (!winFx) {
      winFx = true;
      if (!reduceMotion()) {
        later(700, function () {
          if (overlayWin.classList.contains('hidden')) return;
          winStamp.classList.add('slam');
          shake(winCard);
          sparkAt(winStamp, 12);
          later(560, function () { winStamp.classList.remove('slam'); });
        });
        if (rec && rec.isNew) later(1080, function () {
          if (!overlayWin.classList.contains('hidden')) peak(winBest);
        });
      }
    }
  }

  function countUp(el, total) {
    if (reduceMotion() || !window.requestAnimationFrame) { el.textContent = total; return; }
    var t0 = performance.now();
    var dur = 700;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(total * eased);
      if (k < 1) window.requestAnimationFrame(step);
      else el.textContent = total;
    })(t0);
  }

  /* ---------- 新手引导 ---------- */
  function coachSeen() { try { return localStorage.getItem(COACH_KEY) === '1'; } catch (e) { return true; } }
  function startCoach() {
    coach.active = true;
    coach.step = 0;
    coachEl.classList.remove('hidden');
    positionCoach();
    SFX.tap();
  }
  function positionCoach() {
    var st = COACH_STEPS[coach.step];
    var el = document.querySelector(st.sel);
    if (!el) return;
    var r = el.getBoundingClientRect();
    var m = 7;
    coachHole.style.left = (r.left - m) + 'px';
    coachHole.style.top = (r.top - m) + 'px';
    coachHole.style.right = 'auto';
    coachHole.style.bottom = 'auto';
    coachHole.style.width = (r.width + m * 2) + 'px';
    coachHole.style.height = (r.height + m * 2) + 'px';
    coachStep.textContent = (coach.step + 1) + ' / ' + COACH_STEPS.length;
    coachTitle.textContent = st.title;
    coachText.textContent = st.text;
    var lowerHalf = r.bottom > window.innerHeight * 0.58;
    if (lowerHalf) {
      coachTip.style.bottom = (window.innerHeight - r.top + 14) + 'px';
      coachTip.style.top = 'auto';
    } else {
      coachTip.style.top = Math.min(r.bottom + 14, window.innerHeight - 190) + 'px';
      coachTip.style.bottom = 'auto';
    }
    coachNext.textContent = coach.step === COACH_STEPS.length - 1 ? '开始航程' : '下一步';
  }
  function endCoach() {
    if (!coach.active) return;
    coach.active = false;
    coachEl.classList.add('hidden');
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}
  }
  function coachAdvance() {
    coach.step += 1;
    if (coach.step >= COACH_STEPS.length) { endCoach(); return; }
    positionCoach();
    SFX.tap();
  }

  /* ---------- 屏幕切换 / 开局 ---------- */
  function ensureGameVisible() {
    screenMenu.classList.add('hidden');
    screenGame.classList.add('on');
  }

  function startGame(seed) {
    S = PALM.newGame(seed);
    settleRecorded = false;
    pendingPopUid = null;
    targetSel = 0;
    paySel = null;
    resetPick = null;
    prevTotals = null; prevPips = null; prevFull = null; winFx = false;
    clearAuto();
    coachEl.classList.add('hidden'); coach.active = false;
    ensureGameVisible();
    overlayWin.classList.add('hidden');
    save();
    renderAll();
    SFX.unlock();
    if (!coachSeen()) later(620, startCoach);
  }

  function resumeGame() {
    var st = loadState();
    if (!st) return false;
    S = st;
    settleRecorded = false;
    pendingPopUid = null;
    targetSel = 0;
    paySel = null;
    resetPick = null;
    prevTotals = null; prevPips = null; prevFull = null; winFx = false;
    clearAuto();
    coachEl.classList.add('hidden'); coach.active = false;
    ensureGameVisible();
    overlayWin.classList.add('hidden');
    renderAll();
    SFX.unlock();
    return true;
  }

  function showMenu() {
    clearAuto();
    overlayWin.classList.add('hidden');
    screenGame.classList.remove('on');
    screenMenu.classList.remove('hidden');
    refreshMenu();
  }

  function refreshMenu() {
    var b = bestData();
    menuMeta.classList.remove('hidden');
    menuMeta.innerHTML = (b && b.games)
      ? '<span>最佳 <b>' + b.best + '</b> ' + ic('star') + '</span><span>已完成 <b>' + b.games + '</b> 次航程</span>'
      : '<span>首次航程 · 8 轮见分晓</span>';
    var st = loadState();
    if (st) {
      var v = PALM.draw(st);
      btnResume.classList.remove('hidden');
      resumeSub.textContent = '第 ' + v.round + ' / ' + PALM.RULES.ROUNDS + ' 轮 · 资源 ' + v.counts.bank + ' / ' + PALM.RULES.RES_LIMIT + ' 张';
    } else {
      btnResume.classList.add('hidden');
    }
  }

  /* ---------- 静音 ---------- */
  function syncMute() {
    var m = SFX.muted;
    btnMute.classList.toggle('muted', m);
    btnMuteMenu.classList.toggle('muted', m);
  }

  /* ---------- 事件接线 ---------- */
  function wire() {
    btnStart.addEventListener('click', function () { startGame(); });
    btnResume.addEventListener('click', function () { resumeGame(); });
    btnRules.addEventListener('click', function () { rulesMask.classList.remove('hidden'); SFX.tap(); });
    btnRulesGame.addEventListener('click', function () { rulesMask.classList.remove('hidden'); SFX.tap(); });
    btnCloseRules.addEventListener('click', function () { rulesMask.classList.add('hidden'); SFX.tap(); });
    btnMenu.addEventListener('click', function () { SFX.tap(); showMenu(); });
    btnReset.addEventListener('click', function () { resetMask.classList.remove('hidden'); SFX.tap(); });
    btnResetBack.addEventListener('click', function () { resetMask.classList.add('hidden'); SFX.tap(); });
    btnResetGo.addEventListener('click', function () { resetMask.classList.add('hidden'); startGame(); });
    [btnMute, btnMuteMenu].forEach(function (b) {
      b.addEventListener('click', function () { var on = SFX.toggle(); syncMute(); if (on) SFX.tap(); });
    });
    btnCollect.addEventListener('click', function () { actCard('collect'); });
    btnSpin180.addEventListener('click', function () { actCard('to180'); });
    btnFlip.addEventListener('click', function () { actCard('flip'); });
    btnSkip.addEventListener('click', function () { actCard('skip'); });
    btnPayGo.addEventListener('click', payConfirm);
    btnPayCancel.addEventListener('click', function () { payMask.classList.add('hidden'); paySel = null; SFX.tap(); });
    btnResetPickGo.addEventListener('click', resetPickConfirm);
    btnResetPickCancel.addEventListener('click', function () { resetPickMask.classList.add('hidden'); resetPick = null; SFX.tap(); });
    logbar.addEventListener('click', openLog);
    btnCloseLog.addEventListener('click', function () { logMask.classList.add('hidden'); SFX.tap(); });
    btnCloseInspect.addEventListener('click', function () { inspectMask.classList.add('hidden'); SFX.tap(); });
    btnAgain.addEventListener('click', function () { startGame(); });
    btnHome.addEventListener('click', function () { SFX.tap(); showMenu(); });
    coachNext.addEventListener('click', coachAdvance);
    coachSkip.addEventListener('click', function () { endCoach(); SFX.tap(); });

    /* 抽屉背景点击关闭 */
    [rulesMask, logMask, resetMask, inspectMask, payMask, resetPickMask].forEach(function (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target !== mask) return;
        mask.classList.add('hidden');
        if (mask === payMask) paySel = null;
        if (mask === resetPickMask) resetPick = null;
      });
    });

    /* 首次交互解锁音频 */
    ['pointerdown', 'touchstart'].forEach(function (evt) {
      window.addEventListener(evt, function () { SFX.unlock(); }, { once: true, passive: true });
    });
  }

  /* ---------- 测试钩子 ---------- */
  window.PALM_UI = {
    start: function (seed) { startGame(seed); },
    resume: function () { return resumeGame(); },
    menu: showMenu,
    state: function () { return S; },
    view: function () { return S ? PALM.draw(S) : null; },
    score: function () { return S ? PALM.score(S) : null; },
    best: bestData,
    isBusy: function () { return busy; },
    screen: function () {
      if (!screenGame.classList.contains('on')) return 'menu';
      return overlayWin.classList.contains('hidden') ? 'game' : 'win';
    },
    coachActive: function () { return coach.active; },
    coachStep: function () { return coach.step; },
    coachAdvance: coachAdvance,
    press: actCard,
    target: function () { return targetSel; },
    setTarget: function (i) { targetSel = i; renderAll(); },
    inspect: openInspect,
    openLog: openLog,
    payState: function () { return paySel; },
    payToggle: function (idx) { var r = payRows.querySelector('[data-idx="' + idx + '"]'); if (r) r.click(); },
    payConfirm: payConfirm,
    resetPickState: function () { return resetPick; },
    resetPickSelect: function (uid) {
      var r = resetPickRows.querySelector('[data-uid="' + uid + '"]');
      if (r) r.click();
    },
    resetPickConfirm: resetPickConfirm,
    /* 测试/走查用：白盒改状态后强制重绘；直接执行动作（自动凑资源 / 选费用方案 / 满 4 张自动重置） */
    sync: function () { renderAll(); },
    actRaw: function (action, payload) {
      if (!S) return { ok: false, err: '未开局' };
      var p = payload;
      if (!p) {
        var v = PALM.draw(S);
        if (v.kind === 'card') {
          var ti = action === 'skip' ? 0 : (targetSel >= 0 ? targetSel : 0);
          var slot = v.slots[ti] || v.slots[0];
          if (slot && slot.kind === 'card') {
            var idxs = allResIdx();
            if (action === 'to180' || action === 'flip') {
              if (slot.ops[action].ok && slot.ops[action].cost) p = { target: ti, pay: idxs };
            } else if (action === 'collect') {
              var rs = slot.rowState;
              if (rs.fee) {
                var tot = PALM.resTotals(S, idxs);
                for (var k = 0; k < rs.fee.length; k++) {
                  if (PALM.covers(tot, rs.fee[k])) { p = { target: ti, fee: k, pay: idxs }; break; }
                }
              } else {
                p = { target: ti };
              }
            }
          }
        }
      }
      var r = PALM.act(S, action, p);
      if (!r.ok && r.code === 'RES_LIMIT' && p) {
        var v2 = PALM.draw(S);
        var used = {};
        (p.pay || []).forEach(function (i) { used[i] = true; });
        var cand = ((v2.res && v2.res.list) || []).filter(function (it) { return !used[it.idx]; });
        if (cand.length) {
          var p2 = {};
          Object.keys(p).forEach(function (k) { p2[k] = p[k]; });
          p2.reset = cand[0].uid;
          r = PALM.act(S, action, p2);
        }
      }
      if (r.ok) { save(); renderAll(); }
      return r;
    },
  };

  /* ---------- 启动 ---------- */
  function boot() {
    wire();
    syncMute();
    refreshMenu();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
