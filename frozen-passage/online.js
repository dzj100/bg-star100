/**
 * online.js — 流冰航路 The Frozen Passage · 联机模式
 *
 * 职责：房间管理、状态同步、断线重连、救生艇并发合并
 * 依赖：net.js（Supabase 通信层）、supabase.min.js、game.js（规则引擎 + 联机封装）
 *
 * ── 接入步骤 ──────────────────────────────────────────
 *  1. 房间前缀 frozen-、人数 2~4（见 net.js 的 NET_CONFIG）
 *  2. HTML 脚本顺序：
 *     <script src="game.js"></script>
 *     <script src="render.js"></script>
 *     <script src="supabase.min.js"></script>
 *     <script src="net.js"></script>
 *     <script src="online.js"></script>
 *     <script>initOnline({ ... });</script>
 *  3. 页面需要一个联机大厅容器（缺失时本文件会自动创建）：
 *     <div id="online" style="display:none"></div>
 *  4. 设置页「联机模式」按钮调用 window.showOnlineLobby()
 *  5. 游戏中每次状态变更后调用 window._olPushState()（等价函数名 onlinePushState）
 *  6. 联机操作守卫使用 window._olIsActor() / window._olCanAct(seat)
 * ──────────────────────────────────────────────────────
 */

/* ============================================================
   配置区
   ============================================================ */

const ONLINE_CONFIG = {
  SESSION_KEY: 'frozen-online',     // localStorage 键名，刷新重连凭此找回房间与座位
  GAME_TITLE: '流冰航路',
  // 定时轮询节奏（毫秒）：兜住实时推送漏收（断线窗口/丢包/僵尸连接）
  POLL_WAIT_MS: 2500,
  POLL_GAME_MS: 5000,
  // 状态新鲜度：流冰航路每次状态变更递增 rev（含 lifeboatPick），
  // 联机层优先比较 rev，无 rev 的状态（等候室等）退化为推送时间戳
  getOrderValue: (s) => (s && typeof s.rev === 'number') ? s.rev : ((s && s._ts) || 0),
};

/** 难度定义（等候室展示与校验；游戏侧仍以 SPEC 的 novice/medium/expert 为准） */
const OL_DIFFICULTIES = ['novice', 'medium', 'expert'];
const OL_DIFF_NAME = { novice: '新手', medium: '中等', expert: '专家' };
const OL_DIFF_DESC = {
  novice: '目标卡全部背面 · 终点没有约束',
  medium: '翻开两端与中间的目标卡',
  expert: '5 张目标卡全开 · 终点颜色全约束'
};
const OL_DIFF_DOT = { novice: '#8fb6cf', medium: '#1768b5', expert: '#a2620c' };

/* ============================================================
   HOOK: 游戏定制
   ============================================================ */

/* ── 必需 ──────────────────────────────────────────────── */
let HOOK_dealGame = null;          // (names: string[], difficulty: 'novice'|'medium'|'expert') => void
let HOOK_render = null;            // () => void
let HOOK_renderLanding = null;     // () => string（返回首页 HTML；与 window.renderLanding 二选一）
let HOOK_clearState = null;        // () => void
let HOOK_getOnlineState = null;    // () => state（返回 S 或等义对象，需含 players/currentSeat/activeSeat/rev/pending）
let HOOK_applyOnlineState = null;  // (state) => void
let HOOK_canAct = null;            // (state, seat) 或 (seat) => boolean
let HOOK_getSeat = null;           // () => number|null，本端游戏内座位号

/* ── 可选 ──────────────────────────────────────────────── */
let HOOK_addLog = null;            // (msg, cls) => void
let HOOK_showEndModal = null;      // () => void
let HOOK_getPlayers = null;        // () => Array<{seat?, name, hand}>
let HOOK_getCurrentPlayer = null;  // () => number
let HOOK_getPlayerColors = null;   // () => string[]
let HOOK_showLanding = null;       // () => void
let HOOK_waitingExtras = null;     // () => string，等候室难度卡（房主可选、成员只读）
let HOOK_refreshWaitingExtras = null; // () => void，游戏侧自行就地刷新难度卡
let HOOK_completeLifeboat = null;  // () => void，收齐全员暗选后执行交换并清空 pending

/* ============================================================
   联机状态
   ============================================================ */

let _onlineRoomId   = null;
let _mySeatIndex    = null;   // 服务端 seatIndex（leave_room 用）
let _myPlayerName   = null;
let _isHost         = false;
let _seatOrderIndex = null;   // 游戏内座位号：按 seats 升序后自己的位置
let _unsubscribe    = null;
let _isReceiving    = false;
let _knownSeatCount = 0;
let _departedHandled = false;
let _gameStarted    = false;

// 推送通道
let _myPushSeq      = 0;
let _myPushedIds    = new Set();
let _pendingPushSeat = null;      // 收到的远端状态里的行动者（用于"我做完动作后交接"的补推）
let _lastPushedActiveSeat = null; // 最近一次推送快照里的 activeSeat（交接判定）
let _lastPushPayload = null;
let _lastPushVerified = false;
let _pushInFlight   = false;
let _pushQueued     = false;
let _pushStatus     = '';

// 移动端健壮性
let _channelStatus  = null;
let _resubTimer     = null;
let _lastAppliedTs  = 0;
let _lastAppliedPushId = null;
let _resyncing      = false;
let _lastResyncAt   = 0;
let _lastRecoverAt  = 0;
let _pollTimer      = null;
let _pollIntervalMs = 0;
let _lastWaitingSig = '';

// 救生艇并发
let _lifeboatRepushTimer = null;
let _lifeboatSettling    = false;
let _lifeboatSettledSig  = '';

let _toastTimer = null;

// 钩子重入保护（getSeat / canAct 内部可能回调本文件的全局接口）
let _seatResolving   = false;
let _canActResolving = false;

/* ============================================================
   基础工具
   ============================================================ */

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function _toast(message, tone) {
  if (typeof window.showToast === 'function') {
    try { window.showToast(message, tone); return; } catch (e) { /* 落到本地实现 */ }
  }
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast is-show' + (tone ? ' is-' + tone : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
}

/** 状态获取/应用：优先 hook，其次与 game.js 约定的全局函数 */
function _getState() {
  if (typeof HOOK_getOnlineState === 'function') {
    try { return HOOK_getOnlineState() || null; } catch (e) { return null; }
  }
  if (typeof window._getOnlineState === 'function') {
    try { return window._getOnlineState() || null; } catch (e) { return null; }
  }
  return null;
}

function _applyState(state) {
  if (typeof HOOK_applyOnlineState === 'function') {
    try { HOOK_applyOnlineState(state); return; } catch (e) { console.warn('[online] applyOnlineState failed:', e); return; }
  }
  if (typeof window._applyOnlineState === 'function') {
    try { window._applyOnlineState(state); } catch (e) { console.warn('[online] _applyOnlineState failed:', e); }
  }
}

/** 终局判定：won / lost（兼容 gameOver 标记） */
function _isTerminal(state) {
  if (!state) return false;
  if (state.gameOver === true) return true;
  return state.phase === 'won' || state.phase === 'lost';
}

/** 当前真正可操作的座位：activeSeat 优先，-1 表示救生艇全员 */
function _activeSeatOf(state) {
  if (!state) return null;
  if (typeof state.activeSeat === 'number') return state.activeSeat;
  if (typeof state.currentSeat === 'number') return state.currentSeat;
  if (typeof state.currentPlayer === 'number') return state.currentPlayer;
  return null;
}

function _isLifeboatState(state) {
  if (!state) return false;
  return (state.pending && state.pending.type === 'lifeboat') || state.phase === 'lifeboat';
}

