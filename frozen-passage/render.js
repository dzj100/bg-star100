/* 流冰航路 The Frozen Passage — 单人模式渲染与交互 */
(function () {
  'use strict';

  var F = window.FrozenPassage;
  if (!F) {
    document.body.innerHTML = '<p style="padding:24px;color:#16344c">规则引擎加载失败。</p>';
    return;
  }

  var SAVE_KEY = 'frozen-passage.save.v1';
  var PREFS_KEY = 'frozen-passage.prefs.v1';
  var STATS_KEY = 'frozen-passage.stats.v1';

  var DIFF_NAME = { novice: '新手', medium: '中等', expert: '专家' };
  var DIFF_DESC = {
    novice: '目标卡全部背面 · 终点没有约束',
    medium: '翻开两端与中间的目标卡 · 需按照约束颜色航行',
    expert: '5 张目标卡全开 · 终点颜色全约束'
  };
  var DIFF_REVEAL = { novice: 0, medium: 3, expert: 5 };
  var ROUTE_COLOR = { blue: '#1768b5', red: '#c22f3c', black: '#52677d' };

  var ICONS = {
    menu: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".4"/><path d="M7.5 12.3l3.1 3.1 6.1-6.8"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2 22 20H2z"/><path d="M12 9v4.6"/><circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".4"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>',
    compass: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.1 4.9-4.9 2.1 2.1-4.9z"/></svg>',
    snowflake: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11M12 5.2 9.4 3M12 5.2 14.6 3M12 18.8 9.4 21M12 18.8l2.6 2.2"/></svg>',
    sled: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17h13l3 3H6a2 2 0 0 1-2-2z"/><path d="M6 17V9h6l2.5 3.5H20"/><path d="M9 9V5"/></svg>',
    scroll: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3H18a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M6.5 3A2 2 0 0 0 4.5 5v1.5H8"/><path d="M9.5 8h6.5M9.5 12h5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19.2 12a7.3 7.3 0 1 0-2.1 5.2"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    iceberg: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 20 14H4z"/><path d="M4 18h16M7 21h10"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>'
  };

  var GLYPH = {
    blue: '<svg viewBox="0 0 24 16" width="24" height="16" fill="none" aria-hidden="true"><path d="M2 11.5c2.8 0 2.8-4.2 5.6-4.2s2.8 4.2 5.6 4.2 2.8-4.2 5.6-4.2 2.8 4.2 3.2 3.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    red: '<svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d="M12 2.5 22 14H2z" fill="currentColor" opacity=".88"/></svg>',
    black: '<svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d="M12 2l9.5 6-9.5 6L2.5 8z" fill="currentColor" opacity=".88"/></svg>'
  };

  var GOAL_GLYPH = {
    blue: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20v-7a8 8 0 0 1 16 0v7"/><path d="M9 20v-5a3 3 0 0 1 6 0v5"/><path d="M2 20h20"/></svg>',
    red: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.2 20l1-9h3.6l1 9z"/><path d="M8.4 11h7.2l-1.2-4H9.6z"/><path d="M12 3v3M5.5 5l2 2M18.5 5l-2 2"/><path d="M7 20h10"/></svg>',
    black: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/><path d="M3 20h18"/></svg>'
  };

  var S = null;
  var PREFS = { difficulty: 'novice', hints: true };
  var STATS = defaultStats();
  var SAVE_META = { statsRecorded: false, savedAt: 0 };
  var UI = {
    screen: 'setup',
    selectedCardId: null,
    sheet: null,
    focusReturn: null,
    animateSlotId: null,
    animateHandCardId: null,
    sheetPlacement: null
  };

  var toastTimer = null;
  var routeTimer = null;
  var animTimer = null;

  var setupScreen = document.getElementById('setupScreen');
  var gameScreen = document.getElementById('gameScreen');
  var overlay = document.getElementById('overlay');
  var sheetEl = document.getElementById('sheet');
  var sheetTitle = document.getElementById('sheetTitle');
  var sheetBody = document.getElementById('sheetBody');
  var sheetActions = document.getElementById('sheetActions');
  var toastEl = document.getElementById('toast');

  /* ---------------- 基础工具 ---------------- */

  function defaultStats() {
    return {
      novice: { plays: 0, wins: 0, best: null },
      medium: { plays: 0, wins: 0, best: null },
      expert: { plays: 0, wins: 0, best: null }
    };
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 本地存储不可用时静默 */ }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  function readJSON(key, fallback) {
    var raw = storageGet(key);
    if (!raw) return fallback;
    try {
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function colorName(color) { return F.COLOR_NAME[color] || color; }

  function itemIcon(type) {
    if (type === 'inuit') return ICONS.snowflake;
    if (type === 'sled') return ICONS.sled;
    return ICONS.scroll;
  }

  function cardName(cardId) {
    var card = F.getCard(cardId);
    return card ? colorName(card.color) + ' ' + card.number : '未知卡牌';
  }

  function shortCard(cardId) {
    var card = F.getCard(cardId);
    if (!card) return '';
    return '<b>' + colorName(card.color) + ' ' + card.number + '</b>';
  }

  function posLabel(slot) {
    return '第 ' + slot.row + ' 行第 ' + slot.index + ' 位';
  }

  function slotEl(slotId) {
    return document.querySelector('.slot[data-slot="' + slotId + '"]');
  }

  function goalForSlot(slotId) {
    if (!S) return null;
    for (var i = 0; i < S.board.goals.length; i++) {
      if (S.board.goals[i].slotId === slotId) return S.board.goals[i];
    }
    return null;
  }

  function placedCount() {
    if (!S) return 0;
    return S.board.slots.filter(function (s) { return !!s.cardId; }).length;
  }

  function isTerminal() {
    return !!S && (S.phase === 'won' || S.phase === 'lost');
  }

  function hasUnused(type) {
    return !!S && F.hasUnusedItem(S, type);
  }

  function phaseHint() {
    if (!S) return '还没有开始对局。';
    if (S.phase === 'refill') return '先从供应堆补 1 张手牌。';
    if (S.phase === 'stuck') return '没有可放置的卡牌，试试物品。';
    if (S.phase === 'won' || S.phase === 'lost') return '本局已经结束。';
    return '现在不能进行这个操作。';
  }

  function newSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function cardChip(card) {
    return '<span class="info-chip color-' + card.color + '"><i></i>' +
      colorName(card.color) + ' ' + card.number + '</span>';
  }

  function placementErrorText(check, slot, card) {
    if (!check || check.ok) return '';
    if (check.code === 'support') {
      var missing = (check.missing || []).map(function (id) {
        var s = F.slotById(S, id);
        return s ? posLabel(s) : id;
      });
      return '下方支撑不足：还缺 ' + missing.join('、') + '。';
    }
    if (check.code === 'goal') {
      return '正面目标卡要求' + colorName(check.goalColor) + '色，这张' +
        colorName(card.color) + '色卡不能放在这里。';
    }
    if (check.code === 'color') {
      return '这里必须放' + colorName(check.supportColor) + '色：下方' +
        colorName(check.supportColor) + ' ' + check.supportNumber + ' 的上方还没有同色牌。';
    }
    if (check.code === 'number-left') {
      var left = F.nearestOccupiedInRow(S, slot.row, slot.index, -1);
      var leftName = left ? cardName(left.cardId) : '卡牌';
      return S.wisdom
        ? '需大于左侧的 ' + leftName + '，或与紧邻卡牌同数字。'
        : '需大于同行左侧最近的 ' + leftName + '。';
    }
    if (check.code === 'number-right') {
      var right = F.nearestOccupiedInRow(S, slot.row, slot.index, 1);
      var rightName = right ? cardName(right.cardId) : '卡牌';
      return S.wisdom
        ? '需小于右侧的 ' + rightName + '，或与紧邻卡牌同数字。'
        : '需小于同行右侧最近的 ' + rightName + '。';
    }
    if (check.code === 'occupied') return '这个位置已经有卡牌了。需要替换可用航海日志。';
    return check.message || '不能放在这里。';
  }

  function flashSlot(el) {
    if (!el) return;
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 900);
  }

  function toast(message, tone) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = 'toast is-show' + (tone ? ' is-' + tone : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = 'toast' + (tone ? ' is-' + tone : '');
    }, 2800);
  }

  function savePrefs() {
    storageSet(PREFS_KEY, JSON.stringify(PREFS));
  }

  function saveStats() {
    storageSet(STATS_KEY, JSON.stringify(STATS));
  }

  function saveGame() {
    if (!S) return;
    SAVE_META.savedAt = Date.now();
    storageSet(SAVE_KEY, JSON.stringify({
      state: S,
      statsRecorded: SAVE_META.statsRecorded,
      savedAt: SAVE_META.savedAt
    }));
  }

  function loadPrefs() {
    var value = readJSON(PREFS_KEY, null);
    if (!value) return;
    if (F.DIFFICULTIES.indexOf(value.difficulty) >= 0) PREFS.difficulty = value.difficulty;
    if (typeof value.hints === 'boolean') PREFS.hints = value.hints;
  }

  function loadStats() {
    var value = readJSON(STATS_KEY, null);
    STATS = defaultStats();
    if (!value) return;
    F.DIFFICULTIES.forEach(function (key) {
      var src = value[key];
      if (!src) return;
      var plays = Number(src.plays);
      var wins = Number(src.wins);
      var best = src.best == null ? null : Number(src.best);
      STATS[key].plays = isFinite(plays) && plays > 0 ? Math.floor(plays) : 0;
      STATS[key].wins = isFinite(wins) && wins > 0 ? Math.floor(wins) : 0;
      STATS[key].best = isFinite(best) && best > 0 ? Math.floor(best) : null;
    });
  }

  function loadSave() {
    var raw = storageGet(SAVE_KEY);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      var candidate = parsed && parsed.state ? parsed.state : parsed;
      var state = F.deserialize(candidate);
      if (!state) return;
      S = state;
      SAVE_META.statsRecorded = !!(parsed && parsed.statsRecorded);
      SAVE_META.savedAt = (parsed && Number(parsed.savedAt)) || 0;
      if (F.DIFFICULTIES.indexOf(S.difficulty) >= 0) PREFS.difficulty = S.difficulty;
    } catch (e) {
      S = null;
    }
  }

  function maybeRecordResult() {
    if (!S || !isTerminal() || SAVE_META.statsRecorded) return;
    var stat = STATS[S.difficulty];
    if (!stat) stat = STATS[S.difficulty] = { plays: 0, wins: 0, best: null };
    stat.plays += 1;
    if (S.phase === 'won') {
      stat.wins += 1;
      stat.best = stat.best == null ? S.turn : Math.min(stat.best, S.turn);
    }
    SAVE_META.statsRecorded = true;
    saveStats();
  }

  /* ---------------- 焦点与弹层 ---------------- */

  function selectorFor(el) {
    if (!el || el === document.body || !el.getAttribute) return null;
    if (el.id) return '#' + el.id;
    var action = el.getAttribute('data-action');
    if (!action) return null;
    var selector = '[data-action="' + action + '"]';
    ['card', 'slot', 'type', 'diff', 'tab'].forEach(function (attr) {
      var value = el.getAttribute('data-' + attr);
      if (value) selector += '[data-' + attr + '="' + value + '"]';
    });
    return selector;
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function refocus() {
    var selector = UI.focusReturn;
    UI.focusReturn = null;
    var target = selector ? document.querySelector(selector) : null;
    if (!isVisible(target)) {
      target = UI.screen === 'game'
        ? document.getElementById('btnMenu')
        : document.querySelector('[data-action="start"]');
    }
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function openSheet(type, data) {
    var firstOpen = overlay.hidden;
    UI.sheet = Object.assign({ type: type }, data || {});
    if (firstOpen) UI.focusReturn = selectorFor(document.activeElement);
    renderSheet(null, firstOpen);
  }

  function closeSheet(restore) {
    if (overlay.hidden) return;
    UI.sheet = null;
    overlay.hidden = true;
    document.body.style.overflow = '';
    sheetBody.innerHTML = '';
    sheetActions.innerHTML = '';
    sheetActions.hidden = false;
    if (restore !== false) refocus();
  }

  function renderSheet(focusSelector, firstOpen) {
    if (!UI.sheet || !SHEETS[UI.sheet.type]) {
      closeSheet(false);
      return;
    }
    var model = SHEETS[UI.sheet.type](UI.sheet);
    if (!model) {
      closeSheet(false);
      return;
    }
    sheetTitle.textContent = model.title;
    sheetBody.innerHTML = model.body;
    sheetActions.innerHTML = model.actions || '';
    sheetActions.hidden = !model.actions;
    sheetEl.scrollTop = 0;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    sheetEl.tabIndex = -1;
    var wasHidden = firstOpen;
    requestAnimationFrame(function () {
      var target = focusSelector ? sheetEl.querySelector(focusSelector) : null;
      if (!isVisible(target)) target = wasHidden ? sheetEl : sheetEl.querySelector('[data-autofocus]');
      if (!isVisible(target)) target = sheetEl;
      if (target && target.focus) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
      }
    });
  }

  function trapTab(ev) {
    var nodes = sheetEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    var focusables = Array.prototype.filter.call(nodes, isVisible);
    if (!focusables.length) {
      ev.preventDefault();
      sheetEl.focus();
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;
    if (ev.shiftKey) {
      if (active === first || active === sheetEl || focusables.indexOf(active) < 0) {
        ev.preventDefault();
        last.focus();
      }
    } else if (active === last || active === sheetEl || focusables.indexOf(active) < 0) {
      ev.preventDefault();
      first.focus();
    }
  }

  /* ---------------- 设置页 ---------------- */

  function statsLine(difficulty) {
    var stat = STATS[difficulty] || { plays: 0, wins: 0, best: null };
    if (!stat.plays) return DIFF_NAME[difficulty] + '：还没有完成的对局';
    var best = stat.best != null ? ' · 最少 <b>' + stat.best + '</b> 回合' : '';
    return DIFF_NAME[difficulty] + '：完成 <b>' + stat.plays + '</b> 局 · 胜 <b>' +
      stat.wins + '</b> 局' + best;
  }

  function saveSummary() {
    if (!S) return '';
    if (isTerminal()) return DIFF_NAME[S.difficulty] + ' · 已结束 · 查看结算';
    return DIFF_NAME[S.difficulty] + ' · 第 ' + S.turn + ' 回合 · ' + placedCount() + '/15';
  }

  function difficultyCards() {
    var active = PREFS.difficulty;
    return F.DIFFICULTIES.map(function (key) {
      var isActive = key === active;
      return '<button type="button" class="diff-card' + (isActive ? ' is-active' : '') +
        '" data-action="diff" data-diff="' + key + '" aria-pressed="' + isActive + '">' +
        '<span class="diff-radio" aria-hidden="true"></span>' +
        '<span class="diff-text"><b>' + DIFF_NAME[key] + '</b><span>' + DIFF_DESC[key] + '</span></span>' +
        '<span class="diff-tag">翻 ' + DIFF_REVEAL[key] + '</span>' +
        '</button>';
    }).join('');
  }

  function renderSetup() {
    var saveRow = S
      ? '<div class="save-row"><button type="button" class="btn btn-primary" data-action="continue" aria-label="继续存档：' +
        saveSummary() + '"><span>继续航程</span><span class="save-summary">' + saveSummary() + '</span></button></div>'
      : '';

    var startBtn = '<button type="button" class="btn ' + (S ? 'btn-ghost' : 'btn-primary') +
      ' btn-start" data-action="start">' + (S ? '启程 · 新航路' : '启程') + '</button>';

    var clearLink = S
      ? '<span aria-hidden="true">·</span><button type="button" class="text-btn" data-action="clear-save">清除存档</button>'
      : '';

    setupScreen.innerHTML =
      '<div class="setup-wrap">' +
        '<div class="hero">' +
          '<div class="hero-art">' +
            '<svg class="hero-scene" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
              '<rect width="400" height="300" fill="#f2f5f6"/>' +
              '<path d="M0 0h400v128c-140 34-286 26-400-10Z" fill="#e2e7e9"/>' +
              '<circle cx="76" cy="60" r="48" fill="#ffffff" opacity=".14"/>' +
              '<circle cx="76" cy="60" r="28" fill="#ffffff" opacity=".5"/>' +
              '<path d="M-24 44c46-11 90-11 126 0" stroke="#ffffff" stroke-width="9" stroke-linecap="round" fill="none" opacity=".45"/>' +
              '<path d="M212 30c30-7 58-6 84 2" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".38"/>' +
              '<g stroke="#6f93a8" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".55">' +
                '<path d="M152 74c3-4 6-4 9 0M166 67c3-4 6-4 9 0"/>' +
              '</g>' +
              '<g stroke="#9dbdcd" stroke-width="1" stroke-linejoin="round">' +
                '<path d="M228 130l14-24 9 9 8-5 15 20Z" fill="#e9f3f8"/>' +
                '<path d="M242 106l9 9-5 15h-12Z" fill="#dcebf3" stroke="none"/>' +
                '<path d="M268 130l9-15 6 5 6-3 10 13Z" fill="#f1f8fb"/>' +
              '</g>' +
              '<path d="M-40 178c64-62 158-70 238-30 72 36 138 30 242-34v186H-40Z" fill="#1768b5"/>' +
              '<path d="M-40 222c82-10 142 4 210-2 74-6 140 2 210-12" stroke="#ffffff" stroke-opacity=".26" stroke-width="7" fill="none" stroke-linecap="round"/>' +
              '<path d="M-20 264c70-8 120 2 186-2 70-4 128 2 196-8" stroke="#0f4f86" stroke-opacity=".22" stroke-width="5" fill="none" stroke-linecap="round"/>' +
              '<path d="M206 168c22 4 44 4 66 0" stroke="#ffffff" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="5 7" fill="none"/>' +
              '<g transform="translate(96,-2)" stroke="#b9cbd6" stroke-width="1.2" stroke-linejoin="round">' +
                '<rect x="221" y="74" width="3" height="84" rx="1.5" fill="#b9c7cf" stroke="none"/>' +
                '<path d="M225 80v70h38Z" fill="#ffffff"/>' +
                '<path d="M219 88v62h-30Z" fill="#f2f7fa"/>' +
                '<path d="M222.5 70 202 79l20.5 9Z" fill="#e0262c" stroke="none"/>' +
                '<path d="M196 158h58l-12 14h-30Z" fill="#e0262c" stroke="none"/>' +
                '<path d="M204 158h42l-4 5h-34Z" fill="#ffffff" opacity=".35" stroke="none"/>' +
              '</g>' +
            '</svg>' +
            '<div class="hero-copy">' +
              '<span class="hero-kicker">单人解谜 · SOLO</span>' +
              '<h1 class="hero-title">流冰航路</h1>' +
              '<div class="hero-en">THE FROZEN PASSAGE</div>' +
            '</div>' +
          '</div>' +
          '<p class="hero-desc">十五座冰山，三条彩色航路。<br>让数字自左向右递增，让颜色从冰面连向远方。</p>' +
        '</div>' +
        '<div class="setup-panel">' +
          saveRow +
          startBtn +
          '<div class="setup-links">' +
            '<button type="button" class="text-btn" data-action="rules">规则</button>' +
            '<span aria-hidden="true">·</span>' +
            '<button type="button" class="text-btn" data-action="stats">航行记录</button>' +
            clearLink +
          '</div>' +
          '<p class="setup-foot">启程时选择难度 · 进度自动保存在本机</p>' +
        '</div>' +
      '</div>' +
      '<footer class="credit" aria-label="@imStar100">' +
        '<span class="credit-rule" aria-hidden="true"></span>' +
        '<svg class="credit-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M12 2c.7 5.6 2.4 7.3 8 8-5.6.7-7.3 2.4-8 8-.7-5.6-2.4-7.3-8-8 5.6-.7 7.3-2.4 8-8Z"/>' +
        '</svg>' +
        '<span class="credit-text">@imStar100</span>' +
        '<span class="credit-rule" aria-hidden="true"></span>' +
      '</footer>';
  }

  /* ---------------- 游戏页 ---------------- */

  function buildView() {
    var selected = null;
    if (S && S.phase === 'place' && UI.selectedCardId && S.hand.indexOf(UI.selectedCardId) >= 0) {
      selected = F.getCard(UI.selectedCardId);
    } else if (S && S.phase !== 'place') {
      UI.selectedCardId = null;
    }
    var placements = selected ? F.legalPlacements(S, selected.id) : [];
    var legalMap = Object.create(null);
    var supportMap = Object.create(null);
    placements.forEach(function (p) {
      legalMap[p.slotId] = p;
      F.supportSlots(S, F.slotById(S, p.slotId)).forEach(function (below) {
        supportMap[below.id] = true;
      });
    });
    var counts = Object.create(null);
    if (S && S.phase === 'place') {
      S.hand.forEach(function (id) { counts[id] = F.legalPlacements(S, id).length; });
    }
    return { selected: selected, placements: placements, legalMap: legalMap, supportMap: supportMap, counts: counts };
  }

  function renderTopbar() {
    var left = 15 - placedCount();
    return '<header class="topbar">' +
      '<button type="button" class="icon-btn" id="btnMenu" data-action="menu" aria-label="打开菜单">' + ICONS.menu + '</button>' +
      '<div class="topbar-title">' +
        '<span class="topbar-name">流冰航路</span>' +
        '<span class="topbar-sub">单人 · ' + DIFF_NAME[S.difficulty] + ' · 第 ' + S.turn + ' 回合</span>' +
      '</div>' +
      '<div class="topbar-right">' +
        '<span class="remaining" aria-label="剩余 ' + left + ' 个空位"><b>' + left + '</b>空位</span>' +
        '<button type="button" class="icon-btn" id="btnRules" data-action="rules" aria-label="查看规则">' + ICONS.book + '</button>' +
      '</div>' +
    '</header>';
  }

  function infoBar(view) {
    var tone = '';
    var chip = '';
    var text = '';
    var side = '';
    var actions = '';

    if (S.phase === 'place') {
      var wisdomChip = S.wisdom
        ? '<span class="info-chip is-wisdom"><i></i>因纽特智慧</span>'
        : '';
      if (view.selected) {
        var count = view.placements.length;
        chip = wisdomChip + cardChip(view.selected);
        if (PREFS.hints) {
          text = count > 0
            ? '可放 <b>' + count + '</b> 个位置 · 点按闪烁空位'
            : '这张牌目前无处可放';
          tone = count > 0 ? (S.wisdom ? 'is-accent' : '') : 'is-warn';
        } else {
          text = '规则提示已关闭 · 直接点按空位尝试';
          if (S.wisdom) tone = 'is-accent';
        }
        actions = '<button type="button" class="mini-btn" data-action="clear-select">取消</button>';
      } else {
        chip = wisdomChip;
        text = S.wisdom
          ? '因纽特智慧生效 · 本回合可与紧邻卡牌同数字'
          : (PREFS.hints
            ? '选择一张手牌，查看可放置的位置'
            : '选择一张手牌，直接尝试放置');
        tone = S.wisdom ? 'is-accent' : '';
        side = PREFS.hints ? '手牌 ' + S.hand.length + ' · 供应 ' + S.supply.length : '提示已关';
      }
    } else if (S.phase === 'refill') {
      tone = 'is-accent';
      text = '补牌阶段 · 从供应堆选择 1 张';
      side = '牌背只看颜色';
      actions = '<button type="button" class="mini-btn" data-action="open-refill">选牌</button>';
    } else if (S.phase === 'stuck') {
      tone = 'is-danger';
      text = '没有可放置的卡牌 · 使用物品或宣告失败';
      actions = '<button type="button" class="mini-btn is-danger" data-action="open-stuck">办法</button>';
    } else if (S.phase === 'won') {
      tone = 'is-accent';
      text = '航路贯通 · 15 个位置全部填满';
      actions = '<button type="button" class="mini-btn" data-action="view-result">结算</button>';
    } else if (S.phase === 'lost') {
      tone = 'is-danger';
      text = S.lossReason === 'no-hand' ? '手牌已空 · 航路中断' : '已宣告失败 · 航路中断';
      actions = '<button type="button" class="mini-btn is-danger" data-action="view-result">结算</button>';
    }

    return '<div class="info-bar ' + tone + '" id="infoBar">' +
      '<div class="info-main">' + chip + '<span class="info-text">' + text + '</span></div>' +
      (side ? '<span class="info-side">' + side + '</span>' : '') +
      (actions ? '<div class="info-actions">' + actions + '</div>' : '') +
    '</div>';
  }

  function goalTab(slot) {
    if (slot.row !== 5) return '';
    var goal = goalForSlot(slot.id);
    if (!goal) return '';
    if (goal.faceUp) {
      return '<span class="goal-tab color-' + goal.color + '" role="img" aria-label="目标卡：' +
        colorName(goal.color) + '色，正面朝上" title="目标卡：' + colorName(goal.color) + '色">' +
        '<span class="goal-glyph">' + GOAL_GLYPH[goal.color] + '</span></span>';
    }
    return '<span class="goal-tab is-down" role="img" aria-label="目标卡：背面朝上" title="目标卡：背面朝上">' +
      '<span class="goal-q">?</span></span>';
  }

  function renderSlot(slot, view) {
    var card = slot.cardId ? F.getCard(slot.cardId) : null;
    var classes = ['slot'];
    if (card) {
      classes.push('is-filled', 'color-' + card.color);
    } else {
      classes.push('is-empty');
    }
    if (view.selected && PREFS.hints && !card) {
      classes.push(view.legalMap[slot.id] ? 'is-legal' : 'is-illegal');
    }
    if (view.selected && PREFS.hints && view.supportMap[slot.id]) classes.push('is-support');
    if (UI.animateSlotId === slot.id) classes.push('is-just-placed');

    var aria = posLabel(slot) + '，';
    if (card) {
      aria += colorName(card.color) + ' ' + card.number;
      var goal = slot.row === 5 ? goalForSlot(slot.id) : null;
      if (goal && goal.faceUp) aria += '，目标卡要求' + colorName(goal.color) + '色';
    } else {
      aria += '空位';
      if (view.selected && PREFS.hints && view.legalMap[slot.id]) aria += '，可放置';
    }

    var inner = card
      ? '<span class="slot-inner"><span class="card-number">' + card.number + '</span>' +
          '<span class="card-glyph">' + GLYPH[card.color] + '</span></span>'
      : '<span class="slot-inner"><span class="slot-plus" aria-hidden="true">+</span></span>';

    return '<div class="slot-wrap">' +
      goalTab(slot) +
      '<button type="button" class="' + classes.join(' ') + '" data-action="tap-slot" data-slot="' + slot.id +
        '" aria-label="' + aria + '">' + inner + '</button>' +
      (slot.row === 1
        ? '<span class="starter-hint" aria-hidden="true">' + ICONS.iceberg + '<span>起始</span></span>'
        : '') +
    '</div>';
  }

  function renderBoard(view) {
    var rows = '';
    for (var row = 5; row >= 1; row--) {
      var slots = S.board.slots.filter(function (s) { return s.row === row; })
        .sort(function (a, b) { return a.index - b.index; });
      rows += '<div class="board-row" role="group" aria-label="第 ' + row + ' 行">' +
        slots.map(function (slot) { return renderSlot(slot, view); }).join('') +
      '</div>';
    }
    return '<div class="board" id="board">' +
      '<svg class="route-lines" aria-hidden="true" focusable="false"></svg>' +
      rows +
    '</div>';
  }

  function itemAvailability(type) {
    if (!hasUnused(type)) return { available: false, why: '已使用' };
    if (type === 'inuit') {
      if (S.wisdom) return { available: false, why: '本回合已生效' };
      return {
        available: F.canUseInuit(S),
        why: S.phase === 'place' || S.phase === 'stuck'
          ? '需要与紧邻卡牌同数字的落点'
          : '放置前使用'
      };
    }
    if (type === 'sled') {
      return { available: F.canUseSled(S), why: '需要手牌与供应堆' };
    }
    return { available: F.canUseLog(S), why: '没有可替换的组合' };
  }

  function renderSupply() {
    var cards = S.supply.map(function (id) {
      var card = F.getCard(id);
      return '<button type="button" class="supply-card color-' + card.color +
        (S.phase === 'refill' ? ' is-pickable' : '') +
        '" data-action="supply-card" data-card="' + id +
        '" aria-label="供应堆卡牌，' + colorName(card.color) + '色牌背">' +
        '<span class="supply-q" aria-hidden="true">?</span>' +
        '<span class="supply-color" aria-hidden="true">' + colorName(card.color) + '</span>' +
        '</button>';
    }).join('');

    return '<section class="tray-panel supply-panel" aria-label="供应堆">' +
      '<div class="tray-title"><span>供应堆 · ' + S.supply.length + '</span>' +
        (S.phase === 'refill' ? '<span class="tray-pulse">选择 1 张</span>' : '') +
      '</div>' +
      (S.supply.length
        ? '<div class="supply-row">' + cards + '</div>'
        : '<div class="tray-empty">供应堆已空</div>') +
    '</section>';
  }

  function renderItems() {
    var unused = S.items.filter(function (it) { return !it.used; }).length;
    var tokens = S.items.map(function (item) {
      var av = itemAvailability(item.type);
      var classes = ['item-token'];
      if (item.used) classes.push('is-used');
      else if (!av.available) classes.push('is-unavailable');
      var stateText = item.used ? '已使用' : (av.available ? '可使用' : '不可用，' + av.why);
      return '<button type="button" class="' + classes.join(' ') + '" data-action="item" data-type="' + item.type +
        '" aria-label="' + F.ITEM_NAME[item.type] + '，' + stateText + '。' + F.ITEM_DESC[item.type] + '">' +
        '<span class="item-icon" aria-hidden="true">' + itemIcon(item.type) + '</span>' +
        '<span class="item-name">' + F.ITEM_NAME[item.type] + '</span>' +
        (item.used ? '<span class="item-flag">已用</span>' : '') +
      '</button>';
    }).join('');

    return '<section class="tray-panel items-panel" aria-label="物品">' +
      '<div class="tray-title"><span>物品 · ' + unused + '/3</span>' +
        (S.phase === 'stuck' ? '<span class="tray-pulse">也许能脱困</span>' : '') +
      '</div>' +
      '<div class="items-row">' + tokens + '</div>' +
    '</section>';
  }

  function renderHand(view) {
    if (!S.hand.length) {
      return '<footer class="hand-dock"><div class="hand"><span class="tray-empty">手牌已空</span></div></footer>';
    }
    var canSelect = S.phase === 'place';
    var cards = S.hand.map(function (id) {
      var card = F.getCard(id);
      var count = view.counts[id] || 0;
      var classes = ['hand-card', 'color-' + card.color];
      if (UI.selectedCardId === id) classes.push('is-selected');
      if (PREFS.hints && canSelect && count === 0) classes.push('is-blocked');
      if (UI.animateHandCardId === id) classes.push('is-new');
      var aria = colorName(card.color) + ' ' + card.number;
      if (PREFS.hints && canSelect) aria += '，' + count + ' 个可放位置';
      if (!canSelect) aria += '，' + phaseHint();
      return '<button type="button" class="' + classes.join(' ') + '" data-action="select-hand" data-card="' + id +
        '" aria-pressed="' + (UI.selectedCardId === id) + '"' +
        (canSelect ? '' : ' aria-disabled="true"') +
        ' aria-label="' + aria + '">' +
        '<span class="hand-inner">' +
          '<span class="hand-number">' + card.number + '</span>' +
          '<span class="hand-glyph">' + GLYPH[card.color] + '</span>' +
        '</span>' +
        (PREFS.hints && canSelect
          ? '<span class="hand-badge' + (count === 0 ? ' is-bad' : '') + '" aria-hidden="true">' + count + '</span>'
          : '') +
      '</button>';
    }).join('');

    return '<footer class="hand-dock"><div class="hand" role="group" aria-label="手牌">' + cards + '</div></footer>';
  }

  function renderGame() {
    var view = buildView();
    gameScreen.innerHTML =
      renderTopbar() +
      infoBar(view) +
      '<main class="game-main">' +
        '<div class="board-wrap">' + renderBoard(view) + '</div>' +
        '<div class="tray">' + renderSupply() + renderItems() + '</div>' +
      '</main>' +
      renderHand(view);
    scheduleRoutes();
  }

  function render() {
    var playing = !!(S && UI.screen === 'game');
    document.body.classList.toggle('is-playing', playing);
    if (playing) {
      setupScreen.hidden = true;
      gameScreen.hidden = false;
      renderGame();
    } else {
      gameScreen.hidden = true;
      setupScreen.hidden = false;
      renderSetup();
    }
  }

  /* ---------------- 航线连线 ---------------- */

  function scheduleRoutes() {
    if (routeTimer) clearTimeout(routeTimer);
    requestAnimationFrame(drawRoutes);
    routeTimer = setTimeout(drawRoutes, 260);
  }

  function drawRoutes() {
    if (!S) return;
    var board = document.getElementById('board');
    if (!board) return;
    var svg = board.querySelector('.route-lines');
    if (!svg) return;
    var bounds = board.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    svg.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + bounds.height);
    var parts = [];
    S.board.slots.forEach(function (slot) {
      if (!slot.cardId) return;
      var color = F.getCard(slot.cardId).color;
      F.supportSlots(S, slot).forEach(function (below) {
        if (!below.cardId) return;
        if (F.getCard(below.cardId).color !== color) return;
        var a = slotEl(below.id);
        var b = slotEl(slot.id);
        if (!a || !b) return;
        var ar = a.getBoundingClientRect();
        var br = b.getBoundingClientRect();
        var x1 = ar.left + ar.width / 2 - bounds.left;
        var y1 = ar.top + ar.height / 2 - bounds.top;
        var x2 = br.left + br.width / 2 - bounds.left;
        var y2 = br.top + br.height / 2 - bounds.top;
        parts.push('<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
          '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
          '" stroke="' + ROUTE_COLOR[color] + '" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>');
      });
    });
    svg.innerHTML = parts.join('');
  }

  /* ---------------- 规则检查渲染 ---------------- */

  function ruleCheckRows(card, slot, check) {
    var rows = [];

    var belowText;
    if (slot.row === 1) {
      belowText = '起始卡（无颜色）直接托住。';
    } else {
      var below = F.supportSlots(S, slot).map(function (s) { return shortCard(s.cardId); });
      belowText = '下方 ' + below.join('、') + ' 均已就位。';
    }
    rows.push(checkRow('支撑', belowText, '', false));

    var colorText;
    var colorWarn = false;
    var colorNote = '';
    if (slot.row === 1) {
      colorText = '起始卡无颜色，任意颜色均可。';
    } else if (check.colorMatches && check.colorMatches.length) {
      colorText = '与下方 ' + check.colorMatches.map(function (c) {
        return '<b>' + colorName(c.color) + ' ' + c.number + '</b>';
      }).join('、') + ' 同色相连。';
    } else {
      colorWarn = true;
      colorText = '下方没有同色卡，将另起一条 <b>' + colorName(card.color) + '</b> 色航线。';
      colorNote = '下方每张牌都需由上方两张之一接续。';
    }
    rows.push(checkRow('颜色', colorText, colorNote, colorWarn));

    var left = F.nearestOccupiedInRow(S, slot.row, slot.index, -1);
    var right = F.nearestOccupiedInRow(S, slot.row, slot.index, 1);
    var leftCard = left ? F.getCard(left.cardId) : null;
    var rightCard = right ? F.getCard(right.cardId) : null;
    var leftSame = !!(S.wisdom && leftCard && left.index === slot.index - 1 &&
      card.number === leftCard.number);
    var rightSame = !!(S.wisdom && rightCard && right.index === slot.index + 1 &&
      card.number === rightCard.number);
    var numberText;
    if (!leftCard && !rightCard) {
      numberText = '本行暂无相邻卡牌，不受数字约束。';
    } else {
      var labels = [];
      var chain = '';
      if (leftCard) {
        labels.push('左邻 ' + colorName(leftCard.color) + ' ' + leftCard.number);
        chain += leftCard.number + (leftSame ? ' ≤ ' : ' &lt; ');
      }
      chain += '<b>' + card.number + '</b>';
      if (rightCard) {
        labels.push('右邻 ' + colorName(rightCard.color) + ' ' + rightCard.number);
        chain += (rightSame ? ' ≤ ' : ' &lt; ') + rightCard.number;
      }
      numberText = labels.join('、') + '：' + chain + '。';
    }
    var numberNote = '';
    if (S.wisdom) {
      numberNote = (leftSame || rightSame)
        ? '因纽特智慧生效：与紧邻卡牌同数字，隔空仍不允许。'
        : '因纽特智慧生效：本次放置也可与紧邻卡牌同数字。';
    }
    rows.push(checkRow('数字', numberText, numberNote, false));

    var goal = slot.row === 5 ? goalForSlot(slot.id) : null;
    var goalText;
    if (goal && goal.faceUp) {
      goalText = '正面目标卡为 <b>' + colorName(goal.color) + '</b> 色，与卡牌同色。';
    } else if (goal) {
      goalText = '目标卡背面朝上，无颜色要求。';
    } else {
      goalText = '目标卡只约束第 5 行，本行不受影响。';
    }
    rows.push(checkRow('目标卡', goalText, '', false));

    return rows.join('');
  }

  function checkRow(label, value, note, warn) {
    return '<div class="check-row">' +
      '<span class="check-icon' + (warn ? ' is-warn' : '') + '" aria-hidden="true">' +
        (warn ? ICONS.warn : ICONS.check) +
      '</span>' +
      '<span class="check-label">' + label + '</span>' +
      '<span class="check-value">' + value + (note ? '<span class="check-note">' + note + '</span>' : '') + '</span>' +
    '</div>';
  }

  function placementPreview(card, slot, subtitle) {
    return '<div class="confirm-preview">' +
      '<div class="pos-card color-' + card.color + '"><span class="pos-inner">' + card.number + '</span></div>' +
      '<span class="confirm-arrow" aria-hidden="true">→</span>' +
      '<div class="confirm-pos"><b>' + posLabel(slot) + '</b><span>' + subtitle + '</span></div>' +
    '</div>';
  }

  function invalidSheet(title, message) {
    return {
      title: title,
      body: '<p class="sheet-lead">' + message + '</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">知道了</button>'
    };
  }

  /* ---------------- 各类弹层 ---------------- */

  var SHEETS = {};

  SHEETS.confirm = function (sheet) {
    var card = F.getCard(sheet.cardId);
    var slot = F.slotById(S, sheet.slotId);
    if (!card || !slot || S.hand.indexOf(card.id) < 0) {
      return invalidSheet('无法放置', '手牌或位置已经变化，请重新选择。');
    }
    var check = F.canPlace(S, card.id, slot.id);
    if (!check.ok) return invalidSheet('无法放置', placementErrorText(check, slot, card));

    var subtitle = slot.row === 1
      ? '起始位 · 任意颜色'
      : (check.newRoute ? '另起新航线' : '接入同色航路');

    return {
      title: '确认放置',
      body: placementPreview(card, slot, subtitle) +
        '<div class="check-list">' + ruleCheckRows(card, slot, check) + '</div>' +
        (S.wisdom
          ? '<p class="sheet-note">因纽特智慧已生效：本次放置允许与紧邻卡牌同数字。</p>'
          : '') +
        '<p class="sheet-note">放下后不可撤销；接着从供应堆补 1 张手牌。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">再看看</button>' +
        '<button type="button" class="btn btn-primary" data-action="confirm-place">放下这张牌</button>'
    };
  };

  SHEETS.refill = function () {
    if (S.phase !== 'refill') return invalidSheet('补牌阶段', '现在不需要补牌。');
    if (!S.supply.length) return invalidSheet('供应堆已空', '供应堆没有可补的卡牌。');
    var cards = S.supply.map(function (id) {
      var card = F.getCard(id);
      return '<button type="button" class="refill-card color-' + card.color +
        '" data-action="choose-supply" data-card="' + id +
        '" aria-label="选择' + colorName(card.color) + '色牌背">' +
        '<span class="supply-q" aria-hidden="true">?</span>' +
        '<span class="supply-color" aria-hidden="true">' + colorName(card.color) + '</span>' +
      '</button>';
    }).join('');
    var legend = S.draw.length
      ? '抽牌堆剩余 ' + S.draw.length + ' 张 · 取走后供应堆会补足 3 张。'
      : '抽牌堆已空 · 供应堆取走后不再补足。';
    return {
      title: '补充手牌',
      body: '<p class="sheet-lead">从供应堆选择 1 张加入手牌。</p>' +
        '<div class="refill-row">' + cards + '</div>' +
        '<p class="refill-legend">' + legend + '</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">查看航线</button>'
    };
  };

  SHEETS.inuit = function () {
    if (!hasUnused('inuit')) {
      return invalidSheet('因纽特智慧', '这件物品已经用过了。');
    }
    if (S.wisdom) {
      return invalidSheet('因纽特智慧', '本回合的因纽特智慧已经生效。');
    }
    if (S.phase !== 'place' && S.phase !== 'stuck') {
      return invalidSheet('因纽特智慧', '要在本回合放置手牌之前使用。');
    }
    var options = F.inuitPlacements(S);
    if (!options.length) {
      return invalidSheet('因纽特智慧', '当前没有可与紧邻卡牌同数字的落点。');
    }

    var body = '<p class="sheet-lead">使用后，本回合的这次放置可以把牌放到已放置卡牌的紧邻位置，即使数字相同。' +
      '例如同一行左边 3、右边 5，中间原本只能放 4；使用后 3、4、5 都可以放。隔空的同数字仍然不行。</p>';

    body += options.map(function (option) {
      var card = F.getCard(option.cardId);
      var target = F.slotById(S, option.slotId);
      return '<button type="button" class="option-row" data-action="inuit-option" data-card="' +
        option.cardId + '" data-slot="' + option.slotId +
        '" aria-label="使用因纽特智慧，把 ' + colorName(card.color) + ' ' + card.number +
        ' 放到' + posLabel(target) + '">' +
        '<span class="pick-card color-' + card.color + '" aria-hidden="true"><span class="pick-inner">' +
          card.number + '</span></span>' +
        '<span class="option-text"><b>' + colorName(card.color) + ' ' + card.number + ' → ' +
          posLabel(target) + '</b><span>与紧邻卡牌同数字 · 本回合放宽数字规则</span></span>' +
        '<span class="tag">同数字</span>' +
      '</button>';
    }).join('');

    return {
      title: '因纽特智慧',
      body: body +
        '<p class="sheet-note">点击落点会直接使用物品并进入放置确认；也可以直接使用，再自行选择手牌。' +
        '本回合仍只放 1 张、补 1 张。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-primary" data-action="use-inuit">直接使用</button>'
    };
  };

  SHEETS.sled = function (sheet) {
    if (!hasUnused('sled')) return invalidSheet('狗拉雪橇', '这件物品已经用过了。');
    if (!F.canUseSled(S)) return invalidSheet('狗拉雪橇', '需要同时有手牌和供应堆卡牌。');
    var handPicks = S.hand.map(function (id) {
      var card = F.getCard(id);
      return '<button type="button" class="pick-card color-' + card.color +
        (sheet.handId === id ? ' is-picked' : '') +
        '" data-action="sled-hand" data-card="' + id +
        '" aria-pressed="' + (sheet.handId === id) + '" aria-label="手牌 ' +
        colorName(card.color) + ' ' + card.number + '"><span class="pick-inner">' + card.number + '</span></button>';
    }).join('');
    var supplyPicks = S.supply.map(function (id) {
      var card = F.getCard(id);
      return '<button type="button" class="pick-supply color-' + card.color +
        (sheet.supplyId === id ? ' is-picked' : '') +
        '" data-action="sled-supply" data-card="' + id +
        '" aria-pressed="' + (sheet.supplyId === id) + '" aria-label="供应堆，' +
        colorName(card.color) + '色牌背"><span class="supply-q" aria-hidden="true">?</span>' +
        '<span class="supply-color" aria-hidden="true">' + colorName(card.color) + '</span></button>';
    }).join('');

    var both = sheet.handId && sheet.supplyId;
    var handCard = sheet.handId ? F.getCard(sheet.handId) : null;
    var supplyCard = sheet.supplyId ? F.getCard(sheet.supplyId) : null;
    var preview = both
      ? '<p class="log-preview">将 ' + shortCard(handCard.id) + ' 放回抽牌堆底部，换入一张 <b>' +
        colorName(supplyCard.color) + '</b> 色卡牌。<br>换入后手牌会按数字重新排列。</p>'
      : '<p class="sheet-note">先选一张手牌放回牌堆底，再选一张供应堆卡牌。</p>';

    return {
      title: '狗拉雪橇',
      body: '<p class="sheet-lead">用不上的手牌放回抽牌堆底部，再从供应堆换一张。供应堆会从抽牌堆补足。</p>' +
        '<p class="sheet-step">1 · 放回抽牌堆底部</p><div class="pick-row">' + handPicks + '</div>' +
        '<p class="sheet-step">2 · 从供应堆拿取</p><div class="pick-row">' + supplyPicks + '</div>' +
        preview,
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-primary" data-action="sled-confirm"' +
        (both ? '' : ' disabled') + '>交换这些牌</button>'
    };
  };

  SHEETS.log = function (sheet) {
    if (!hasUnused('log')) return invalidSheet('航海日志', '这件物品已经用过了。');
    if (!F.canUseLog(S)) return invalidSheet('航海日志', '当前没有可替换的组合。');
    var placed = S.board.slots.filter(function (slot) { return !!slot.cardId; });
    var slotList = placed.map(function (slot) {
      var card = F.getCard(slot.cardId);
      return '<button type="button" class="log-slot color-' + card.color +
        (sheet.slotId === slot.id ? ' is-picked' : '') +
        '" data-action="log-slot" data-slot="' + slot.id +
        '" aria-pressed="' + (sheet.slotId === slot.id) + '" aria-label="' +
        posLabel(slot) + '，' + colorName(card.color) + ' ' + card.number + '">' +
        '<span class="pos">' + slot.row + '·' + slot.index + '</span>' +
        '<span class="mini-face" aria-hidden="true"><span>' + card.number + '</span></span>' +
      '</button>';
    }).join('');

    var validMap = Object.create(null);
    if (sheet.slotId) {
      F.logOptions(S).forEach(function (option) {
        if (option.slotId === sheet.slotId) validMap[option.cardId] = option;
      });
      if (sheet.cardId && !validMap[sheet.cardId]) sheet.cardId = null;
    }

    var handPicks = '';
    if (sheet.slotId) {
      handPicks = '<p class="sheet-step">2 · 用哪张手牌替换</p><div class="pick-row">' +
        S.hand.map(function (id) {
          var card = F.getCard(id);
          var valid = !!validMap[id];
          return '<button type="button" class="pick-card color-' + card.color +
            (sheet.cardId === id ? ' is-picked' : '') + (valid ? '' : ' is-invalid') +
            '" data-action="log-hand" data-card="' + id + '"' + (valid ? '' : ' disabled') +
            ' aria-label="' + colorName(card.color) + ' ' + card.number + (valid ? '' : '，不能放入该位置') +
            '"><span class="pick-inner">' + card.number + '</span></button>';
        }).join('') +
      '</div>';
      if (!Object.keys(validMap).length) {
        handPicks += '<p class="sheet-note">没有手牌能放进这个位置，换一个位置试试。</p>';
      }
    }

    var upperHint = '';
    if (sheet.slotId) {
      var hintSlot = F.slotById(S, sheet.slotId);
      var hintUpper = F.upperSlots(S, hintSlot).filter(function (s) { return !!s.cardId; });
      if (hintUpper.length === 2) {
        var hintColors = [];
        hintUpper.forEach(function (s) {
          var c = F.getCard(s.cardId).color;
          if (hintColors.indexOf(c) < 0) hintColors.push(c);
        });
        upperHint = '<p class="sheet-note">上方 ' +
          hintUpper.map(function (s) { return shortCard(s.cardId); }).join('、') +
          ' 已就位：换上的牌必须与其中至少一张同色（' +
          hintColors.map(function (c) { return colorName(c) + '色'; }).join('或') +
          '），才能接续上方航路。</p>';
      }
    }

    var preview = '';
    if (sheet.slotId && sheet.cardId && validMap[sheet.cardId]) {
      var option = validMap[sheet.cardId];
      var newCard = F.getCard(sheet.cardId);
      var targetSlot = F.slotById(S, sheet.slotId);
      var placedUpper = F.upperSlots(S, targetSlot).filter(function (s) { return !!s.cardId; });
      var matchingUpper = placedUpper.filter(function (s) {
        return F.getCard(s.cardId).color === newCard.color;
      });
      var routeText;
      if (targetSlot.row === 1) {
        if (matchingUpper.length) {
          routeText = '起点位：与上方 ' +
            matchingUpper.map(function (s) { return shortCard(s.cardId); }).join('、') +
            ' 同色接续';
        } else if (placedUpper.length) {
          routeText = '起点位：颜色任意，上方空位需接续该颜色';
        } else {
          routeText = '起点位：上方尚无牌，颜色任意';
        }
      } else if (option.newRoute) {
        routeText = '将另起一条 <b>' + colorName(newCard.color) + '</b> 色航线';
      } else {
        routeText = '与下方支撑同色相连';
      }
      if (targetSlot.row !== 1 && matchingUpper.length) {
        routeText += '，并接续到上方 ' +
          matchingUpper.map(function (s) { return shortCard(s.cardId); }).join('、');
      }
      preview = '<p class="log-preview">换下 ' + shortCard(option.outCardId) + '，换上 ' +
        shortCard(sheet.cardId) + '。' + routeText + '。' +
        '<br>换下的牌会回到手牌并重新排序。</p>';
    } else if (sheet.slotId) {
      preview = '<p class="sheet-note">选择一张符合规则的手牌，预览替换结果。</p>';
    } else {
      preview = '<p class="sheet-note">先选择要替换的位置。</p>';
    }

    return {
      title: '航海日志',
      body: '<p class="sheet-lead">用一张手牌替换已放置的卡牌。换上的牌必须重新满足支撑、颜色、数字与目标卡规则，并接续上方已放置的航路。</p>' +
        '<p class="sheet-step">1 · 选择要替换的位置</p>' +
        '<div class="log-slots">' + slotList + '</div>' +
        handPicks + upperHint + preview,
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-primary" data-action="log-confirm"' +
        (sheet.slotId && sheet.cardId && validMap[sheet.cardId] ? '' : ' disabled') + '>替换</button>'
    };
  };

  SHEETS.stuck = function () {
    if (S.phase !== 'stuck') return invalidSheet('无法放置', '当前不是卡住状态。');
    var rows = '';
    ['inuit', 'sled', 'log'].forEach(function (type) {
      if (!hasUnused(type)) return;
      var can;
      var reason;
      if (type === 'inuit') {
        can = F.canUseInuit(S);
        reason = can
          ? '使用后本回合可与紧邻卡牌同数字。'
          : '没有可与紧邻卡牌同数字的落点。';
      } else if (type === 'sled') {
        can = F.canUseSled(S);
        reason = S.supply.length
          ? '把手牌放回牌堆底，从供应堆换一张。'
          : '供应堆为空，无法换牌。';
      } else {
        can = F.canUseLog(S);
        reason = can
          ? '替换一张已放置的卡牌。'
          : '没有手牌能放进已放置的位置。';
      }
      rows += '<div class="rescue-row">' +
        '<span class="rescue-icon" aria-hidden="true">' + itemIcon(type) + '</span>' +
        '<span class="rescue-text"><b>' + F.ITEM_NAME[type] + '</b><span>' + reason + '</span></span>' +
        (can
          ? '<button type="button" class="mini-btn" data-action="stuck-' + type + '">使用</button>'
          : '<span class="tag">不可用</span>') +
      '</div>';
    });

    if (!rows) {
      rows = '<div class="stuck-empty">物品已经用尽，没有别的办法了。</div>';
    }

    return {
      title: '无法放置',
      body: '<p class="sheet-lead">当前手牌没有任何合法落点。可以尝试尚未使用的物品，或宣告航路中断。</p>' +
        '<div class="stuck-list">' + rows + '</div>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">再看看</button>' +
        '<button type="button" class="btn btn-danger" data-action="declare-loss">宣告失败</button>'
    };
  };

  SHEETS.declare = function () {
    return {
      title: '宣告失败？',
      body: '<p class="sheet-lead">这局会记为失败，最终棋盘仍保存在本机。这个操作不可撤销。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="open-stuck">返回</button>' +
        '<button type="button" class="btn btn-danger" data-action="confirm-loss">确认宣告</button>'
    };
  };

  SHEETS.result = function () {
    var won = S.phase === 'won';
    var goalsUp = S.board.goals.filter(function (g) { return g.faceUp; }).length;
    var sub;
    if (won) {
      sub = '第 ' + S.turn + ' 回合完成 · 目标卡 ' + goalsUp + '/5 已翻开';
    } else if (S.lossReason === 'no-hand') {
      sub = '第 ' + S.turn + ' 回合 · 手牌耗尽';
    } else {
      sub = '第 ' + S.turn + ' 回合 · 主动宣告失败';
    }
    var flavor = won
      ? '十五座冰山各就各位，成功穿越了西北航线！'
      : '冰面在最后一格前合拢，再接再厉，也许下一次就能通过！';
    return {
      title: '本局结算',
      body: '<div class="result-hero">' +
          '<div class="result-glyph' + (won ? '' : ' is-loss') + '" aria-hidden="true">' +
            (won ? ICONS.compass : ICONS.x) +
          '</div>' +
          '<h3 class="result-title">' + (won ? '航路贯通' : '航路中断') + '</h3>' +
          '<p class="result-sub">' + sub + '</p>' +
        '</div>' +
        '<div class="result-stats">' +
          '<div class="stat-cell"><b>' + S.turn + '</b><span>回合</span></div>' +
          '<div class="stat-cell"><b>' + placedCount() + '/15</b><span>冰山卡</span></div>' +
          '<div class="stat-cell"><b>' + DIFF_NAME[S.difficulty] + '</b><span>难度</span></div>' +
        '</div>' +
        '<p class="result-flavor">' + flavor + '</p>',
      actions: '<button type="button" class="btn btn-primary" data-action="result-again">再来一局</button>' +
        '<button type="button" class="btn btn-ghost" data-action="result-setup">返回设置</button>'
    };
  };

  function miniStatsRows() {
    return F.DIFFICULTIES.map(function (key) {
      var stat = STATS[key];
      var value = stat.plays
        ? '完成 ' + stat.plays + ' · 胜 ' + stat.wins + (stat.best != null ? ' · 最少 ' + stat.best + ' 回合' : '')
        : '暂无记录';
      return '<div class="stats-line"><span>' + DIFF_NAME[key] + '</span><b>' + value + '</b></div>';
    }).join('');
  }

  SHEETS.menu = function () {
    return {
      title: '菜单',
      body: '<div class="menu-list">' +
          '<button type="button" class="menu-row" data-action="menu-rules">' +
            '<span class="menu-icon" aria-hidden="true">' + ICONS.book + '</span>规则说明' +
            '<span class="menu-sub">流程 · 物品</span></button>' +
          '<button type="button" class="menu-row" data-action="toggle-hints" aria-pressed="' + PREFS.hints + '">' +
            '<span class="menu-icon" aria-hidden="true">' + ICONS.eye + '</span>规则提示' +
            '<span class="switch' + (PREFS.hints ? ' is-on' : '') + '" aria-hidden="true"></span></button>' +
          '<button type="button" class="menu-row" data-action="menu-stats">' +
            '<span class="menu-icon" aria-hidden="true">' + ICONS.chart + '</span>航行记录' +
            '<span class="menu-sub">本机统计</span></button>' +
          '<button type="button" class="menu-row" data-action="confirm-restart">' +
            '<span class="menu-icon" aria-hidden="true">' + ICONS.refresh + '</span>重新开始' +
            '<span class="menu-sub">同难度新局</span></button>' +
          '<button type="button" class="menu-row" data-action="menu-setup">' +
            '<span class="menu-icon" aria-hidden="true">' + ICONS.home + '</span>返回设置' +
            '<span class="menu-sub">自动保存</span></button>' +
        '</div>' +
        '<div class="stats-table">' + miniStatsRows() + '</div>' 
        //+ '<p class="menu-seed">种子 ' + S.seed + ' · 版本 v' + S.version + '</p>'
        ,
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">继续航路</button>'
    };
  };

  function miniPyramid() {
    var rows = '';
    rows += '<div class="mini-row">' + new Array(6).join('<span class="mini-dot is-goal"></span>') + '</div>';
    for (var r = 5; r >= 1; r--) {
      var dots = '';
      for (var i = 0; i < r; i++) dots += '<span class="mini-dot"></span>';
      rows += '<div class="mini-row">' + dots + '</div>';
    }
    rows += '<div class="mini-row"><span class="mini-dot is-start"></span></div>';
    return '<div class="mini-pyramid" aria-hidden="true">' + rows + '</div>';
  }

  var RULE_TABS = [
    { key: 'flow', label: '回合流程' },
    { key: 'rules', label: '放置规则' },
    { key: 'items', label: '物品介绍' },
    { key: 'ending', label: '胜负判定' }
  ];

  function rulePanel(tab) {
    if (tab === 'rules') {
      return '<p class="rule-lead">每次放牌都要同时满足四条规则（除了第 1 行在起始卡上，颜色任意）</p>' +
        '<div class="rule-item"><h4><em>①</em>支撑</h4><p>第 2 行起，下面需要的卡牌必须已经放好：两端各需一张，中间需两张。</p></div>' +
        '<div class="rule-item"><h4><em>②</em>颜色 / 航线</h4><p>上方的 2 张牌中至少要有 1 张与它下方相邻牌同色</p><p class="rule-example">例：已知第二行的蓝 2 的上方已有蓝 5 接续，而第二行的黑 5 的上方只有红 8，则第三行空缺的那张必须放黑色。</p></div>' +
        '<div class="rule-item"><h4><em>③</em>数字</h4><p>同一行从左到右严格递增。相同的数字不能相邻放置。</p><p class="rule-example">使用“因纽特智慧”后，本回合的这次放置可以在已放置卡牌的旁边放同数字的牌（例如左边 3、右边 5，中间 3、4、5 都行）；隔空的同数字仍不允许。</p></div>' +
        '<div class="rule-item"><h4><em>④</em>目标卡</h4><p>第 5 行若目标卡正面朝上，所放卡牌必须与目标卡同色。目标卡未启用时不约束。</p></div>';
    }
    if (tab === 'items') {
      return '<p class="rule-lead">单人局从 6 个标记中随机抽 3 个，允许出现同类标记；每个标记只能用一次。</p>' +
        '<div class="rule-item"><h4><em>❄</em>因纽特智慧</h4><p>在本回合放置前使用。本回合的这次放置可以把牌放到已放置卡牌的紧邻位置，即使数字相同；隔空的同数字仍不允许。仍然只放 1 张、补 1 张。</p></div>' +
        '<div class="rule-item"><h4><em>🐕</em>狗拉雪橇</h4><p>把一张手牌放回抽牌堆底部，再从供应堆取一张。供应堆随后从抽牌堆补足。</p></div>' +
        '<div class="rule-item"><h4><em>📅</em>航海日志</h4><p>用一张手牌替换一张已放置的卡牌。换上的牌要重新满足四条规则，换下的牌回到手牌。</p></div>' +
        '<p class="sheet-note">卡住时可以先试试尚未使用的雪橇或日志；物品使用后不可撤销。</p>';
    }
    if (tab === 'ending') {
      return '<p class="rule-lead">胜负只看两件事：能否填满，以及是否还有合法落点。</p>' +
        '<div class="rule-item"><h4>胜利</h4><p>15 个位置全部放满立即胜利。</p></div>' +
        '<div class="rule-item"><h4>失败</h4><p>轮到你时，手牌没有任何合法落点，且物品也无法解救，即航路中断。可以在卡住界面主动宣告失败。</p></div>';
    }
    return '<p class="rule-lead">把 15 张冰山卡填满倒三角。每回合放置 1 张、补 1 张；当没有任何合法落点时，航路中断。</p>' +
      miniPyramid() +
      '<ol class="rule-steps">' +
        '<li><b>设置</b><span>5 张目标卡在第 5 行上方，起始卡在第 1 行下方。新手 0 张目标卡正面，中等 3 张（左中右），专家 5 张（全部）。</span></li>' +
        '<li><b>放置</b><span>从手牌中选 1 张放到合法空位，必须满足支撑、颜色、数字、目标卡四条规则。</span></li>' +
        '<li><b>补牌</b><span>从供应堆 3 张中选 1 张加入手牌；供应堆从抽牌堆补足。</span></li>' +
        '<li><b>结束</b><span>填满 15 位立即胜利；无法放置且物品也无法解救，就是失败。</span></li>' +
      '</ol>' +
      '<p class="rule-verse"><b>起点提示：</b>第一张牌放在起始卡上，颜色任意。</p>';
  }

  SHEETS.rules = function (sheet) {
    var tab = sheet.tab || 'flow';
    var tabs = RULE_TABS.map(function (item) {
      var active = item.key === tab;
      return '<button type="button" class="rule-tab' + (active ? ' is-active' : '') +
        '" data-action="rules-tab" data-tab="' + item.key + '" role="tab" aria-selected="' +
        active + '">' + item.label + '</button>';
    }).join('');
    return {
      title: '流冰航路 · 规则',
      body: '<div class="rule-tabs" role="tablist" aria-label="规则分类">' + tabs + '</div>' +
        rulePanel(tab) +
        '<p class="rules-foot">流冰航路 · 单人模式</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">关闭</button>'
    };
  };

  SHEETS.stats = function () {
    return {
      title: '航行记录',
      body: '<div class="stats-table">' + miniStatsRows() + '</div>' +
        '<p class="sheet-note">只统计已经结束的对局；记录保存在本机浏览器。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">关闭</button>'
    };
  };

  SHEETS.voyage = function () {
    return {
      title: '启程',
      body: '<p class="sheet-lead">选择难度后出发。难度只影响终点目标卡的翻开数量，其余规则相同。</p>' +
        '<div class="difficulty-list">' + difficultyCards() + '</div>' +
        '<div class="mini-stats" aria-live="polite">' + statsLine(PREFS.difficulty) + '</div>' +
        (S ? '<p class="sheet-note">开始新航路会覆盖当前存档，航行记录保留。</p>' : ''),
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-primary" data-action="voyage-start">' +
        (S ? '覆盖并启程' : '启程') + '</button>'
    };
  };

  SHEETS.overwrite = function () {
    return {
      title: '开始新航程？',
      body: '<p class="sheet-lead">' + (isTerminal()
        ? '当前已结束的存档会被新对局替换。'
        : '当前未完成的航程会被覆盖。') +
        '统计记录会保留，这个操作不可撤销。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-primary" data-action="confirm-start">开始新航程</button>'
    };
  };

  SHEETS.restart = function () {
    return {
      title: '重新开始？',
      body: '<p class="sheet-lead">当前对局会被同难度的新航程覆盖，统计记录保留。这个操作不可撤销。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="menu">取消</button>' +
        '<button type="button" class="btn btn-danger" data-action="restart-confirm">重新开始</button>'
    };
  };

  SHEETS.clear = function () {
    return {
      title: '清除存档？',
      body: '<p class="sheet-lead">将删除本机的对局存档，航行记录会保留。这个操作不可撤销。</p>',
      actions: '<button type="button" class="btn btn-ghost" data-action="close-sheet">取消</button>' +
        '<button type="button" class="btn btn-danger" data-action="confirm-clear">确认清除</button>'
    };
  };

  /* ---------------- 动作 ---------------- */

  function startNewGame(opts) {
    opts = opts || {};
    var difficulty = opts.difficulty || PREFS.difficulty;
    if (F.DIFFICULTIES.indexOf(difficulty) < 0) difficulty = 'novice';
    var seed = opts.seed != null ? (opts.seed >>> 0) : newSeed();
    S = F.createGame({ difficulty: difficulty, seed: seed });
    SAVE_META = { statsRecorded: false, savedAt: Date.now() };
    UI.screen = 'game';
    UI.selectedCardId = null;
    UI.animateSlotId = null;
    UI.animateHandCardId = null;
    closeSheet(false);
    saveGame();
    render();
    toast('新航程 · ' + DIFF_NAME[difficulty] + ' · 先放第 1 行');
  }

  function continueGame() {
    if (!S) {
      toast('没有可继续的存档。', 'warn');
      return;
    }
    UI.screen = 'game';
    UI.selectedCardId = null;
    maybeRecordResult();
    saveGame();
    closeSheet(false);
    render();
    promptCurrentPhase();
  }

  function promptCurrentPhase() {
    if (!S) return;
    if (S.phase === 'won' || S.phase === 'lost') openSheet('result');
    else if (S.phase === 'refill') openSheet('refill');
    else if (S.phase === 'stuck') openSheet('stuck');
  }

  function commit(next, opts) {
    opts = opts || {};
    var previousPhase = S ? S.phase : null;
    var keepSelection = opts.keepSelection && UI.selectedCardId &&
      next.hand.indexOf(UI.selectedCardId) >= 0 ? UI.selectedCardId : null;
    S = next;
    UI.selectedCardId = keepSelection;
    UI.animateSlotId = opts.animateSlotId || null;
    UI.animateHandCardId = opts.animateHandCardId || null;
    if (animTimer) clearTimeout(animTimer);
    animTimer = setTimeout(function () {
      UI.animateSlotId = null;
      UI.animateHandCardId = null;
    }, 700);

    maybeRecordResult();
    saveGame();
    closeSheet(false);
    render();

    var willOpen = opts.prompt !== false && (
      (S.phase === 'refill' && previousPhase !== 'refill') ||
      (S.phase === 'stuck' && previousPhase !== 'stuck') ||
      ((S.phase === 'won' || S.phase === 'lost') && previousPhase !== S.phase)
    );

    if (opts.toast && !willOpen) toast(opts.toast, opts.tone);

    if (opts.prompt !== false) {
      if (S.phase === 'refill' && previousPhase !== 'refill') {
        openSheet('refill');
      } else if (S.phase === 'stuck' && previousPhase !== 'stuck') {
        openSheet('stuck');
      } else if ((S.phase === 'won' || S.phase === 'lost') && previousPhase !== S.phase) {
        openSheet('result');
      }
    }
  }

  function selectHand(cardId) {
    if (!S) return;
    if (S.phase !== 'place') {
      toast(phaseHint(), 'warn');
      return;
    }
    if (S.hand.indexOf(cardId) < 0) return;
    UI.selectedCardId = UI.selectedCardId === cardId ? null : cardId;
    render();
    if (UI.selectedCardId) {
      var selected = document.querySelector('.hand-card[data-card="' + UI.selectedCardId + '"]');
      if (selected) {
        try { selected.focus({ preventScroll: true }); } catch (e) { selected.focus(); }
      }
    }
  }

  function handleSlot(slotId) {
    if (!S) return;
    if (S.phase !== 'place') {
      toast(phaseHint(), 'warn');
      return;
    }
    var slot = F.slotById(S, slotId);
    if (!slot) return;
    var el = slotEl(slotId);

    if (!UI.selectedCardId) {
      if (slot.cardId) toast(posLabel(slot) + '：' + cardName(slot.cardId));
      else toast('先从手牌选择一张卡牌。');
      return;
    }
    var card = F.getCard(UI.selectedCardId);
    if (!card) return;
    if (slot.cardId) {
      toast('这个位置已有卡牌。需要替换可用航海日志。', 'warn');
      flashSlot(el);
      return;
    }
    var check = F.canPlace(S, card.id, slot.id);
    if (!check.ok) {
      toast(placementErrorText(check, slot, card), 'warn');
      flashSlot(el);
      return;
    }
    openSheet('confirm', { cardId: card.id, slotId: slot.id });
  }

  function confirmPlacement() {
    if (!UI.sheet || UI.sheet.type !== 'confirm') return;
    var card = F.getCard(UI.sheet.cardId);
    var slot = F.slotById(S, UI.sheet.slotId);
    var wasWisdom = !!S.wisdom;
    var result = F.placeCard(S, UI.sheet.cardId, UI.sheet.slotId);
    if (!result.ok) {
      toast(result.message || '无法放置。', 'warn');
      return;
    }
    var newRoute = result.state.lastAction && result.state.lastAction.newRoute;
    var message = '放下 ' + cardName(card.id) + ' · ' +
      (slot.row === 1 ? '航路起点' : (newRoute ? '另起' + colorName(card.color) + '色航线' : '接入同色航路'));
    if (wasWisdom) message += ' · 因纽特智慧';
    commit(result.state, { animateSlotId: slot.id, toast: message });
  }

  function chooseSupply(cardId) {
    if (S.phase !== 'refill') {
      toast(phaseHint(), 'warn');
      return;
    }
    var card = F.getCard(cardId);
    var result = F.chooseSupply(S, cardId);
    if (!result.ok) {
      toast(result.message || '无法补牌。', 'warn');
      return;
    }
    commit(result.state, {
      animateHandCardId: cardId,
      toast: '补入一张' + colorName(card.color) + '色卡牌 · 第 ' + result.state.turn + ' 回合'
    });
  }

  function activateInuit() {
    var result = F.useInuit(S);
    if (!result.ok) {
      toast(result.message || '无法使用因纽特智慧。', 'warn');
      return false;
    }
    commit(result.state, {
      keepSelection: true,
      toast: '因纽特智慧生效 · 本回合可与紧邻卡牌同数字'
    });
    return true;
  }

  function openInuitOption(cardId, slotId) {
    if (!activateInuit()) return;
    openSheet('confirm', { cardId: cardId, slotId: slotId });
  }

  function applySled() {
    if (!UI.sheet || UI.sheet.type !== 'sled') return;
    if (!UI.sheet.handId || !UI.sheet.supplyId) {
      toast('先选择一张手牌和一张供应堆卡牌。', 'warn');
      return;
    }
    var wasStuck = S.phase === 'stuck';
    var supplyCard = F.getCard(UI.sheet.supplyId);
    var result = F.useSled(S, UI.sheet.handId, UI.sheet.supplyId);
    if (!result.ok) {
      toast(result.message || '无法换牌。', 'warn');
      return;
    }
    commit(result.state, {
      prompt: false,
      animateHandCardId: UI.sheet.supplyId,
      toast: '狗拉雪橇：换入一张' + colorName(supplyCard.color) + '色卡牌'
    });
    if (result.state.phase === 'stuck') {
      openSheet('stuck');
    } else if (wasStuck) {
      toast('换牌后出现了新的落点。');
    }
  }

  function applyLog() {
    if (!UI.sheet || UI.sheet.type !== 'log') return;
    if (!UI.sheet.slotId || !UI.sheet.cardId) {
      toast('先选择位置和替换手牌。', 'warn');
      return;
    }
    var wasStuck = S.phase === 'stuck';
    var outCardId = F.slotById(S, UI.sheet.slotId).cardId;
    var result = F.useLog(S, UI.sheet.slotId, UI.sheet.cardId);
    if (!result.ok) {
      toast(result.message || '无法替换。', 'warn');
      return;
    }
    commit(result.state, {
      prompt: false,
      animateSlotId: UI.sheet.slotId,
      animateHandCardId: outCardId,
      toast: '航海日志：换下 ' + cardName(outCardId)
    });
    if (result.state.phase === 'stuck') {
      openSheet('stuck');
    } else if (wasStuck) {
      toast('换牌后出现了新的落点。');
    }
  }

  function declareLoss() {
    var result = F.declareLoss(S);
    if (!result.ok) {
      toast(result.message || '无法宣告失败。', 'warn');
      return;
    }
    commit(result.state, { toast: '已宣告航路中断', tone: 'danger' });
  }

  function handleItem(type) {
    if (!S) return;
    if (!F.ITEM_TYPES || F.ITEM_TYPES.indexOf(type) < 0) return;
    if (!hasUnused(type)) {
      toast(F.ITEM_NAME[type] + '已经用过了。', 'warn');
      return;
    }
    if (type === 'inuit') {
      if (S.wisdom) {
        toast('本回合的因纽特智慧已经生效。');
        return;
      }
      if (S.phase !== 'place' && S.phase !== 'stuck') {
        toast(phaseHint(), 'warn');
        return;
      }
      if (!F.canUseInuit(S)) {
        toast('当前没有可与紧邻卡牌同数字的落点。', 'warn');
        return;
      }
      openSheet('inuit');
      return;
    }
    if (S.phase !== 'place' && S.phase !== 'stuck') {
      toast(phaseHint(), 'warn');
      return;
    }
    if (type === 'sled') {
      if (!F.canUseSled(S)) {
        toast('狗拉雪橇需要至少一张手牌和一张供应堆卡牌。', 'warn');
        return;
      }
      openSheet('sled', { handId: null, supplyId: null });
      return;
    }
    if (type === 'log') {
      if (!F.canUseLog(S)) {
        toast('没有手牌能替换已放置的卡牌，暂时用不上航海日志。', 'warn');
        return;
      }
      openSheet('log', { slotId: null, cardId: null });
    }
  }

  function toggleHints() {
    PREFS.hints = !PREFS.hints;
    savePrefs();
    render();
    if (UI.sheet && UI.sheet.type === 'menu') {
      renderSheet('[data-action="toggle-hints"]');
    }
    toast(PREFS.hints ? '已开启合法位高亮与提示。' : '已关闭合法位高亮与提示。');
  }

  function updateDifficulty(key) {
    if (F.DIFFICULTIES.indexOf(key) < 0) return;
    PREFS.difficulty = key;
    savePrefs();
    if (UI.sheet && UI.sheet.type === 'voyage') {
      renderSheet('[data-action="diff"][data-diff="' + key + '"]');
      return;
    }
    render();
    var target = document.querySelector('.diff-card[data-diff="' + key + '"]');
    if (target) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function clearSave() {
    storageRemove(SAVE_KEY);
    S = null;
    SAVE_META = { statsRecorded: false, savedAt: 0 };
    UI.screen = 'setup';
    UI.selectedCardId = null;
    closeSheet(false);
    render();
    toast('存档已清除，航行记录保留。');
  }

  function goSetup() {
    UI.screen = 'setup';
    UI.selectedCardId = null;
    closeSheet(false);
    if (S) saveGame();
    render();
    var target = document.querySelector('[data-action="start"]');
    if (target) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  /* ---------------- 事件 ---------------- */

  var ACTIONS = {
    diff: function (el) { updateDifficulty(el.getAttribute('data-diff')); },
    start: function () { openSheet('voyage'); },
    'voyage-start': function () {
      if (S) openSheet('overwrite');
      else startNewGame({ difficulty: PREFS.difficulty });
    },
    'confirm-start': function () { startNewGame({ difficulty: PREFS.difficulty }); },
    continue: function () { continueGame(); },
    rules: function () { openSheet('rules', { tab: 'flow' }); },
    'rules-tab': function (el) {
      if (!UI.sheet) return;
      UI.sheet.tab = el.getAttribute('data-tab');
      renderSheet('[data-action="rules-tab"][data-tab="' + UI.sheet.tab + '"]');
    },
    stats: function () { openSheet('stats'); },
    'clear-save': function () { openSheet('clear'); },
    'confirm-clear': function () { clearSave(); },
    menu: function () { openSheet('menu'); },
    'menu-rules': function () { openSheet('rules', { tab: 'flow' }); },
    'menu-stats': function () { openSheet('stats'); },
    'menu-setup': function () { goSetup(); },
    'toggle-hints': function () { toggleHints(); },
    'confirm-restart': function () { openSheet('restart'); },
    'restart-confirm': function () { startNewGame({ difficulty: S.difficulty }); },
    'close-sheet': function () { closeSheet(); },
    'select-hand': function (el) { selectHand(el.getAttribute('data-card')); },
    'clear-select': function () {
      UI.selectedCardId = null;
      render();
      var hand = document.querySelector('.hand-card');
      if (hand) hand.focus();
    },
    'tap-slot': function (el) { handleSlot(el.getAttribute('data-slot')); },
    'confirm-place': function () { confirmPlacement(); },
    'supply-card': function () {
      if (S.phase === 'refill') openSheet('refill');
      else toast('补牌时从供应堆 3 张中选 1 张，牌背只显示颜色。');
    },
    'open-refill': function () {
      if (S.phase === 'refill') openSheet('refill');
      else toast('现在不是补牌阶段。', 'warn');
    },
    'choose-supply': function (el) { chooseSupply(el.getAttribute('data-card')); },
    'inuit-option': function (el) {
      openInuitOption(el.getAttribute('data-card'), el.getAttribute('data-slot'));
    },
    'use-inuit': function () { activateInuit(); },
    item: function (el) { handleItem(el.getAttribute('data-type')); },
    'stuck-inuit': function () { openSheet('inuit'); },
    'stuck-sled': function () { openSheet('sled', { handId: null, supplyId: null }); },
    'stuck-log': function () { openSheet('log', { slotId: null, cardId: null }); },
    'sled-hand': function (el) {
      UI.sheet.handId = el.getAttribute('data-card');
      renderSheet('[data-action="sled-hand"][data-card="' + UI.sheet.handId + '"]');
    },
    'sled-supply': function (el) {
      UI.sheet.supplyId = el.getAttribute('data-card');
      renderSheet('[data-action="sled-supply"][data-card="' + UI.sheet.supplyId + '"]');
    },
    'sled-confirm': function () { applySled(); },
    'log-slot': function (el) {
      UI.sheet.slotId = el.getAttribute('data-slot');
      UI.sheet.cardId = null;
      renderSheet('[data-action="log-slot"][data-slot="' + UI.sheet.slotId + '"]');
    },
    'log-hand': function (el) {
      UI.sheet.cardId = el.getAttribute('data-card');
      renderSheet('[data-action="log-hand"][data-card="' + UI.sheet.cardId + '"]');
    },
    'log-confirm': function () { applyLog(); },
    'open-stuck': function () {
      if (S.phase === 'stuck') openSheet('stuck');
      else closeSheet();
    },
    'declare-loss': function () { openSheet('declare'); },
    'confirm-loss': function () { declareLoss(); },
    'view-result': function () { openSheet('result'); },
    'result-again': function () { startNewGame({ difficulty: S.difficulty }); },
    'result-setup': function () { goSetup(); }
  };

  document.addEventListener('click', function (ev) {
    if (ev.target === overlay) {
      closeSheet();
      return;
    }
    var el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var handler = ACTIONS[el.getAttribute('data-action')];
    if (handler) {
      ev.preventDefault();
      handler(el);
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      if (!overlay.hidden) {
        ev.preventDefault();
        closeSheet();
        return;
      }
      if (UI.selectedCardId) {
        UI.selectedCardId = null;
        render();
      }
      return;
    }
    if (ev.key === 'Tab' && !overlay.hidden) trapTab(ev);
  });

  window.addEventListener('resize', function () {
    if (S && UI.screen === 'game') {
      clearTimeout(routeTimer);
      routeTimer = setTimeout(drawRoutes, 80);
    }
  });

  window.addEventListener('load', function () {
    if (S && UI.screen === 'game') scheduleRoutes();
  });

  /* ---------------- 启动 ---------------- */

  function init() {
    loadPrefs();
    loadStats();
    loadSave();
    if (S) {
      maybeRecordResult();
      saveGame();
    }
    UI.screen = 'setup';
    render();
  }

  init();

  /* 调试/自动化测试入口：不参与正常玩法 */
  window.FrozenPassageApp = {
    getState: function () { return S ? JSON.parse(JSON.stringify(S)) : null; },
    startNewGame: function (opts) { startNewGame(opts || {}); },
    restore: function (state, opts) {
      var parsed = F.deserialize(state);
      if (!parsed) return false;
      S = parsed;
      SAVE_META = { statsRecorded: false, savedAt: Date.now() };
      UI.screen = 'game';
      UI.selectedCardId = null;
      closeSheet(false);
      maybeRecordResult();
      saveGame();
      render();
      if (!opts || !opts.silent) promptCurrentPhase();
      return true;
    },
    openSheet: openSheet,
    closeSheet: closeSheet
  };
})();
