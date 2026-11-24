'use strict';
/* 《牛头王》6 nimmt! —— 对局控制器 + DOM 渲染 + 动画编排
   依赖：game.js（window.SixNimmt）→ ai.js（window.SixNimmtAI）→ 本文件
   只操作 DOM / localStorage；所有规则判断都交回引擎。 */
(function (window, document) {
  if (!window || !document) return;
  var SN = window.SixNimmt;
  var AI = window.SixNimmtAI;
  if (!SN || !AI) return;

  /* ============================================================
     常量与运行时状态
     ============================================================ */

  var SAVE_KEY = 'six-nimmt-save-v1';
  var STATS_KEY = 'six-nimmt-stats-v1';
  var SETTINGS_KEY = 'six-nimmt-settings-v1';

  var ROW_CN = ['A 行', 'B 行', 'C 行', 'D 行'];

  var D = {};                      /* DOM 缓存 */
  var S = null;                    /* 当前对局状态 */
  var runId = 0;                   /* 每次开新局 / 回首页递增，作废旧异步流程 */
  var resolving = false;           /* 同一时刻只允许一个结算循环 */
  var aiTimers = [];               /* AI 选牌定时器 */
  var thinkingSeats = {};          /* seat -> true，AI 思考中 */
  var pendingPick = null;          /* 人类点到但尚未锁定的牌 */
  var flippedCards = {};           /* card -> true，亮牌托盘只翻转一次 */
  var handSig = '';                /* 手牌 DOM 签名，避免 AI 回合重绘打断点击 */
  var aiRng = null;                /* AI 决策 rng（引擎注入） */
  var delayRng = null;             /* AI 延迟 rng */
  var lastDelta = {};              /* seat -> 本局累计收牌牛头，用于记分板 */
  var resultRecorded = false;
  var overShown = false;
  var toastTimer = 0;
  var focusStack = [];
  var choiceState = null;          /* { resolve, options, busy } */
  var confirmCb = null;
  var prefs = { name: '', aiCount: 4 };
  var reducedMotion = false;
  var fastMode = false;
  var urlParams = {};
  var gameStartTs = 0;

  /* ============================================================
     小工具
     ============================================================ */

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function clamp(n, a, b) {
    n = Math.floor(Number(n));
    if (!isFinite(n)) n = a;
    return n < a ? a : (n > b ? b : n);
  }
  function scene(ms) {
    if (reducedMotion) return 0;
    if (fastMode) return Math.max(16, Math.min(ms, 60));
    return ms;
  }
  function wait(ms, rid) {
    var token = (rid === undefined || rid === null) ? runId : rid;
    return new Promise(function (resolve) {
      window.setTimeout(function () { resolve(token === runId); }, scene(ms));
    });
  }
  function rectOf(node) {
    if (!node || !node.getBoundingClientRect) return null;
    var r = node.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return r;
  }
  function isAlive(rid) { return rid === runId && !!S; }

  /* ============================================================
     localStorage
     ============================================================ */

  function readJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function removeKey(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    var o = readJSON(SETTINGS_KEY);
    if (!o || typeof o !== 'object') return;
    if (typeof o.name === 'string') prefs.name = o.name.slice(0, 8);
    if (o.aiCount != null) prefs.aiCount = clamp(o.aiCount, 2, 9);
  }
  function savePrefs() { writeJSON(SETTINGS_KEY, { name: prefs.name, aiCount: prefs.aiCount }); }

  function loadStats() {
    var o = readJSON(STATS_KEY);
    var st = { games: 0, wins: 0, best: null, lastScore: null, lastRank: null, updated: 0 };
    if (o && typeof o === 'object') {
      st.games = Math.max(0, Math.floor(Number(o.games) || 0));
      st.wins = Math.max(0, Math.floor(Number(o.wins) || 0));
      if (typeof o.best === 'number' && isFinite(o.best)) st.best = o.best;
      if (typeof o.lastScore === 'number' && isFinite(o.lastScore)) st.lastScore = o.lastScore;
      if (typeof o.lastRank === 'number' && isFinite(o.lastRank)) st.lastRank = o.lastRank;
      if (typeof o.updated === 'number') st.updated = o.updated;
    }
    return st;
  }
  function saveStats(st) { writeJSON(STATS_KEY, st); }

  function clearSave() { removeKey(SAVE_KEY); }

  function saveGame() {
    if (!S) return;
    if (S.phase === 'gameEnd') { clearSave(); return; }
    writeJSON(SAVE_KEY, { v: 1, ts: Date.now(), S: S });
  }

  function readSave() {
    var raw = null;
    try { raw = window.localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { clearSave(); return null; }
    if (!parsed || parsed.v !== 1 || !parsed.S) { clearSave(); return null; }
    var check = SN.validate(parsed.S);
    if (!check.ok || parsed.S.phase === 'gameEnd') { clearSave(); return null; }
    return parsed.S;
  }

  /* ============================================================
     牌面 / 牌背 HTML
     ============================================================ */

  function bullsIcons(n, extraClass) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<svg class="bull-ico' + (extraClass ? ' ' + extraClass : '') +
        '" viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>';
    }
    return out;
  }

  /* opts: { tag:'button'|'div', index, total, selected, disabled, classes } */
  function cardHTML(card, opts) {
    opts = opts || {};
    var bulls = SN.bullsOf(card);
    var cls = 'card bull-' + bulls;
    if (opts.classes) cls += ' ' + opts.classes;
    if (opts.selected) cls += ' is-selected';
    if (opts.disabled) cls += ' is-disabled';

    var inner = '<span class="card-corner">' + card + '</span>' +
      '<span class="card-bulls">' + bullsIcons(bulls) + '</span>' +
      '<span class="card-count"><svg class="bull-ico" viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>' + bulls + '</span>';

    if (opts.tag === 'button') {
      var style = '';
      if (opts.index != null) {
        style = ' style="--i:' + opts.index + ';--n:' + (opts.total || 1) + '"';
      }
      return '<button class="' + cls + '" type="button" data-card="' + card + '"' + style +
        ' aria-pressed="' + (opts.selected ? 'true' : 'false') + '"' +
        ' aria-label="数字 ' + card + '，' + bulls + ' 个牛头"' +
        (opts.disabled ? ' disabled' : '') + '>' + inner + '</button>';
    }
    return '<div class="' + cls + '" data-card="' + card + '">' + inner + '</div>';
  }

  function cardBackHTML(extraClass) {
    return '<div class="card-back' + (extraClass ? ' ' + extraClass : '') + '" aria-label="对手已锁定的牌">' +
      '<span class="card-back-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#card-back-mark"></use></svg></span>' +
      '</div>';
  }

  function bullSvg(size) {
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>';
  }

  /* ============================================================
     屏幕切换 / 轻提示
     ============================================================ */

  function showScreen(id) {
    var screens = $$('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('active', screens[i].id === id);
    }
  }

  function toast(msg, ms) {
    if (!D.toast) return;
    D.toast.textContent = msg || '';
    D.toast.classList.add('show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      D.toast.classList.remove('show');
      toastTimer = 0;
    }, ms || 2200);
  }

  function clearFx() {
    if (D.fx) D.fx.innerHTML = '';
  }

  /* ============================================================
     弹窗 / 焦点
     ============================================================ */

  function openModal(node, focusSel) {
    if (!node || node.classList.contains('open')) return;
    focusStack.push(document.activeElement);
    node.classList.add('open');
    var target = focusSel ? node.querySelector(focusSel) : null;
    if (!target) target = node.querySelector('[data-close]') || node.querySelector('button');
    if (target) {
      window.setTimeout(function () {
        try { target.focus(); } catch (e) { /* ignore */ }
      }, 30);
    }
  }

  function closeModal(node) {
    if (!node || !node.classList.contains('open')) return;
    node.classList.remove('open');
    var back = focusStack.pop();
    if (back && back.focus && document.documentElement.contains(back)) {
      try { back.focus(); } catch (e) { /* ignore */ }
    }
  }

  function activeModal() {
    return document.querySelector('.modal.open');
  }

  function trapFocus(modal, e) {
    var nodes = $$('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])', modal)
      .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openConfirm(title, text, onOk) {
    if (!D.modalConfirm) return;
    D.confirmTitle.textContent = title || '确认';
    D.confirmText.textContent = text || '';
    confirmCb = onOk || null;
    openModal(D.modalConfirm, '#confirmCancel');
  }

  function closeConfirm(confirmed) {
    var cb = confirmCb;
    confirmCb = null;
    closeModal(D.modalConfirm);
    if (confirmed && cb) cb();
  }

  /* ============================================================
     菜单 / 设置
     ============================================================ */

  function renderMenu() {
    var saved = readSave();
    if (D.btnContinue) D.btnContinue.hidden = !saved;
    var st = loadStats();
    if (D.menuStats) {
      if (st.games > 0) {
        D.menuStats.textContent = '已战 ' + st.games + ' 局 · 胜 ' + st.wins + ' 局' +
          (st.best === null ? '' : ' · 最佳 ' + st.best + ' 牛头');
      } else {
        D.menuStats.textContent = '还没有战绩 · 第一局，从牛栏开始';
      }
    }
  }

  function humanName() {
    var n = (prefs.name || '').replace(/\s+/g, ' ').trim();
    return n ? n.slice(0, 8) : '牛来';
  }

  function renderSetup() {
    if (D.inpName) D.inpName.value = prefs.name;
    if (D.rosterCount) D.rosterCount.textContent = String(prefs.aiCount + 1);
    $$('#aiCountSeg button').forEach(function (b) {
      b.classList.toggle('active', Number(b.getAttribute('data-ai')) === prefs.aiCount);
    });
    renderRoster();
  }

  function renderRoster() {
    if (!D.roster) return;
    var rows = [];
    rows.push('<div class="roster-row is-me">' +
      '<span class="roster-avatar">' + bullSvg(18) + '</span>' +
      '<span class="roster-name">' + esc(humanName()) + '</span>' +
      '<span class="roster-tag">你 · 牧场主</span></div>');
    for (var i = 0; i < prefs.aiCount; i++) {
      var name = SN.AI_NAMES[i % SN.AI_NAMES.length];
      rows.push('<div class="roster-row">' +
        '<span class="roster-avatar">' + bullSvg(18) + '</span>' +
        '<span class="roster-name">' + esc(name) + '</span>' +
        '<span class="roster-tag">AI · 标准</span></div>');
    }
    D.roster.innerHTML = rows.join('');
    if (D.rosterCount) D.rosterCount.textContent = String(prefs.aiCount + 1);
  }

  function openSetup() {
    renderSetup();
    showScreen('screen-setup');
    if (D.btnBegin) {
      window.setTimeout(function () { try { D.btnBegin.focus(); } catch (e) { /* ignore */ } }, 30);
    }
  }

  /* ============================================================
     开局 / 恢复
     ============================================================ */

  function newRngs(seed) {
    aiRng = SN.seeded((seed ^ 0xA53C9E1D) >>> 0);
    delayRng = SN.seeded((seed ^ 0x51ED270B) >>> 0);
  }

  function startNewGame(cfg) {
    cfg = cfg || {};
    abortChoice();
    runId += 1;
    clearAITimers();
    clearFx();
    resolving = false;
    thinkingSeats = {};
    pendingPick = null;
    flippedCards = {};
    handSig = '';
    lastDelta = {};
    resultRecorded = false;
    overShown = false;

    var aiCount = clamp(cfg.aiCount != null ? cfg.aiCount : prefs.aiCount, 2, 9);
    var seed = (cfg.seed != null && isFinite(Number(cfg.seed))) ? (Number(cfg.seed) >>> 0) : (Date.now() >>> 0);
    var name = cfg.humanName || humanName();

    prefs.aiCount = aiCount;
    prefs.name = name === '牛来' ? prefs.name : name;
    savePrefs();

    S = SN.newGame({
      aiCount: aiCount,
      humanName: name,
      difficulty: 'normal',
      seed: seed
    });
    newRngs(S.seed);
    gameStartTs = Date.now();

    showScreen('screen-game');
    renderAll();
    saveGame();
    scheduleAITimers(runId);
  }

  function resumeGame(saved) {
    runId += 1;
    clearAITimers();
    resolving = false;
    thinkingSeats = {};
    pendingPick = null;
    flippedCards = {};
    handSig = '';
    lastDelta = {};
    resultRecorded = false;
    overShown = false;

    S = saved;
    newRngs(S.seed);
    gameStartTs = Date.now();

    /* 让「再来一局 / 调整人数」沿用这局的配置 */
    prefs.aiCount = clamp(S.settings.aiCount, 2, 9);
    prefs.name = S.players[0] ? S.players[0].name : prefs.name;
    savePrefs();

    showScreen('screen-game');
    renderAll();
    saveGame();

    var rid = runId;
    if (S.phase === 'selecting') {
      scheduleAITimers(rid);
      if (SN.allSelected(S)) maybeReveal(rid);
      toast('已恢复对局 · 第 ' + S.trick + ' 局', 1800);
    } else if (S.phase === 'revealing' || S.phase === 'chooseRow') {
      toast('已恢复对局 · 继续结算第 ' + S.trick + ' 局', 1800);
      window.setTimeout(function () {
        if (isAlive(rid)) resolveLoop(rid);
      }, scene(360));
    } else if (S.phase === 'trickEnd') {
      window.setTimeout(function () {
        if (isAlive(rid)) endTrick(rid);
      }, scene(360));
    }
  }

  function goHome() {
    abortChoice();
    clearAITimers();
    clearFx();
    runId += 1;
    resolving = false;
    thinkingSeats = {};
    pendingPick = null;
    flippedCards = {};
    handSig = '';
    S = null;
    showScreen('screen-menu');
    renderMenu();
    var buttons = $$('.modal.open');
    for (var i = 0; i < buttons.length; i++) closeModal(buttons[i]);
    if (D.btnStart) {
      window.setTimeout(function () { try { D.btnStart.focus(); } catch (e) { /* ignore */ } }, 30);
    }
  }

  function recordResult(res) {
    if (resultRecorded) return;
    resultRecorded = true;
    var human = null;
    for (var i = 0; i < res.order.length; i++) {
      if (res.order[i].seat === 0) { human = res.order[i]; break; }
    }
    if (!human) return;
    var st = loadStats();
    st.games += 1;
    if (human.winner) st.wins += 1;
    if (st.best === null || human.score < st.best) st.best = human.score;
    st.lastScore = human.score;
    st.lastRank = human.rank;
    st.updated = Date.now();
    saveStats(st);
  }

  function finishGame(rid) {
    if (rid !== runId || !S || S.phase !== 'gameEnd' || overShown) return;
    overShown = true;
    clearAITimers();
    clearFx();
    resolving = false;
    var res = SN.rankings(S);
    recordResult(res);
    clearSave();
    renderOver(res);
    showScreen('screen-over');
    if (D.over) D.over.scrollTop = 0;
    if (D.btnAgain) {
      window.setTimeout(function () { try { D.btnAgain.focus(); } catch (e) { /* ignore */ } }, 120);
    }
    var humanWon = res.winners.indexOf(0) >= 0;
    if (humanWon) {
      var token = runId;
      window.setTimeout(function () {
        if (token === runId && S && S.phase === 'gameEnd') confetti();
      }, 260);
    }
  }

  /* ============================================================
     玩家 / 记分板 / 日志
     ============================================================ */

  function minScore() {
    if (!S || !S.players.length) return 0;
    var m = Infinity;
    for (var i = 0; i < S.players.length; i++) {
      if (S.players[i].score < m) m = S.players[i].score;
    }
    return isFinite(m) ? m : 0;
  }

  function chipStatus(p) {
    if (!S) return '';
    if (S.phase === 'selecting') {
      if (p.selected !== null && p.selected !== undefined) return '已锁定';
      if (p.ai) return thinkingSeats[p.seat] ? '思考中' : '等待中';
      return pendingPick != null ? '按「锁定出牌」' : '请选牌';
    }
    if (S.phase === 'chooseRow') {
      return (S.pendingChoice && S.pendingChoice.seat === p.seat) ? '选行中' : '亮牌中';
    }
    if (S.phase === 'revealing') return '亮牌中';
    if (S.phase === 'trickEnd') return '本局结束';
    return '终局';
  }

  function updatePlayersOverflow() {
    var el = D.players;
    if (!el) return;
    var max = el.scrollWidth - el.clientWidth;
    var overflow = max > 2;
    el.classList.toggle('has-overflow', overflow);
    el.classList.toggle('is-scrolled', overflow && el.scrollLeft > 2);
    el.classList.toggle('at-end', overflow && el.scrollLeft >= max - 2);
  }

  function renderPlayers() {
    if (!D.players) return;
    if (!S) {
      D.players.innerHTML = '';
      D.players.classList.remove('has-overflow', 'is-scrolled', 'at-end');
      return;
    }
    var min = minScore();
    var showLead = !(S.phase === 'selecting' && S.trick === 1 && min === 0);
    var html = '';
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var cls = 'player-chip';
      if (p.seat === 0) cls += ' is-me';
      if (showLead && p.score === min) cls += ' is-leading is-lowest';
      if (S.phase === 'selecting' && p.selected !== null && p.selected !== undefined) cls += ' is-selected';
      if (p.ai && thinkingSeats[p.seat]) cls += ' is-thinking';
      html += '<div class="' + cls + '" data-seat="' + p.seat + '">' +
        '<span class="chip-avatar">' + bullSvg(16) + '</span>' +
        '<span class="chip-name">' + esc(p.name) + '</span>' +
        '<span class="chip-score">' + p.score + '</span>' +
        '<span class="chip-status">' + esc(chipStatus(p)) + '</span>' +
        '</div>';
    }
    var scrollLeft = D.players.scrollLeft;
    D.players.innerHTML = html;
    D.players.scrollLeft = scrollLeft;
    if (window.requestAnimationFrame) window.requestAnimationFrame(updatePlayersOverflow);
    else updatePlayersOverflow();
  }

  function renderScoreboard() {
    if (!D.scoreboard) return;
    if (!S) { D.scoreboard.innerHTML = ''; return; }
    var order = S.players.slice().sort(function (a, b) {
      return a.score - b.score || a.seat - b.seat;
    });
    var min = order.length ? order[0].score : 0;
    var showLead = !(S.phase === 'selecting' && S.trick === 1 && min === 0);
    var html = '';
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      var cls = 'score-row';
      if (p.seat === 0) cls += ' is-me';
      if (showLead && p.score === min) cls += ' is-leading';
      if (S.phase === 'gameEnd' && p.score === min) cls += ' is-winner';
      var delta = lastDelta[p.seat] ? '+' + lastDelta[p.seat] : '';
      html += '<div class="' + cls + '">' +
        '<span class="sc-rank">' + (i + 1) + '</span>' +
        '<span class="sc-name">' + esc(p.name) + '</span>' +
        '<span class="sc-score">' + p.score + '</span>' +
        '<span class="sc-delta">' + delta + '</span>' +
        '</div>';
    }
    D.scoreboard.innerHTML = html;
  }

  function playerOf(seat) {
    return (S && S.players[seat]) ? S.players[seat] : null;
  }

  function logText(e) {
    if (!e) return '';
    var p = playerOf(e.seat);
    var who = p ? p.name : '玩家';
    var row = (typeof e.rowIndex === 'number') ? (ROW_CN[e.rowIndex] || ('第' + (e.rowIndex + 1) + '行')) : '';
    var tag = (typeof e.trick === 'number') ? '[第' + e.trick + '局] ' : '';
    if (e.type === 'select') return tag + who + ' 已锁定手牌';
    if (e.type === 'place') return tag + who + ' 的 ' + e.card + ' 落在' + row;
    if (e.type === 'take') {
      return tag + who + ' 的 ' + e.card + ' ' + (e.viaChoice ? '自选' : '撞满') + row +
        '，收走 ' + (e.took ? e.took.length : 0) + ' 张 · +' + e.bulls + ' 牛头';
    }
    if (e.type === 'choice') return tag + who + ' 的 ' + e.card + ' 比所有行尾都小，正在选行';
    if (e.type === 'gameEnd') return tag + '10 局结束 · 牛群归栏';
    return '';
  }

  function logHTML(e) {
    if (!e) return '';
    var p = playerOf(e.seat);
    var who = p ? esc(p.name) : '玩家';
    var row = (typeof e.rowIndex === 'number') ? (ROW_CN[e.rowIndex] || '') : '';
    var tag = '<span class="log-tag">第' + e.trick + '局</span>';
    if (e.type === 'select') return tag + '<b>' + who + '</b> 已锁定';
    if (e.type === 'place') return tag + '<b>' + who + '</b> 的 ' + e.card + ' 落在' + row;
    if (e.type === 'take') {
      return tag + '<b>' + who + '</b> 的 ' + e.card + ' ' + (e.viaChoice ? '自选' : '撞满') + row +
        ' · +' + e.bulls + ' 牛头';
    }
    if (e.type === 'choice') return tag + '<b>' + who + '</b> 的 ' + e.card + ' 比所有行尾都小，选一行';
    if (e.type === 'gameEnd') return tag + '<b>终局</b> · 牛群归栏';
    return '';
  }

  function renderLogs() {
    if (!S) return;
    var all = S.log || [];
    var entries = [];
    for (var e = 0; e < all.length; e++) {
      if (all[e].type !== 'select') entries.push(all[e]);
    }
    if (D.latestLog) {
      var latest = entries.length ? entries[entries.length - 1] : null;
      if (latest) {
        D.latestLog.innerHTML = logHTML(latest);
      } else if (S.phase === 'selecting') {
        var lockedCount = 0;
        for (var c = 0; c < S.players.length; c++) {
          if (S.players[c].selected !== null && S.players[c].selected !== undefined) lockedCount++;
        }
        D.latestLog.textContent = '本局锁定 ' + lockedCount + ' / ' + S.players.length + ' 人';
      } else if (S.log && S.log.length) {
        D.latestLog.textContent = '正在亮牌…';
      } else {
        D.latestLog.textContent = '开局后，最新动态会显示在这里';
      }
    }
    if (D.logPanel) {
      var from = Math.max(0, entries.length - 26);
      var html = '';
      for (var i = from; i < entries.length; i++) {
        html += '<div class="log-line">' + logHTML(entries[i]) + '</div>';
      }
      if (!html) html = '<div class="log-line">本局暂无落牌 · 所有人锁定后开始结算</div>';
      if (D.logPanel.innerHTML !== html) D.logPanel.innerHTML = html;
      D.logPanel.scrollTop = D.logPanel.scrollHeight;
    }
    if (D.modalLog && D.modalLog.classList.contains('open')) renderLogModal();
  }

  function renderLogModal() {
    if (!D.logModalBody) return;
    if (!S) { D.logModalBody.textContent = ''; return; }
    var lines = [];
    for (var i = 0; i < S.log.length; i++) {
      if (S.log[i].type === 'select') continue;
      lines.push(logText(S.log[i]));
    }
    D.logModalBody.textContent = lines.length ? lines.join('\n') : '尚无落牌记录。';
    D.logModalBody.scrollTop = D.logModalBody.scrollHeight;
  }

  /* ============================================================
     桌面 / 亮牌托盘 / 手牌
     ============================================================ */

  function rowEls() {
    return D.table ? $$('.row', D.table) : [];
  }

  function renderRows() {
    if (!D.table || !S) return;
    var rows = S.rows;
    var els = rowEls();
    for (var i = 0; i < els.length; i++) {
      var data = rows[i];
      if (!data) continue;
      var cards = data.cards || [];
      var rowEl = els[i];
      rowEl.classList.toggle('is-full', cards.length >= 5);
      rowEl.classList.toggle('is-danger', cards.length >= 4 && cards.length < 5);
      rowEl.classList.toggle('is-empty', cards.length === 0);

      var bullsHost = rowEl.querySelector('.row-bulls');
      if (bullsHost) {
        var total = SN.rowBulls(cards);
        bullsHost.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>' +
          '<span>' + total + '</span>';
      }
      var track = rowEl.querySelector('.row-track');
      if (track) {
        var html = '';
        for (var k = 0; k < cards.length; k++) {
          html += cardHTML(cards[k]);
        }
        if (cards.length) {
          for (var s = cards.length; s < 5; s++) {
            html += '<span class="row-slot" aria-hidden="true"></span>';
          }
        }
        if (track.innerHTML !== html) track.innerHTML = html;
      }
    }
  }

  function trayCardEl(seat, card) {
    if (!D.revealTray) return null;
    return D.revealTray.querySelector('.reveal-slot[data-seat="' + seat + '"] .reveal-card .card[data-card="' + card + '"]');
  }

  function renderTray() {
    if (!D.revealTray) return;
    if (!S) { D.revealTray.innerHTML = ''; return; }
    var html = '';
    var players = S.players || [];
    if (S.phase === 'selecting') {
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var locked = p.selected !== null && p.selected !== undefined;
        var cls = 'reveal-slot';
        if (!locked) cls += ' is-empty';
        cls += p.ai ? ' is-ai' : ' is-human';
        if (p.ai && thinkingSeats[p.seat]) cls += ' is-thinking';
        var core = '';
        if (locked) core = p.ai ? cardBackHTML() : cardHTML(p.selected);
        html += '<div class="' + cls + '" data-seat="' + p.seat + '">' +
          '<div class="reveal-card">' + core + '</div>' +
          '<span class="reveal-name">' + esc(p.name) + '</span></div>';
      }
    } else if (S.phase === 'revealing' || S.phase === 'chooseRow' || S.phase === 'trickEnd') {
      var queue = S.revealQueue || [];
      var bySeat = {};
      for (var q = 0; q < queue.length; q++) bySeat[queue[q].seat] = queue[q];
      for (var j = 0; j < players.length; j++) {
        var pl = players[j];
        var entry = bySeat[pl.seat];
        var slotCls = 'reveal-slot';
        var core2 = '';
        var fresh = false;
        if (entry) {
          fresh = !flippedCards[entry.card];
          core2 = cardHTML(entry.card);
          if (fresh) flippedCards[entry.card] = true;
        } else {
          slotCls += ' is-empty';
        }
        slotCls += pl.ai ? ' is-ai' : ' is-human';
        if (fresh) slotCls += ' is-flipped';
        var attrs = ' data-seat="' + pl.seat + '"';
        if (entry) attrs += ' data-card="' + entry.card + '"';
        html += '<div class="' + slotCls + '"' + attrs + '>' +
          '<div class="reveal-card">' + core2 + '</div>' +
          '<span class="reveal-name">' + esc(pl.name) + '</span></div>';
      }
    }
    if (D.revealTray.innerHTML !== html) D.revealTray.innerHTML = html;
    if (S.phase === 'revealing' || S.phase === 'chooseRow' || S.phase === 'trickEnd') {
      var cards = $$('.reveal-slot.is-flipped .card', D.revealTray);
      for (var k = 0; k < cards.length; k++) {
        cards[k].style.animationDelay = (reducedMotion ? 0 : Math.min(k, 6) * 45) + 'ms';
      }
    }
  }

  function humanCanPick() {
    return !!(S && S.phase === 'selecting' &&
      S.players[0] && (S.players[0].selected === null || S.players[0].selected === undefined));
  }

  function renderHand() {
    if (!D.hand) return;
    if (!S) { D.hand.innerHTML = ''; handSig = ''; return; }
    var me = S.players[0];
    var selectable = humanCanPick();
    var total = me.hand.length;
    var sig = me.hand.join(',') + '|' + total + '|' + (selectable ? 1 : 0) + '|' +
      (pendingPick == null ? '' : pendingPick) + '|' + S.phase;
    if (sig === handSig && D.hand.childElementCount === total) return;
    handSig = sig;
    var html = '';
    for (var i = 0; i < me.hand.length; i++) {
      var card = me.hand[i];
      html += cardHTML(card, {
        tag: 'button',
        index: i,
        total: total,
        selected: pendingPick === card,
        disabled: !selectable,
        classes: selectable ? 'is-playable' : ''
      });
    }
    D.hand.innerHTML = html;
  }

  function renderTopbar() {
    if (!S) return;
    if (D.tbTrick) D.tbTrick.textContent = '第 ' + S.trick + ' / ' + SN.TRICKS + ' 局';
    if (D.trickDots) {
      var dots = $$('.dot', D.trickDots);
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('done', i < S.trick - 1);
        dots[i].classList.toggle('current', i === S.trick - 1);
      }
    }
  }

  function renderPrompt() {
    if (!D.handPrompt || !S) return;
    var me = S.players[0];
    var txt = '';
    var waiting = false;
    if (S.phase === 'selecting') {
      if (me.selected !== null && me.selected !== undefined) {
        txt = '已锁定 · 等待其他玩家亮牌';
        waiting = true;
      } else if (pendingPick != null) {
        txt = '已选中 ' + pendingPick + ' · 点「锁定出牌」';
      } else {
        var thinking = false;
        for (var k in thinkingSeats) { if (thinkingSeats[k]) { thinking = true; break; } }
        txt = thinking ? '牛群正在思考 · 你可以先选牌' : '选择一张手牌 · 所有人同时亮牌';
      }
    } else if (S.phase === 'revealing') {
      txt = '亮牌中 · 按牌面从小到大结算';
      waiting = true;
    } else if (S.phase === 'chooseRow') {
      txt = (S.pendingChoice && S.pendingChoice.seat === 0) ? '轮到你选行 · 收走一整行' : '亮牌中 · 有人正在选行';
      waiting = true;
    } else if (S.phase === 'trickEnd') {
      txt = '本局结束 · 准备下一局';
      waiting = true;
    } else {
      txt = '牛群归栏 · 正在统计';
      waiting = true;
    }
    D.handPrompt.textContent = txt;
    D.handPrompt.classList.toggle('is-waiting', waiting);
  }

  function updateLockBtn() {
    if (!D.btnLock) return;
    var can = humanCanPick() && pendingPick != null;
    D.btnLock.disabled = !can;
    if (S && S.phase === 'selecting' && S.players[0] &&
      S.players[0].selected !== null && S.players[0].selected !== undefined) {
      D.btnLock.textContent = '已锁定 · 等待亮牌';
    } else {
      D.btnLock.textContent = '锁定出牌';
    }
  }

  function renderAll() {
    if (!S) {
      renderMenu();
      return;
    }
    renderTopbar();
    renderPlayers();
    renderRows();
    renderTray();
    renderHand();
    renderPrompt();
    updateLockBtn();
    renderScoreboard();
    renderLogs();
    saveGame();
  }

  /* ============================================================
     选牌 / AI 定时
     ============================================================ */

  function clearAITimers() {
    for (var i = 0; i < aiTimers.length; i++) window.clearTimeout(aiTimers[i]);
    aiTimers = [];
    thinkingSeats = {};
  }

  function scheduleAITimers(rid) {
    clearAITimers();
    if (!isAlive(rid) || S.phase !== 'selecting') return;
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      if (!p.ai) continue;
      if (p.selected !== null && p.selected !== undefined) continue;
      thinkingSeats[p.seat] = true;
      (function (seat) {
        var rand = delayRng ? delayRng() : 0.5;
        var delay = fastMode ? (20 + rand * 40) : (300 + rand * 1300);
        var timer = window.setTimeout(function () {
          aiTimers = aiTimers.filter(function (t) { return t !== timer; });
          aiChoose(seat, rid);
        }, scene(Math.round(delay)));
        aiTimers.push(timer);
      })(p.seat);
    }
    renderPlayers();
    renderTray();
    renderPrompt();
  }

  function aiChoose(seat, rid) {
    if (!isAlive(rid) || !S || S.phase !== 'selecting') return;
    var p = playerOf(seat);
    if (!p || !p.ai) return;
    if (p.selected !== null && p.selected !== undefined) { delete thinkingSeats[seat]; return; }
    delete thinkingSeats[seat];

    var card = null;
    try {
      var view = SN.viewFor(S, seat);
      card = AI.chooseCard(view, S.settings.difficulty, aiRng);
    } catch (e) { card = null; }
    if (card == null || p.hand.indexOf(card) < 0) card = p.hand[0];

    try {
      SN.selectCard(S, seat, card);
    } catch (e) {
      renderAll();
      return;
    }
    renderAll();
    maybeReveal(rid);
  }

  function onHandClick(e) {
    var target = e.target;
    var btn = null;
    while (target && target !== D.hand) {
      if (target.classList && target.classList.contains('card')) { btn = target; break; }
      target = target.parentNode;
    }
    if (!btn || !humanCanPick()) return;
    var card = Number(btn.getAttribute('data-card'));
    if (!(card >= 1)) return;
    pendingPick = (pendingPick === card) ? null : card;
    renderHand();
    renderPrompt();
    updateLockBtn();
  }

  function lockHuman() {
    if (!humanCanPick() || pendingPick == null) return;
    var rid = runId;
    try {
      SN.selectCard(S, 0, pendingPick);
    } catch (e) {
      pendingPick = null;
      renderAll();
      return;
    }
    pendingPick = null;
    renderAll();
    maybeReveal(rid);
  }

  function maybeReveal(rid) {
    if (!isAlive(rid) || S.phase !== 'selecting') return;
    if (!SN.allSelected(S)) return;
    try {
      SN.beginReveal(S);
    } catch (e) {
      return;
    }
    renderAll();
    saveGame();
    var token = runId;
    window.setTimeout(function () {
      if (token !== runId || !S) return;
      resolveLoop(token);
    }, scene(540));
  }

  /* ============================================================
     选行
     ============================================================ */

  function pickChoice(index) {
    if (!choiceState || choiceState.busy) return;
    if (index < 0 || index >= choiceState.options.length) return;
    choiceState.busy = true;
    var resolve = choiceState.resolve;
    choiceState = null;
    var rows = rowEls();
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-choosable', 'is-target');
    closeModal(D.modalChoice);
    if (resolve) resolve(index);
  }

  function abortChoice() {
    if (!choiceState) return;
    var resolve = choiceState.resolve;
    choiceState = null;
    var rows = rowEls();
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-choosable', 'is-target');
    closeModal(D.modalChoice);
    if (resolve) resolve(null);
  }

  function openChoice(ev, rid) {
    return new Promise(function (resolve) {
      if (!isAlive(rid) || !S) { resolve(null); return; }
      if (D.choiceTitle) {
        D.choiceTitle.textContent = '你打出 ' + ev.card + ' · 必须收一行';
      }
      if (D.choiceSub) {
        D.choiceSub.textContent = '这张牌比所有行尾都小。收走整行的牛头会立刻计入你的分数。';
      }
      var rows = S.rows;
      var html = '';
      for (var oi = 0; oi < ev.options.length; oi++) {
        var ri = ev.options[oi];
        var cards = (rows[ri] && rows[ri].cards) ? rows[ri].cards : [];
        var bulls = SN.rowBulls(cards);
        var danger = cards.length >= 5 || bulls >= 8;
        html += '<button type="button" class="choice-row' + (danger ? ' is-danger' : '') + '"' +
          ' data-row="' + ri + '" aria-label="收走' + ROW_CN[ri] + '，' + bulls + ' 个牛头">' +
          '<span class="choice-no">' + (oi + 1) + '</span>' +
          '<span class="choice-main">' +
          '<span class="choice-title">' + ROW_CN[ri] + ' · ' + cards.length + ' 张牌</span>' +
          '<span class="choice-cards">' + cards.join(' · ') + '</span>' +
          '</span>' +
          '<span class="choice-bulls"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>' + bulls + '</span>' +
          '</button>';
      }
      if (D.choiceRows) D.choiceRows.innerHTML = html;
      if (D.choiceHint) D.choiceHint.textContent = '数字键 1~4 也可以选择 · 收走整行全部牛头';

      choiceState = { resolve: resolve, options: ev.options.slice(), busy: false };

      var els = rowEls();
      for (var i = 0; i < els.length; i++) els[i].classList.add('is-choosable');

      openModal(D.modalChoice, '.choice-row');
    });
  }

  function chooseRowFor(ev, rid) {
    var p = playerOf(ev.seat);
    if (p && p.ai) {
      var idx = ev.options[0];
      try {
        var view = SN.viewFor(S, ev.seat);
        var pick = AI.chooseRow(view, S.settings.difficulty, aiRng);
        if (ev.options.indexOf(pick) >= 0) idx = pick;
      } catch (e) { /* 用默认 */ }
      var els = rowEls();
      if (els[idx]) els[idx].classList.add('is-target');
      toast(p.name + ' 收走' + ROW_CN[idx] + ' · +' + SN.rowBulls(S.rows[idx].cards) + ' 牛头', 1200);
      return wait(520, rid).then(function (ok) {
        if (els[idx]) els[idx].classList.remove('is-target');
        return ok ? idx : null;
      });
    }
    return openChoice(ev, rid);
  }

  /* ============================================================
     飞牌 / 特效
     ============================================================ */

  function makeFlight(sourceEl) {
    if (reducedMotion || !sourceEl || !sourceEl.cloneNode) return null;
    var rect = rectOf(sourceEl);
    if (!rect) return null;
    var node = sourceEl.cloneNode(true);
    node.classList.add('fx-card');
    node.classList.remove('is-selected', 'is-playable', 'is-locked', 'is-disabled', 'anim-flip', 'anim-place', 'anim-deal', 'anim-pop');
    node.removeAttribute('data-card');
    node.style.position = 'fixed';
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
    node.style.margin = '0';
    node.style.transform = 'none';
    node.style.setProperty('--cw', rect.width + 'px');
    if (!D.fx) return null;
    D.fx.appendChild(node);
    return { node: node, rect: rect };
  }

  function launchFlight(flight, destLeft, destTop, scale, duration) {
    if (!flight || !flight.node) return;
    var node = flight.node;
    var from = flight.rect;
    var dx = destLeft - from.left;
    var dy = destTop - from.top;
    var dur = Math.max(1, duration);
    var finished = false;
    function end() {
      if (finished) return;
      finished = true;
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    try {
      var anim = node.animate([
        { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
        { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + scale + ')', opacity: 0.9 }
      ], { duration: dur, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'both' });
      anim.onfinish = end;
      anim.oncancel = end;
    } catch (e) { end(); return; }
    window.setTimeout(end, dur + 140);
  }

  function flyTo(sourceEl, destLeft, destTop, scale, duration) {
    var flight = makeFlight(sourceEl);
    if (!flight) return false;
    launchFlight(flight, destLeft, destTop, scale, scene(duration));
    return true;
  }

  function sparkAt(x, y, count) {
    if (reducedMotion || !D.fx) return;
    var n = count || 10;
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'fx-spark';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      var dx = (Math.random() * 2 - 1) * 46;
      var dy = -18 - Math.random() * 46;
      d.style.setProperty('--dx', dx.toFixed(0) + 'px');
      d.style.setProperty('--dy', dy.toFixed(0) + 'px');
      D.fx.appendChild(d);
      (function (node) {
        window.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1050);
      })(d);
    }
  }

  function bullRiseAt(x, y) {
    if (reducedMotion || !D.fx) return;
    var d = document.createElement('div');
    d.className = 'fx-bull';
    d.innerHTML = '<svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><use href="#bull-head"></use></svg>';
    d.style.left = (x - 13) + 'px';
    d.style.top = (y - 20) + 'px';
    D.fx.appendChild(d);
    window.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1400);
  }

  function scoreFloatAt(x, y, text) {
    if (reducedMotion || !D.fx) return;
    var d = document.createElement('div');
    d.className = 'fx-score';
    d.textContent = text;
    d.style.left = (x - 12) + 'px';
    d.style.top = (y - 30) + 'px';
    D.fx.appendChild(d);
    window.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1250);
  }

  function confetti() {
    if (reducedMotion || !D.fx) return;
    var colors = ['#FF5D73', '#5BC0EB', '#3DDC97', '#FFB703', '#A78BFA'];
    for (var i = 0; i < 46; i++) {
      var d = document.createElement('div');
      d.className = 'fx-confetti';
      d.style.left = (Math.random() * 100) + 'vw';
      d.style.top = '-12px';
      d.style.background = colors[i % colors.length];
      d.style.setProperty('--dx', ((Math.random() * 2 - 1) * 90).toFixed(0) + 'px');
      d.style.animationDelay = ((i % 12) * 55) + 'ms';
      d.style.animationDuration = (1500 + Math.random() * 700) + 'ms';
      D.fx.appendChild(d);
      (function (node) {
        window.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 2800);
      })(d);
    }
  }

  function animateCounter(el, from, to, dur) {
    if (!el) return;
    if (reducedMotion || !dur) { el.textContent = String(to); return; }
    var start = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    function frame(now) {
      if (!el.isConnected) return;
      var k = Math.min(1, (now - start) / dur);
      el.textContent = String(Math.round(from + (to - from) * k));
      if (k < 1) window.requestAnimationFrame(frame);
    }
    el.textContent = String(from);
    window.requestAnimationFrame(frame);
  }

  function flashTake(ev, rid) {
    if (!isAlive(rid)) return;
    var p = playerOf(ev.seat);
    var chip = D.players ? D.players.querySelector('.player-chip[data-seat="' + ev.seat + '"]') : null;
    if (chip && p) {
      var r = rectOf(chip);
      var scoreEl = chip.querySelector('.chip-score');
      if (scoreEl) animateCounter(scoreEl, p.score - ev.bulls, p.score, scene(480));
      if (r) {
        scoreFloatAt(r.left + r.width / 2, r.top + 8, '+' + ev.bulls);
        if (ev.took && ev.took.indexOf(55) >= 0) {
          sparkAt(r.left + r.width / 2, r.top + r.height / 2, 16);
          bullRiseAt(r.left + r.width / 2, r.top + 8);
        }
      }
    }
    var els = rowEls();
    var rowEl = els[ev.rowIndex];
    if (rowEl) {
      rowEl.classList.add('is-taken');
      window.setTimeout(function () { rowEl.classList.remove('is-taken'); }, scene(620) + 60);
    }
  }

  function showRowEat(ev, rid) {
    var els = rowEls();
    var rowEl = els[ev.rowIndex];
    var p = playerOf(ev.seat);
    if (!rowEl || !p) return wait(0, rid);
    var old = rowEl.querySelector('.row-eat');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var node = document.createElement('div');
    node.className = 'row-eat';
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML =
      '<span class="row-eat-plate">' +
      '<span class="row-eat-name">' + esc(p.name) + '</span>' +
      '<span class="row-eat-bulls">+' + ev.bulls + ' 牛头</span>' +
      '</span>';
    rowEl.appendChild(node);
    return wait(1000, rid).then(function (ok) {
      if (!ok) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return ok;
      }
      node.classList.add('is-out');
      return wait(200, rid).then(function (ok2) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return ok2;
      });
    });
  }

  /* ============================================================
     结算动画
     ============================================================ */

  function animatePlace(ev, rid) {
    var els = rowEls();
    var rowEl = els[ev.rowIndex];
    var played = trayCardEl(ev.seat, ev.card);
    if (!rowEl || !played) return Promise.resolve(true);
    var track = rowEl.querySelector('.row-track');
    var cards = track ? $$('.card', track) : [];
    var from = rectOf(played);
    if (!from) return Promise.resolve(true);
    var destLeft, destTop;
    if (cards.length) {
      var last = rectOf(cards[cards.length - 1]);
      destLeft = last ? last.right + 4 : from.left;
      destTop = last ? last.top : from.top;
    } else {
      var tr = rectOf(track);
      destLeft = tr ? tr.left + 8 : from.left;
      destTop = tr ? tr.top + 4 : from.top;
    }
    flyTo(played, destLeft, destTop, 1, 280);
    return wait(290, rid).then(function (ok) {
      if (ok && ev.card === 55 && D.fx) {
        sparkAt(destLeft + from.width / 2, destTop + from.height / 2, 14);
      }
      return ok;
    });
  }

  function animateTake(ev, rid) {
    var els = rowEls();
    var rowEl = els[ev.rowIndex];
    var played = trayCardEl(ev.seat, ev.card);
    if (!rowEl) return Promise.resolve(true);

    var track = rowEl.querySelector('.row-track');
    var rowCards = track ? $$('.card', track) : [];
    var hasKing = ev.card === 55;
    for (var h = 0; h < rowCards.length; h++) {
      if (rowCards[h].getAttribute('data-card') === '55') hasKing = true;
    }

    if (played && track) {
      var tr = rectOf(track);
      var pr = rectOf(played);
      if (tr && pr) {
        flyTo(played, tr.right - Math.min(tr.width * 0.28, 70), tr.top + tr.height * 0.3, 0.82, 210);
      }
    }

    var chip = D.players ? D.players.querySelector('.player-chip[data-seat="' + ev.seat + '"]') : null;
    var target = chip ? rectOf(chip) : null;

    return wait(190, rid).then(function (ok) {
      if (!ok) return false;
      rowEl.classList.add('is-taken');
      var tx = target ? (target.left + target.width / 2) : window.innerWidth / 2;
      var ty = target ? (target.top + target.height / 2) : 40;
      var chain = Promise.resolve(true);
      rowCards.forEach(function (cardEl, idx) {
        chain = chain.then(function (stillOk) {
          if (!stillOk) return false;
          var r = rectOf(cardEl);
          if (r) {
            flyTo(cardEl, tx - r.width / 2, ty - r.height / 2, 0.34, 360);
            if (hasKing && idx === 0 && D.fx) {
              sparkAt(r.left + r.width / 2, r.top + r.height / 2, 12);
            }
          }
          return wait(60, rid);
        });
      });
      return chain.then(function (stillOk) {
        if (!stillOk) return false;
        return wait(360, rid).then(function (done) {
          rowEl.classList.remove('is-taken');
          if (done && hasKing && target && D.fx) {
            bullRiseAt(target.left + target.width / 2, target.top + 6);
          }
          return done;
        });
      });
    });
  }

  function afterResolve(ev) {
    if (ev.type === 'take' && ev.bulls) {
      lastDelta[ev.seat] = (lastDelta[ev.seat] || 0) + ev.bulls;
    }
  }

  function animatePlacedCard(rowIndex) {
    var els = rowEls();
    var rowEl = els[rowIndex];
    if (!rowEl) return;
    var track = rowEl.querySelector('.row-track');
    if (!track) return;
    var cards = $$('.card', track);
    var last = cards[cards.length - 1];
    if (!last) return;
    last.classList.add('anim-place');
    window.setTimeout(function () { last.classList.remove('anim-place'); }, 520);
  }

  function resolveOne(rid) {
    if (!isAlive(rid) || !S) return Promise.resolve(false);

    if (S.phase === 'chooseRow') {
      var pc = S.pendingChoice;
      if (!pc) return Promise.resolve(false);
      return chooseRowFor(pc, rid).then(function (rowIndex) {
        if (rowIndex == null || !isAlive(rid)) return false;
        return animateTake({ seat: pc.seat, card: pc.card, rowIndex: rowIndex, bulls: SN.rowBulls(S.rows[rowIndex].cards), took: S.rows[rowIndex].cards.slice() }, rid)
          .then(function (ok) {
            if (!ok) return false;
            var ev = SN.chooseRow(S, pc.seat, rowIndex);
            afterResolve(ev);
            renderAll();
            flashTake(ev, rid);
            return showRowEat(ev, rid);
          });
      });
    }

    var entry = S.revealQueue[S.revealIndex];
    if (!entry) return Promise.resolve(false);

    var ev = SN.resolveNext(S);

    if (ev.type === 'choice') {
      return chooseRowFor(ev, rid).then(function (rowIndex) {
        if (rowIndex == null || !isAlive(rid)) return false;
        return animateTake({
          seat: ev.seat, card: ev.card, rowIndex: rowIndex,
          bulls: SN.rowBulls(S.rows[rowIndex].cards), took: S.rows[rowIndex].cards.slice()
        }, rid).then(function (ok) {
          if (!ok) return false;
          var ev2 = SN.chooseRow(S, ev.seat, rowIndex);
          afterResolve(ev2);
          renderAll();
          flashTake(ev2, rid);
          return showRowEat(ev2, rid);
        });
      });
    }

    if (ev.type === 'take') {
      afterResolve(ev);
      return animateTake(ev, rid).then(function (ok) {
        if (!ok) return false;
        renderAll();
        flashTake(ev, rid);
        return showRowEat(ev, rid);
      });
    }

    if (ev.type === 'place') {
      return animatePlace(ev, rid).then(function (ok) {
        if (!ok) return false;
        renderAll();
        animatePlacedCard(ev.rowIndex);
        return wait(150, rid);
      });
    }

    return Promise.resolve(false);
  }

  function resolveLoop(rid) {
    if (!isAlive(rid)) return;
    if (resolving) return;
    resolving = true;
    (function run() {
      if (!isAlive(rid)) { if (rid === runId) resolving = false; return; }
      if (S.phase !== 'revealing' && S.phase !== 'chooseRow') {
        if (S.phase === 'trickEnd') {
          endTrick(rid).then(function () { if (rid === runId) resolving = false; });
        } else {
          if (rid === runId) resolving = false;
        }
        return;
      }
      resolveOne(rid).then(function (ok) {
        if (!isAlive(rid) || !ok) {
          if (rid === runId) resolving = false;
          return;
        }
        run();
      }).catch(function () {
        if (rid === runId) resolving = false;
      });
    })();
  }

  function endTrick(rid) {
    if (!isAlive(rid) || S.phase !== 'trickEnd') return Promise.resolve();
    renderAll();
    return wait(620, rid).then(function (ok) {
      if (!ok || !isAlive(rid)) return;
      var res;
      try { res = SN.startNextTrick(S); } catch (e) { return; }
      if (res.type === 'gameEnd') {
        finishGame(rid);
        return;
      }
      lastDelta = {};
      thinkingSeats = {};
      pendingPick = null;
      renderAll();
      saveGame();
      scheduleAITimers(rid);
    });
  }

  /* ============================================================
     终局
     ============================================================ */

  function renderOver(res) {
    var human = null;
    for (var i = 0; i < res.order.length; i++) {
      if (res.order[i].seat === 0) { human = res.order[i]; break; }
    }
    var winnerNames = [];
    for (var w = 0; w < res.winners.length; w++) {
      var wp = playerOf(res.winners[w]);
      if (wp) winnerNames.push(wp.name);
    }
    var humanWon = res.winners.indexOf(0) >= 0;
    if (D.overTitle) {
      if (humanWon && res.winners.length > 1) D.overTitle.textContent = '共享王座';
      else if (humanWon) D.overTitle.textContent = '牛头王诞生';
      else D.overTitle.textContent = '牛群归栏';
    }
    if (D.overSub) {
      if (human) {
        if (humanWon) {
          D.overSub.textContent = res.winners.length > 1
            ? '你与 ' + winnerNames.filter(function (n) { return n !== (human ? human.name : ''); }).join('、') + ' 并列最低 · 共享胜利'
            : '你以 ' + human.score + ' 牛头登顶 · 收走 ' + human.takenCount + ' 张牌';
        } else {
          D.overSub.textContent = '你以 ' + human.score + ' 牛头位列第 ' + human.rank + ' 名 · 冠军 ' + (winnerNames[0] || '') ;
        }
      } else {
        D.overSub.textContent = '牛头分最低者称王';
      }
    }

    if (D.rankList) {
      var html = '';
      for (var k = 0; k < res.order.length; k++) {
        var e = res.order[k];
        var cls = 'rank-row' + (e.winner ? ' is-winner' : '');
        var no = e.shared ? '=' : String(e.rank);
        html += '<div class="' + cls + '">' +
          '<span class="rank-no">' + no + '</span>' +
          '<span class="rank-main">' +
          '<span class="rank-name">' + esc(e.name) + (e.seat === 0 ? '（你）' : '') + '</span>' +
          '<span class="rank-meta">收 ' + e.takenCount + ' 张 · 收行 ' + e.rowsTaken + ' 次' +
          (e.shared ? ' · 并列第一' : '') + '</span>' +
          '</span>' +
          '<span class="rank-score">' + e.score + '<small>牛头</small></span>' +
          '</div>';
      }
      D.rankList.innerHTML = html;
    }

    if (D.overStats) {
      var min = res.order.length ? res.order[0].score : 0;
      D.overStats.innerHTML =
        '<span class="os-chip">参战 <b>' + S.players.length + '</b> 人</span>' +
        '<span class="os-chip">共 <b>' + SN.TRICKS + '</b> 局</span>' +
        '<span class="os-chip">你的收牌 <b>' + (human ? human.takenCount : 0) + '</b> 张</span>' +
        '<span class="os-chip">你的收行 <b>' + (human ? human.rowsTaken : 0) + '</b> 次</span>' +
        '<span class="os-chip">最低分 <b>' + min + '</b> 牛头</span>';
    }
  }

  /* ============================================================
     计分 / 日志弹窗
     ============================================================ */

  function renderScoreModal() {
    if (!D.scoreModalBody) return;
    if (!S) { D.scoreModalBody.textContent = ''; return; }
    var order = S.players.slice().sort(function (a, b) {
      return a.score - b.score || a.seat - b.seat;
    });
    var html = '<p class="rules-lead">第 ' + S.trick + ' 局 · 牛头分最低者领先。收走的牌公开，可随时核对。</p>' +
      '<table class="rules-table score-table"><thead><tr><th>名次</th><th>玩家</th><th>牛头分</th><th>收牌</th><th>收行</th><th>手牌</th></tr></thead><tbody>';
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      html += '<tr' + (p.seat === 0 ? ' class="t-low"' : '') + '>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(p.name) + (p.ai ? '' : '（你）') + '</td>' +
        '<td><b>' + p.score + '</b></td>' +
        '<td>' + p.taken.length + '</td>' +
        '<td>' + p.rowsTaken + '</td>' +
        '<td>' + p.hand.length + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    D.scoreModalBody.innerHTML = html;
  }

  function copyLogs() {
    var text = '';
    if (S) {
      var lines = [];
      for (var i = 0; i < S.log.length; i++) {
        if (S.log[i].type === 'select') continue;
        lines.push(logText(S.log[i]));
      }
      text = lines.join('\n');
    }
    if (!text) { toast('还没有可复制的日志'); return; }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? '日志已复制' : '复制失败，请手动选择');
      } catch (e) { toast('复制失败，请手动选择'); }
    }
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(text).then(function () { toast('日志已复制'); }, fallback);
    } else {
      fallback();
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  function bind() {
    if (D.btnStart) D.btnStart.addEventListener('click', openSetup);
    if (D.btnRules) D.btnRules.addEventListener('click', function () { openModal(D.modalRules); });
    if (D.btnHelp) D.btnHelp.addEventListener('click', function () { openModal(D.modalRules); });

    if (D.btnContinue) {
      D.btnContinue.addEventListener('click', function () {
        var saved = readSave();
        if (!saved) { toast('没有可继续的对局'); renderMenu(); return; }
        resumeGame(saved);
      });
    }

    if (D.btnSetupBack) D.btnSetupBack.addEventListener('click', function () { showScreen('screen-menu'); renderMenu(); });

    if (D.aiCountSeg) {
      D.aiCountSeg.addEventListener('click', function (e) {
        var b = e.target;
        while (b && b !== D.aiCountSeg && !(b.getAttribute && b.getAttribute('data-ai'))) b = b.parentNode;
        if (!b || b === D.aiCountSeg || !b.getAttribute) return;
        prefs.aiCount = clamp(b.getAttribute('data-ai'), 2, 9);
        savePrefs();
        renderSetup();
      });
    }
    if (D.inpName) {
      D.inpName.addEventListener('input', function () {
        prefs.name = (D.inpName.value || '').slice(0, 8);
        savePrefs();
        renderRoster();
      });
      D.inpName.addEventListener('change', function () {
        prefs.name = (D.inpName.value || '').slice(0, 8);
        savePrefs();
      });
    }
    if (D.btnBegin) {
      D.btnBegin.addEventListener('click', function () {
        prefs.name = (D.inpName && D.inpName.value ? D.inpName.value : prefs.name).slice(0, 8);
        savePrefs();
        startNewGame({ aiCount: prefs.aiCount, humanName: humanName() });
      });
    }

    if (D.btnExit) {
      D.btnExit.addEventListener('click', function () {
        if (!S) { goHome(); return; }
        if (S.phase === 'gameEnd') { goHome(); return; }
        openConfirm('退出对局？', '当前进度会保存，回到首页后点「继续上局」即可回到这一局。', function () {
          saveGame();
          goHome();
          toast('对局已保存 · 可从首页继续', 2200);
        });
      });
    }

    if (D.btnScores) {
      D.btnScores.addEventListener('click', function () {
        if (!S) { toast('对局还没开始'); return; }
        renderScoreModal();
        openModal(D.modalScores);
      });
    }
    if (D.btnLog) {
      D.btnLog.addEventListener('click', function () {
        if (!S) { toast('对局还没开始'); return; }
        renderLogModal();
        openModal(D.modalLog, '#logClose');
      });
    }
    if (D.logCopy) D.logCopy.addEventListener('click', copyLogs);

    if (D.btnAgain) {
      D.btnAgain.addEventListener('click', function () {
        startNewGame({ aiCount: prefs.aiCount, humanName: humanName() });
      });
    }
    if (D.btnChangeSetup) {
      D.btnChangeSetup.addEventListener('click', function () {
        openSetup();
      });
    }
    if (D.btnBackHome) {
      D.btnBackHome.addEventListener('click', function () {
        goHome();
      });
    }

    if (D.btnLock) D.btnLock.addEventListener('click', lockHuman);
    if (D.hand) D.hand.addEventListener('click', onHandClick);

    if (D.players) {
      D.players.addEventListener('scroll', updatePlayersOverflow, { passive: true });
    }
    window.addEventListener('resize', updatePlayersOverflow);

    if (D.hand) {
      D.hand.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' &&
          e.key !== 'Home' && e.key !== 'End') return;
        var cards = $$('.card:not([disabled])', D.hand);
        if (!cards.length) return;
        var at = cards.indexOf(document.activeElement);
        var next = at;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at <= 0 ? cards.length - 1 : at - 1;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at >= cards.length - 1 ? 0 : at + 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = cards.length - 1;
        e.preventDefault();
        try { cards[next].focus(); } catch (err) { /* ignore */ }
      });
    }

    if (D.choiceRows) {
      D.choiceRows.addEventListener('click', function (e) {
        var b = e.target;
        while (b && b !== D.choiceRows && !(b.getAttribute && b.getAttribute('data-row'))) b = b.parentNode;
        if (!b || b === D.choiceRows || !b.getAttribute) return;
        var idx = Number(b.getAttribute('data-row'));
        if (idx >= 0) pickChoice(idx);
      });
    }

    if (D.confirmOk) D.confirmOk.addEventListener('click', function () { closeConfirm(true); });
    if (D.confirmCancel) D.confirmCancel.addEventListener('click', function () { closeConfirm(false); });

    document.addEventListener('click', function (e) {
      var node = e.target;
      if (!node || !node.classList || !node.classList.contains('modal') || !node.classList.contains('open')) return;
      if (node.id === 'modal-choice') return;
      if (node.id === 'modal-confirm') { closeConfirm(false); return; }
      closeModal(node);
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.getAttribute && t.getAttribute('data-close')) {
          closeModal(document.getElementById(t.getAttribute('data-close')));
          return;
        }
        t = t.parentNode;
      }
    });

    document.addEventListener('keydown', function (e) {
      var modal = activeModal();
      if (!modal) return;

      if (modal.id === 'modal-choice') {
        if (e.key === 'Escape') { e.preventDefault(); return; }
        if (choiceState && !choiceState.busy) {
          var n = parseInt(e.key, 10);
          if (n >= 1 && n <= choiceState.options.length) {
            e.preventDefault();
            pickChoice(choiceState.options[n - 1]);
          }
        }
        if (e.key === 'Tab') trapFocus(modal, e);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (modal.id === 'modal-confirm') closeConfirm(false);
        else closeModal(modal);
        return;
      }
      if (e.key === 'Tab') trapFocus(modal, e);
    });
  }

  function cacheDom() {
    D.menu = $('screen-menu');
    D.setup = $('screen-setup');
    D.game = $('screen-game');
    D.over = $('screen-over');

    D.btnStart = $('btnStart');
    D.btnContinue = $('btnContinue');
    D.btnRules = $('btnRules');
    D.menuStats = $('menuStats');

    D.btnSetupBack = $('btnSetupBack');
    D.inpName = $('inpName');
    D.aiCountSeg = $('aiCountSeg');
    D.roster = $('roster');
    D.rosterCount = $('rosterCount');
    D.btnBegin = $('btnBegin');

    D.btnExit = $('btnExit');
    D.tbTrick = $('tbTrick');
    D.trickDots = $('trickDots');
    D.btnScores = $('btnScores');
    D.btnLog = $('btnLog');
    D.btnHelp = $('btnHelp');

    D.players = $('players');
    D.table = $('table');
    D.revealTray = $('revealTray');
    D.handPrompt = $('handPrompt');
    D.hand = $('hand');
    D.btnLock = $('btnLock');
    D.scoreboard = $('scoreboard');
    D.latestLog = $('latestLog');
    D.logPanel = $('logPanel');

    D.overTitle = $('overTitle');
    D.overSub = $('overSub');
    D.rankList = $('rankList');
    D.overStats = $('overStats');
    D.btnAgain = $('btnAgain');
    D.btnChangeSetup = $('btnChangeSetup');
    D.btnBackHome = $('btnBackHome');

    D.modalRules = $('modal-rules');
    D.modalChoice = $('modal-choice');
    D.choiceTitle = $('choiceTitle');
    D.choiceSub = $('choiceSub');
    D.choiceRows = $('choiceRows');
    D.choiceHint = $('choiceHint');
    D.modalScores = $('modal-scores');
    D.scoreModalBody = $('scoreModalBody');
    D.modalLog = $('modal-log');
    D.logModalBody = $('logModalBody');
    D.logCopy = $('logCopy');
    D.logClose = $('logClose');
    D.modalConfirm = $('modal-confirm');
    D.confirmTitle = $('confirmTitle');
    D.confirmText = $('confirmText');
    D.confirmOk = $('confirmOk');
    D.confirmCancel = $('confirmCancel');

    D.fx = $('fx');
    D.toast = $('toast');
  }

  /* ============================================================
     初始化
     ============================================================ */

  function parseParams() {
    try {
      urlParams = {};
      var q = window.location.search || '';
      if (q.charAt(0) === '?') q = q.slice(1);
      var parts = q.split('&');
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var kv = parts[i].split('=');
        urlParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      }
    } catch (e) { urlParams = {}; }
    fastMode = urlParams.fast === '1' || urlParams.fast === 'true';
  }

  function init() {
    cacheDom();
    parseParams();
    loadPrefs();

    try {
      var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mq) {
        reducedMotion = !!mq.matches;
        var onMotion = function (ev) { reducedMotion = !!ev.matches; };
        if (mq.addEventListener) mq.addEventListener('change', onMotion);
        else if (mq.addListener) mq.addListener(onMotion);
      }
    } catch (e) { reducedMotion = false; }

    renderSetup();
    bind();

    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    showScreen('screen-menu');
    renderMenu();

    window.__SN_DEBUG__ = {
      getState: function () { return S; }
    };

    var autostart = urlParams.autostart === '1' || urlParams.autostart === 'true';
    if (autostart) {
      var ai = urlParams.ai != null && urlParams.ai !== '' ? clamp(urlParams.ai, 2, 9) : prefs.aiCount;
      var seed = urlParams.seed != null && urlParams.seed !== '' && isFinite(Number(urlParams.seed))
        ? (Number(urlParams.seed) >>> 0) : (Date.now() >>> 0);
      var name = urlParams.name ? String(urlParams.name).slice(0, 8) : humanName();
      startNewGame({ aiCount: ai, humanName: name, seed: seed });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null);