/** 本端游戏内座位号：hook → 昵称唯一匹配 → seats 升序位置 → 服务端座位 */
function _seatOf() {
  // 防重入：游戏侧常把 getSeat 写成 window._olSeatIndex()，递归时退化为内部推导
  if (!_seatResolving && typeof HOOK_getSeat === 'function') {
    let s = null;
    _seatResolving = true;
    try { s = HOOK_getSeat(); } catch (e) { s = null; } finally { _seatResolving = false; }
    if (typeof s === 'number' && s >= 0) return s;
  }
  const state = _getState();
  if (state && Array.isArray(state.players) && _myPlayerName) {
    const hits = [];
    state.players.forEach((p, i) => { if (p && p.name === _myPlayerName) hits.push(i); });
    if (hits.length === 1) return hits[0];
  }
  if (_seatOrderIndex !== null) return _seatOrderIndex;
  return _mySeatIndex;
}

/** 操作权判定：hook 优先，缺省按 activeSeat（-1 = 全员） */
function _canAct(state, seat) {
  // 防重入：游戏侧 canAct 可能内部调用 window._olIsActor/_olCanAct
  if (!_canActResolving && typeof HOOK_canAct === 'function') {
    let v = null;
    _canActResolving = true;
    try {
      v = HOOK_canAct.length >= 2 ? HOOK_canAct(state, seat) : HOOK_canAct(seat);
    } catch (e) { v = null; } finally { _canActResolving = false; }
    if (typeof v === 'boolean') return v;
  }
  const act = _activeSeatOf(state);
  if (act === null) return false;
  if (act === -1) return true;                 // 救生艇：全员可选自己的牌
  return act === seat;
}

function _playerColors() {
  if (typeof HOOK_getPlayerColors === 'function') {
    try { return HOOK_getPlayerColors() || []; } catch (e) { return []; }
  }
  return [];
}

function _diffOf(room) {
  const d = room && room.state && room.state.pendingDifficulty;
  return OL_DIFFICULTIES.indexOf(d) >= 0 ? d : null;
}

/* ============================================================
   会话持久化
   ============================================================ */

function _saveSession() {
  if (!_onlineRoomId) return;
  try {
    localStorage.setItem(ONLINE_CONFIG.SESSION_KEY, JSON.stringify({
      roomId: _onlineRoomId, seatIndex: _mySeatIndex,
      isHost: _isHost, playerName: _myPlayerName,
    }));
  } catch (e) { /* 隐私模式忽略 */ }
}

function _clearSession() {
  try { localStorage.removeItem(ONLINE_CONFIG.SESSION_KEY); } catch (e) { /* ignore */ }
}

/* ============================================================
   DOM / 视图切换（不依赖 index.html 预置容器）
   ============================================================ */

