/* =========================================================
   同词相遇 · render.js
   界面控制器：首页 / 等候室 / 出词 / 揭晓 / 结算 / 规则 / 分享
   依赖：window.SWG（规则）、window.SWN（联机），均可缺失时降级
   ========================================================= */
(function () {
  'use strict';

  var SWR = window.SWR = window.SWR || {};

  var SEAT_COLORS = ['#2F6B4F', '#2A9D8F', '#E8733A', '#8C5A9E'];
  var MODE_NAME = { duel: '同心小径', party: '营地同频' };
  var TIME_OPTIONS = [0, 15, 30, 60];
  var ROUND_OPTIONS = [10, 15, 20];
  var LS_NAME = 'sameword-name';
  var LS_STATS = 'sameword-stats';
  var LS_SOUND = 'sameword-sound';
  var RESULT_LABEL = {
    match: '撞词', agree: '意思一样', giveup: '放弃',
    limit: '打满全场', allmatch: '全员同频'
  };

  var S = null;
  var VIEW = null;
  var NET = true;
  var MY_SEAT = 0;
  var clockOffset = 0;
  var lastHostNow = 0;
  var draft = '';
  var draftRound = '';
  var autoSubmitKey = '';
  var lastPhase = '';
  var celebrateKey = '';
  var celebrateTimer = 0;
  var celebrateFade = 0;
  var logs = [];
  var soundOn = true;
  var shareData = null;
  var confirmCb = null;
  var bootJoinUsed = false;
  var URL_ROOM = '';
  var lastNetToast = 0;

  var appEl, sheetLayer, sheetPanel, modalLayer, modalPanel, toastLayer,
      celebrateLayer, offlineBanner;

  var layerState = { current: null, panel: null, prevFocus: null, kind: '' };

  /* ---------------- 基础工具 ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function readLS(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeLS(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }
  function ico(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ico-' + name + '"/></svg>';
  }
  function use(id, vb, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="' + vb + '" aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>';
  }
  function seatColor(i) {
    var colors = (window.SWG && window.SWG.SEAT_COLORS) || SEAT_COLORS;
    return colors[i] || SEAT_COLORS[i % 4];
  }
  function modeName(mode) { return MODE_NAME[mode] || MODE_NAME.duel; }
  function fmtClock(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function limitLabel(n) {
    if (!n) return '不限时';
    return n + ' 秒';
  }

  function getName() {
    var n = readLS(LS_NAME);
    return n ? String(n).slice(0, 24) : '';
  }
  function saveName(name) {
    try {
      var v = window.SWG && SWG.validateName ? SWG.validateName(name) : null;
      writeLS(LS_NAME, v && v.ok ? v.name : String(name || '').trim());
    } catch (e) { /* ignore */ }
  }
  function readStats() {
    try { return JSON.parse(readLS(LS_STATS) || 'null'); } catch (e) { return null; }
  }

  /* ---------------- 规则降级包装 ---------------- */

  function normalizeWord(raw) {
    if (window.SWG && typeof SWG.normalizeWord === 'function') return SWG.normalizeWord(raw);
    var s = String(raw == null ? '' : raw);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.toLowerCase().replace(/\s+/g, '').replace(/[\p{P}~～·…]/gu, '');
  }
  function charLen(raw) {
    if (window.SWG && typeof SWG.charLen === 'function') return SWG.charLen(raw);
    return Array.from(String(raw == null ? '' : raw)).length;
  }
  function validateWord(raw) {
    if (window.SWG && typeof SWG.validateWord === 'function') return SWG.validateWord(raw);
    var display = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!display) return { ok: false, error: 'EMPTY' };
    var norm = normalizeWord(display);
    if (!norm || !/[\p{L}\p{N}]/u.test(norm)) return { ok: false, error: 'ONLY_SYMBOL' };
    if (Array.from(norm).length > 10) return { ok: false, error: 'TOO_LONG' };
    return { ok: true, word: display, display: display };
  }
  function validateName(raw) {
    if (window.SWG && typeof SWG.validateName === 'function') return SWG.validateName(raw);
    var name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    var len = charLen(name);
    if (len < 1 || len > 12) return { ok: false, error: 'NAME_LEN' };
    return { ok: true, name: name };
  }
  function minPlayers(mode) {
    if (window.SWG && typeof SWG.minPlayers === 'function') return SWG.minPlayers(mode);
    return mode === 'party' ? 3 : 2;
  }
  function wordLimit() {
    return (window.SWG && SWG.LIMITS && SWG.LIMITS.WORD) || 10;
  }
  function nameLimit() {
    return (window.SWG && SWG.LIMITS && SWG.LIMITS.NAME) || 12;
  }

  /* ---------------- 联网状态 ---------------- */

  function hasSWN() {
    return !!(window.SWN && typeof SWN.init === 'function' && typeof SWN.pushState === 'function');
  }
  function netIsHost() {
    try { return !!(window.SWN && SWN.isHost && SWN.isHost()); } catch (e) { return false; }
  }
  function mySeat() {
    try {
      if (window.SWN && SWN.getSeat) {
        var v = SWN.getSeat();
        if (typeof v === 'number' && v >= 0) return v;
      }
    } catch (e) { /* ignore */ }
    return MY_SEAT;
  }
  function roomCode() {
    try {
      if (window.SWN && SWN.getRoomView) {
        var v = SWN.getRoomView();
        if (v && v.code) return String(v.code);
      }
    } catch (e) { /* ignore */ }
    if (VIEW && VIEW.code) return String(VIEW.code);
    return '';
  }
  function inviteURL(code) {
    var c = String(code || '');
    try {
      var u = new URL(window.location.href);
      return u.origin + u.pathname + '?room=' + encodeURIComponent(c);
    } catch (e) {
      return window.location.origin + window.location.pathname + '?room=' + c;
    }
  }
  function netErrorText(err, fallback) {
    var m = '';
    try { m = String((err && (err.message || err.error || err.code)) || err || ''); } catch (e) {}
    if (/full|满/i.test(m)) return '房间已满，换一个房间吧';
    if (/start|开始/i.test(m)) return '这局已经开始了，等下一局吧';
    if (/not.?found|过期|不存在|closed/i.test(m)) return '房间不存在或已过期';
    if (/name|昵称/i.test(m)) return '昵称要是 1~12 个字';
    if (/network|fetch|timeout|offline/i.test(m)) return '网络不太稳，请稍后再试';
    return fallback;
  }

  /* ---------------- 音效 / 触觉 ---------------- */

  var audioCtx = null;

  function getAudio() {
    if (!soundOn) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) {
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    try { if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
    return audioCtx;
  }
  function tone(freq, dur, type, gain, delay) {
    var ac = getAudio();
    if (!ac) return;
    try {
      var t0 = ac.currentTime + (delay || 0);
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(ac.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function sound(name) {
    if (!soundOn) return;
    try {
      if (name === 'tap') tone(520, 0.07, 'triangle', 0.05);
      else if (name === 'seal') { tone(320, 0.07, 'triangle', 0.06); tone(500, 0.09, 'triangle', 0.045, 0.05); }
      else if (name === 'flip') tone(700, 0.05, 'sine', 0.035);
      else if (name === 'vote') tone(460, 0.07, 'sine', 0.045);
      else if (name === 'win') [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.2, 'triangle', 0.05, i * 0.1); });
      else if (name === 'whistle') { tone(1250, 0.16, 'sine', 0.045); tone(940, 0.2, 'sine', 0.035, 0.15); }
      else if (name === 'error') tone(180, 0.12, 'sawtooth', 0.03);
    } catch (e) { /* ignore */ }
  }
  function haptic(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  /* ---------------- 吐司 / 弹层 ---------------- */

  SWR.toast = function (msg, type) {
    if (!toastLayer || !msg) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = String(msg);
    toastLayer.appendChild(el);
    while (toastLayer.children.length > 3) toastLayer.removeChild(toastLayer.firstChild);
    window.setTimeout(function () {
      el.classList.add('out');
      window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }, 2400);
  };
  function toast(msg, type) { SWR.toast(msg, type); }

  function openLayer(kind, html, onMount) {
    var layer = kind === 'modal' ? modalLayer : sheetLayer;
    var panel = kind === 'modal' ? modalPanel : sheetPanel;
    if (!layer || !panel) return;
    closeLayer(true);
    layerState.prevFocus = document.activeElement;
    layerState.kind = kind;
    layerState.current = layer;
    layerState.panel = panel;
    panel.innerHTML = html;
    layer.hidden = false;
    document.body.classList.add('has-layer');
    void layer.offsetHeight;
    layer.classList.add('is-open');
    window.setTimeout(function () {
      if (layerState.current !== layer) return;
      try { panel.focus({ preventScroll: true }); } catch (e) {}
    }, 60);
    if (typeof onMount === 'function') {
      try { onMount(panel); } catch (e) { /* ignore */ }
    }
  }
  function closeLayer(immediate) {
    var layer = layerState.current;
    var panel = layerState.panel;
    if (!layer) return;
    layer.classList.remove('is-open');
    document.body.classList.remove('has-layer');
    layerState.current = null;
    layerState.panel = null;
    layerState.kind = '';
    var prev = layerState.prevFocus;
    layerState.prevFocus = null;
    var finish = function () {
      if (layerState.current === layer) return;
      layer.hidden = true;
      if (panel) panel.innerHTML = '';
    };
    if (immediate) finish();
    else window.setTimeout(finish, 240);
    if (prev && prev.focus) {
      try { prev.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  SWR.closeSheet = function () { closeLayer(); };
  SWR.showSheet = function (html, onMount) { openLayer('sheet', html, onMount); };

  function showConfirm(title, body, okText, cb) {
    confirmCb = cb;
    openLayer('sheet',
      '<div class="sheet-head"><div><h2 class="sheet-title" id="sheetTitle">' + esc(title) + '</h2></div>' +
      '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button></div>' +
      '<div class="sheet-body"><p class="sheet-body" style="font-size:15px;line-height:1.7;color:var(--ink-soft);margin-bottom:14px">' + body + '</p></div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-lg" data-act="confirm-ok">' + esc(okText || '确定') + '</button>' +
      '<button class="btn btn-ghost btn-lg" data-act="sheet-close">再想想</button></div>');
  }

  /* ---------------- 时间 ---------------- */

  function roundKey(st) {
    if (!st) return '';
    return (st.gameNo || 1) + '-' + (st.round || 1);
  }
  function roundKeyNow() { return roundKey(S); }
  function rawRemain() {
    if (!S || !S.deadline) return null;
    // 留 1s 网络缓冲（SPEC §6.3）：各端提前收口，避免房主宽限期内被代填空词
    return S.deadline - 1000 - (Date.now() + clockOffset);
  }
  function remainMs() {
    var r = rawRemain();
    return r == null ? null : Math.max(0, r);
  }
  function recordClock(state) {
    if (!state) return;
    var h = Number(state.hostNow || state._ts || 0);
    if (h && h !== lastHostNow) {
      lastHostNow = h;
      clockOffset = h - Date.now();
    }
  }

  /* ---------------- 座位 / 状态读取 ---------------- */

  function seatCount() {
    return (S && S.seatNames && S.seatNames.length) || 0;
  }
  function playerName(i) {
    var n = S && S.seatNames ? S.seatNames[i] : '';
    return n || ('玩家' + (i + 1));
  }
  function isDeparted(i) {
    return !!(S && Array.isArray(S.departed) && S.departed.indexOf(i) >= 0);
  }
  function activeSeats() {
    var out = [];
    for (var i = 0; i < seatCount(); i++) if (!isDeparted(i)) out.push(i);
    return out;
  }
  function subDone(sub) {
    return !!(sub && sub.done && (sub.round == null || sub.round === S.round));
  }
  function mySub() {
    return (S && S.subs && S.subs[mySeat()]) || null;
  }
  function myDone() { return subDone(mySub()); }
  function myWord() {
    var sub = mySub();
    return sub && sub.word ? String(sub.word) : '';
  }
  function roundNow() { return S ? (S.round || 1) : 1; }
  function isLastRound() {
    if (!S || S.mode !== 'party') return false;
    var limit = (S.settings && S.settings.roundLimit) || 0;
    return limit > 0 && roundNow() >= limit;
  }
  function curHistory() {
    if (!S || !Array.isArray(S.history)) return null;
    for (var i = S.history.length - 1; i >= 0; i--) {
      if (S.history[i] && S.history[i].round === S.round) return S.history[i];
    }
    return null;
  }
  function revealWords() {
    var n = seatCount();
    var h = curHistory();
    var out = [];
    for (var i = 0; i < n; i++) {
      if (h && Array.isArray(h.words)) out[i] = h.words[i] || '';
      else out[i] = (S.subs && S.subs[i] && S.subs[i].word) || '';
    }
    return out;
  }
  function historyPairs() {
    var h = curHistory();
    return (h && Array.isArray(h.pairs)) ? h.pairs : [];
  }
  function claims() { return (S && S.claims) || {}; }
  function claimOn(from, to) {
    var c = claims();
    return !!(c[from] && c[from][to] && c[from][to].on);
  }
  function mutualClaim(a, b) { return claimOn(a, b) && claimOn(b, a); }
  function exactWith(a, b) {
    return historyPairs().some(function (p) {
      return p && p.kind === 'exact' &&
        ((p.a === a && p.b === b) || (p.a === b && p.b === a));
    });
  }
  function agreeWith(a, b) {
    return historyPairs().some(function (p) {
      return p && p.kind === 'agree' &&
        ((p.a === a && p.b === b) || (p.a === b && p.b === a));
    }) || mutualClaim(a, b);
  }
  function exactPairCount() {
    return historyPairs().filter(function (p) { return p && p.kind === 'exact'; }).length;
  }
  function hasEmptyWord() {
    var words = revealWords();
    if (!words.length) return false;
    for (var i = 0; i < words.length; i++) {
      if (!words[i] && !isDeparted(i)) return true;
    }
    return false;
  }
  function lastHistory() {
    if (!S || !Array.isArray(S.history) || !S.history.length) return null;
    return S.history[S.history.length - 1];
  }

/* ---------------- 启动就绪 ---------------- */

  function markReady() {
    document.body.classList.add('is-ready');
    try { if (window.__swBooted) window.__swBooted(); } catch (e) {}
  }

  /* ---------------- 首页 ---------------- */

  function statsChipsHTML() {
    var st = readStats();
    if (!st || !st.games) return '';
    var out = '<div class="landing-stats">';
    out += '<span class="stat-chip">已玩 <b>' + esc(st.games) + '</b> 局</span>';
    if (st.sync) out += '<span class="stat-chip">同频 <b>' + esc(st.sync) + '</b> 次</span>';
    if (st.best) out += '<span class="stat-chip">最快 <b>' + esc(st.best) + '</b> 轮</span>';
    out += '</div>';
    return out;
  }

  function landingHTML() {
    return '' +
      '<div class="landing">' +
        '<div class="landing-top">' +
          '<button class="icon-btn" data-act="toggle-sound" aria-pressed="' + (soundOn ? 'true' : 'false') + '" aria-label="音效开关">' +
            ico(soundOn ? 'sound' : 'mute') + '<span>' + (soundOn ? '声音' : '静音') + '</span></button>' +
          '<button class="icon-btn" data-act="open-rules" aria-label="玩法规则">' + ico('help') + '<span>规则</span></button>' +
        '</div>' +
        '<div class="landing-hero">' +
          '<div class="hero-sun" aria-hidden="true"></div>' +
          use('logo-badge', '0 0 120 120', 'hero-badge') +
          '<h1 class="landing-title">同词相遇</h1>' +
          '<div class="landing-en">SAME WORD</div>' +
          '<div class="landing-tag">' + ico('users') + '2~4 人 · 默契猜词</div>' +
          '<p class="landing-sub">各写一个词，同时揭晓，<br>看能否<strong>想到一块儿</strong></p>' +
          '<div class="mode-teasers" aria-hidden="true">' +
            '<div class="mode-mini">' + use('boot', '0 0 100 80') + '<div><b>同心小径</b><span>2 人 · 相遇</span></div></div>' +
            '<div class="mode-mini">' + use('tent', '0 0 120 100') + '<div><b>营地同频</b><span>3~4 人 · 冒险</span></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="landing-actions">' +
          '<button class="btn btn-primary btn-lg" data-act="open-create">' + ico('arrow') + '创建房间</button>' +
          '<button class="btn btn-secondary btn-lg" data-act="open-join">' + ico('users') + '加入房间</button>' +
        '</div>' +
        statsChipsHTML() +
        '<div class="camp-strip" aria-hidden="true">' +
          use('pine', '0 0 60 90', 'cs-pine') +
          '<span class="cs-line"></span>' +
          use('tent', '0 0 120 100', 'cs-tent') +
          use('flag', '0 0 80 100', 'cs-flag') +
          '<span class="cs-line"></span>' +
          use('pine', '0 0 60 90', 'cs-pine mirror') +
        '</div>' +
        '<div class="credit">@imStar100</div>' +
      '</div>';
  }

  SWR.renderLanding = function () {
    S = null;
    VIEW = null;
    draft = '';
    draftRound = '';
    autoSubmitKey = '';
    lastPhase = '';
    lastWaitKey = '';
    stopCelebration(true);
    closeLayer(true);
    if (appEl) {
      appEl.dataset.screen = 'landing';
      appEl.innerHTML = landingHTML();
    }
    markReady();
    if (URL_ROOM && !bootJoinUsed) {
      bootJoinUsed = true;
      window.setTimeout(function () {
        if (S || VIEW || layerState.current) return;
        openJoin(URL_ROOM);
      }, 160);
    }
  };

  /* ---------------- 创建 / 加入 ---------------- */

  var SHEET = null;

  function modeCardHTML(mode, iconId, vb) {
    return '<button class="mode-card" type="button" data-act="pick-mode" data-mode="' + mode + '" aria-pressed="' + (SHEET.mode === mode ? 'true' : 'false') + '">' +
      '<span class="mc-icon">' + use(iconId, vb) + '</span>' +
      '<span class="mc-title">' + modeName(mode) + '</span>' +
      '<span class="mc-sub">' + (mode === 'duel' ? '2 人 · 路上相遇' : '3~4 人 · 营地冒险') + '</span>' +
      '</button>';
  }

  function createSheetHTML(name) {
    return '' +
      '<div class="sheet-head">' +
        '<div><h2 class="sheet-title" id="sheetTitle">创建房间<small>选一条路，支一顶帐篷</small></h2></div>' +
        '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<label class="field"><span class="field-label">你的昵称</span>' +
          '<input class="input" id="createName" type="text" maxlength="' + nameLimit() + '" autocomplete="nickname" placeholder="1~12 个字" value="' + esc(name) + '"></label>' +
        '<div class="field"><span class="field-label">选一条路</span>' +
          '<div class="mode-pick">' + modeCardHTML('duel', 'boot', '0 0 100 80') + modeCardHTML('party', 'tent', '0 0 120 100') + '</div></div>' +
        '<div class="field"><span class="field-label">每轮限时</span>' +
          '<div class="chips">' + TIME_OPTIONS.map(function (n) {
            return '<button class="chip-opt" type="button" data-act="pick-time" data-v="' + n + '" aria-pressed="' + (SHEET.timeLimit === n ? 'true' : 'false') + '">' +
              (n === 0 ? '不限时' : n + ' 秒') + '</button>';
          }).join('') + '</div>' +
          '<p class="form-note">倒计时结束会自动提交你的草稿；不限时则等所有人写完。</p></div>' +
        '<div class="field" id="roundField"' + (SHEET.mode === 'party' ? '' : ' hidden') + '>' +
          '<span class="field-label">总对局数</span>' +
          '<div class="chips">' + (ROUND_OPTIONS.map(function (n) {
            return '<button class="chip-opt" type="button" data-act="pick-round" data-v="' + n + '" aria-pressed="' + (SHEET.roundLimit === n ? 'true' : 'false') + '">' + n + ' 局</button>';
          }).join('')) +
            '<div class="stepper" style="margin-left:4px">' +
              '<button type="button" data-act="round-step" data-d="-5" aria-label="减少局数">' + ico('minus') + '</button>' +
              '<span class="stepper-val" id="roundVal">' + SHEET.roundLimit + '</span>' +
              '<button type="button" data-act="round-step" data-d="5" aria-label="增加局数">' + ico('plus') + '</button>' +
            '</div>' +
          '</div>' +
          '<p class="form-note">可自定义 5~50 局，撞上越多分越高。</p></div>' +
        '<p class="form-err" id="createErr" role="alert"></p>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-lg" data-act="create-submit">' + ico('arrow') + '出发，开一局</button></div>';
  }

  function paintCreate(panel) {
    if (!SHEET || !panel) return;
    $all('[data-act="pick-mode"]', panel).forEach(function (el) {
      el.setAttribute('aria-pressed', el.dataset.mode === SHEET.mode ? 'true' : 'false');
    });
    $all('[data-act="pick-time"]', panel).forEach(function (el) {
      el.setAttribute('aria-pressed', Number(el.dataset.v) === SHEET.timeLimit ? 'true' : 'false');
    });
    $all('[data-act="pick-round"]', panel).forEach(function (el) {
      el.setAttribute('aria-pressed', Number(el.dataset.v) === SHEET.roundLimit ? 'true' : 'false');
    });
    var rf = $('#roundField', panel);
    if (rf) rf.hidden = SHEET.mode !== 'party';
    var rv = $('#roundVal', panel);
    if (rv) rv.textContent = String(SHEET.roundLimit);
  }

  function openCreate() {
    SHEET = { mode: 'duel', timeLimit: 0, roundLimit: 10 };
    openLayer('sheet', createSheetHTML(getName()), function (panel) {
      panel.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'createName') {
          e.preventDefault();
          var btn = $('[data-act="create-submit"]', panel);
          if (btn) submitCreate(btn);
        }
      });
    });
  }

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.classList.add('is-busy');
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = label || btn.dataset.label || '确定';
    }
  }

  async function submitCreate(btn) {
    if (!SHEET) return;
    var panel = btn && btn.closest('.sheet');
    if (!panel) return;
    var nameEl = $('#createName', panel);
    var errEl = $('#createErr', panel);
    var name = nameEl ? nameEl.value : '';
    var v = validateName(name);
    if (!v.ok) {
      if (nameEl) nameEl.classList.add('err');
      showErr(errEl, '昵称要有 1~' + nameLimit() + ' 个字哦');
      if (nameEl) { try { nameEl.focus(); } catch (e) {} }
      sound('error');
      return;
    }
    if (nameEl) nameEl.classList.remove('err');
    saveName(v.name);
    if (!hasSWN()) {
      showErr(errEl, '联机模块还没准备好，刷新页面再试');
      return;
    }
    showErr(errEl, '');
    busy(btn, true, '正在支帐篷…');
    try {
      await window.SWN.createRoom({
        name: v.name,
        mode: SHEET.mode,
        timeLimit: SHEET.timeLimit,
        roundLimit: SHEET.roundLimit
      });
      logLine('创建了「' + modeName(SHEET.mode) + '」房间');
      closeLayer();
      toast('营地开好了，把房间号发给朋友', 'ok');
      pushViewFromSWN();
    } catch (err) {
      busy(btn, false, '出发，开一局');
      showErr(errEl, netErrorText(err, '创建失败，请稍后再试'));
      sound('error');
    }
  }

  function joinSheetHTML(code) {
    return '' +
      '<div class="sheet-head">' +
        '<div><h2 class="sheet-title" id="sheetTitle">加入房间<small>输入朋友发来的 4 位房间号</small></h2></div>' +
        '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<label class="field"><span class="field-label">房间号</span>' +
          '<input class="input input-code" id="joinCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="0000" value="' + esc(code) + '"></label>' +
        '<label class="field"><span class="field-label">你的昵称</span>' +
          '<input class="input" id="joinName" type="text" maxlength="' + nameLimit() + '" autocomplete="nickname" placeholder="1~12 个字" value="' + esc(getName()) + '"></label>' +
        '<p class="form-err" id="joinErr" role="alert"></p>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-lg" data-act="join-submit">' + ico('arrow') + '进营地</button></div>';
  }

  function openJoin(prefill) {
    var code = String(prefill || URL_ROOM || '').replace(/\D/g, '').slice(0, 4);
    openLayer('sheet', joinSheetHTML(code), function (panel) {
      var input = $('#joinCode', panel);
      if (!input) return;
      panel.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var btn = $('[data-act="join-submit"]', panel);
          if (btn) submitJoin(btn);
        }
      });
      if (!code) { try { input.focus(); } catch (e) {} }
    });
  }

  async function submitJoin(btn) {
    var panel = btn && btn.closest('.sheet');
    if (!panel) return;
    var codeEl = $('#joinCode', panel);
    var nameEl = $('#joinName', panel);
    var errEl = $('#joinErr', panel);
    var code = (codeEl ? codeEl.value : '').replace(/\D/g, '');
    var name = nameEl ? nameEl.value : '';
    if (code.length !== 4) {
      if (codeEl) codeEl.classList.add('err');
      showErr(errEl, '房间号是 4 位数字');
      if (codeEl) { try { codeEl.focus(); } catch (e) {} }
      return;
    }
    var v = validateName(name);
    if (!v.ok) {
      if (nameEl) nameEl.classList.add('err');
      showErr(errEl, '昵称要有 1~' + nameLimit() + ' 个字哦');
      if (nameEl) { try { nameEl.focus(); } catch (e) {} }
      return;
    }
    if (codeEl) codeEl.classList.remove('err');
    if (nameEl) nameEl.classList.remove('err');
    saveName(v.name);
    if (!hasSWN()) {
      showErr(errEl, '联机模块还没准备好，刷新页面再试');
      return;
    }
    showErr(errEl, '');
    busy(btn, true, '正在进营地…');
    try {
      await window.SWN.joinRoom({ code: code, name: v.name });
      logLine('加入了房间 ' + code);
      closeLayer();
      toast('进营地啦', 'ok');
      pushViewFromSWN();
    } catch (err) {
      busy(btn, false, '进营地');
      showErr(errEl, netErrorText(err, '加入失败，检查房间号再试'));
      sound('error');
    }
  }

  function pushViewFromSWN() {
    try {
      if (window.SWN && SWN.getRoomView) {
        var v = SWN.getRoomView();
        if (v) SWR.renderWaiting(v);
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 等候室 ---------------- */

  var lastWaitKey = '';
  var waitDirty = false;

  function netChipHTML() {
    return '<span class="net-chip' + (NET ? '' : ' off') + '" title="' + (NET ? '已连接' : '正在重连') + '">' +
      '<i class="net-dot"></i><span class="net-text">' + (NET ? '在线' : '重连中') + '</span></span>';
  }

  function seatCountLabel(v, maxSeats) {
    return (v.seats ? v.seats.length : 0) + '/' + maxSeats;
  }

  function waitingSeatsHTML(v, maxSeats) {
    var map = {};
    (v.seats || []).forEach(function (s) { map[s.seatIndex] = s; });
    var out = '';
    for (var i = 0; i < maxSeats; i++) {
      var color = seatColor(i);
      var found = map[i];
      if (found) {
        out += '<div class="seat' + (i === v.seat ? ' is-me' : '') + '" style="--seat:' + color + '">' +
          '<div class="bib">' + use('bib', '0 0 100 110') + '<span class="bib-no">' + (i + 1) + '</span></div>' +
          '<div class="seat-body">' +
            '<div class="seat-name">' + esc(found.name || ('玩家' + (i + 1))) + (i === v.seat ? '（我）' : '') + '</div>' +
            '<div class="seat-role">' + (i === 0
              ? '<span class="host-star">' + ico('star') + '房主</span>'
              : ico('check') + '已就位') + '</div>' +
          '</div></div>';
      } else {
        out += '<div class="seat empty" style="--seat:' + color + '">' +
          '<div class="seat-goat">' + use('mascot-goat-lost', '0 0 120 120') + '</div>' +
          '<div class="seat-body"><div class="seat-name">空位</div>' +
            '<div class="seat-empty-copy">等待伙伴<small>号码布 ' + (i + 1) + ' 号</small></div></div>' +
          '</div>';
      }
    }
    return out;
  }

  function waitingSettingsHTML(v, mode) {
    var p = v.pending || {};
    var time = typeof p.timeLimit === 'number' ? p.timeLimit : 0;
    var rounds = p.roundLimit || 10;
    if (!v.isHost) {
      return '<section class="card settings-card card-tight">' +
        '<div class="section-title">营地设置 <span class="st-count">房主可改</span></div>' +
        '<div class="setting-row"><span class="setting-label">' + ico('clock') + '每轮限时</span><span class="setting-value">' + limitLabel(time) + '</span></div>' +
        (mode === 'party' ? '<div class="setting-row"><span class="setting-label">' + ico('flag') + '总对局数</span><span class="setting-value">' + esc(rounds) + ' 局</span></div>' : '') +
        '<p class="setting-hint">由房主统一设置，开局后倒计时会自动校准。</p></section>';
    }
    return '<section class="card settings-card card-tight">' +
      '<div class="section-title">营地设置 <span class="st-count">房主</span></div>' +
      '<div class="setting-row"><span class="setting-label">' + ico('clock') + '每轮限时</span>' +
        '<div class="settings-chips">' + TIME_OPTIONS.map(function (n) {
          return '<button class="chip-opt" type="button" data-act="wait-time" data-v="' + n + '" aria-pressed="' + (time === n ? 'true' : 'false') + '">' +
            (n === 0 ? '不限' : n + 's') + '</button>';
        }).join('') + '</div></div>' +
      (mode === 'party'
        ? '<div class="setting-row"><span class="setting-label">' + ico('flag') + '总对局数</span>' +
          '<div class="stepper">' +
            '<button type="button" data-act="wait-round-step" data-d="-5" aria-label="减少局数">' + ico('minus') + '</button>' +
            '<span class="stepper-val">' + esc(rounds) + '</span>' +
            '<button type="button" data-act="wait-round-step" data-d="5" aria-label="增加局数">' + ico('plus') + '</button>' +
          '</div></div>'
        : '') +
      '<p class="setting-hint">' + (mode === 'party' ? '打满局数或全员同词即进入结算；可自定义 5~50 局。' : '限时以房主时钟为准，所有端自动校准。') + '</p>' +
      '</section>';
  }

  function waitingFooterHTML(v, mode) {
    var count = (v.seats || []).length;
    var min = minPlayers(mode);
    var short = Math.max(0, min - count);
    var hostName = v.hostName || '房主';
    if (v.isHost) {
      var can = !!v.canStart;
      return '<div class="wait-footer">' +
        '<button class="btn btn-primary btn-lg" data-act="start-game"' + (can ? '' : ' disabled') + '>开始游戏！' + (can ? ico('arrow') : '') + '</button>' +
        '<div class="host-hint">' + ico('compass') + '<span>' +
          (can ? '人到齐了，出发去营地！' : (short > 0 ? '还差 ' + short + ' 位伙伴，把房间号发出去吧' : '双人模式满 2 人就能出发')) +
        '</span></div>' +
        '<button class="btn btn-text" data-act="leave-room">' + ico('exit') + '离开房间</button>' +
        '</div>';
    }
    return '<div class="wait-footer">' +
      '<div class="host-hint">' + ico('compass') + '<span>等 <b>' + esc(hostName) + '</b> 开始游戏…</span></div>' +
      '<div class="wait-goat">' + use('mascot-goat', '0 0 120 120') + '<span class="tiny">先去想一个顺手的词吧</span></div>' +
      '<button class="btn btn-text" data-act="leave-room">' + ico('exit') + '离开房间</button>' +
      '</div>';
  }

  function waitingHTML(v) {
    var mode = (v.pending && v.pending.mode) === 'party' ? 'party' : 'duel';
    var maxSeats = mode === 'party' ? 4 : 2;
    var code = String(v.code || '');
    var url = inviteURL(code);
    var p = v.pending || {};
    return '<div class="screen waiting">' +
      '<header class="hud">' +
        '<div class="hud-left">' +
          '<span class="chip chip-mode">' + modeName(mode) + '</span>' +
          '<span class="chip chip-soft">' + limitLabel(p.timeLimit) + '</span>' +
          (mode === 'party' ? '<span class="chip chip-soft">' + esc(p.roundLimit || 10) + ' 局</span>' : '') +
        '</div>' +
        '<div class="hud-right">' + netChipHTML() +
          '<button class="icon-btn" data-act="open-rules" aria-label="规则">' + ico('help') + '</button>' +
        '</div>' +
      '</header>' +
      '<section class="card room-card">' +
        '<div class="room-top"><span class="eyebrow">营地房间号</span>' +
          '<span class="room-live"><i class="net-dot"></i>' + (NET ? '等人中' : '重连中') + '</span></div>' +
        '<div class="code-row"><span class="room-code" aria-label="房间号 ' + esc(code) + '">' + esc(code) + '</span></div>' +
        '<div class="invite-line">' + ico('link') + '<span class="invite-url">' + esc(url) + '</span></div>' +
        '<div class="room-actions">' +
          '<button class="btn btn-secondary" data-act="copy-invite">' + ico('copy') + '复制邀请</button>' +
          '<button class="btn btn-secondary" data-act="share-invite">' + ico('share') + '分享邀请</button>' +
        '</div>' +
      '</section>' +
      '<section class="card">' +
        '<div class="section-title">营地伙伴 <span class="st-count">' + seatCountLabel(v, maxSeats) + '</span></div>' +
        '<div class="seat-grid">' + waitingSeatsHTML(v, maxSeats) + '</div>' +
        '<p class="setting-hint">号码布 1~4 号对应席位；昵称可以重复，看号码布认人。</p>' +
      '</section>' +
      waitingSettingsHTML(v, mode) +
      waitingFooterHTML(v, mode) +
      '<p class="net-note">4 位房间号 · 朋友输入即可加入 · 朋友间信任模式</p>' +
      '</div>';
  }

  SWR.renderWaiting = function (view) {
    if (!view) return;
    if (view.status && view.status !== 'waiting' && S) return;
    // 本地刚改过设置、写入还在路上：别让旧快照把数字闪回去
    if (waitDirty && VIEW && VIEW.pending) {
      var want = VIEW.pending;
      var got = view.pending || {};
      if (want.mode !== got.mode || want.timeLimit !== got.timeLimit || want.roundLimit !== got.roundLimit) {
        view.pending = { mode: want.mode, timeLimit: want.timeLimit, roundLimit: want.roundLimit };
      } else {
        waitDirty = false;
      }
    }
    VIEW = view;
    S = null;
    lastPhase = '';
    stopCelebration(true);
    if (typeof view.seat === 'number') MY_SEAT = view.seat;
    var sig = waitSignature(view);
    if (sig !== lastWaitKey || !appEl || appEl.dataset.screen !== 'waiting') {
      lastWaitKey = sig;
      if (appEl) {
        appEl.dataset.screen = 'waiting';
        appEl.innerHTML = waitingHTML(view);
      }
    } else {
      refreshNetUI();
    }
    markReady();
  };

  function waitSignature(v) {
    var seats = (v.seats || []).map(function (s) { return s.seatIndex + ':' + s.name; }).join(',');
    var p = v.pending || {};
    return [v.code, v.seat, v.isHost ? 1 : 0, v.canStart ? 1 : 0, v.status,
      seats, p.mode, p.timeLimit, p.roundLimit].join('|');
  }

  function paintWaitingSettings() {
    if (!VIEW || !VIEW.pending || !appEl || appEl.dataset.screen !== 'waiting') return;
    var val = appEl.querySelector('.stepper-val');
    if (val) val.textContent = String(VIEW.pending.roundLimit);
    var t = Number(VIEW.pending.timeLimit) || 0;
    var opts = appEl.querySelectorAll('[data-act="wait-time"]');
    for (var i = 0; i < opts.length; i++) {
      opts[i].setAttribute('aria-pressed', Number(opts[i].dataset.v) === t ? 'true' : 'false');
    }
  }

  function setWaiting(patch) {
    if (!VIEW || !VIEW.isHost || !hasSWN() || !window.SWN.setWaiting) return;
    if (!VIEW.pending) VIEW.pending = {};
    var changed = false;
    Object.keys(patch).forEach(function (k) {
      if (VIEW.pending[k] !== patch[k]) { VIEW.pending[k] = patch[k]; changed = true; }
    });
    if (!changed) { sound('tap'); return; }
    waitDirty = true;
    paintWaitingSettings();
    lastWaitKey = waitSignature(VIEW);
    sound('tap');
    var snap = {
      mode: VIEW.pending.mode,
      timeLimit: VIEW.pending.timeLimit,
      roundLimit: VIEW.pending.roundLimit
    };
    function failed() {
      waitDirty = false;
      lastWaitKey = '';
      toast('设置没同步上，再点一次', 'warn');
      if (VIEW && appEl && appEl.dataset.screen === 'waiting') SWR.renderWaiting(VIEW);
    }
    try {
      var r = window.SWN.setWaiting(snap);
      if (r && typeof r.then === 'function') {
        r.then(function (ok) {
          if (ok === false) { failed(); return; }
          var p = VIEW && VIEW.pending;
          if (waitDirty && p && p.mode === snap.mode && p.timeLimit === snap.timeLimit && p.roundLimit === snap.roundLimit) {
            waitDirty = false;
          }
        }, failed);
      }
    } catch (e) { failed(); }
  }

  function roundStepFor(v, delta) {
    var p = v.pending || {};
    var next = clamp((p.roundLimit || 10) + delta, 5, 50);
    setWaiting({ roundLimit: next });
  }

  async function startGame() {
    if (!VIEW || !hasSWN()) { toast('联机模块还没准备好', 'warn'); return; }
    var mode = (VIEW.pending && VIEW.pending.mode) === 'party' ? 'party' : 'duel';
    if ((VIEW.seats || []).length < minPlayers(mode)) { toast('人数还不够，再等一位伙伴', 'warn'); return; }
    if (!window.SWG || typeof SWG.createState !== 'function') { toast('游戏模块还没加载好，刷新试试', 'warn'); return; }
    var map = {};
    (VIEW.seats || []).forEach(function (s) { map[s.seatIndex] = s.name; });
    var maxIdx = 0;
    Object.keys(map).forEach(function (k) { maxIdx = Math.max(maxIdx, Number(k) || 0); });
    var names = [];
    for (var i = 0; i <= maxIdx; i++) names.push(map[i] || ('玩家' + (i + 1)));
    // 中途离席会留下空座位：按离席处理，否则会永远等这个幽灵座位提交
    var ghosts = [];
    for (var g = 0; g <= maxIdx; g++) if (!(g in map)) ghosts.push(g);
    var p = VIEW.pending || {};
    try {
      S = SWG.createState({
        mode: mode,
        settings: { timeLimit: p.timeLimit || 0, roundLimit: p.roundLimit || 10 },
        seatNames: names,
        now: Date.now()
      });
    } catch (e) {
      toast('开局失败，请刷新重试', 'err');
      return;
    }
    if (ghosts.length) S.departed = ghosts;
    MY_SEAT = typeof VIEW.seat === 'number' ? VIEW.seat : 0;
    recordClock(S);
    draft = ''; draftRound = ''; autoSubmitKey = '';
    try {
      var ok = await window.SWN.startGame(S);
      if (ok === false) {
        S = null;
        toast('开局失败，请再试一次', 'warn');
        return;
      }
      logLine('房主开局：' + modeName(mode) + '，共 ' + names.length + ' 人');
      sound('whistle');
      haptic([8, 30, 8]);
      VIEW = null;
      if (appEl) appEl.dataset.screen = '';
      renderGame();
    } catch (err) {
      S = null;
      toast(netErrorText(err, '开局失败，请再试一次'), 'warn');
    }
  }

  function leaveConfirm() {
    showConfirm('离开房间？', '你的号码布会空出来，房主可以邀请新的伙伴。', '离开房间', function () {
      doLeave();
    });
  }
  function doLeave() {
    // 立即回首页，离席请求在后台完成：网络慢时不能把人卡在房间里
    var pending = null;
    try {
      if (hasSWN() && window.SWN.leave) pending = window.SWN.leave();
    } catch (e) { /* ignore */ }
    SWR.renderLanding();
    if (pending && typeof pending.catch === 'function') pending.catch(function () { /* ignore */ });
  }

  function copyText(text) {
    var done = function () { toast('已复制，快发给朋友', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      cb();
    } catch (e) {
      toast('复制失败，请长按选择', 'warn');
    }
  }

  async function shareInvite() {
    if (!VIEW) return;
    var url = inviteURL(VIEW.code);
    var text = '来「同词相遇」和我撞个词！房间号 ' + VIEW.code;
    if (navigator.share) {
      try {
        await navigator.share({ title: '同词相遇', text: text, url: url });
        return;
      } catch (e) { /* 用户取消或不可用 */ }
    }
    copyText(url);
  }

/* ---------------- HUD / 计时 ---------------- */

  function timerHTML() {
    if (!S) return '';
    var limit = (S.settings && S.settings.timeLimit) || 0;
    if (!limit) return '<span class="timer-chip" aria-label="本轮不限时">' + ico('clock') + '不限时</span>';
    var rem = remainMs();
    var secs = rem == null ? limit : Math.ceil(rem / 1000);
    return '<div class="timer-ring" data-timer="1" role="timer" aria-label="剩余 ' + secs + ' 秒">' +
      '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="tr-track" cx="22" cy="22" r="17"/><circle class="tr-fill" cx="22" cy="22" r="17"/></svg>' +
      '<span class="timer-num">' + esc(secs) + '</span></div>';
  }

  function updateTimers() {
    if (!S) return;
    var els = $all('.timer-ring[data-timer]');
    if (!els.length) return;
    var rem = remainMs();
    if (rem == null) return;
    var total = ((S.settings && S.settings.timeLimit) || 0) * 1000 || 1;
    var frac = clamp(rem / total, 0, 1);
    var secs = Math.ceil(rem / 1000);
    els.forEach(function (el) {
      var fill = $('.tr-fill', el);
      var num = $('.timer-num', el);
      if (fill) fill.style.strokeDashoffset = String((106.8 * (1 - frac)).toFixed(2));
      if (num) num.textContent = String(secs);
      el.classList.toggle('is-low', rem <= 5000);
      el.setAttribute('aria-label', '剩余 ' + secs + ' 秒');
    });
  }

  function hudHTML(withTimer) {
    if (!S) return '';
    var mode = S.mode === 'party' ? 'party' : 'duel';
    var round = roundNow();
    var limit = (S.settings && S.settings.roundLimit) || 0;
    var pill = mode === 'duel'
      ? '<span class="round-pill"><b>' + round + '</b><span>轮</span></span>'
      : '<span class="round-pill"><b>' + round + '</b><span>/ ' + (limit || '—') + ' 局</span></span>';
    return '<header class="hud">' +
      '<div class="hud-left"><span class="chip chip-mode">' + modeName(mode) + '</span>' + pill + '</div>' +
      '<div class="hud-right">' + (withTimer ? timerHTML() : '') + netChipHTML() +
        '<button class="icon-btn" data-act="open-log" aria-label="对局记录">' + ico('log') + '</button>' +
        '<button class="icon-btn" data-act="open-rules" aria-label="规则">' + ico('help') + '</button>' +
      '</div></header>';
  }

  /* ---------------- 出词 ---------------- */

  function playerStateHTML(seat) {
    if (isDeparted(seat)) return '离线';
    var sub = S.subs && S.subs[seat];
    if (subDone(sub)) return ico('check') + '已提交';
    return '<span class="think-dots"><i></i><i></i><i></i></span>思考中';
  }

  function playerStripHTML() {
    var me = mySeat();
    var out = '<div class="player-strip" id="playerStrip">';
    for (var i = 0; i < seatCount(); i++) {
      var cls = 'pchip';
      if (i === me) cls += ' is-me';
      if (isDeparted(i)) cls += ' off';
      else if (subDone(S.subs && S.subs[i])) cls += ' done';
      out += '<div class="' + cls + '" data-pseat="' + i + '" style="--seat:' + seatColor(i) + '">' +
        '<span class="pavatar">' + (i + 1) + '</span>' +
        '<span class="pbody"><span class="pname">' + esc(playerName(i)) + (i === me ? ' · 我' : '') + '</span>' +
        '<span class="pstate">' + playerStateHTML(i) + '</span></span></div>';
    }
    return out + '</div>';
  }

  function promptWordsHTML(words) {
    if (!words || !words.length) return '';
    var out = '<div class="prompt-words">';
    words.forEach(function (w, i) {
      if (i > 0) out += '<span class="pw-plus">+</span>';
      out += w
        ? '<span class="pw-chip">' + esc(w) + '</span>'
        : '<span class="pw-chip empty">超时</span>';
    });
    return out + '</div>';
  }

  function promptHTML() {
    var mode = S.mode === 'party' ? 'party' : 'duel';
    var label = '';
    var body = '';
    if (mode === 'duel') {
      if (roundNow() <= 1) {
        label = '第一轮 · 自由联想';
        body = '<p class="prompt-text">第一轮，随便想一个词！越日常越容易撞上。</p>';
      } else {
        var h = lastHistory();
        label = '上一轮你们写的是';
        body = promptWordsHTML(h && h.words) +
          '<p class="prompt-text">从这两个词出发，想一个能把它们连起来的词。</p>';
      }
    } else {
      label = '第 ' + roundNow() + ' 局 · 共 ' + ((S.settings && S.settings.roundLimit) || '—') + ' 局';
      var last = lastHistory();
      var note = '各写一个词，同时揭晓，别偷看噢。';
      if (last && last.round !== S.round) {
        var ex = (last.pairs || []).filter(function (p) { return p.kind === 'exact'; });
        if (ex.length) {
          note = '上一局：' + playerName(ex[0].a) + ' × ' + playerName(ex[0].b) + ' 撞上了 💥';
        } else if ((last.pairs || []).some(function (p) { return p.kind === 'agree'; })) {
          note = '上一局有人认证成功 🤝，这局继续找同频。';
        } else {
          note = '上一局没人撞上，这局继续找同频。';
        }
      } else if (!last) {
        note = '营地开张，先随便写一个词吧。';
      }
      body = '<p class="prompt-text">' + note + '</p>';
    }
    return '<section class="card prompt-card">' +
      '<div class="prompt-icon">' + use('trail-sign', '0 0 120 100') + '</div>' +
      '<div class="prompt-body"><span class="eyebrow">' + esc(label) + '</span>' + body + '</div>' +
      '</section>';
  }

  function wordHintHTML(raw) {
    var v = validateWord(raw);
    if (!String(raw || '').trim()) return '1~10 个字。英文大小写、空格、标点都不影响判同。';
    if (!v.ok) {
      if (v.error === 'ONLY_SYMBOL') return '<span class="err">不能只有符号哦</span>';
      if (v.error === 'TOO_LONG') return '<span class="err">最多 10 个字，再精简一下</span>';
      return '<span class="err">写点什么吧</span>';
    }
    var norm = normalizeWord(raw);
    var display = String(raw).trim().replace(/\s+/g, ' ');
    if (norm && norm !== display.toLowerCase()) {
      return '判同按「<b>' + esc(norm) + '</b>」计算 · 可以提交了';
    }
    return '可以提交了 ✓';
  }

  function inputCardHTML() {
    var rk = roundKeyNow();
    var val = draftRound === rk ? draft : '';
    var v = validateWord(val);
    var count = Math.min(wordLimit(), charLen(val));
    return '<section class="card input-card" id="inputCard">' +
      '<div class="input-head"><label for="wordInput">写下你想到的词</label>' +
        '<span class="counter" id="wordCount">' + count + '/' + wordLimit() + '</span></div>' +
      '<input class="word-input" id="wordInput" type="text" maxlength="' + wordLimit() + '" enterkeyhint="done" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="比如：一种食物" value="' + esc(val) + '">' +
      '<p class="word-hint" id="wordHint">' + wordHintHTML(val) + '</p>' +
      '<button class="btn btn-primary btn-lg" id="submitWord" data-act="submit-word"' + (v.ok ? '' : ' disabled') + '>提交，保密！</button>' +
      '</section>';
  }

  function sealedCardHTML() {
    var sub = mySub();
    var word = sub && sub.word ? String(sub.word) : '';
    var rem = remainMs();
    var locked = rem != null && rem <= 0;
    return '<section class="card sealed-card">' +
      '<div class="sealed-inner">' +
        '<div class="wax-seal">' + ico('check') + '</div>' +
        '<div class="sealed-copy"><span class="eyebrow">已封存，揭晓前谁也看不到</span>' +
          '<div class="sealed-word' + (word ? '' : ' is-empty') + '">' + (word ? esc(word) : '本轮超时') + '</div></div>' +
      '</div>' +
      '<div class="wait-line" id="waitLine">' + waitingTextHTML() + '</div>' +
      '<div class="sealed-actions"><button class="btn btn-secondary btn-sm" id="withdrawBtn" data-act="withdraw"' + (locked ? ' disabled' : '') + '>撤回重写</button></div>' +
      '</section>';
  }

  function waitingTextHTML() {
    var me = mySeat();
    var sub = mySub();
    if (subDone(sub) && !(sub && sub.word)) {
      return ico('clock') + '<span>本轮超时没写，等揭晓…</span>';
    }
    var others = activeSeats().filter(function (s) {
      return s !== me && !subDone(S.subs && S.subs[s]);
    });
    if (!others.length) return ico('compass', 'compass-mini') + '<span>全员写完，马上揭晓…</span>';
    var names = others.map(function (s) { return '<b>' + esc(playerName(s)) + '</b>'; });
    var text = names.length === 1
      ? '等 ' + names[0] + ' 写完…'
      : '等 ' + names[0] + ' 等 ' + names.length + ' 人…';
    return ico('compass', 'compass-mini') + '<span>' + text + '</span>';
  }

  function historyMarksHTML(row) {
    var marks = [];
    (row.pairs || []).forEach(function (p) {
      if (p.kind === 'exact') marks.push(playerName(p.a) + ' × ' + playerName(p.b) + ' 撞词 💥');
      else if (p.kind === 'agree') marks.push(playerName(p.a) + ' × ' + playerName(p.b) + ' 认证 🤝');
    });
    return marks.length
      ? marks.map(function (m) { return '<span class="hit-mark">' + esc(m) + '</span>'; }).join('')
      : '<span class="muted">—</span>';
  }

  function histDetailsHTML() {
    var hist = (S && S.history) || [];
    if (!hist.length) return '';
    var rows = hist.slice().reverse().map(function (row) {
      var words = (row.words || []).map(function (w, i) {
        return '<span><b>' + esc(playerName(i)) + '</b> ' + (w ? esc(w) : '<span class="miss">超时</span>') + '</span>';
      }).join('');
      return '<tr><td>第 ' + esc(row.round) + ' 局</td><td><div class="hist-words">' + words + '</div></td>' +
        '<td>' + historyMarksHTML(row) + '</td></tr>';
    }).join('');
    return '<details class="hist-details"><summary>完整历史（' + hist.length + ' 局）</summary>' +
      '<table class="hist-table"><thead><tr><th>局</th><th>大家写的</th><th>命中</th></tr></thead><tbody>' + rows + '</tbody></table></details>';
  }

  function playingFooterHTML() {
    var out = '';
    var me = mySeat();
    var dec = (S && S.decisions) || {};
    var reqs = activeSeats().filter(function (s) {
      return s !== me && dec[s] && dec[s].value === 'giveup';
    });
    var myReq = !!(dec[me] && dec[me].value === 'giveup');
    if (S.mode === 'party') {
      out += histDetailsHTML();
      if (netIsHost()) {
        out += '<div class="result-foot"><button class="btn btn-text" data-act="force-reveal">' + ico('clock') + '等不到人？直接揭晓</button></div>' +
          '<div class="result-foot"><button class="btn btn-text danger" data-act="force-end">' + ico('exit') + '提前结束，看结算</button></div>';
      }
    } else if (netIsHost()) {
      if (reqs.length) {
        out += '<div class="giveup-request"><span>' + esc(playerName(reqs[0])) + ' 想结束本局</span>' +
          '<button class="btn btn-sm btn-primary" data-act="approve-giveup" data-seat="' + reqs[0] + '">结束并结算</button></div>';
      }
      out += '<div class="result-foot"><button class="btn btn-text" data-act="force-reveal">' + ico('clock') + '等不到人？直接揭晓</button></div>' +
        '<div class="result-foot"><button class="btn btn-text danger" data-act="giveup">' + ico('exit') + '想不到了？放弃，看结算</button></div>';
    } else if (myReq) {
      out += '<div class="vote-state mine">' + ico('clock') + '<span>已请求结束本局，等房主确认…</span></div>' +
        '<div class="result-foot"><button class="btn btn-text" data-act="cancel-giveup">取消请求</button></div>';
    } else if (reqs.length) {
      out += '<div class="vote-state">' + ico('clock') + '<span>有伙伴想结束本局，等房主确认…</span></div>' +
        '<div class="result-foot"><button class="btn btn-text danger" data-act="giveup">' + ico('exit') + '想不到了？放弃，看结算</button></div>';
    } else {
      out += '<div class="result-foot"><button class="btn btn-text danger" data-act="giveup">' + ico('exit') + '想不到了？放弃，看结算</button></div>';
    }
    out += '<div class="host-hint" id="hostOffline" hidden>' + ico('compass', 'compass-mini') +
      '<span>房主暂时离线，等待恢复…</span></div>';
    return out;
  }

  function playingHTML() {
    var me = mySeat();
    var done = myDone();
    return '<div class="screen playing">' +
      hudHTML(true) +
      playerStripHTML() +
      promptHTML() +
      (done ? sealedCardHTML() : inputCardHTML()) +
      playingFooterHTML() +
      '<p class="net-note">只显示自己的词 · 揭晓前谁也看不到别人</p>' +
      '</div>';
  }

  function renderPlaying() {
    var key = 'play:' + roundKey(S) + ':' + (myDone() ? 1 : 0) + ':' + mySeat();
    if (!appEl || appEl.dataset.screen !== key) {
      if (appEl) {
        appEl.dataset.screen = key;
        appEl.innerHTML = playingHTML();
      }
    } else {
      patchPlaying();
    }
    updateTimers();
  }

  function patchPlaying() {
    var strip = $('#playerStrip');
    if (strip) {
      for (var i = 0; i < seatCount(); i++) {
        var chip = $('[data-pseat="' + i + '"]', strip);
        if (!chip) continue;
        var done = !isDeparted(i) && subDone(S.subs && S.subs[i]);
        chip.classList.toggle('done', done);
        chip.classList.toggle('off', isDeparted(i));
        var st = $('.pstate', chip);
        if (st) st.innerHTML = playerStateHTML(i);
      }
    }
    var wait = $('#waitLine');
    if (wait) wait.innerHTML = waitingTextHTML();
    var wb = $('#withdrawBtn');
    if (wb) {
      var rem = remainMs();
      wb.disabled = !!(rem != null && rem <= 0);
    }
    updateHostOffline();
  }

  function updateHostOffline() {
    var el = $('#hostOffline');
    if (!el) return;
    var r = rawRemain();
    var late = r != null && r < -8000 && !netIsHost();
    el.hidden = !late;
  }

  function refreshWordUI() {
    var input = $('#wordInput');
    if (!input) return;
    var raw = input.value;
    draft = raw;
    draftRound = roundKeyNow();
    var v = validateWord(raw);
    var count = Math.min(wordLimit(), charLen(raw));
    var counter = $('#wordCount');
    if (counter) {
      counter.textContent = count + '/' + wordLimit();
      counter.classList.toggle('is-max', count >= wordLimit());
    }
    var hint = $('#wordHint');
    if (hint) hint.innerHTML = wordHintHTML(raw);
    var btn = $('#submitWord');
    if (btn) btn.disabled = !v.ok;
  }

  function submitWord() {
    if (!S || S.phase !== 'playing') return;
    if (!window.SWG || typeof SWG.submit !== 'function') { toast('游戏模块还没加载好，刷新试试', 'warn'); return; }
    var input = $('#wordInput');
    var rk = roundKeyNow();
    var raw = input ? input.value : (draftRound === rk ? draft : '');
    var v = validateWord(raw);
    if (!v.ok) {
      if (input) {
        input.classList.add('err');
        try { input.focus(); } catch (e) {}
      }
      var hint = $('#wordHint');
      if (hint) hint.innerHTML = wordHintHTML(raw);
      sound('error');
      return;
    }
    var r = SWG.submit(S, mySeat(), raw, Date.now());
    if (!r || !r.ok) {
      toast(r && r.error === 'TOO_LATE' ? '已经揭晓了，改不了啦' : '提交失败，再试一次', 'warn');
      return;
    }
    if (input) input.classList.remove('err');
    draft = '';
    draftRound = rk;
    sound('seal');
    haptic(12);
    forceRender();
    SWR.pushState();
    logLine('你在第 ' + roundNow() + ' 轮提交了词');
  }

  function withdrawWord() {
    if (!S || S.phase !== 'playing') return;
    var rem = remainMs();
    if (rem != null && rem <= 0) { toast('时间到，不能撤回了', 'warn'); sound('error'); return; }
    var me = mySeat();
    if (window.SWG && typeof SWG.withdraw === 'function') {
      var r = SWG.withdraw(S, me, Date.now());
      if (r && r.error === 'NOT_PLAYING') { toast('已经揭晓了，改不了啦', 'warn'); return; }
      if (r && r.error === 'INACTIVE') { toast('你已离席，不能再写词了', 'warn'); return; }
    } else {
      if (!S.subs) S.subs = {};
      S.subs[me] = { word: '', at: Date.now(), done: false, round: S.round };
    }
    autoSubmitKey = '';
    sound('tap');
    forceRender();
    SWR.pushState();
    toast('已撤回，重新写一个吧');
  }

  function forceRender() {
    if (!appEl) return;
    appEl.dataset.screen = '';
    renderGame();
  }

  function autoSubmitIfNeeded() {
    if (!S || S.phase !== 'playing' || !S.deadline) return;
    var rem = rawRemain();
    if (rem == null || rem > 350) return;
    var rk = roundKeyNow();
    if (autoSubmitKey === rk) return;
    var me = mySeat();
    if (isDeparted(me)) { autoSubmitKey = rk; return; }
    if (myDone()) { autoSubmitKey = rk; return; }
    if (!window.SWG || typeof SWG.submitEmpty !== 'function') return;
    autoSubmitKey = rk;
    var input = $('#wordInput');
    var raw = input ? input.value : (draftRound === rk ? draft : '');
    var v = validateWord(raw);
    try {
      if (v.ok && typeof SWG.submit === 'function') SWG.submit(S, me, raw, Date.now());
      else SWG.submitEmpty(S, me, Date.now());
    } catch (e) { /* ignore */ }
    draft = '';
    draftRound = rk;
    sound('flip');
    haptic(10);
    toast(v.ok ? '时间到，已自动提交' : '时间到，本轮按超时处理', v.ok ? 'ok' : 'warn');
    forceRender();
    SWR.pushState();
  }

  function tickTimer() {
    if (!S) return;
    updateTimers();
    updateHostOffline();
    if (S.phase === 'playing') autoSubmitIfNeeded();
  }

  /* ---------------- 主渲染路由 ---------------- */

  SWR.getState = function () { return S; };

  function renderGame() {
    if (typeof SWR.renderGame === 'function') SWR.renderGame();
  }

  SWR.renderGame = function () {
    if (!S) { SWR.renderLanding(); return; }
    if (S.phase !== 'finished') stopCelebration(true);
    if (S.phase === 'playing') renderPlaying();
    else if (S.phase === 'reveal') {
      if (S.mode === 'party') renderRevealParty();
      else renderRevealDuel();
    } else if (S.phase === 'finished') renderFinished();
    else renderPlaying();
    markReady();
    updateTimers();
  };

  /* ---------------- 揭晓 · 双人 ---------------- */

  function wordCardHTML(seat, word, opts) {
    opts = opts || {};
    var mine = seat === mySeat();
    var exact = !!opts.exact;
    var agree = !exact && !!opts.agree;
    var badge = exact
      ? '<span class="wc-badge">💥 撞词</span>'
      : (agree ? '<span class="wc-badge agree">🤝 认证</span>' : '');
    var delay = (opts.index || 0) * 230;
    return '<div class="word-card' + (mine ? ' is-me' : '') + (exact ? ' is-exact' : '') + (agree ? ' is-agree' : '') + '" style="--seat:' + seatColor(seat) + '">' +
      '<div class="wc-top"><span class="wc-bib">' + (seat + 1) + '</span>' +
        '<span class="wc-name">' + esc(playerName(seat)) + (mine ? ' · 我' : '') + '</span>' + badge + '</div>' +
      '<div class="flip"><span class="wc-word' + (word ? '' : ' empty') + '" style="--delay:' + delay + 'ms">' + (word ? esc(word) : '超时') + '</span></div>' +
      '<div class="wc-foot">' + (opts.foot || (isDeparted(seat) ? '已离席' : '')) + '</div>' +
      '</div>';
  }

  function duelRevealTitle() {
    var words = revealWords();
    var same = words.length > 1 && words[0] && normalizeWord(words[0]) === normalizeWord(words[1]);
    return {
      main: same ? '撞上啦！！' : '差一点点！',
      sub: '第 ' + roundNow() + ' 轮 · ' + playerName(0) + ' × ' + playerName(1)
    };
  }

  function duelDynamicHTML() {
    var me = mySeat();
    var decisions = S.decisions || {};
    var mine = decisions[me];
    var myVote = mine && (mine.value === 'same' || mine.value === 'next') ? mine.value : '';
    var myReq = mine && mine.value === 'giveup';
    var active = activeSeats();
    var others = active.filter(function (s) { return s !== me; });
    var other = others.length ? others[0] : null;
    var otherVote = other != null && decisions[other] && (decisions[other].value === 'same' || decisions[other].value === 'next')
      ? decisions[other].value : '';
    var reqSeats = active.filter(function (s) {
      return s !== me && decisions[s] && decisions[s].value === 'giveup';
    });
    var empty = hasEmptyWord();
    var host = netIsHost();
    var out = '';

    if (host && reqSeats.length) {
      out += '<div class="giveup-request"><span>' + esc(playerName(reqSeats[0])) + ' 想结束本局</span>' +
        '<button class="btn btn-sm btn-primary" data-act="approve-giveup" data-seat="' + reqSeats[0] + '">结束并结算</button></div>';
    }

    if (myVote) {
      var mineTxt = myVote === 'same' ? '意思一样' : '进入下一轮';
      var nextTxt;
      if (otherVote) {
        if (myVote === 'same' && otherVote === 'same') {
          nextTxt = host ? '双方都同意，正在结算…' : '双方都同意，等房主结算…';
        } else {
          nextTxt = host ? '双方已表态，正在进入下一轮…' : '双方已表态，等房主推进下一轮…';
        }
      } else {
        nextTxt = '已表态，等 ' + (other != null ? esc(playerName(other)) : '对方') + ' 也表态后才推进…';
      }
      out += '<div class="vote-state mine">' + ico('check') +
        '<span>你选了 <b>' + mineTxt + '</b> · ' + nextTxt + '</span></div>';
    } else {
      out += '<p class="vote-question">两个词不一样。你们觉得……</p>' +
        '<div class="votes">' +
          '<button class="vote-btn same" data-act="duel-vote" data-v="same"' + (empty ? ' disabled' : '') + '>' +
            '🤝 我认为意思一样<small>' + (empty ? '本轮有人超时，不可选' : '双方都同意才结算') + '</small></button>' +
          '<button class="vote-btn next" data-act="duel-vote" data-v="next">' +
            '我想进入下一轮 →<small>双方表态后才继续</small></button>' +
        '</div>';
      if (empty) out += '<p class="tiny" style="text-align:center">本轮有人超时，只能进入下一轮。</p>';
    }

    if (!myVote && otherVote) {
      out += '<div class="vote-state">' + ico('compass') + '<span><b>' + esc(playerName(other)) + '</b> 已经表态了，等你啦</span></div>';
    }
    if (myReq) {
      out += '<div class="vote-state">' + ico('clock') + '<span>已请求结束本局，等房主确认…</span></div>';
    } else if (!host && reqSeats.length) {
      out += '<div class="vote-state">' + ico('clock') + '<span>有伙伴想结束本局，等房主确认…</span></div>';
    }

    var tools = '';
    if (host) tools += '<button class="btn btn-secondary btn-sm" data-act="force-next">不等了，下一轮 →</button>';
    if (!myReq) tools += '<button class="btn btn-text danger" data-act="giveup">想不到了？放弃，看结算</button>';
    out += '<div class="host-tools">' + tools + '</div>';
    return out;
  }

  function duelRevealHTML() {
    var words = revealWords();
    var t = duelRevealTitle();
    var cards = '';
    for (var i = 0; i < seatCount(); i++) {
      var word = words[i] || '';
      cards += wordCardHTML(i, word, {
        index: i,
        exact: words.length > 1 && word && normalizeWord(word) === normalizeWord(words[i === 0 ? 1 : 0]) && normalizeWord(word) !== '',
        foot: word ? '' : '本轮超时'
      });
    }
    return '<div class="screen reveal">' +
      hudHTML(false) +
      '<div class="reveal-title">' + esc(t.main) + '<small>' + esc(t.sub) + '</small></div>' +
      '<div class="word-grid">' + cards + '</div>' +
      '<div class="duel-dynamic" id="duelDynamic">' + duelDynamicHTML() + '</div>' +
      '</div>';
  }

  function renderRevealDuel() {
    var key = 'duel:' + roundKey(S);
    if (!appEl || appEl.dataset.screen !== key) {
      if (appEl) {
        appEl.dataset.screen = key;
        appEl.innerHTML = duelRevealHTML();
      }
    } else {
      var d = $('#duelDynamic');
      if (d) d.innerHTML = duelDynamicHTML();
    }
  }

  function voteDuel(value) {
    if (!S || S.phase !== 'reveal' || !window.SWG || typeof SWG.duelDecide !== 'function') return;
    if (value === 'same' && hasEmptyWord()) { toast('本轮有人超时，只能进入下一轮', 'warn'); return; }
    try {
      SWG.duelDecide(S, mySeat(), value, Date.now());
    } catch (e) { /* ignore */ }
    sound('vote');
    haptic(8);
    renderGame();
    SWR.pushState();
  }

  function forceNextDuel() {
    if (!S || !netIsHost() || !window.SWG || typeof SWG.startRound !== 'function') return;
    try { SWG.startRound(S, Date.now()); } catch (e) { return; }
    draft = ''; draftRound = ''; autoSubmitKey = '';
    sound('flip');
    forceRender();
    SWR.pushState();
    logLine('房主推进到第 ' + roundNow() + ' 轮');
  }

  function giveUp() {
    if (!S) return;
    if (netIsHost()) {
      showConfirm('放弃这一局？', '会直接进入结算，本局记为「信号失联」。', '放弃并结算', function () {
        if (!S || !window.SWG || typeof SWG.finish !== 'function') return;
        try { SWG.finish(S, 'giveup', 0, Date.now()); } catch (e) { return; }
        sound('whistle');
        forceRender();
        SWR.pushState();
      });
    } else {
      if (!S.decisions) S.decisions = {};
      S.decisions[mySeat()] = { value: 'giveup', at: Date.now() };
      sound('tap');
      renderGame();
      SWR.pushState();
      toast('已告诉房主你想结束本局', 'ok');
    }
  }

  /* 取消结束请求：写墓碑值，保证合并时能覆盖旧的 giveup */
  function cancelGiveup() {
    if (!S || netIsHost()) return;
    if (!S.decisions) S.decisions = {};
    S.decisions[mySeat()] = { value: 'cancel', at: Date.now() };
    sound('tap');
    renderGame();
    SWR.pushState();
    toast('已取消结束请求');
  }

  function approveGiveup(seat) {
    if (!S || !netIsHost() || !window.SWG || typeof SWG.finish !== 'function') return;
    showConfirm('结束本局？', esc(playerName(seat)) + ' 想放弃，本局按「信号失联」结算。', '结束并结算', function () {
      try { SWG.finish(S, 'giveup', seat, Date.now()); } catch (e) { return; }
      sound('whistle');
      forceRender();
      SWR.pushState();
    });
  }

  function forceEnd() {
    if (!S || !netIsHost() || !window.SWG || typeof SWG.finish !== 'function') return;
    showConfirm('提前结束？', '会直接进入结算，已撞上的对子照常计分。', '提前结束', function () {
      try { SWG.finish(S, 'giveup', 0, Date.now()); } catch (e) { return; }
      sound('whistle');
      forceRender();
      SWR.pushState();
    });
  }

  /* 有人掉线/关页时房主的唯一出口：把未提交按超时填空后立刻揭晓（规则由 SWG 执行） */
  function forceReveal() {
    if (!S || !netIsHost() || !window.SWG) return;
    if (S.phase !== 'playing') return;
    if (typeof SWG.fillMissing !== 'function' || typeof SWG.finalizeRound !== 'function') return;
    showConfirm('直接揭晓？', '还没出词的伙伴按「超时未出词」处理，本局立刻揭晓。', '直接揭晓', function () {
      var t = Date.now();
      try { SWG.fillMissing(S, t); } catch (e) {}
      try { SWG.finalizeRound(S, t); } catch (e) { return; }
      sound('whistle');
      forceRender();
      SWR.pushState();
    });
  }

/* ---------------- 揭晓 · 多人 ---------------- */

  function claimInnerHTML(target) {
    var me = mySeat();
    var words = revealWords();
    if (target === me) {
      var ins = activeSeats().filter(function (s) {
        return s !== me && claimOn(s, me) && !exactWith(s, me);
      });
      if (!ins.length) return '<span class="claim-chip dead">我的词</span>';
      return ins.map(function (s) {
        var back = claimOn(me, s);
        return '<span class="claim-chip' + (back ? ' hit' : '') + '">' +
          (back ? '✓ ' : '') + esc(playerName(s)) + (back ? ' 互选' : ' 觉得像') + '</span>';
      }).join('');
    }
    if (isDeparted(target)) return '<span class="claim-chip dead">已离席</span>';
    if (exactWith(me, target)) return '<span class="claim-chip hit">✓ 撞上了</span>';
    if (!words[me] || !words[target]) return '<span class="claim-chip dead">本轮超时</span>';
    var my = claimOn(me, target);
    var theirs = claimOn(target, me);
    if (my) return '<button class="claim-btn on" data-act="claim" data-seat="' + target + '">' + (theirs ? '互选成功 ✓' : '已认证，等 TA') + '</button>';
    if (theirs) return '<button class="claim-btn ask" data-act="claim" data-seat="' + target + '">TA 觉得像，确认？</button>';
    return '<button class="claim-btn" data-act="claim" data-seat="' + target + '">🤝 和我意思一样</button>';
  }

  function partyCardsHTML() {
    var me = mySeat();
    var words = revealWords();
    var out = '<div class="party-cards" id="partyCards">';
    for (var i = 0; i < seatCount(); i++) {
      var word = words[i] || '';
      var ex = false;
      var ag = false;
      for (var j = 0; j < seatCount(); j++) {
        if (j === i) continue;
        if (exactWith(i, j)) ex = true;
        else if (agreeWith(i, j)) ag = true;
      }
      var cls = 'party-word';
      if (i === me) cls += ' is-me';
      if (ex) cls += ' is-exact';
      else if (ag) cls += ' is-agree';
      if (isDeparted(i)) cls += ' off';
      out += '<div class="' + cls + '" data-pword="' + i + '" style="--seat:' + seatColor(i) + '">' +
        '<span class="score-bib">' + (i + 1) + '</span>' +
        '<div class="pw-main"><div class="pw-owner"><b>' + esc(playerName(i)) + (i === me ? ' · 我' : '') + '</b>' +
          (ex ? '<span class="wc-badge">💥 撞词</span>' : (ag ? '<span class="wc-badge agree">🤝 认证</span>' : '')) +
        '</div>' +
        '<div class="pw-word' + (word ? '' : ' empty') + '">' + (word ? esc(word) : '超时') + '</div></div>' +
        '<div class="claim-area" data-claim="' + i + '">' + claimInnerHTML(i) + '</div>' +
        '</div>';
    }
    return out + '</div>';
  }

  function readyOn(seat) {
    if (isDeparted(seat)) return true;
    var r = S && S.ready && S.ready[seat];
    return !!(r && r.on);
  }

  function readyBarHTML() {
    var me = mySeat();
    var active = activeSeats();
    var onCount = active.filter(readyOn).length;
    var mine = readyOn(me);
    var all = active.length > 0 && onCount === active.length;
    var host = netIsHost();
    var dots = active.map(function (s) {
      return '<i class="' + (readyOn(s) ? 'on' : '') + '"></i>';
    }).join('');
    var myClaims = [];
    active.forEach(function (s) {
      if (s !== me && claimOn(me, s) && !mutualClaim(me, s) && !exactWith(me, s)) myClaims.push(playerName(s));
    });
    var out = '<section class="card ready-bar" id="readyBar">' +
      '<div class="ready-count"><span>准备好了 <b>' + onCount + '/' + active.length + '</b></span>' +
        '<span class="progress-dots">' + dots + '</span></div>';
    if (myClaims.length) {
      out += '<p class="my-claim-line">你认证了 ' + esc(myClaims.join('、')) + '，等对方也点你。</p>';
    }
    if (isDeparted(me)) {
      out += '<p class="my-claim-line">你已离席，等待房主推进…</p>';
    } else {
      out += '<button class="btn ' + (mine ? 'btn-secondary' : 'btn-primary') + ' btn-lg" data-act="toggle-ready">' +
        (mine ? '取消准备' : (isLastRound() ? '准备好了，看结算 →' : '准备好了，下一局 →')) + '</button>';
    }
    if (host) {
      out += '<div class="host-tools">' +
        '<button class="btn btn-secondary btn-sm" data-act="party-next">' + (isLastRound() ? '直接看结算 →' : '不等了，下一局 →') + '</button>' +
        '<button class="btn btn-text danger" data-act="force-end">提前结束，看结算</button></div>';
    } else if (all) {
      out += '<p class="my-claim-line">全员准备好了，等房主推进…</p>';
    }
    return out + '</section>';
  }

  function partyRevealTitle() {
    var ex = exactPairCount();
    if (ex > 0) return { main: '撞上 ' + ex + ' 对！', sub: '第 ' + roundNow() + ' 局 · 还可以认证意思一样的' };
    var ag = historyPairs().filter(function (p) { return p && p.kind === 'agree'; }).length;
    if (ag > 0) return { main: '认证 ' + ag + ' 对', sub: '第 ' + roundNow() + ' 局 · 双选即认证成功' };
    return { main: '这局没撞上', sub: '第 ' + roundNow() + ' 局 · 觉得谁和你同频？点一下认证' };
  }

  function partyRevealHTML() {
    var t = partyRevealTitle();
    return '<div class="screen reveal party-reveal">' +
      hudHTML(false) +
      '<div class="reveal-title">' + esc(t.main) + '<small>' + esc(t.sub) + '</small></div>' +
      partyCardsHTML() +
      readyBarHTML() +
      '</div>';
  }

  function patchPartyDynamic() {
    for (var i = 0; i < seatCount(); i++) {
      var el = $('[data-claim="' + i + '"]');
      if (el) el.innerHTML = claimInnerHTML(i);
    }
    var rb = $('#readyBar');
    if (rb) {
      var tmp = document.createElement('div');
      tmp.innerHTML = readyBarHTML();
      var fresh = tmp.firstElementChild;
      if (fresh) rb.innerHTML = fresh.innerHTML;
    }
  }

  function renderRevealParty() {
    var key = 'party:' + roundKey(S);
    if (!appEl || appEl.dataset.screen !== key) {
      if (appEl) {
        appEl.dataset.screen = key;
        appEl.innerHTML = partyRevealHTML();
      }
    } else {
      patchPartyDynamic();
    }
  }

  function claimTo(target) {
    if (!S || S.phase !== 'reveal' || !window.SWG || typeof SWG.toggleClaim !== 'function') return;
    var r = SWG.toggleClaim(S, mySeat(), target, Date.now());
    if (r && r.error) { toast('这一对不能认证了', 'warn'); return; }
    sound('vote');
    haptic(8);
    renderGame();
    SWR.pushState();
    if (r && r.on) toast('已认证 ' + playerName(target) + '，等 TA 也点你', 'ok');
  }

  function toggleReady() {
    if (!S || S.phase !== 'reveal' || S.mode !== 'party') return;
    if (!window.SWG || typeof SWG.setReady !== 'function') return;
    var on = !readyOn(mySeat());
    SWG.setReady(S, mySeat(), on, Date.now());
    sound('tap');
    haptic(6);
    renderGame();
    SWR.pushState();
  }

  function partyNext() {
    if (!S || !netIsHost()) return;
    if (isLastRound()) {
      if (!window.SWG || typeof SWG.finish !== 'function') return;
      try { SWG.finish(S, 'limit', 0, Date.now()); } catch (e) { return; }
    } else {
      if (!window.SWG || typeof SWG.startRound !== 'function') return;
      try { SWG.startRound(S, Date.now()); } catch (e) { return; }
    }
    sound('whistle');
    forceRender();
    SWR.pushState();
    logLine('房主推进到第 ' + roundNow() + ' 局');
  }

  /* ---------------- 结算数据 ---------------- */

  function duelLevelInfo() {
    var n = (S && S.history && S.history.length) || 0;
    if (window.SWG && typeof SWG.duelLevel === 'function') {
      try {
        var r = SWG.duelLevel(n, S.result);
        if (r && r.t) return r;
      } catch (e) { /* fall through */ }
    }
    if (S.result === 'giveup') return { t: '信号失联', q: '今天的脑电波没对上频道，换个时间再战！' };
    if (n <= 1) return { t: '灵魂双胞胎', q: '第一轮就撞上？你们是不是共用一个脑子！' };
    if (n === 2) return { t: '脑电波同频', q: '只绕了一个弯就会合，这默契可以上综艺了' };
    if (n === 3) return { t: '心有灵犀', q: '一点就通，好搭子认证 ✓' };
    if (n <= 5) return { t: '默契搭子', q: '绕了点路，但终究想到一块儿去了' };
    if (n <= 8) return { t: '渐入佳境', q: '兜兜转转，最后还是想到了一起' };
    if (n <= 12) return { t: '脑内环游', q: '你们的脑回路绕了地球一圈才碰头' };
    return { t: '平行宇宙重逢', q: '跨越了 ' + n + ' 轮，终于在同一个宇宙相遇' };
  }

  function pairKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }

  function partyStatsInfo() {
    if (window.SWG && typeof SWG.partyStats === 'function') {
      try {
        var raw = SWG.partyStats(S, mySeat());
        if (raw && raw.scores) {
          var best = null;
          if (raw.best && typeof raw.best.a === 'number') {
            best = { seat: raw.best.a, partner: raw.best.b, n: raw.best.n || raw.best.count || 0 };
          } else if (raw.best) {
            best = raw.best;
          }
          var myBest = null;
          if (raw.myBest && typeof raw.myBest.a === 'number') {
            var mbSeat = mySeat();
            myBest = {
              seat: mbSeat,
              partner: raw.myBest.a === mbSeat ? raw.myBest.b : raw.myBest.a,
              n: raw.myBest.n || raw.myBest.count || 0
            };
          } else if (raw.myBest) {
            myBest = raw.myBest;
          }
          return {
            scores: raw.scores.map(function (x) { return { seat: x.seat, score: x.score || 0 }; }),
            pairs: (raw.pairs || []).map(function (p) {
              return { a: p.a, b: p.b, n: p.n || p.count || 0 };
            }),
            best: best,
            topSeats: raw.topSeats || [],
            myScore: raw.myScore || 0,
            myBest: myBest,
            rounds: raw.rounds || ((S.history && S.history.length) || 0)
          };
        }
      } catch (e) { /* fall through */ }
    }
    var active = activeSeats();
    var scoreMap = {};
    var pairMap = {};
    active.forEach(function (s) { scoreMap[s] = 0; });
    ((S && S.history) || []).forEach(function (row) {
      (row.pairs || []).forEach(function (p) {
        if (scoreMap[p.a] == null || scoreMap[p.b] == null) return;
        scoreMap[p.a] += 1;
        scoreMap[p.b] += 1;
        var k = pairKey(p.a, p.b);
        if (!pairMap[k]) pairMap[k] = { a: Math.min(p.a, p.b), b: Math.max(p.a, p.b), n: 0 };
        pairMap[k].n += 1;
      });
    });
    var scores = active.map(function (s) { return { seat: s, score: scoreMap[s] || 0 }; })
      .sort(function (a, b) { return b.score - a.score || a.seat - b.seat; });
    var pairs = Object.keys(pairMap).map(function (k) { return pairMap[k]; })
      .sort(function (a, b) { return b.n - a.n || a.a - b.a || a.b - b.b; });
    var best = null;
    active.forEach(function (s) {
      pairs.forEach(function (p) {
        if (p.a !== s && p.b !== s) return;
        var partner = p.a === s ? p.b : p.a;
        if (!best || p.n > best.n || (p.n === best.n && s < best.seat)) best = { seat: s, partner: partner, n: p.n };
      });
    });
    var top = scores.length ? scores[0].score : 0;
    return {
      scores: scores, pairs: pairs, best: best,
      topSeats: top > 0 ? scores.filter(function (x) { return x.score === top; }).map(function (x) { return x.seat; }) : [],
      myScore: scoreMap[mySeat()] || 0,
      myBest: best && best.seat === mySeat() ? best : null,
      rounds: (S.history && S.history.length) || 0
    };
  }

  function topScore(info) {
    var m = 0;
    ((info && info.scores) || []).forEach(function (x) { if (x.score > m) m = x.score; });
    return m;
  }

  function rankInfo(info) {
    var map = {};
    var active = activeSeats();
    var special = null;
    if (window.SWG && typeof SWG.rankTitles === 'function') {
      try {
        var r = SWG.rankTitles(info.scores);
        if (r && r.list) {
          special = r.special || null;
          r.list.forEach(function (g) {
            (g.seats || []).forEach(function (s) {
              map[s] = { rank: g.rank, title: g.title, tag: g.tag || ('第 ' + g.rank + ' 名') };
            });
          });
          if (special) {
            active.forEach(function (s) {
              if (!map[s]) map[s] = { rank: 1, title: special, tag: '并列第一' };
            });
          }
          return { map: map, special: special, tag: r.tag || null };
        }
      } catch (e) { /* fall through */ }
    }
    var arr = info.scores.slice().sort(function (a, b) { return b.score - a.score || a.seat - b.seat; });
    var allZero = arr.length > 0 && arr.every(function (x) { return x.score === 0; });
    var allSame = arr.length > 1 && arr.every(function (x) { return x.score === arr[0].score; }) && arr[0].score > 0;
    if (allZero) special = '各自美丽';
    else if (allSame) special = (arr.length >= 4 ? '四胞胎' : '三胞胎');
    var titles3 = ['万人迷', '高级的脑回路', '独立寒秋的脑回路'];
    var titles4 = ['万人迷', '高级的脑回路', '有点特色的脑回路', '独立寒秋的脑回路'];
    var titles = arr.length >= 4 ? titles4 : titles3;
    var rank = 0;
    var lastScore = null;
    var groups = {};
    arr.forEach(function (x, idx) {
      if (x.score !== lastScore) { rank = idx + 1; lastScore = x.score; }
      groups[rank] = (groups[rank] || 0) + 1;
      map[x.seat] = {
        rank: rank,
        title: special || titles[rank - 1] || '',
        tag: rank === 1 ? '第 1 名' : ('第 ' + rank + ' 名')
      };
    });
    return { map: map, special: special, tag: null };
  }

  function cpTitleText(n) {
    if (window.SWG && typeof SWG.cpTitle === 'function') {
      try {
        var t = SWG.cpTitle(n);
        if (t) return t;
      } catch (e) { /* fall through */ }
    }
    if (!n) return '各自美丽';
    if (n >= 6) return '天选 CP';
    if (n >= 4) return '默契老伙计';
    if (n >= 2) return '心有灵犀 CP';
    return '一拍即合';
  }

  /* ---------------- 结算页 ---------------- */

  function resultTitleText() {
    var n = (S.history && S.history.length) || 0;
    if (S.mode === 'party') {
      if (S.result === 'allmatch') return '全员同词，直接封神！';
      if (S.result === 'giveup') return '提前收营，下次再聚';
      return '打满 ' + n + ' 局，默契结算';
    }
    if (S.result === 'match') return '你们在第 ' + n + ' 轮想到了同一个词！';
    if (S.result === 'agree') return '达成「意思一样」认证 🤝';
    if (S.result === 'giveup') return n ? '一起坚持了 ' + n + ' 轮' : '这局还没开始就结束了';
    return '本次同频之旅结束';
  }

  function resultMetaHTML() {
    var out = '<div class="result-meta">';
    out += '<span class="chip">' + modeName(S.mode) + '</span>';
    out += '<span class="chip">' + seatCount() + ' 人</span>';
    out += '<span class="chip">' + limitLabel((S.settings && S.settings.timeLimit) || 0) + '</span>';
    out += '</div>';
    return out;
  }

  function duelTrailHTML() {
    var hist = S.history || [];
    if (!hist.length) return '<section class="card trail-card"><div class="eyebrow">脑回路轨迹</div><p class="muted">还没有走过第一段路。</p></section>';
    var rows = hist.map(function (row) {
      var ex = (row.pairs || []).filter(function (p) { return p.kind === 'exact'; })[0];
      var ag = (row.pairs || []).filter(function (p) { return p.kind === 'agree'; })[0];
      var cls = ex ? 'hit' : (ag ? 'agree' : '');
      var words = (row.words || []).map(function (w, i) {
        return '<b>' + esc(playerName(i)) + '</b> ' + (w ? esc(w) : '<span class="miss">超时</span>');
      }).join('<span class="pw-plus">×</span>');
      var mark = ex ? '💥 撞词' : (ag ? '🤝 意思一样' : '—');
      return '<li class="trail-row ' + cls + '">' +
        '<span class="trail-round">第 ' + esc(row.round) + ' 轮</span>' +
        '<span class="trail-words">' + words + '</span>' +
        '<span class="trail-mark ' + (ag ? 'ag' : '') + '">' + mark + '</span></li>';
    }).join('');
    return '<section class="card trail-card"><div class="eyebrow">脑回路轨迹</div><ul class="trail">' + rows + '</ul></section>';
  }

  function duelHeroHTML(level) {
    var n = (S.history && S.history.length) || 0;
    return '<section class="result-hero">' +
      '<div class="result-scene">' + use('scene-mountains', '0 0 480 300', 'scene') +
        '<span class="result-flag">' + use('flag', '0 0 80 100') + '</span></div>' +
      '<div class="result-body">' +
        '<div class="result-big"><b>' + n + '</b><span>轮</span></div>' +
        '<h2 class="result-title">' + esc(resultTitleText()) + '</h2>' +
        '<span class="level-badge">' + ico('star') + esc(level.t) + '</span>' +
        '<p class="level-copy">' + esc(level.q) + '</p>' +
        resultMetaHTML() +
      '</div></section>';
  }

  function partyHeroHTML(info, rank) {
    var n = (S.history && S.history.length) || 0;
    var top = info.pairs.length ? info.pairs[0].n : 0;
    var cp = cpTitleText(top);
    var lead = topScore(info);
    var badge = rank.special || cp;
    var copy;
    if (rank.special) {
      copy = rank.special === '各自美丽' ? '完成度如此这般，我是没想到的！？' : '全员同频，可以去驾驶 EVA 了。';
      if (rank.special === '各自美丽') copy = '完成度如此这般，我是没想到的！？下次再来撞一个。';
    } else if (top) {
      copy = '最强 CP 累计 ' + top + ' 对，最高默契分 ' + lead + '。';
    } else {
      copy = '这场还没撞上任何一对，下次继续找同频。';
    }
    return '<section class="result-hero">' +
      '<div class="result-scene">' + use('scene-mountains', '0 0 480 300', 'scene') +
        '<span class="result-flag">' + use('flag', '0 0 80 100') + '</span></div>' +
      '<div class="result-body">' +
        '<div class="result-big"><b>' + n + '</b><span>局</span></div>' +
        '<h2 class="result-title">' + esc(resultTitleText()) + '</h2>' +
        '<span class="level-badge">' + ico('star') + esc(badge) + '</span>' +
        '<p class="level-copy">' + esc(copy) + '</p>' +
        resultMetaHTML() +
      '</div></section>';
  }

  function cpBoardHTML(info) {
    var rows = info.pairs;
    var out = '<section class="card"><div class="eyebrow">最强 CP · 我的最佳</div>';
    if (!rows.length) {
      out += '<p class="cp-empty">这场还没撞上任何一对，下次继续找同频。</p></section>';
      return out;
    }
    var max = rows[0].n || 1;
    out += '<div class="cp-board">';
    rows.slice(0, 6).forEach(function (p) {
      out += '<div class="cp-row' + (p.n === max && max > 1 ? ' top' : '') + '">' +
        '<span class="cp-name">' + esc(playerName(p.a)) + ' × ' + esc(playerName(p.b)) + '</span>' +
        '<span class="cp-bar"><i style="width:' + Math.max(6, Math.round((p.n / max) * 100)) + '%"></i></span>' +
        '<span class="cp-count">' + p.n + '</span></div>';
    });
    out += '</div>';
    if (info.myBest) {
      out += '<p class="my-claim-line" style="margin-top:10px">我的最佳 CP：' +
        esc(playerName(info.myBest.seat)) + ' × ' + esc(playerName(info.myBest.partner)) +
        ' · ' + info.myBest.n + ' 对</p>';
    } else {
      out += '<p class="my-claim-line" style="margin-top:10px">我的最佳 CP：还在寻找中…</p>';
    }
    return out + '</section>';
  }

  function scoreListHTML(info, rank) {
    var out = '<section class="card"><div class="eyebrow">个人默契分</div><div class="score-list">';
    info.scores.forEach(function (row) {
      var meta = rank.map[row.seat] || { rank: 0, title: '', tag: '' };
      out += '<div class="score-row' + (row.seat === mySeat() ? ' me' : '') + '" style="--seat:' + seatColor(row.seat) + '">' +
        '<span class="score-bib">' + (row.seat + 1) + '</span>' +
        '<span class="score-name">' + esc(playerName(row.seat)) + (row.seat === mySeat() ? ' · 我' : '') +
          '<small>' + esc(meta.title) + '</small></span>' +
        (meta.tag ? '<span class="rank-tag r' + meta.rank + '">' + esc(meta.tag) + '</span>' : '') +
        '<span class="score-num">' + row.score + '</span></div>';
    });
    out += '</div></section>';
    return out;
  }

  function roundWordsHTML(row) {
    var hitSeats = {};
    var agSeats = {};
    (row.pairs || []).forEach(function (p) {
      if (p.kind === 'exact') { hitSeats[p.a] = 1; hitSeats[p.b] = 1; }
      else if (p.kind === 'agree') { agSeats[p.a] = 1; agSeats[p.b] = 1; }
    });
    var out = '';
    for (var i = 0; i < seatCount(); i++) {
      var w = (row.words && row.words[i]) || '';
      if (!w) { out += '<span class="round-word miss">' + esc(playerName(i)) + ' 超时</span>'; continue; }
      var cls = hitSeats[i] ? ' hit' : (agSeats[i] ? ' ag' : '');
      var mark = hitSeats[i] ? '<span class="rw-mark">💥</span>' : (agSeats[i] ? '<span class="rw-mark">🤝</span>' : '');
      out += '<span class="round-word' + cls + '">' + esc(playerName(i)) + ' ' + esc(w) + mark + '</span>';
    }
    return out;
  }

  function roundsCardHTML() {
    var hist = (S.history || []).slice().reverse();
    var rows = hist.map(function (row) {
      return '<div class="round-row"><span class="round-no">第 ' + esc(row.round) + ' 局</span>' +
        '<span class="round-words">' + roundWordsHTML(row) + '</span></div>';
    }).join('');
    return '<section class="card rounds-card"><div class="eyebrow">每局词表</div>' + (rows || '<p class="cp-empty">还没有记录。</p>') + '</section>';
  }

  function rematchHTML() {
    var active = activeSeats();
    var rem = S.rematch || {};
    var on = active.filter(function (s) { return rem[s] && rem[s].on; });
    var mine = !!(rem[mySeat()] && rem[mySeat()].on);
    var enough = active.length >= minPlayers(S.mode);
    var copy;
    if (!enough) {
      copy = '人数不足，无法再来一局。';
    } else if (on.length === active.length) {
      copy = '全员同意，房主马上开新局…';
    } else if (on.length) {
      var others = on.filter(function (s) { return s !== mySeat(); }).map(playerName);
      copy = mine
        ? '已确认，等 ' + (others.length ? esc(others.join('、')) : '其他伙伴') + '…'
        : '<b>' + esc(playerName(on[0])) + '</b> 想再来一局，冲！';
    } else {
      copy = '同一座位、同样设置，再来一局？';
    }
    return '<section class="rematch-card"><p class="rematch-copy">' + copy + '</p>' +
      '<button class="btn ' + (mine ? 'btn-secondary' : 'btn-primary') + ' btn-lg" data-act="rematch"' +
        (enough ? '' : ' disabled') + '>' + (mine ? '已确认，取消' : '再来一局') + '</button></section>';
  }

  function finishedHTML() {
    var duel = S.mode !== 'party';
    var info = duel ? null : partyStatsInfo();
    var rank = duel ? null : rankInfo(info);
    return '<div class="screen finished">' +
      hudHTML(false) +
      (duel ? duelHeroHTML(duelLevelInfo()) : partyHeroHTML(info, rank)) +
      (duel ? duelTrailHTML() : cpBoardHTML(info) + scoreListHTML(info, rank) + roundsCardHTML()) +
      '<div id="rematchCard">' + rematchHTML() + '</div>' +
      '<div class="share-row">' +
        '<button class="btn btn-secondary" data-act="share-result">' + ico('share') + '分享战绩</button>' +
        '<button class="btn btn-ghost" data-act="leave-room">' + ico('exit') + '离开</button>' +
      '</div>' +
      '<p class="net-note">' + (netIsHost() ? '房主开启再来一局后，会自动重置' : '等房主开新局 · 也可随时离开') + '</p>' +
      '</div>';
  }

  function toggleRematch() {
    if (!S || S.phase !== 'finished') return;
    if (!window.SWG || typeof SWG.toggleRematch !== 'function') return;
    if (activeSeats().length < minPlayers(S.mode)) { toast('人数不足，无法再来一局', 'warn'); return; }
    SWG.toggleRematch(S, mySeat(), Date.now());
    sound('tap');
    haptic(6);
    applyRematchPatch();
    SWR.pushState();
  }

  function applyRematchPatch() {
    var rc = $('#rematchCard');
    if (rc) rc.innerHTML = rematchHTML();
  }

  function noteFinished() {
    var sig = 'sw-finned-' + roomCode() + '-' + (S.gameNo || 1);
    try {
      if (window.sessionStorage && sessionStorage.getItem(sig)) return;
      if (window.sessionStorage) sessionStorage.setItem(sig, '1');
    } catch (e) { /* ignore */ }
    var st = readStats() || { games: 0, sync: 0, best: 0 };
    st.games = (st.games || 0) + 1;
    if (S.result === 'match' || S.result === 'agree' || S.result === 'allmatch') {
      st.sync = (st.sync || 0) + 1;
      if (S.mode !== 'party') {
        var n = (S.history && S.history.length) || 0;
        if (n > 0 && (!st.best || n < st.best)) st.best = n;
      }
    }
    writeLS(LS_STATS, JSON.stringify(st));
  }

  function renderFinished() {
    var key = 'fin:' + (S.gameNo || 1) + ':' + S.result + ':' + ((S.history && S.history.length) || 0) + ':' + mySeat();
    if (!appEl || appEl.dataset.screen !== key) {
      if (appEl) {
        appEl.dataset.screen = key;
        appEl.innerHTML = finishedHTML();
      }
      noteFinished();
      maybeCelebrate();
    } else {
      applyRematchPatch();
    }
    updateTimers();
  }

  /* ---------------- 庆祝 ---------------- */

  function confettiHTML(count) {
    var syms = ['confetti-leaf', 'confetti-flag', 'confetti-dot', 'confetti-star'];
    var colors = ['#F2B233', '#2A9D8F', '#E8733A', '#8C5A9E', '#2F6B4F', '#5BB7C9'];
    var out = '';
    for (var i = 0; i < count; i++) {
      var left = Math.round((i * 37 + 11) % 100);
      var delay = ((i * 13) % 26) / 10;
      var dur = 2.2 + ((i * 7) % 13) / 10;
      var size = 10 + (i % 4) * 4;
      var rot = (i * 47) % 360;
      var color = colors[i % colors.length];
      var sym = syms[i % syms.length];
      out += '<span class="confetti-piece" style="left:' + left + '%;--c:' + color + ';--s:' + size + 'px;--d:' + delay + 's;--t:' + dur + 's;--r:' + rot + 'deg">' +
        '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false"><use href="#' + sym + '"/></svg></span>';
    }
    return out;
  }

  function stopCelebration(force) {
    if (celebrateTimer) { clearTimeout(celebrateTimer); celebrateTimer = 0; }
    if (celebrateFade) { clearTimeout(celebrateFade); celebrateFade = 0; }
    if (force) {
      if (celebrateLayer) celebrateLayer.innerHTML = '';
      celebrateKey = '';
    }
  }

  function showCelebration(kind) {
    if (!celebrateLayer) return;
    stopCelebration(true);
    var title = '';
    var sub = '';
    var stamp = 'stamp-match';
    var count = 40;
    var words = (lastHistory() && lastHistory().words) || [];
    if (kind === 'all') {
      title = '全员同词！';
      stamp = 'stamp-all';
      count = 80;
      sub = words[0] ? '「' + words[0] + '」' : '这一局，全员脑电波完全同频';
    } else if (kind === 'agree') {
      title = '同频认证';
      stamp = 'stamp-agree';
      sub = '你们都觉得：意思一样';
    } else {
      title = '撞词成功';
      count = 80;
      sub = words[0] ? '「' + words[0] + '」' : '你们想到了同一个词';
    }
    celebrateLayer.innerHTML = '<div class="celebrate">' +
      use(stamp, '0 0 240 240', 'celebrate-stamp') +
      '<div class="celebrate-title">' + esc(title) + '</div>' +
      (sub ? '<div class="celebrate-sub">' + esc(sub) + '</div>' : '') +
      confettiHTML(count) +
      '</div>';
    celebrateKey = kind;
    celebrateFade = window.setTimeout(function () {
      var box = $('.celebrate', celebrateLayer);
      if (box) box.classList.add('is-out');
    }, 2300);
    celebrateTimer = window.setTimeout(function () {
      if (celebrateLayer) celebrateLayer.innerHTML = '';
    }, 2700);
    sound('win');
    haptic([18, 40, 18]);
  }

  function maybeCelebrate() {
    if (!S || S.phase !== 'finished') return;
    var key = 'fin:' + (S.gameNo || 1) + ':' + S.result;
    if (celebrateKey === key) return;
    if (S.result === 'match') showCelebration('match');
    else if (S.result === 'agree') showCelebration('agree');
    else if (S.result === 'allmatch') showCelebration('all');
    celebrateKey = key;
  }

/* ---------------- 规则 / 记录 ---------------- */

  function rulesHTML() {
    return '<div class="sheet-head"><div><h2 class="sheet-title" id="modalTitle">玩法规则<small>找到同频伙伴</small></h2></div>' +
      '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button></div>' +
      '<div class="rules-body">' +
        '<div class="rule-hero">' + use('trail-sign', '0 0 120 100') +
          '<p>每人每轮写一个词，同时揭晓。别人看不到你写了什么，直到一起翻开。撞上同一个词，或者互认「意思一样」，就算同频。</p></div>' +
        '<div class="rule-section"><h3>' + ico('boot') + '同心小径 · 2 人</h3><ul>' +
          '<li>第 1 轮自由想一个词；第 2 轮起，从上一轮两人的词出发继续联想。</li>' +
          '<li>两个词一样 → <b>撞词</b>，庆祝并进入结算。</li>' +
          '<li>不一样 → 各自选「意思一样」或「下一轮」；双方都表态后，若有人选下一轮就继续，双方都选意思一样则结算。</li>' +
          '<li>若本轮有人超时，不能选「意思一样」；想不出来可以放弃。</li>' +
        '</ul></div>' +
        '<div class="rule-section"><h3>' + ico('tent') + '营地同频 · 3~4 人</h3><ul>' +
          '<li>每局全员各写一个词，同时揭晓；撞词自动成对，两人各 +1。</li>' +
          '<li>觉得谁和你想的一样，就点 TA 的「🤝 和我意思一样」；TA 也点你，则认证成功，各 +1。</li>' +
          '<li>撞词后不可修改；本轮超时的词不参与认证。</li>' +
          '<li>全员同词 → 本局直接最终结算；否则玩满设定局数后结算。</li>' +
          '<li>每人可准备下一局，全员准备则自动推进；房主也可以强制推进或提前结束。</li>' +
        '</ul></div>' +
        '<div class="rule-section"><h3>' + ico('clock') + '计时与判同</h3><ul>' +
          '<li>每轮限时 15 / 30 / 60 秒 / 不限时，由房主开局前设定；时间到自动提交，否则算超时。</li>' +
          //'<li>英文不区分大小写，全半角、空格、标点都不影响判同，展示保留你写的原文。</li>' +
          '<li>每个词 1~10 个字；允许提交本局游戏中已出现的词。</li>' +
        '</ul></div>' +
        '<div class="rule-section"><h3>' + ico('whistle') + '离席判定</h3><ul>' +
          '<li>中途离开会空出号码布，本轮按超时处理，不参与计分与称号。</li>' +
          '<li>房主离开则房间解散；刷新页面会自动回到原来的座位。</li>' +
          '<li>词会随房间状态同步，界面只显示自己的词，不许偷看哦。</li>' +
        '</ul></div>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-lg" data-act="sheet-close">知道了，出发</button></div>';
  }

  SWR.showRules = function () {
    openLayer('modal', rulesHTML());
  };

  function logLine(text) {
    if (!text) return;
    logs.push({ t: Date.now(), text: String(text) });
    if (logs.length > 80) logs.shift();
  }

  function logHTML() {
    var rows = logs.slice().reverse().map(function (l) {
      return '<div class="log-row"><span class="log-time">' + esc(fmtClock(l.t)) + '</span>' +
        '<span class="log-text">' + esc(l.text) + '</span></div>';
    }).join('');
    return '<div class="sheet-head"><div><h2 class="sheet-title" id="modalTitle">对局记录<small>这一路的脚印</small></h2></div>' +
      '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button></div>' +
      (rows ? '<div class="log-list">' + rows + '</div>' : '<p class="log-empty">还没有记录，先去写个词吧。</p>') +
      '<div class="sheet-actions"><button class="btn btn-ghost" data-act="sheet-close">收起</button></div>';
  }

  /* ---------------- 分享长图 ---------------- */

  var SHARE_W = 900;
  var shareDataUrl = '';
  var shareBlob = null;
  var shareFileName = 'same-word.png';
  var shareText = '';
  var shareSize = { w: 0, h: 0 };

  function canvasFont(ctx, weight, size) {
    ctx.font = weight + ' ' + size + 'px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function fillRound(ctx, x, y, w, h, r, fill, stroke, lw) {
    roundRectPath(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 5; ctx.stroke(); }
  }

  function wrapCanvasText(ctx, text, maxW) {
    var chars = Array.from(String(text == null ? '' : text));
    var lines = [];
    var line = '';
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '\n') { lines.push(line); line = ''; continue; }
      var test = line + ch;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawTextBlock(ctx, text, x, y, size, weight, color, maxW, lh, maxLines) {
    canvasFont(ctx, weight, size);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    var lines = wrapCanvasText(ctx, text, maxW);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (lines[maxLines - 1].length > 1) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
    return y + lines.length * lh;
  }

  function drawPill(ctx, x, y, text, size, fill, color) {
    canvasFont(ctx, 800, size);
    var w = ctx.measureText(text).width + size * 1.6;
    var h = size * 2.1;
    fillRound(ctx, x, y, w, h, h / 2, fill, '#22301F', 4);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + size * 0.8, y + h / 2 + 1);
    return { w: w, h: h };
  }

  function starPath(ctx, cx, cy, R) {
    var inner = R * 0.46;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? inner : R;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var x = cx + Math.cos(a) * r;
      var yy = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
    }
    ctx.closePath();
  }

  function drawHeroStamp(ctx, cx, cy, label) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-8 * Math.PI / 180);
    ctx.strokeStyle = 'rgba(47,107,79,.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(47,107,79,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 49, 0, Math.PI * 2); ctx.stroke();
    starPath(ctx, 0, -24, 11);
    ctx.fillStyle = '#F2B233';
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,48,31,.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    canvasFont(ctx, 900, 17);
    ctx.fillStyle = '#2F6B4F';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 8);
    canvasFont(ctx, 700, 8);
    ctx.fillStyle = 'rgba(47,107,79,.65)';
    ctx.fillText('SAME WORD', 0, 27);
    ctx.restore();
  }

  function drawShareHero(ctx) {
    var band = 320;
    var g = ctx.createLinearGradient(0, 0, 0, band);
    g.addColorStop(0, '#CFEAF3');
    g.addColorStop(0.65, '#E9F4E6');
    g.addColorStop(1, '#F4EDD4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SHARE_W, band);

    ctx.fillStyle = '#F2B233';
    ctx.beginPath();
    ctx.arc(772, 84, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22301F';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = '#2F6B4F';
    ctx.beginPath(); ctx.moveTo(-40, band); ctx.lineTo(170, 250); ctx.lineTo(380, band); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1F4C37';
    ctx.beginPath(); ctx.moveTo(290, band); ctx.lineTo(520, 236); ctx.lineTo(750, band); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5E7C52';
    ctx.beginPath(); ctx.moveTo(600, band); ctx.lineTo(786, 262); ctx.lineTo(950, band); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#E7EFD8';
    ctx.fillRect(0, band - 16, SHARE_W, 16);

    canvasFont(ctx, 800, 22);
    ctx.fillStyle = '#4C5B45';
    ctx.textBaseline = 'middle';
    ctx.fillText('SAME WORD · 同词相遇', 56, 52);
    canvasFont(ctx, 900, 62);
    ctx.fillStyle = '#22301F';
    ctx.fillText('同词相遇', 54, 112);
    canvasFont(ctx, 700, 24);
    ctx.fillStyle = '#3D4A38';
    ctx.fillText('各写一个词，同时揭晓，看谁和谁能想到一起', 56, 162);
    drawPill(ctx, 56, 194, modeName(S.mode) + ' · ' + seatCount() + ' 人', 22, '#FFFDF6', '#22301F');
    return band;
  }

  function fitCanvasText(ctx, text, maxW) {
    var s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function drawShareRows(ctx, y) {
    var duel = S.mode !== 'party';
    var hist = (S.history || []);
    var ink = '#22301F';
    var soft = '#5C6758';
    var line = 'rgba(34,48,31,.24)';

    function sectionTitle(title, yy) {
      canvasFont(ctx, 900, 30);
      ctx.fillStyle = '#2F6B4F';
      ctx.textBaseline = 'top';
      ctx.fillText(title, 48, yy);
      ctx.strokeStyle = 'rgba(34,48,31,.16)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(48, yy + 44);
      ctx.lineTo(852, yy + 44);
      ctx.stroke();
      return yy + 62;
    }

    if (duel) {
      y = sectionTitle('脑回路轨迹', y);
      var list = hist;
      var hidden = 0;
      if (list.length > 24) { hidden = list.length - 24; list = list.slice(-24); }
      if (!list.length) {
        canvasFont(ctx, 600, 24);
        ctx.fillStyle = soft;
        ctx.textBaseline = 'top';
        ctx.fillText('还没有走过第一段路。', 48, y);
        y += 50;
      }
      list.forEach(function (row) {
        var ex = (row.pairs || []).filter(function (p) { return p.kind === 'exact'; })[0];
        var ag = (row.pairs || []).filter(function (p) { return p.kind === 'agree'; })[0];
        var words = (row.words || []).map(function (w, i) {
          return playerName(i) + ' ' + (w || '超时');
        }).join('  ×  ');
        canvasFont(ctx, 900, 24);
        ctx.fillStyle = soft;
        ctx.textBaseline = 'top';
        ctx.fillText('第 ' + row.round + ' 轮', 48, y + 4);
        var end = drawTextBlock(ctx, words, 180, y, 26, 700, ink, 560, 34, 2);
        var mark = ex ? '💥 撞词' : (ag ? '🤝 一样' : '—');
        canvasFont(ctx, 800, 22);
        ctx.fillStyle = ex ? '#D9632E' : (ag ? '#2A9D8F' : soft);
        ctx.textBaseline = 'top';
        ctx.fillText(mark, 760, y + 4);
        y = Math.max(end, y + 38) + 18;
        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(48, y - 8); ctx.lineTo(852, y - 8); ctx.stroke();
      });
      if (hidden) {
        canvasFont(ctx, 600, 22);
        ctx.fillStyle = soft;
        ctx.textBaseline = 'top';
        ctx.fillText('前 ' + hidden + ' 轮已折叠', 48, y);
        y += 40;
      }
      return y;
    }

    var info = partyStatsInfo();
    var rank = rankInfo(info);
    var maxN = info.pairs.length ? info.pairs[0].n : 1;
    y = sectionTitle('最强 CP', y);
    if (!info.pairs.length) {
      canvasFont(ctx, 600, 24);
      ctx.fillStyle = soft;
      ctx.textBaseline = 'top';
      ctx.fillText('这场还没撞上任何一对，下次继续。', 48, y);
      y += 44;
    } else {
      info.pairs.slice(0, 6).forEach(function (p, idx) {
        canvasFont(ctx, 800, 26);
        ctx.fillStyle = ink;
        ctx.textBaseline = 'top';
        ctx.fillText(playerName(p.a) + ' × ' + playerName(p.b), 48, y);
        canvasFont(ctx, 900, 26);
        ctx.textAlign = 'right';
        ctx.fillText(String(p.n), 852, y);
        ctx.textAlign = 'left';
        var bw = Math.max(20, Math.round((p.n / maxN) * 804));
        fillRound(ctx, 48, y + 38, 804, 16, 8, 'rgba(34,48,31,.09)', null, 0);
        fillRound(ctx, 48, y + 38, bw, 16, 8, idx === 0 ? '#F2B233' : '#2A9D8F', null, 0);
        y += 74;
      });
    }

    y += 12;
    y = sectionTitle('个人默契分', y);
    info.scores.forEach(function (row) {
      var meta = rank.map[row.seat] || {};
      canvasFont(ctx, 800, 26);
      ctx.fillStyle = ink;
      ctx.textBaseline = 'top';
      ctx.fillText((row.seat + 1) + '  ' + playerName(row.seat), 48, y);
      canvasFont(ctx, 600, 20);
      ctx.fillStyle = soft;
      ctx.fillText(meta.title || '', 330, y + 5);
      canvasFont(ctx, 900, 30);
      ctx.fillStyle = '#2F6B4F';
      ctx.textAlign = 'right';
      ctx.fillText(String(row.score), 852, y - 2);
      ctx.textAlign = 'left';
      y += 48;
    });

    y += 28;
    y = sectionTitle('每局词表', y);
    var rounds = hist.slice().reverse();
    var cut = 0;
    if (rounds.length > 12) { cut = rounds.length - 12; rounds = rounds.slice(0, 12); }
    if (rounds.length) {
      var cols = Math.min(4, Math.max(2, seatCount()));
      var tableX = 164;
      var markW = 96;
      var colW = Math.floor((852 - markW - tableX) / cols);
      var cellSize = cols >= 4 ? 18 : 20;
      canvasFont(ctx, 800, 17);
      ctx.fillStyle = soft;
      ctx.textBaseline = 'top';
      ctx.fillText('局', 48, y + 3);
      for (var ci = 0; ci < cols; ci++) {
        ctx.fillText(fitCanvasText(ctx, playerName(ci), colW - 12), tableX + ci * colW, y + 3);
      }
      ctx.textAlign = 'right';
      ctx.fillText('判定', 852, y + 3);
      ctx.textAlign = 'left';
      y += 30;
      ctx.strokeStyle = 'rgba(34,48,31,.24)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(48, y - 6); ctx.lineTo(852, y - 6); ctx.stroke();

      rounds.forEach(function (row, ri) {
        var words = [];
        var maxLines = 1;
        for (var i = 0; i < cols; i++) {
          var w = row.words && row.words[i];
          words.push(w ? String(w) : '超时');
        }
        canvasFont(ctx, 600, cellSize);
        words.forEach(function (w) { maxLines = Math.max(maxLines, wrapCanvasText(ctx, w, colW - 14).length); });
        var lineH = cellSize + 8;
        var contentH = maxLines * lineH;
        var rh = Math.max(46, contentH + 18);
        var padTop = Math.round((rh - contentH) / 2);
        if (ri % 2 === 1) fillRound(ctx, 40, y - 5, 820, rh - 2, 8, 'rgba(34,48,31,.04)', null, 0);
        canvasFont(ctx, 800, 20);
        ctx.fillStyle = soft;
        ctx.textBaseline = 'top';
        ctx.fillText('第 ' + row.round + ' 局', 48, y + padTop);
        words.forEach(function (w, i) {
          drawTextBlock(ctx, w, tableX + i * colW, y + padTop, cellSize, 600, ink, colW - 14, lineH, 2);
        });
        var exN = 0;
        var agN = 0;
        (row.pairs || []).forEach(function (p) {
          if (p.kind === 'exact') exN++;
          else if (p.kind === 'agree') agN++;
        });
        var mark = '';
        if (exN) mark += '💥' + (exN > 1 ? '×' + exN : '');
        if (agN) mark += (mark ? ' ' : '') + '🤝' + (agN > 1 ? '×' + agN : '');
        if (mark) {
          canvasFont(ctx, 700, 19);
          ctx.fillStyle = ink;
          ctx.textAlign = 'right';
          ctx.fillText(mark, 852, y + padTop + 2);
          ctx.textAlign = 'left';
        }
        y += rh;
      });
    }
    if (cut) {
      canvasFont(ctx, 600, 22);
      ctx.fillStyle = soft;
      ctx.fillText('更早的 ' + cut + ' 局已折叠', 48, y);
      y += 36;
    }
    return y;
  }

  function sharePageURL() {
    try {
      var loc = window.location;
      return loc.origin + loc.pathname;
    } catch (e) { return ''; }
  }

  function buildShareImage() {
    var duel = S.mode !== 'party';
    var hist = (S.history || []).length;
    var est = 900 + Math.min(duel ? hist : 12 + hist, 30) * 80;
    if (!duel) est += 720;
    var cv = document.createElement('canvas');
    cv.width = SHARE_W;
    cv.height = Math.max(1300, Math.min(12000, est));
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('NO_CANVAS');

    ctx.fillStyle = '#FBF7EC';
    ctx.fillRect(0, 0, SHARE_W, cv.height);

    var band = drawShareHero(ctx);
    var y = band + 36;

    var level = duel ? duelLevelInfo() : null;
    var info = duel ? null : partyStatsInfo();
    var rank = duel ? null : rankInfo(info);

    fillRound(ctx, 48, y, 244, 130, 22, '#F2B233', '#22301F', 6);
    canvasFont(ctx, 900, 92);
    ctx.fillStyle = '#22301F';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(duel ? hist : hist), 74, y + 66);
    canvasFont(ctx, 900, 26);
    ctx.fillText(duel ? '轮' : '局', 74 + (String(hist).length * 52), y + 84);

    var stampY = y + 65;
    var title = resultTitleText();
    var titleEnd = drawTextBlock(ctx, title, 316, y + 2, 36, 900, '#22301F', 396, 46, 3);
    drawHeroStamp(ctx, 790, stampY, duel ? '默契认证' : '同频认证');
    y = Math.max(y + 130 + 24, titleEnd + 24);

    var badgeText = duel ? level.t : (rank.special || cpTitleText(info.pairs.length ? info.pairs[0].n : 0));
    var pill = drawPill(ctx, 48, y, badgeText, 24, '#2F6B4F', '#FBF7EC');
    y += pill.h + 16;

    var copy = duel ? level.q : (info.pairs.length
      ? '最强 CP 累计 ' + info.pairs[0].n + ' 对，最高默契分 ' + topScore(info) + '。'
      : '这场还没撞上任何一对，下次继续找同频。');
    y = drawTextBlock(ctx, copy, 48, y, 26, 600, '#5C6758', 804, 38, 3) + 26;

    y = drawShareRows(ctx, y);

    ctx.strokeStyle = 'rgba(34,48,31,.18)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(48, y + 8); ctx.lineTo(852, y + 8); ctx.stroke();
    y += 30;
    canvasFont(ctx, 800, 24);
    ctx.fillStyle = '#2F6B4F';
    ctx.textBaseline = 'top';
    ctx.fillText('同词相遇 · SAME WORD', 48, y);
    canvasFont(ctx, 600, 21);
    ctx.fillStyle = '#5C6758';
    var d = new Date();
    var dateTxt = d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
    ctx.textAlign = 'right';
    ctx.fillText(dateTxt, 852, y + 3);
    ctx.textAlign = 'left';
    y += 36;

    var pageURL = sharePageURL();
    if (pageURL) {
      canvasFont(ctx, 600, 20);
      ctx.fillStyle = '#5C6758';
      ctx.fillText(pageURL, 48, y);
      y += 34;
    }

    var outH = Math.max(600, Math.min(cv.height, Math.ceil(y)));
    var out = document.createElement('canvas');
    out.width = SHARE_W;
    out.height = outH;
    var octx = out.getContext('2d');
    octx.fillStyle = '#FBF7EC';
    octx.fillRect(0, 0, SHARE_W, outH);
    octx.drawImage(cv, 0, 0);

    var isJpg = outH > 3000;
    var dataUrl = out.toDataURL(isJpg ? 'image/jpeg' : 'image/png', 0.9);
    var blob = dataUrlToBlob(dataUrl);
    return {
      dataUrl: dataUrl,
      blob: blob,
      fileName: isJpg ? 'same-word-result.jpg' : 'same-word-result.png',
      width: SHARE_W,
      height: outH
    };
  }

  function dataUrlToBlob(url) {
    try {
      var parts = String(url).split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function shareSheetHTML() {
    return '<div class="sheet-head"><div><h2 class="sheet-title" id="sheetTitle">分享战绩<small>把这次同频发给朋友</small></h2></div>' +
      '<button class="sheet-close" data-act="sheet-close" aria-label="关闭">' + ico('close') + '</button></div>' +
      '<div class="share-wrap" id="shareWrap"><p class="share-loading">正在冲洗战绩长图…</p></div>';
  }

  function shareReadyHTML() {
    var canNative = !!(navigator.share && navigator.canShare && shareBlob);
    try { canNative = !!(navigator.canShare && navigator.canShare({ files: [new File([shareBlob], shareFileName, { type: shareBlob.type })] })); } catch (e) { /* keep */ }
    return '<div class="share-img-wrap"><img src="' + shareDataUrl + '" alt="同词相遇战绩长图" width="' + SHARE_W + '"></div>' +
      '<p class="share-tip">长按图片也能保存 · ' + shareSize.w + '×' + shareSize.h + '</p>' +
      '<div class="sheet-actions">' +
        (canNative ? '<button class="btn btn-primary btn-lg" data-act="share-native">' + ico('share') + '分享给朋友</button>' : '') +
        '<button class="btn btn-secondary btn-lg" data-act="share-download">' + ico('check') + '保存图片</button>' +
        '<button class="btn btn-ghost" data-act="share-text">只发文字</button>' +
      '</div>';
  }

  SWR.showShare = function () {
    if (!S) return;
    openLayer('sheet', shareSheetHTML());
    window.setTimeout(function () {
      var wrap = $('#shareWrap');
      if (!wrap) return;
      try {
        var res = buildShareImage();
        shareDataUrl = res.dataUrl;
        shareBlob = res.blob;
        shareFileName = res.fileName;
        shareSize = { w: res.width, h: res.height };
        shareText = buildShareText();
        wrap.innerHTML = shareReadyHTML();
      } catch (e) {
        wrap.innerHTML = '<p class="share-tip">长图生成失败了，直接发文字吧。</p>' +
          '<div class="sheet-actions"><button class="btn btn-primary" data-act="share-text">分享文字</button></div>';
      }
    }, 40);
  };

  function buildShareText() {
    var n = (S.history && S.history.length) || 0;
    if (S.mode === 'party') {
      var info = partyStatsInfo();
      var top = info.pairs.length ? info.pairs[0] : null;
      return '我们在「同词相遇」打了 ' + n + ' 局' + (top ? '，最强 CP 是 ' + playerName(top.a) + ' × ' + playerName(top.b) + '（' + top.n + ' 对）' : '') + '，来一起找同频！';
    }
    return '我们在「同词相遇」第 ' + n + ' 轮撞词了：' + duelLevelInfo().t + '。来一起找同频！';
  }

  function downloadShare() {
    if (!shareDataUrl) return;
    try {
      var a = document.createElement('a');
      a.href = shareDataUrl;
      a.download = shareFileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('长图已保存', 'ok');
    } catch (e) {
      toast('保存失败，长按图片试试', 'warn');
    }
  }

  async function nativeShareImage() {
    if (!shareBlob) { downloadShare(); return; }
    try {
      var file = new File([shareBlob], shareFileName, { type: shareBlob.type });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '同词相遇战绩', text: shareText || buildShareText() });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: '同词相遇战绩', text: shareText || buildShareText(), url: inviteURL(roomCode()) });
        return;
      }
    } catch (e) { /* 用户取消 */ }
    downloadShare();
  }

  async function shareTextOnly() {
    var text = (shareText || buildShareText()) + ' ' + inviteURL(roomCode());
    if (navigator.share) {
      try { await navigator.share({ title: '同词相遇', text: text }); return; } catch (e) { /* ignore */ }
    }
    copyText(text);
  }

  /* ---------------- 网络状态 / 状态页 ---------------- */

  function refreshNetUI() {
    $all('.net-chip').forEach(function (el) {
      el.classList.toggle('off', !NET);
      var t = $('.net-text', el);
      if (t) t.textContent = NET ? '在线' : '重连中';
      el.setAttribute('title', NET ? '已连接' : '正在重连');
    });
    $all('.room-live').forEach(function (el) {
      el.innerHTML = '<i class="net-dot"></i>' + (NET ? '等人中' : '重连中');
    });
    if (offlineBanner) offlineBanner.hidden = NET;
  }

  SWR.setNet = function (online, silent) {
    var was = NET;
    NET = !!online;
    refreshNetUI();
    if (silent) return;
    if (!NET && was && Date.now() - lastNetToast > 8000) {
      lastNetToast = Date.now();
      toast('网络断开，正在悄悄重连…', 'warn');
    } else if (NET && !was) {
      toast('网络恢复了，继续同步', 'ok');
    }
  };

  function statusPageHTML(reason) {
    var map = {
      'host-left': { t: '房主收起帐篷走了', c: '房间已经解散。回首页可以重新开一顶，把刚才的默契再找回来。' },
      'not-found': { t: '这个营地不存在', c: '房间号可能过期了，也可能被房主解散。回首页重新开一局吧。' },
      'closed': { t: '房间已解散', c: '大家先回首页。想继续的话，重新创建房间再喊朋友进来。' }
    };
    var info = map[reason] || { t: '房间已关闭', c: '链接失效了，回首页重新开始一局。' };
    return '<div class="screen status-page">' +
      '<div class="status-art">' + use('mascot-goat-lost', '0 0 120 120', 'goat') +
        '<span class="status-cloud">' + use('compass', '0 0 100 100') + '</span></div>' +
      '<h1 class="status-title">' + esc(info.t) + '</h1>' +
      '<p class="status-copy">' + esc(info.c) + '</p>' +
      '<div class="status-actions">' +
        '<button class="btn btn-primary btn-lg" data-act="home">' + ico('flag') + '回首页</button>' +
        '<button class="btn btn-ghost" data-act="open-rules">看看规则</button>' +
      '</div></div>';
  }

  SWR.onRoomClosed = function (reason) {
    if (reason === 'left') return;
    URL_ROOM = '';
    bootJoinUsed = true;
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
    closeLayer(true);
    stopCelebration(true);
    S = null;
    VIEW = null;
    MY_SEAT = 0;
    lastPhase = '';
    draft = '';
    draftRound = '';
    autoSubmitKey = '';
    if (appEl) {
      appEl.dataset.screen = 'status:' + (reason || 'closed');
      appEl.innerHTML = statusPageHTML(reason);
    }
    markReady();
  };

  SWR.onPlayerLeft = function (info) {
    var name = (info && info.name) || (S && info && typeof info.seat === 'number' ? playerName(info.seat) : '有伙伴');
    toast(name + ' 离开了，座位按空词处理', 'warn');
    haptic(8);
    logLine(name + ' 离开了房间');
    if (S) renderGame();
  };

  /* ---------------- 远端 / 推送 ---------------- */

  var lastSeenRoundKey = '';

  SWR.applyRemote = function (state, meta) {
    if (!state) return;
    // 已回到首页（例如刚离席）时，飞行中的推送不应把人拽回对局
    if (appEl && appEl.dataset.screen === 'landing') return;
    if (!state.phase) {
      try {
        if (window.SWN && SWN.getRoomView) {
          var v = SWN.getRoomView();
          if (v && v.status === 'waiting') SWR.renderWaiting(v);
        }
      } catch (e) { /* ignore */ }
      return;
    }
    var fromWaiting = !!VIEW || (appEl && /^waiting/.test(appEl.dataset.screen || ''));
    if (fromWaiting && layerState.current) closeLayer(true);
    S = state;
    VIEW = null;
    MY_SEAT = mySeat();
    recordClock(S);
    autoSubmitKey = '';
    var rk = roundKey(S);
    if (draftRound && draftRound !== rk) { draft = ''; draftRound = ''; }
    if (S.phase === 'playing') draftRound = rk;
    else { draft = ''; draftRound = ''; }

    var prevPhase = lastPhase;
    if (!prevPhase) {
      logLine(S.phase === 'finished'
        ? '进入结算：' + (RESULT_LABEL[S.result] || S.result || '结束')
        : '进入第 ' + roundNow() + (S.phase === 'reveal' ? ' 轮揭晓' : ' 轮'));
    } else if (prevPhase !== S.phase) {
      if (S.phase === 'reveal') logLine('第 ' + roundNow() + ' 轮揭晓');
      else if (S.phase === 'finished') logLine('本局结算：' + (RESULT_LABEL[S.result] || S.result || '结束'));
      else if (S.phase === 'playing') logLine('新一局开始');
    } else if (S.phase === 'playing' && lastSeenRoundKey && lastSeenRoundKey !== rk) {
      logLine('第 ' + roundNow() + ' 轮开始');
    }
    lastSeenRoundKey = rk;
    lastPhase = S.phase;
    renderGame();
  };

  var pushFails = 0;
  var pushRetryTimer = null;
  function schedulePushRetry() {
    if (pushRetryTimer || pushFails > 2) return;
    pushRetryTimer = window.setTimeout(function () {
      pushRetryTimer = null;
      if (S) SWR.pushState();
    }, 1000);
  }

  SWR.pushState = async function () {
    if (!S || !hasSWN() || !window.SWN.pushState) return;
    try {
      var r = await window.SWN.pushState(S);
      if (r && r.ok) {
        pushFails = 0;
        if (r.state && r.state.phase) {
          S = r.state;
          recordClock(r.state);
          renderGame();
        }
        return;
      }
      // 写没落地：退避补推（自己的字段写入是幂等的）
      pushFails += 1;
      schedulePushRetry();
    } catch (e) {
      pushFails += 1;
      schedulePushRetry();
      if (netIsHost()) toast('同步慢了一拍，稍后自动重试', 'warn');
    }
  };

  /* ---------------- 房主循环 ---------------- */

  function hostLoop() {
    if (!S || !window.SWG || typeof SWG.hostTick !== 'function' || !netIsHost()) return;
    // party 揭晓期的认证对由房主重算进 history.pairs（history 是房主字段，成员算的不落库）
    var pairsChanged = false;
    if (S.phase === 'reveal' && S.mode === 'party' && typeof SWG.syncPairs === 'function') {
      var before = JSON.stringify(historyPairs());
      try { SWG.syncPairs(S); } catch (e) { /* ignore */ }
      if (JSON.stringify(historyPairs()) !== before) pairsChanged = true;
    }
    var changed = false;
    try { changed = SWG.hostTick(S, Date.now()); } catch (e) { changed = false; }
    if (changed || pairsChanged) {
      autoSubmitKey = '';
      renderGame();
      SWR.pushState();
    }
  }

  /* ---------------- 事件 ---------------- */

  function closeTopLayer() {
    if (layerState.current) { closeLayer(); return true; }
    return false;
  }

  function trapTab(e) {
    var panel = layerState.panel;
    if (!panel) return;
    var nodes = $all('button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', panel)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      e.preventDefault();
      try { last.focus(); } catch (err) {}
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      try { first.focus(); } catch (err) {}
    }
  }

  function onDocKey(e) {
    if (e.key === 'Escape') {
      if (closeTopLayer()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Tab' && layerState.current) trapTab(e);
    if (e.key === 'Enter' && e.target && e.target.id === 'wordInput' && !e.shiftKey) {
      e.preventDefault();
      submitWord();
    }
  }

  function onDocInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains('err')) t.classList.remove('err');
    if (t.id === 'wordInput') refreshWordUI();
  }

  function toggleSound() {
    soundOn = !soundOn;
    writeLS(LS_SOUND, soundOn ? 'on' : 'off');
    if (S) { /* 游戏中无声音按钮 */ }
    if (appEl && appEl.dataset.screen === 'landing') SWR.renderLanding();
    else {
      $all('[data-act="toggle-sound"]').forEach(function (el) {
        el.innerHTML = ico(soundOn ? 'sound' : 'mute') + '<span>' + (soundOn ? '声音' : '静音') + '</span>';
        el.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      });
    }
    sound('tap');
    toast(soundOn ? '音效已开启' : '已静音');
  }

  function onDocClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.dataset.act;
    switch (act) {
      case 'open-rules': SWR.showRules(); break;
      case 'open-log': openLayer('modal', logHTML()); break;
      case 'toggle-sound': toggleSound(); break;
      case 'open-create': openCreate(); break;
      case 'open-join': openJoin(); break;
      case 'sheet-close': closeLayer(); break;
      case 'pick-mode':
        if (!SHEET) return;
        SHEET.mode = el.dataset.mode === 'party' ? 'party' : 'duel';
        paintCreate(el.closest('.sheet'));
        sound('tap');
        break;
      case 'pick-time':
        if (!SHEET) return;
        SHEET.timeLimit = Number(el.dataset.v) || 0;
        paintCreate(el.closest('.sheet'));
        sound('tap');
        break;
      case 'pick-round':
        if (!SHEET) return;
        SHEET.roundLimit = clamp(Number(el.dataset.v) || 10, 5, 50);
        paintCreate(el.closest('.sheet'));
        sound('tap');
        break;
      case 'round-step':
        if (!SHEET) return;
        SHEET.roundLimit = clamp(SHEET.roundLimit + (Number(el.dataset.d) || 0), 5, 50);
        paintCreate(el.closest('.sheet'));
        sound('tap');
        break;
      case 'create-submit': submitCreate(el); break;
      case 'join-submit': submitJoin(el); break;
      case 'confirm-ok': {
        var cb = confirmCb;
        confirmCb = null;
        closeLayer();
        if (cb) { try { cb(); } catch (err) { /* ignore */ } }
        break;
      }
      case 'copy-invite': copyText(inviteURL(roomCode())); break;
      case 'share-invite': shareInvite(); break;
      case 'wait-time':
        setWaiting({ timeLimit: Number(el.dataset.v) || 0 });
        break;
      case 'wait-round-step':
        if (VIEW) roundStepFor(VIEW, Number(el.dataset.d) || 0);
        break;
      case 'start-game': startGame(); break;
      case 'leave-room': leaveConfirm(); break;
      case 'submit-word': submitWord(); break;
      case 'withdraw': withdrawWord(); break;
      case 'duel-vote': voteDuel(el.dataset.v); break;
      case 'giveup': giveUp(); break;
      case 'cancel-giveup': cancelGiveup(); break;
      case 'approve-giveup': approveGiveup(Number(el.dataset.seat)); break;
      case 'force-next': forceNextDuel(); break;
      case 'force-end': forceEnd(); break;
      case 'force-reveal': forceReveal(); break;
      case 'claim': claimTo(Number(el.dataset.seat)); break;
      case 'toggle-ready': toggleReady(); break;
      case 'party-next': partyNext(); break;
      case 'rematch': toggleRematch(); break;
      case 'share-result': SWR.showShare(); break;
      case 'share-download': downloadShare(); break;
      case 'share-native': nativeShareImage(); break;
      case 'share-text': shareTextOnly(); break;
      case 'home': SWR.renderLanding(); break;
      default: break;
    }
  }

  /* ---------------- 初始化 ---------------- */

  var initDone = false;

  SWR.init = function () {
    if (initDone) return;
    initDone = true;

    appEl = document.getElementById('app');
    sheetLayer = document.getElementById('sheetLayer');
    sheetPanel = document.getElementById('sheetPanel');
    modalLayer = document.getElementById('modalLayer');
    modalPanel = document.getElementById('modalPanel');
    toastLayer = document.getElementById('toastLayer');
    celebrateLayer = document.getElementById('celebrateLayer');
    offlineBanner = document.getElementById('offlineBanner');

    soundOn = readLS(LS_SOUND) !== 'off';
    try {
      var q = new URLSearchParams(window.location.search);
      var r = String(q.get('room') || '').replace(/\D/g, '').slice(0, 4);
      if (r) URL_ROOM = r;
    } catch (e) { /* ignore */ }

    document.addEventListener('click', onDocClick);
    document.addEventListener('input', onDocInput);
    document.addEventListener('keydown', onDocKey);
    window.addEventListener('online', function () { SWR.setNet(true); });
    window.addEventListener('offline', function () { SWR.setNet(false); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      tickTimer();
      updateTimers();
    });

    window.setInterval(hostLoop, 600);
    window.setInterval(tickTimer, 200);

    if (navigator.onLine === false) NET = false;
    refreshNetUI();

    if (!hasSWN()) SWR.renderLanding();
  };

  /* 兼容旧入口：显式渲染 */
  SWR.boot = function () {
    if (S) SWR.renderGame();
    else if (VIEW) SWR.renderWaiting(VIEW);
    else SWR.renderLanding();
  };

})();