function _ensureOnlineContainer() {
  let el = document.getElementById('online');
  if (!el) {
    el = document.createElement('div');
    el.id = 'online';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

function _showLobbyView() {
  const online = _ensureOnlineContainer();
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  online.style.display = 'block';
}

function _showGameView() {
  const online = document.getElementById('online');
  if (online) online.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = '';
}

function _hideOnlineView() {
  _olCloseDialog();
  const online = document.getElementById('online');
  if (online) online.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = '';
  _hideNetLoading();
}

function _backToLanding() {
  _hideOnlineView();
  if (typeof HOOK_showLanding === 'function') {
    try { HOOK_showLanding(); return; } catch (e) { console.warn('[online] showLanding failed:', e); }
  }
  if (typeof HOOK_clearState === 'function') HOOK_clearState();
  if (typeof HOOK_render === 'function') HOOK_render();
}

/* ---------------- Loading ---------------- */

function _showNetLoading(text) {
  let el = document.getElementById('ol-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ol-loading';
    el.className = 'ol-loading';
    el.innerHTML = '<div class="ol-loading-box"><div class="ol-spinner"></div><span id="ol-loading-text"></span></div>';
    document.body.appendChild(el);
  }
  const t = document.getElementById('ol-loading-text');
  if (t) t.textContent = text || '加载中…';
  el.style.display = 'flex';
}

function _hideNetLoading() {
  const el = document.getElementById('ol-loading');
  if (el) el.style.display = 'none';
}

/* ---------------- 通用弹窗 ---------------- */

function _ensureDialogHost() {
  let host = document.getElementById('ol-modal');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ol-modal';
    host.className = 'ol-modal';
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  return host;
}

function _olDialog(opts) {
  const host = _ensureDialogHost();
  host.innerHTML =
    '<div class="ol-modal-box" role="dialog" aria-modal="true">' +
      '<h2 class="ol-modal-title">' + _esc(opts.title || '') + '</h2>' +
      (opts.body ? '<div class="ol-modal-body">' + opts.body + '</div>' : '') +
      '<div class="ol-modal-actions">' +
        (opts.ok ? '<button type="button" class="start-btn' + (opts.danger ? ' is-danger' : '') +
          '" onclick="' + (opts.okAction || '_olCloseDialog()') + '">' + _esc(opts.ok) + '</button>' : '') +
        (opts.cancel ? '<button type="button" class="start-btn ghost" onclick="_olCloseDialog()">' +
          _esc(opts.cancel) + '</button>' : '') +
      '</div>' +
    '</div>';
  host.style.display = 'flex';
  window._olDialogLock = opts.lock === true;
}

function _olCloseDialog() {
  const host = document.getElementById('ol-modal');
  if (host) { host.style.display = 'none'; host.innerHTML = ''; }
  window._olDialogLock = false;
}

/* ============================================================
   大厅 UI（沿用流冰航路的 ice / serif / 卡片视觉）
   ============================================================ */

function showOnlineLobby() {
  _showLobbyView();
  renderOnlineLobby();
}

function onlineBackToLanding() {
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  _cleanupOnline();
  _hideOnlineView();
  if (roomId && seatIndex !== null) {
    if (wasHost) netUpdateGameState(roomId, null, 'finished');
    else netLeaveRoom(roomId, seatIndex);
  }
  _backToLanding();
}

function renderOnlineLobby() {
  const online = _ensureOnlineContainer();
  online.innerHTML =
    '<div class="setup-header">' +
      '<h1>' + _esc(ONLINE_CONFIG.GAME_TITLE) + ' · 联机</h1>' +
      '<button type="button" class="back-btn" onclick="onlineBackToLanding()">返回</button>' +
    '</div>' +
    '<div class="ol-panel">' +
      '<p class="ol-lead">2~4 人协作 · 同一片冰面 · 共同抵达彼岸</p>' +
      '<button type="button" class="start-btn" onclick="onCreateRoom()">创建房间</button>' +
      '<div class="ol-or">或 加入朋友的航路</div>' +
      '<input id="joinRoomInput" class="ol-input ol-input-code" type="text" inputmode="numeric" ' +
        'placeholder="4 位房间号" maxlength="4" autocomplete="off">' +
      '<input id="joinNameInput" class="ol-input" type="text" placeholder="你的名字" maxlength="8" autocomplete="off">' +
      '<button type="button" class="start-btn ghost" onclick="onJoinRoom()">加入房间</button>' +
    '</div>';
  const pref = /[?&]room=(\d{4})(?:&|$)/.exec(location.search);
  if (pref) {
    const input = document.getElementById('joinRoomInput');
    if (input) input.value = pref[1];
  }
}

/* ============================================================
   创建 / 加入
   ============================================================ */

async function onCreateRoom() {
  const name = prompt('输入你的名字（房主）:', '');
  if (!name || !name.trim()) return;
  _myPlayerName = name.trim();

  _showNetLoading('正在创建房间…');
  try {
    const roomId = await netCreateRoom(_myPlayerName);
    _onlineRoomId = roomId;
    _mySeatIndex = 0;
    _seatOrderIndex = 0;
    _isHost = true;
    _gameStarted = false;
    _saveSession();
    _knownSeatCount = 1;
    _departedHandled = false;
    _subscribeToRoom(roomId);
    renderWaitingRoom({ seats: [{ name: _myPlayerName, seatIndex: 0 }] });
  } catch (e) {
    _toast('创建房间失败: ' + (e.message || e));
  } finally {
    _hideNetLoading();
  }
}

async function onJoinRoom() {
  const roomInput = document.getElementById('joinRoomInput');
  const nameInput = document.getElementById('joinNameInput');
  const roomId = ((roomInput && roomInput.value) || '').trim().toUpperCase();
  const name = ((nameInput && nameInput.value) || '').trim();
  if (!roomId || roomId.length !== 4) { _toast('请输入 4 位房间号'); return; }
  if (!name) { _toast('请输入你的名字'); return; }

  _myPlayerName = name;
  _showNetLoading('正在加入房间…');
  try {
    const { seatIndex, room } = await netJoinRoom(roomId, name);
    _onlineRoomId = roomId;
    _mySeatIndex = seatIndex;
    _isHost = false;
    _gameStarted = false;
    _saveSession();
    _departedHandled = false;
    _refreshSeatOrder(room.seats);
    _subscribeToRoom(roomId);
    // join_room 返回加入后的权威快照（已包含自己）
    _knownSeatCount = (room.seats || []).length;
    if (room.status === 'playing' && room.state) {
      _gameStarted = true;
      _applyState(room.state);
      _showGameView();
      if (typeof HOOK_render === 'function') HOOK_render();
      if (_isTerminal(room.state) && typeof HOOK_showEndModal === 'function') HOOK_showEndModal();
      _startPolling(ONLINE_CONFIG.POLL_GAME_MS);
    } else if (room.status === 'finished') {
      _cleanupOnline();
      _hideOnlineView();
      _toast('该房间已结束');
      _backToLanding();
    } else {
      _showLobbyView();
      renderWaitingRoom(room);
    }
  } catch (e) {
    _toast(e.message || '加入失败');
  } finally {
    _hideNetLoading();
  }
}

/* ============================================================
   等候室
   ============================================================ */

function _refreshSeatOrder(seats) {
  if (!Array.isArray(seats) || _mySeatIndex === null) return;
  const sorted = seats.slice().sort((a, b) => a.seatIndex - b.seatIndex);
  const idx = sorted.findIndex(s => s.seatIndex === _mySeatIndex);
  if (idx >= 0) _seatOrderIndex = idx;
}

/** 默认难度卡（未提供 HOOK_waitingExtras 时兜底，保证流程可用） */
function _defaultWaitingExtras() {
  const cur = OL_DIFFICULTIES.indexOf(window._olPendingDifficulty) >= 0
    ? window._olPendingDifficulty : 'novice';
  const head = '<div class="ol-extras-label">' +
    (_isHost ? '难度（由你选择，成员只读）' : '难度（由房主选择）') + '</div>';
  if (!_isHost) {
    return '<div id="olWaitingExtras">' + head +
      '<div class="setup-chip is-readonly">' +
        '<span class="setup-dot" style="background:' + (OL_DIFF_DOT[cur] || '#888') + '"></span>' +
        '<span>' + _esc(OL_DIFF_NAME[cur] || cur) + '</span>' +
        '<span class="ol-chip-note">' + _esc(OL_DIFF_DESC[cur] || '') + '</span>' +
      '</div></div>';
  }
  return '<div id="olWaitingExtras">' + head +
    '<div class="ol-diff-row">' +
      OL_DIFFICULTIES.map(k =>
        '<button type="button" class="setup-chip ol-diff' + (k === cur ? ' is-on' : '') +
          '" onclick="_olSetPendingDifficulty(\'' + k + '\')" aria-pressed="' + (k === cur) + '">' +
          '<span class="setup-dot" style="background:' + (OL_DIFF_DOT[k] || '#888') + '"></span>' +
          '<span>' + _esc(OL_DIFF_NAME[k]) + '</span>' +
        '</button>'
      ).join('') +
    '</div></div>';
}

function renderWaitingRoom(room) {
  room = room || {};
  // 房主选择的难度随房间状态同步；成员端只读
  window._olPendingDifficulty = _diffOf(room) || 'novice';
  const seats = (room.seats || []).slice().sort((a, b) => a.seatIndex - b.seatIndex);
  const colors = _playerColors();

  const seatsHTML = seats.map((s, i) =>
    '<div class="setup-chip">' +
      '<span class="setup-dot" style="background:' + (colors[i] || OL_DIFF_DOT.medium) + '"></span>' +
      '<span class="ol-chip-name">' + _esc(s.name) + '</span>' +
      '<span class="ol-chip-note">' + (s.seatIndex === 0 ? '房主' : '座位 ' + (s.seatIndex + 1)) + '</span>' +
    '</div>'
  ).join('');

  const extrasHTML = typeof HOOK_waitingExtras === 'function'
    ? '<div id="olWaitingExtras">' + (HOOK_waitingExtras() || '') + '</div>'
    : _defaultWaitingExtras();

  const canStart = _isHost && seats.length >= 2;
  const startHTML = _isHost
    ? '<button type="button" class="start-btn" onclick="startOnlineGame()"' +
      (canStart ? '' : ' disabled') + '>开始游戏 (' + seats.length + '/' + NET_CONFIG.MAX_PLAYERS + '人)</button>' +
      (seats.length >= 2 ? '' : '<p class="ol-hint">至少需要 2 人才能开始</p>')
    : '<p class="ol-hint">等待房主开始游戏…</p>';

  _ensureOnlineContainer().innerHTML =
    '<div class="setup-header">' +
      '<h1>房间 ' + _esc(_onlineRoomId) + '</h1>' +
      '<button type="button" class="back-btn" onclick="onlineBackToLanding()">退出</button>' +
    '</div>' +
    '<div class="ol-panel">' +
      '<p class="ol-lead">把房间号告诉朋友，一起登上冰面</p>' +
      '<div class="ol-room-code">' + _esc(_onlineRoomId) + '</div>' +
      '<div class="ol-seats">' + seatsHTML + '</div>' +
      extrasHTML +
      '<div class="ol-start-row">' + startHTML + '</div>' +
    '</div>';
  _lastWaitingSig = _waitingSig(room);
}

/** 等候室内容签名：座位 + 难度；未变化不重绘（避免重置房主选难度的交互） */
function _waitingSig(room) {
  const seats = (room.seats || []).map(s => s.seatIndex + ':' + s.name).join(',');
  const d = (room.state && room.state.pendingDifficulty) || '';
  return seats + '|' + d + '|' + (_isHost ? 'h' : 'm');
}

/**
 * 房主切换难度（成员调用会被忽略并提示）。
 * 写 room.state = { pendingDifficulty } 且 status='waiting'，其余端经 Realtime/轮询同步。
 */
async function _olSetPendingDifficulty(level) {
  if (OL_DIFFICULTIES.indexOf(level) < 0) return false;
  if (!_onlineRoomId) return false;
  if (!_isHost) { _toast('只有房主可以切换难度'); return false; }
  window._olPendingDifficulty = level;
  refreshWaitingExtras();
  if (!_gameStarted) {
    await netUpdateGameState(_onlineRoomId, { pendingDifficulty: level }, 'waiting');
  }
  return true;
}

/**
 * 刷新等候室难度卡（房主切换后调用）：
 * 房主把 window._olPendingDifficulty 写入 room.state；随后就地重绘难度卡。
 */
function refreshWaitingExtras() {
  if (typeof HOOK_refreshWaitingExtras === 'function') {
    try { HOOK_refreshWaitingExtras(); } catch (e) { console.warn('[online] refreshWaitingExtras failed:', e); }
    return;
  }
  const host = document.getElementById('olWaitingExtras');
  if (!host) return;
  const html = typeof HOOK_waitingExtras === 'function'
    ? (HOOK_waitingExtras() || '')
    : _defaultWaitingExtras();
  if (typeof HOOK_waitingExtras === 'function') {
    host.innerHTML = html;
  } else {
    // 兜底难度卡自带容器 id，直接替换外层，避免嵌套
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    if (fresh) host.replaceWith(fresh);
  }
}

/**
 * 房主/成员统一入口：刷新等候室（难度）并重拉房间。
 * 房主会先把当前难度写入房间状态，成员只读。
 */
async function _olRefreshWaitingRoom() {
  if (!_onlineRoomId || _gameStarted) return false;
  try {
    if (_isHost) {
      const level = OL_DIFFICULTIES.indexOf(window._olPendingDifficulty) >= 0
        ? window._olPendingDifficulty : 'novice';
      await netUpdateGameState(_onlineRoomId, { pendingDifficulty: level }, 'waiting');
    }
    const room = await netGetRoom(_onlineRoomId);
    if (!_onlineRoomId || !room) return false;
    renderWaitingRoom(room);
    return true;
  } catch (e) {
    console.warn('[online] refresh waiting room failed:', e);
    return false;
  }
}

/* ============================================================
   Realtime 订阅
   ============================================================ */

function _subscribeToRoom(roomId) {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _channelStatus = 'CONNECTING';

  _unsubscribe = netSubscribeRoom(roomId, (row) => {
    // 对局中成员离开 → 解散弹窗/提示；等候室离开只更新席位
    _syncSeatTracking(row);

    if (row.status === 'waiting' && row.seats) {
      _renderWaitingIfChanged(row);
      return;
    }
    if (row.status === 'finished') {
      _handleRemoteFinished(row);
      return;
    }
    if (row.status === 'playing' && row.state) {
      _handleRemoteState(row);
    }
  }, (status) => {
    _channelStatus = status;
    if (status === 'SUBSCRIBED') {
      // 首次订阅与断线重连都会到这里；断线期间的 UPDATE 不会重放，必须补拉
      _resyncRoom();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      _scheduleResubscribe();
    }
  });

  _startPolling(_gameStarted ? ONLINE_CONFIG.POLL_GAME_MS : ONLINE_CONFIG.POLL_WAIT_MS);
}

/* ============================================================
   远端状态应用
   ============================================================ */

/**
 * 处理远端对局状态。
 * @param {object} row - rooms 行
 * @param {boolean} [force] - 权威重同步（跳过新鲜度过滤）
 */
function _handleRemoteState(row, force) {
  const state = row.state;
  if (!state) return;

  const remotePushId = state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;   // 自己的推送回声

  if (!force) {
    if (remotePushId && remotePushId === _lastAppliedPushId) return;
    const remoteTs = state._ts || 0;
    if (remoteTs && remoteTs < _lastAppliedTs - 3000) {
      console.log('[online] ignore stale ts', remoteTs, '<', _lastAppliedTs - 3000);
      return;
    }
    // rev 新鲜度：本地已推进（本端刚操作）时不接受更旧的快照；
    // 新一局（seed 变化）或本地已终局（准备回房间）时放行
    const local = _getState();
    if (local && _gameStarted && !_isTerminal(local) && local.seed === state.seed) {
      const lo = _orderValue(local);
      const ro = _orderValue(state);
      if (lo > ro) {
        console.log('[online] ignore stale rev', ro, '<', lo);
        return;
      }
    }
  }

  _isReceiving = true;
  _gameStarted = true;
  _startPolling(ONLINE_CONFIG.POLL_GAME_MS);

  // 记录"上一手行动者"，供我做完动作后的交接补推判定
  const remoteAct = _activeSeatOf(state);
  if (_pendingPushSeat !== _seatOf()) {
    _pendingPushSeat = remoteAct;
  }
  _refreshSeatOrder(row.seats || []);

  const wasTerminal = _isTerminal(_getState());

  // 救生艇并发：把本地暗选并进远端 picks，再整包应用
  let lifeboatNeedRepush = false;
  if (_gameStarted && _isLifeboatState(state)) {
    lifeboatNeedRepush = _mergeLifeboatPicks(state);
  }

  _showGameView();
  _applyState(state);

  if (_isLifeboatState(state)) {
    // 只有 currentSeat 收齐全员选择后结算；其他端只合并/等待
    _maybeSettleLifeboat(state);
    if (lifeboatNeedRepush) _scheduleLifeboatRepush();
  }

  if (_isTerminal(state) && !wasTerminal) {
    if (typeof HOOK_render === 'function') HOOK_render();
    if (typeof HOOK_showEndModal === 'function') HOOK_showEndModal();
  }

  _isReceiving = false;
}

/** 处理房间结束/解散（status='finished'） */
function _handleRemoteFinished(row, force) {
  const state = row.state;
  const remotePushId = state && state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;
  if (!force && state) {
    if (remotePushId && remotePushId === _lastAppliedPushId) return;
    const remoteTs = state._ts || 0;
    if (remoteTs && remoteTs < _lastAppliedTs - 3000) return;
  }

  _isReceiving = true;
  if (state) {
    const wasTerminal = _isTerminal(_getState());
    _showGameView();
    _applyState(state);
    if (_isTerminal(state) && !wasTerminal) {
      if (typeof HOOK_render === 'function') HOOK_render();
      if (typeof HOOK_showEndModal === 'function') HOOK_showEndModal();
    }
  } else {
    // 房间已解散（房主解散 / 房主自己退出）
    _cleanupOnline();
    if (typeof HOOK_clearState === 'function') HOOK_clearState();
    _hideOnlineView();
    _toast('房间已解散');
    _backToLanding();
  }
  _isReceiving = false;
}

/* ============================================================
   救生艇并发同步
   ============================================================ */

/**
 * 把本地 pending.picks 并入远端快照（同一座位优先保留非空值）：
 *  - 远端空、本地有 → 保留本地，需重推
 *  - 远端有、本地空 → 采纳远端
 *  - 两端都有但不同 → 自己座位以本地为准（需重推），他人座位以远端为准
 * @returns {boolean} 是否需要在应用后延迟重推
 */
function _mergeLifeboatPicks(remoteState) {
  const local = _getState();
  if (!local || !local.pending || local.pending.type !== 'lifeboat') return false;
  if (!remoteState || !remoteState.pending || remoteState.pending.type !== 'lifeboat') return false;

  const mySeat = _seatOf();
  const localPicks = local.pending.picks || {};
  const remotePicks = Object.assign({}, remoteState.pending.picks || {});
  let needRepush = false;

  Object.keys(localPicks).forEach((key) => {
    const lv = localPicks[key];
    if (lv == null || lv === '') return;
    const rv = remotePicks[key];
    if (rv == null || rv === '') {
      remotePicks[key] = lv;                 // 远端缺失：补回本地选择
      needRepush = true;
    } else if (rv !== lv && Number(key) === mySeat) {
      remotePicks[key] = lv;                 // 自己座位以本地为准
      needRepush = true;
    }
  });

  remoteState.pending.picks = remotePicks;
  return needRepush;
}

/** 本端暗选被远端覆盖：延迟（+随机抖动）重推合并后的状态；只在仍处于救生艇阶段生效 */
function _scheduleLifeboatRepush() {
  if (_lifeboatRepushTimer) return;
  const delay = 220 + Math.floor(Math.random() * 380);
  _lifeboatRepushTimer = setTimeout(() => {
    _lifeboatRepushTimer = null;
    if (!_onlineRoomId || !_gameStarted || _isReceiving) return;
    const local = _getState();
    if (!_isLifeboatState(local)) return;      // 已离开救生艇阶段
    _markPushAndSend(local, _pushStatus || 'playing');
  }, delay);
}

function _allLifeboatPicksReady(state) {
  if (!state || !state.pending || state.pending.type !== 'lifeboat') return false;
  const picks = state.pending.picks || {};
  let seats = [];
  if (Array.isArray(state.players) && state.players.length) {
    seats = state.players.map((p, i) => (p && typeof p.seat === 'number') ? p.seat : i);
  } else {
    seats = Object.keys(picks).map(Number);
  }
  if (!seats.length) return false;
  return seats.every(s => picks[s] != null && picks[s] !== '');
}

function _lifeboatSig(state) {
  const picks = (state && state.pending && state.pending.picks) || {};
  const rev = (state && typeof state.rev === 'number') ? state.rev : 0;
  return rev + '|' + Object.keys(picks).sort().map(k => k + ':' + (picks[k] || '')).join(',');
}

/** 只有 currentSeat 客户端、且在收齐全员暗选后结算一次 */
function _maybeSettleLifeboat(state) {
  if (typeof HOOK_completeLifeboat !== 'function' || _lifeboatSettling) return false;
  if (!_isLifeboatState(state)) return false;
  const seat = _seatOf();
  if (seat === null || typeof state.currentSeat !== 'number' || state.currentSeat !== seat) return false;
  if (!_allLifeboatPicksReady(state)) return false;

  const sig = _lifeboatSig(state);
  if (sig === _lifeboatSettledSig) return false;

  _lifeboatSettling = true;
  try {
    _lifeboatSettledSig = sig;
    HOOK_completeLifeboat();
    const settled = _getState();
    if (settled) _markPushAndSend(settled, _pushStatus || 'playing');   // 结算结果立即广播
    return true;
  } catch (e) {
    console.warn('[online] completeLifeboat failed:', e);
    _lifeboatSettledSig = '';
    return false;
  } finally {
    _lifeboatSettling = false;
  }
}

/* ============================================================
   断线恢复 / 重同步 / 丢失推送补发
   ============================================================ */

function _orderValue(state) {
  try {
    if (typeof ONLINE_CONFIG.getOrderValue === 'function') {
      return ONLINE_CONFIG.getOrderValue(state) || 0;
    }
  } catch (e) { /* ignore */ }
  return (state && state._ts) || 0;
}

/** 拉取房间最新状态并应用；本地有未确认推送且房间落后时先补发 */
async function _resyncRoom() {
  if (!_onlineRoomId || _resyncing) return;
  const now = Date.now();
  if (now - _lastResyncAt < 800) return;    // 限频
  _resyncing = true;
  _lastResyncAt = now;
  try {
    const room = await netGetRoom(_onlineRoomId);
    if (!_onlineRoomId) return;             // 拉取期间已退出
    _syncSeatTracking(room);

    // 本地最后一次推送未被确认：判断是否需要补发
    if (_lastPushPayload && !_lastPushVerified && _gameStarted) {
      const my = _lastPushPayload;
      const roomState = room.state;
      const roomPushId = roomState && roomState._pushId;
      const startLost = my.status === 'playing' && room.status === 'waiting';
      if (roomPushId === my.pushId) {
        _lastPushVerified = true;                       // 其实已到达（响应丢失）
      } else if (startLost || _orderValue(roomState) < _orderValue(my.stateObj)) {
        console.log('[online] resend unverified push', my.pushId);
        await _markPushAndSend(my.stateObj, my.status);
        return;
      } else {
        _lastPushVerified = true;                       // 已被更新状态取代
      }
    }

    const roomPushId = room.state && room.state._pushId;
    if (roomPushId && roomPushId === _lastAppliedPushId) {
      // 载荷无变化；但成员端「返回房间」不改载荷，需兜住界面切换
      if (room.status === 'waiting' && _gameStarted) _renderWaitingIfChanged(room);
    } else if (room.status === 'finished') {
      _handleRemoteFinished(room, true);
    } else if (room.status === 'playing' && room.state) {
      _handleRemoteState(room, true);
    } else if (room.status === 'waiting' && room.seats) {
      _renderWaitingIfChanged(room);
    }
  } catch (e) {
    console.warn('[online] resync failed:', e);
  } finally {
    _resyncing = false;
  }
}

function _scheduleResubscribe() {
  if (_resubTimer || !_onlineRoomId) return;
  _resubTimer = setTimeout(() => {
    _resubTimer = null;
    if (!_onlineRoomId || _channelStatus === 'SUBSCRIBED') return;
    console.warn('[online] channel unhealthy, resubscribe');
    _subscribeToRoom(_onlineRoomId);
  }, 2000);
}

/** 回到前台 / 网络恢复 / bfcache：重建频道（iOS 后台会挂死 WebSocket）+ 重拉状态 */
function _recoverConnection() {
  if (!_onlineRoomId) return;
  const now = Date.now();
  if (now - _lastRecoverAt < 1500) return;
  _lastRecoverAt = now;
  _subscribeToRoom(_onlineRoomId);
  _resyncRoom();
}

/** 定时轮询（幂等；间隔变化时切换节奏）：兜住"僵尸连接"静默漏收 */
function _startPolling(ms) {
  if (_pollTimer && _pollIntervalMs === ms) return;
  _stopPolling();
  _pollIntervalMs = ms;
  _pollTimer = setInterval(_pollTick, ms);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _pollIntervalMs = 0;
}

async function _pollTick() {
  if (!_onlineRoomId || _resyncing) return;
  if (!_gameStarted) {
    try {
      const room = await netGetRoom(_onlineRoomId);
      if (!_onlineRoomId || !room) return;
      if (room.status !== 'waiting') { _resyncRoom(); return; }   // 开局/解散漏收
      _syncSeatTracking(room);
      _renderWaitingIfChanged(room);
    } catch (e) { /* 网络抖动，下个周期再试 */ }
    return;
  }
  _resyncRoom();
}

/** 席位跟踪：仅对局中成员离开才弹解散/提示；等候室离开只更新席位 */
function _syncSeatTracking(row) {
  if (!Array.isArray(row.seats)) return;
  _refreshSeatOrder(row.seats);
  if (_gameStarted && row.status === 'playing'
      && row.seats.length < _knownSeatCount && _knownSeatCount > 0 && !_departedHandled) {
    _departedHandled = true;
    const players = (typeof HOOK_getPlayers === 'function' && HOOK_getPlayers()) || [];
    const departedSeat = players.length > 0
      ? players.findIndex((_, i) => i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
      : -1;
    let departedName = '未知玩家';
    if (departedSeat >= 0 && players[departedSeat] && players[departedSeat].name) {
      departedName = players[departedSeat].name;
    }
    if (_isHost) {
      _showPlayerLeftDialog(departedName);
    } else {
      _toast(departedName + ' 退出了房间，等待房主解散房间…');
    }
  }
  _knownSeatCount = row.seats.length;
}

/* ============================================================
   界面切换：对局 ⇄ 等候室
   ============================================================ */

function _switchToWaitingView() {
  _gameStarted = false;
  _startPolling(ONLINE_CONFIG.POLL_WAIT_MS);
  _lastWaitingSig = '';
  _departedHandled = false;
  // 本局推送流结束：清掉未确认上下文，防回前台重同步把终局快照倒灌回房间
  _lastPushPayload = null;
  _lastPushVerified = true;
  _pendingPushSeat = null;
  _lastPushedActiveSeat = null;
  _pushStatus = '';
  _lifeboatSettledSig = '';
  if (_lifeboatRepushTimer) { clearTimeout(_lifeboatRepushTimer); _lifeboatRepushTimer = null; }
  _olCloseDialog();
  const em = document.getElementById('endModal');
  if (em && em.classList) em.classList.remove('show');
  _showLobbyView();
}

function _renderWaitingIfChanged(room) {
  // 对局中收到 waiting（房主点了「返回房间」）：本地已结算才允许切回等候室。
  // 开局中间态（新一局快照带着旧 status='waiting' 落地）必须保持对局界面。
  const rs = room.state;
  const midStart = !!rs && (rs.phase === 'place' || rs.phase === 'refill' || rs.phase === 'stuck');
  if (_gameStarted && !midStart) {
    const st = _getState();
    if (_isTerminal(st)) _switchToWaitingView();
  }
  if (_gameStarted) return;
  const sig = _waitingSig(room);
  if (sig === _lastWaitingSig) return;
  _showLobbyView();
  renderWaitingRoom(room);
}

/* ============================================================
   房主开始游戏
   ============================================================ */

async function startOnlineGame() {
  if (!_isHost) return false;
  _showNetLoading('正在开始游戏…');
  try {
    const room = await netGetRoom(_onlineRoomId);
    const seats = (room.seats || []).slice().sort((a, b) => a.seatIndex - b.seatIndex);
    if (seats.length < 2) { _toast('至少需要 2 人才能开始'); return false; }
    _knownSeatCount = seats.length;
    _departedHandled = false;
    _refreshSeatOrder(seats);
    _gameStarted = true;
    _startPolling(ONLINE_CONFIG.POLL_GAME_MS);

    const difficulty = _diffOf(room) || window._olPendingDifficulty || 'novice';
    window._olPendingDifficulty = difficulty;
    const names = seats.map(s => s.name);
    if (typeof HOOK_dealGame === 'function') HOOK_dealGame(names, difficulty);

    _showGameView();
    if (typeof HOOK_render === 'function') HOOK_render();
    await _markPushAndSend(_getState(), 'playing');
    return true;
  } catch (e) {
    _toast('开始游戏失败: ' + (e.message || e));
    return false;
  } finally {
    _hideNetLoading();
  }
}

/* ============================================================
   推送通道
   ============================================================ */

/**
 * 状态推送入口（游戏每次状态变更后调用，例如覆盖 saveState）。
 * 可推送者：canAct 命中的行动者（普通阶段当前玩家 / 无线电目标玩家 / 救生艇全员），
 * 或刚刚把行动权交出去的本端（回合交接补推）。
 */
function onlinePushState() {
  if (!_onlineRoomId || _isReceiving || !_gameStarted) return false;
  const state = _getState();
  if (!state) return false;
  if (_isTerminal(state)) return false;          // 终局走 onlineEndGame

  const seat = _seatOf();
  if (seat === null) return false;

  const act = _activeSeatOf(state);
  const isActor = _canAct(state, seat);
  const handedOff = !isActor
    && _lastPushedActiveSeat !== null
    && _lastPushedActiveSeat === seat
    && act !== seat;
  const canPush = isActor || handedOff || _pendingPushSeat === seat;
  if (!canPush) return false;

  _markPushAndSend(state);

  // 救生艇：本端是 currentSeat 且我的暗选补齐全员 → 立即结算并广播
  if (_isLifeboatState(state) && _allLifeboatPicksReady(state)) {
    _maybeSettleLifeboat(state);
  }
  return true;
}

async function _markPushAndSend(stateObj, status) {
  if (!_onlineRoomId || !stateObj) return false;
  // 串行化：并发 UPDATE 会竞速，旧快照后到会覆盖对方刚应用的新进度
  if (status) _pushStatus = status;              // 粘性：开局 status 随排队补发一起送达
  if (_pushInFlight) { _pushQueued = true; return true; }
  _pushInFlight = true;
  try {
    _myPushSeq++;
    const ts = Date.now();
    // 含时间戳：刷新重连后序号会重置，仅靠 座位-序号 会与刷新前的推送 ID 撞车
    const pushId = _mySeatIndex + '-' + ts.toString(36) + '-' + _myPushSeq;
    const snapshot = JSON.parse(JSON.stringify(stateObj));
    snapshot._pushId = pushId;
    snapshot._src = _mySeatIndex;
    snapshot._ts = ts;
    _myPushedIds.add(pushId);
    if (_myPushedIds.size > 240) {
      _myPushedIds = new Set(Array.from(_myPushedIds).slice(-120));
    }
    _lastAppliedTs = Math.max(_lastAppliedTs, ts);
    const act = _activeSeatOf(snapshot);
    _lastPushedActiveSeat = (typeof act === 'number') ? act : null;
    _pendingPushSeat = null;
    _lastPushPayload = { pushId: pushId, stateObj: snapshot, status: _pushStatus };
    _lastPushVerified = false;

    const ok = await netUpdateGameState(_onlineRoomId, snapshot, _pushStatus);
    if (ok && _lastPushPayload && _lastPushPayload.pushId === pushId) _lastPushVerified = true;
    return ok;
  } finally {
    _pushInFlight = false;
    if (_pushQueued) {
      _pushQueued = false;
      if (_onlineRoomId) {
        // 在途期间产生的最新本地状态（不经过行动者判定），携带粘性 status
        const latest = _getState();
        if (latest) _markPushAndSend(latest, _pushStatus);
      }
    }
  }
}

/**
 * 游戏方在终局时调用：把结算快照广播出去。
 * 房间 status 保持 'playing'（阻止新人加入），各端据 state.phase 判定结算；
 * 房主「回到房间」时才把 status 改回 'waiting'。
 */
function onlineEndGame() {
  if (!_onlineRoomId) return false;
  const state = _getState();
  if (!state) return false;
  _markPushAndSend(state, _pushStatus || 'playing');
  return true;
}

/* ============================================================
   对外接口（游戏/渲染层调用）
   ============================================================ */

/** 本端是否为当前有效行动者（联机守卫；单机无房间时恒 true） */
window._olIsActor = function() {
  if (!_onlineRoomId) return true;
  const state = _getState();
  const seat = _seatOf();
  if (!state || seat === null) return true;
  return _canAct(state, seat);
};

/** 指定座位当前是否可操作（渲染层置灰用） */
window._olCanAct = function(seat) {
  if (!_onlineRoomId) return true;
  const s = (typeof seat === 'number') ? seat : _seatOf();
  return _canAct(_getState(), s);
};

/** 当前客户端座位号（游戏内座位；未加入房间返回 null） */
window._olSeatIndex = function() {
  if (!_onlineRoomId) return null;
  return _seatOf();
};

/** 当前客户端是否为房主 */
window._olIsHost = function() {
  return _onlineRoomId ? _isHost : false;
};

/** 等候室难度（房主切换后写入房间，成员只读镜像） */
window._olPendingDifficulty = 'novice';

/** 房主切换难度（成员调用无效） */
window._olSetPendingDifficulty = _olSetPendingDifficulty;

/** 刷新等候室难度卡（本地即时反馈） */
window._olRefreshWaitingExtras = refreshWaitingExtras;

/** 刷新等候室（房主会把难度写入房间状态） */
window._olRefreshWaitingRoom = _olRefreshWaitingRoom;

/** 对局中「退出房间」（联机菜单调用；弹确认层） */
window._olExitRoom = exitOnlineRoom;

/**
 * 结算后「回到房间」：仅房主可执行（成员只读等待房主）。
 * 房主把房间 status 改回 'waiting'，状态载荷只保留难度。
 */
window._olReturnToWaiting = async function() {
  if (!_onlineRoomId) return false;
  if (!_isHost) { _toast('等待房主返回房间'); return false; }
  const state = _getState();
  if (!_isTerminal(state)) return false;

  _showNetLoading('正在返回房间…');
  // 主动结束本局推送流，并等待在途推送落地，避免与房间更新竞速
  _lastPushPayload = null;
  _lastPushVerified = true;
  const t0 = Date.now();
  while (_pushInFlight && Date.now() - t0 < 1500) await _sleep(60);
  try {
    const difficulty = OL_DIFFICULTIES.indexOf(window._olPendingDifficulty) >= 0
      ? window._olPendingDifficulty : 'novice';
    const ok = await netUpdateGameState(_onlineRoomId, { pendingDifficulty: difficulty }, 'waiting');
    if (!ok) { _toast('返回房间失败，请重试'); return false; }
    _switchToWaitingView();
    const room = await netGetRoom(_onlineRoomId);
    if (!_onlineRoomId || !room) return true;
    _knownSeatCount = (room.seats || []).length;
    _renderWaitingIfChanged(room);
    return true;
  } catch (e) {
    console.warn('[online] return to waiting failed:', e);
    _toast('返回房间失败，请重试');
    return false;
  } finally {
    _hideNetLoading();
  }
};

/* ============================================================
   退出房间 / 成员离开
   ============================================================ */

function exitOnlineRoom() {
  _olDialog({
    title: '退出房间',
    body: '<p>确定退出当前联机房间？<br>本局进度将丢失。</p>',
    ok: '确认退出',
    okAction: 'confirmExitRoom()',
    cancel: '继续游戏',
    danger: true,
  });
}

async function confirmExitRoom() {
  _olCloseDialog();
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  _cleanupOnline();
  if (typeof HOOK_clearState === 'function') HOOK_clearState();
  _hideOnlineView();
  if (roomId && seatIndex !== null) {
    if (wasHost) netUpdateGameState(roomId, null, 'finished');
    else netLeaveRoom(roomId, seatIndex);
  }
  _backToLanding();
}

function _showPlayerLeftDialog(name) {
  // 只能「解散房间」：锁背景，防止误关后对局无人可操作
  _olDialog({
    title: '玩家离开',
    body: '<p><strong class="ol-danger">' + _esc(name) + '</strong> 退出了房间。</p>' +
          '<p class="ol-hint">本局无法继续，只能解散房间。</p>',
    ok: '解散房间',
    okAction: '_onDissolveAfterDeparture()',
    danger: true,
    lock: true,
  });
}

function _onDissolveAfterDeparture() {
  _olCloseDialog();
  _isReceiving = false;
  const roomId = _onlineRoomId;
  _cleanupOnline();
  if (typeof HOOK_clearState === 'function') HOOK_clearState();
  _hideOnlineView();
  if (roomId) netUpdateGameState(roomId, null, 'finished');
  _backToLanding();
}

/* ============================================================
   资源清理
   ============================================================ */

function _cleanupOnline() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_resubTimer) { clearTimeout(_resubTimer); _resubTimer = null; }
  if (_lifeboatRepushTimer) { clearTimeout(_lifeboatRepushTimer); _lifeboatRepushTimer = null; }
  _stopPolling();
  _onlineRoomId = null;
  _mySeatIndex = null;
  _myPlayerName = null;
  _isHost = false;
  _seatOrderIndex = null;
  _knownSeatCount = 0;
  _departedHandled = false;
  _gameStarted = false;
  _isReceiving = false;
  _myPushSeq = 0;
  _myPushedIds = new Set();
  _pendingPushSeat = null;
  _lastPushedActiveSeat = null;
  _lastPushPayload = null;
  _lastPushVerified = false;
  _pushInFlight = false;
  _pushQueued = false;
  _pushStatus = '';
  _channelStatus = null;
  _lastAppliedTs = 0;
  _lastAppliedPushId = null;
  _resyncing = false;
  _lastResyncAt = 0;
  _lastRecoverAt = 0;
  _lastWaitingSig = '';
  _lifeboatSettledSig = '';
  _lifeboatSettling = false;
  _seatResolving = false;
  _canActResolving = false;
  window._olDialogLock = false;
  window._olPendingDifficulty = 'novice';
  _clearSession();
}

/* ============================================================
   刷新重连
   ============================================================ */

async function _tryReconnect() {
  try {
    const raw = localStorage.getItem(ONLINE_CONFIG.SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !saved.roomId) return false;

    const room = await netGetRoom(saved.roomId);
    if (!room || room.status === 'finished') {
      _clearSession();
      return false;
    }

    // 座位校验：自己的座位必须还在（避免刷新后重复占座）
    const mySeat = (room.seats || []).find(s => s.seatIndex === saved.seatIndex);
    if (!mySeat || mySeat.name !== saved.playerName) {
      _clearSession();
      return false;
    }

    _onlineRoomId = saved.roomId;
    _mySeatIndex = saved.seatIndex;
    _isHost = !!saved.isHost;
    _myPlayerName = saved.playerName;
    _knownSeatCount = (room.seats || []).length;
    _departedHandled = false;
    _myPushSeq = 0;
    _myPushedIds = new Set();
    _pendingPushSeat = null;
    _lastPushedActiveSeat = null;
    _lastAppliedTs = 0;
    _lastAppliedPushId = null;
    _lastPushPayload = null;
    _lastPushVerified = false;
    _pushInFlight = false;
    _pushQueued = false;
    _pushStatus = '';
    _lastWaitingSig = '';
    _lifeboatSettledSig = '';
    if (_resubTimer) { clearTimeout(_resubTimer); _resubTimer = null; }
    _resyncing = false;
    _lastResyncAt = 0;
    _lastRecoverAt = 0;
    _refreshSeatOrder(room.seats);
    _subscribeToRoom(saved.roomId);

    if (room.status === 'playing' && room.state) {
      _gameStarted = true;
      _startPolling(ONLINE_CONFIG.POLL_GAME_MS);
      _applyState(room.state);
      _pendingPushSeat = _activeSeatOf(room.state);
      _showGameView();
      if (typeof HOOK_render === 'function') HOOK_render();
      if (_isTerminal(room.state) && typeof HOOK_showEndModal === 'function') HOOK_showEndModal();
    } else {
      _gameStarted = false;
      _showLobbyView();
      renderWaitingRoom(room);
    }
    return true;
  } catch (e) {
    console.warn('[online] reconnect failed:', e);
    _clearSession();
    return false;
  }
}

/* ============================================================
   样式（联机专用，作用域限定，不覆盖游戏样式）
   ============================================================ */

function _injectStyle() {
  if (document.getElementById('ol-style')) return;
  const style = document.createElement('style');
  style.id = 'ol-style';
  style.textContent = `
#online {
  max-width: 560px;
  margin: 0 auto;
  padding: calc(16px + var(--safe-top, 0px)) 16px calc(28px + var(--safe-bottom, 0px));
  min-height: 100dvh;
  color: var(--ink, #16344c);
  font-family: var(--sans, system-ui, sans-serif);
}
#online .setup-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
#online .setup-header h1 { margin: 0; font-family: var(--serif, Georgia, serif); font-size: 18px; letter-spacing: .1em; font-weight: 700; color: var(--ink, #16344c); }
#online .back-btn {
  display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 0 13px;
  border-radius: 999px; border: 1px solid var(--line-strong, rgba(28,84,130,.32));
  background: rgba(255,255,255,.7); color: var(--ink-2, #2f4e66); font-size: 12.5px; cursor: pointer;
}
#online .back-btn:active { transform: translateY(1px); }
#online .ol-panel {
  background: var(--panel, rgba(255,255,255,.78));
  border: 1px solid var(--line, rgba(28,84,130,.14));
  border-radius: 18px; padding: 16px;
  box-shadow: 0 10px 26px -18px rgba(18,62,96,.5);
}
#online .ol-lead { margin: 0 0 14px; font-size: 12px; letter-spacing: .06em; color: var(--muted, #607d91); text-align: center; }
#online .ol-or { margin: 16px 0 10px; text-align: center; font-size: 11.5px; letter-spacing: .16em; color: var(--muted, #607d91); }
#online .start-btn {
  display: block; width: 100%; min-height: 50px; padding: 0 18px; cursor: pointer;
  border: 1px solid var(--ice-strong, #0e5b95); border-radius: 14px;
  background: linear-gradient(180deg, #2a83c2 0%, #1768b5 58%, #10589b 100%);
  color: #fff; font-size: 14.5px; letter-spacing: .1em; font-weight: 600;
  box-shadow: 0 8px 20px -12px rgba(16,88,155,.95);
}
#online .start-btn.ghost { background: rgba(255,255,255,.9); color: var(--ice-strong, #0e5b95); border-color: var(--line-strong, rgba(28,84,130,.32)); box-shadow: none; }
#online .start-btn.is-danger { background: linear-gradient(180deg, #d65a51, #b3322b); border-color: #96241f; }
#online .start-btn:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
#online .start-btn:active:not(:disabled) { transform: translateY(1px); }
#online .ol-input {
  display: block; width: 100%; min-height: 46px; padding: 10px 14px; margin-bottom: 10px;
  border-radius: 12px; border: 1px solid var(--line-strong, rgba(28,84,130,.32));
  background: rgba(255,255,255,.92); color: var(--ink, #16344c); font-size: 14px; font-family: inherit;
}
#online .ol-input-code { text-align: center; letter-spacing: .42em; font-size: 19px; font-family: var(--serif, Georgia, serif); text-indent: .42em; }
#online .ol-input:focus { outline: 2px solid var(--blue, #1768b5); outline-offset: 1px; }
#online .ol-room-code {
  text-align: center; font-family: var(--serif, Georgia, serif); font-size: 32px; letter-spacing: .3em;
  text-indent: .3em; color: var(--ice-strong, #0e5b95); margin: 4px 0 16px;
}
#online .ol-seats { display: flex; flex-direction: column; gap: 7px; }
#online .setup-chip {
  display: flex; align-items: center; gap: 9px; padding: 10px 13px;
  border-radius: 12px; border: 1px solid var(--line, rgba(28,84,130,.14));
  background: rgba(255,255,255,.82); font-size: 13px; color: var(--ink, #16344c);
}
#online .setup-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(255,255,255,.9); }
#online .ol-chip-name { font-weight: 600; letter-spacing: .04em; }
#online .ol-chip-note { margin-left: auto; font-size: 10.5px; color: var(--muted, #607d91); text-align: right; }
#online .setup-chip.is-readonly { opacity: .82; }
#online .ol-extras-label { margin: 16px 0 7px; font-size: 11px; letter-spacing: .14em; color: var(--muted, #607d91); }
#online .ol-diff-row { display: flex; gap: 7px; }
#online .ol-diff { flex: 1; justify-content: center; cursor: pointer; min-height: 42px; }
#online .ol-diff.is-on { border-color: var(--blue, #1768b5); background: rgba(23,104,181,.1); box-shadow: inset 0 0 0 1px rgba(23,104,181,.35); }
#online .ol-start-row { margin-top: 16px; }
#online .ol-hint { margin: 10px 0 0; font-size: 11.5px; color: var(--muted, #607d91); text-align: center; }

/* 通用弹窗 */
.ol-modal {
  position: fixed; inset: 0; z-index: 9200; display: none;
  align-items: center; justify-content: center; padding: 24px;
  background: rgba(12,42,66,.42); backdrop-filter: blur(2px);
}
.ol-modal-box {
  width: 100%; max-width: 340px; padding: 20px 18px 16px; border-radius: 18px;
  background: var(--panel-solid, #fff); border: 1px solid var(--line-strong, rgba(28,84,130,.32));
  box-shadow: 0 22px 48px -24px rgba(12,42,66,.6); color: var(--ink, #16344c);
  font-family: var(--sans, system-ui, sans-serif);
}
.ol-modal-title { margin: 0 0 10px; font-family: var(--serif, Georgia, serif); font-size: 17px; letter-spacing: .08em; text-align: center; }
.ol-modal-body { font-size: 13px; line-height: 1.6; color: var(--ink-2, #2f4e66); }
.ol-modal-body p { margin: 0 0 8px; text-align: center; }
.ol-modal-actions { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.ol-modal .start-btn {
  display: block; width: 100%; min-height: 44px; padding: 0 18px; cursor: pointer;
  border: 1px solid var(--ice-strong, #0e5b95); border-radius: 14px;
  background: linear-gradient(180deg, #2a83c2 0%, #1768b5 58%, #10589b 100%);
  color: #fff; font-size: 13.5px; letter-spacing: .1em; font-weight: 600;
}
.ol-modal .start-btn.ghost { background: rgba(255,255,255,.92); color: var(--ice-strong, #0e5b95); border-color: var(--line-strong, rgba(28,84,130,.32)); }
.ol-modal .start-btn.is-danger { background: linear-gradient(180deg, #d65a51, #b3322b); border-color: #96241f; }
.ol-modal-actions .start-btn { min-height: 44px; font-size: 13.5px; }
.ol-danger { color: var(--danger, #c43c34); }

/* 加载遮罩 */
.ol-loading {
  position: fixed; inset: 0; z-index: 9300; display: none;
  align-items: center; justify-content: center; background: rgba(37,50,78,.32);
}
.ol-loading-box {
  display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-radius: 14px;
  background: var(--panel-solid, #fff); border: 1px solid var(--line-strong, rgba(28,84,130,.32));
  color: var(--ink, #16344c); font-size: 13.5px; box-shadow: 0 18px 40px -22px rgba(12,42,66,.65);
}
.ol-spinner {
  width: 18px; height: 18px; border-radius: 50%; flex: none;
  border: 2.5px solid rgba(23,104,181,.22); border-top-color: var(--blue, #1768b5);
  animation: ol-spin .75s linear infinite;
}
@keyframes ol-spin { to { transform: rotate(360deg); } }

/* 非当前玩家操作区置灰（通用工具类，由 render.js 按需加在容器上；
   不覆盖游戏样式，只做禁用与降透明） */
.ol-readonly { opacity: .45; filter: saturate(.72); }
.ol-readonly, .ol-readonly * { pointer-events: none !important; cursor: default !important; }
.ol-waiting-hint {
  margin: 8px 0 0; font-size: 11.5px; letter-spacing: .05em;
  color: var(--muted, #607d91); text-align: center;
}
`;
  document.head.appendChild(style);
}

/* ============================================================
   启动
   ============================================================ */

/**
 * 初始化联机模式
 * @param {object} hooks - 游戏定制钩子
 *
 * 必需：
 *   dealGame(names, difficulty)  初始化联机对局（players/currentSeat/activeSeat/rev/pending）
 *   render()                     渲染游戏界面
 *   renderLanding()              首页 HTML（可选：与 window.renderLanding 二选一）
 *   clearState()                 清空游戏状态
 *   getOnlineState()             取当前状态快照
 *   applyOnlineState(state)      应用远端快照
 *   canAct(seat) | canAct(state, seat)   操作权判定
 *   getSeat()                    本端游戏内座位号
 *
 * 可选：
 *   addLog / showEndModal / getPlayers / getCurrentPlayer / getPlayerColors /
 *   showLanding / waitingExtras / refreshWaitingExtras / completeLifeboat
 */
function initOnline(hooks) {
  hooks = hooks || {};
  HOOK_dealGame = hooks.dealGame || null;
  HOOK_render = hooks.render || null;
  HOOK_renderLanding = hooks.renderLanding || null;
  HOOK_clearState = hooks.clearState || null;
  HOOK_getOnlineState = hooks.getOnlineState || null;
  HOOK_applyOnlineState = hooks.applyOnlineState || null;
  HOOK_canAct = hooks.canAct || null;
  HOOK_getSeat = hooks.getSeat || null;
  HOOK_addLog = hooks.addLog || null;
  HOOK_showEndModal = hooks.showEndModal || null;
  HOOK_getPlayers = hooks.getPlayers || null;
  HOOK_getCurrentPlayer = hooks.getCurrentPlayer || null;
  HOOK_getPlayerColors = hooks.getPlayerColors || null;
  HOOK_showLanding = hooks.showLanding || null;
  HOOK_waitingExtras = hooks.waitingExtras || null;
  HOOK_refreshWaitingExtras = hooks.refreshWaitingExtras || null;
  HOOK_completeLifeboat = hooks.completeLifeboat || null;

  // 与游戏层约定的全局接口
  window._getOnlineState = HOOK_getOnlineState || function() { return null; };
  window._applyOnlineState = HOOK_applyOnlineState || function() {};
  window._olPushState = onlinePushState;
  window._olEndGame = onlineEndGame;

  window._olPendingDifficulty = window._olPendingDifficulty || 'novice';

  // 若游戏提供了 renderLanding，则在其 HTML 里插入联机入口（可选路径）
  if (HOOK_renderLanding) {
    window.renderLanding = function() {
      const html = HOOK_renderLanding();
      const btn = '<button type="button" class="start-btn ghost" onclick="showOnlineLobby()">联机模式</button>';
      if (html.indexOf('<!--ONLINE_BTN-->') >= 0) return html.replace('<!--ONLINE_BTN-->', btn);
      const pos = html.lastIndexOf('</div>');
      if (pos < 0) return html + btn;
      return html.slice(0, pos) + btn + html.slice(pos);
    };
  }

  _injectStyle();

  // 移动端生命周期恢复：iOS 切后台会挂起 WebSocket，断线期间事件不重放，
  // 回前台 / 网络恢复 / bfcache 恢复时统一重建频道并重拉状态
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') return;
    _recoverConnection();
  });
  window.addEventListener('online', function() { _recoverConnection(); });
  window.addEventListener('pageshow', function(ev) { if (ev.persisted) _recoverConnection(); });

  const bootstrap = function() {
    _ensureOnlineContainer();
    _injectStyle();
    let saved = null;
    try { saved = localStorage.getItem(ONLINE_CONFIG.SESSION_KEY); } catch (e) { /* ignore */ }
    if (saved) _tryReconnect();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(bootstrap, 0); });
  } else {
    setTimeout(bootstrap, 0);
  }
}
