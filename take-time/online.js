/**
 * online.js — 联机模式通用模板
 *
 * 职责：房间管理、状态同步、观战/接管、重连
 * 依赖：net.js（Supabase 通信层）、game.js（本局游戏逻辑）
 *
 * ── 接入步骤 ──────────────────────────────────────────
 *  1. 复制 net.js 和本文件到项目，修改 NET_CONFIG
 *  2. 在 HTML 中按顺序加载：
 *     <script src="game.js"></script>
 *     <script src="render.js"></script>
 *     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *     <script src="net.js"></script>
 *     <script src="online.js"></script>
 *  3. 实现下方「HOOK: 游戏定制」中的所有函数
 *  4. 在 HTML 中添加联机大厅容器：<div id="online" style="display:none"></div>
 *  5. 调用 initOnline() 启动
 * ──────────────────────────────────────────────────────
 */

/* ============================================================
   配置区
   ============================================================ */

const ONLINE_CONFIG = {
  SESSION_KEY: 'taketime-online',   // localStorage 键名，不同游戏用不同值
  GAME_TITLE: '时序谜局',           // 游戏名称
};

/** 游戏定制：等候室额外内容（选关），由 initOnline 注册 */
let HOOK_waitingExtras = null;

/* ============================================================
   HOOK: 游戏定制 — 请根据实际游戏实现以下函数
   ============================================================ */

/**
 * 必须实现 ─ 初始化游戏状态
 * 引用：game.js 中的初始化函数
 * 示例：function() { dealGame([...names]); S.phase = 'playing'; }
 */
let HOOK_dealGame = null; // → function(names: string[]): void

/**
 * 必须实现 ─ 渲染游戏主界面
 * 引用：game.js/render.js 中的 render()
 * 示例：function() { render(); }
 */
let HOOK_render = null; // → function(): void

/**
 * 必须实现 ─ 渲染着陆页
 * 引用：game.js/render.js 中的 renderLanding()
 * 示例：function() { return renderLandingHTML(); }
 */
let HOOK_renderLanding = null; // → function(): string

/**
 * 必须实现 ─ 清空游戏状态
 * 引用：game.js 中的 clearState()
 * 示例：function() { clearState(); }
 */
let HOOK_clearState = null; // → function(): void

/**
 * 可选 ─ 添加日志
 * 引用：game.js 中的 addLog()
 * 示例：function(msg, cls) { addLog(msg, cls); }
 */
let HOOK_addLog = null; // → function(msg: string, cls?: string): void

/**
 * 可选 ─ 显示结算弹窗
 * 引用：game.js/render.js 中的 showEndModal()
 * 示例：function() { showEndModal(); }
 */
let HOOK_showEndModal = null; // → function(): void

/**
 * 可选 ─ 获取当前玩家列表
 * 引用：game.js 中的 S.players
 * 示例：function() { return S.players; }
 */
let HOOK_getPlayers = null; // → function(): Array<{name: string, ...}>

/**
 * 可选 ─ 获取当前回合玩家索引
 * 引用：game.js 中的 S.currentPlayer
 * 示例：function() { return S.currentPlayer; }
 */
let HOOK_getCurrentPlayer = null; // → function(): number

/**
 * 可选 ─ 获取玩家颜色列表
 * 引用：game.js 中的 PLAYER_COLORS
 * 示例：function() { return PLAYER_COLORS; }
 */
let HOOK_getPlayerColors = null; // → function(): string[]

/* ============================================================
   联机状态
   ============================================================ */

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

let _onlineRoomId   = null;
let _mySeatIndex    = null;
let _myPlayerName   = null;
let _isHost         = false;
let _unsubscribe    = null;
let _isReceiving    = false;
let _knownSeatCount = 0;
let _departedHandled = false;
let _myPushSeq      = 0;
let _myPushedIds    = new Set();
let _pendingPushSeat = null;
let _lastPushedCurrentSeat = null;
let _gameStarted    = false;
let _rescueSheetShown = false; // 视游戏需求保留

function _saveSession() {
  if (_onlineRoomId) {
    try {
      localStorage.setItem(ONLINE_CONFIG.SESSION_KEY, JSON.stringify({
        roomId: _onlineRoomId, seatIndex: _mySeatIndex,
        isHost: _isHost, playerName: _myPlayerName,
      }));
    } catch (e) {}
  }
}

function _clearSession() {
  try { localStorage.removeItem(ONLINE_CONFIG.SESSION_KEY); } catch (e) {}
}

/* ============================================================
   页面导航
   ============================================================ */

function showOnlineLobby() {
  document.getElementById('online').style.display = 'flex';
  document.getElementById('online').style.flexDirection = 'column';
  document.getElementById('online').style.alignItems = 'center';
  document.getElementById('online').style.minHeight = 'calc(100dvh - 24px)';
  document.getElementById('online').style.padding = '28px';
  document.getElementById('app').style.display = 'none';
  renderOnlineLobby();
}

async function onlineBackToLanding() {
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  _cleanupOnline();
  document.getElementById('online').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (roomId && seatIndex !== null) {
    if (wasHost) {
      netUpdateGameState(roomId, null, 'finished');
    } else {
      netLeaveRoom(roomId, seatIndex);
    }
  }
  if (typeof HOOK_showLanding === 'function') {
    HOOK_showLanding();
  }
}

function _cleanupOnline() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _onlineRoomId = null;
  _mySeatIndex  = null;
  _myPlayerName = null;
  _isHost       = false;
  _knownSeatCount = 0;
  _departedHandled = false;
  _myPushSeq = 0;
  _myPushedIds = new Set();
  _pendingPushSeat = null;
  _lastPushedCurrentSeat = null;
  _gameStarted = false;
  _clearSession();
}

/* ============================================================
   HOOK: 显示着陆页（由游戏方实现）
   ============================================================ */

let HOOK_showLanding = null;

/* ============================================================
   大厅 UI
   ============================================================ */

function renderOnlineLobby() {
  const colors = typeof HOOK_getPlayerColors === 'function' ? HOOK_getPlayerColors() : [];
  document.getElementById('online').innerHTML = `
    <div class="setup-header" style="width:100%;">
      <h1>🌐 ${_esc(ONLINE_CONFIG.GAME_TITLE)} 联机</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 返回</button>
    </div>
    <div style="width:100%;margin:0 auto;">
      <div style="margin-bottom:20px;">
        <button class="start-btn" onclick="onCreateRoom()" style="margin-bottom:12px;">创建房间</button>
      </div>
      <div style="text-align:center;color:var(--text-dim);margin-bottom:12px;">—— 或 ——</div>
      <div>
        <input id="joinRoomInput" type="text" inputmode="numeric" placeholder="输入4位房间号" maxlength="4"
          style="width:100%;padding:12px;font-size:1.2rem;text-align:center;
                 letter-spacing:.4em;text-transform:uppercase;
                 background:var(--surface);color:var(--text);border:1px solid #2a2a32;
                 border-radius:8px;margin-bottom:12px;">
        <input id="joinNameInput" type="text" placeholder="你的名字" maxlength="8"
          style="width:100%;padding:10px;font-size:1rem;
                 background:var(--surface);color:var(--text);border:1px solid #2a2a32;
                 border-radius:8px;margin-bottom:12px;">
        <button class="start-btn" onclick="onJoinRoom()" style="background:transparent;border:2px solid var(--gold);color:var(--gold);">加入房间</button>
      </div>
    </div>`;
}

/* ============================================================
   Loading 遮罩
   ============================================================ */

function _showNetLoading(text) {
  let el = document.getElementById('net-loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'net-loading-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);';
    el.innerHTML = `<div style="background:#1a1a24;padding:24px 36px;border-radius:12px;text-align:center;color:#e8e6e3;font-size:1rem;">
      <div style="width:32px;height:32px;border:3px solid #444;border-top-color:#d4a843;border-radius:50%;animation:ol-spin .7s linear infinite;margin:0 auto 12px;"></div>
      <span id="net-loading-text"></span>
    </div>`;
    const style = document.createElement('style');
    style.textContent = '@keyframes ol-spin{to{transform:rotate(360deg)}}';
    el.appendChild(style);
    document.body.appendChild(el);
  }
  document.getElementById('net-loading-text').textContent = text || '加载中...';
  el.style.display = 'flex';
}

function _hideNetLoading() {
  const el = document.getElementById('net-loading-overlay');
  if (el) el.style.display = 'none';
}

/* ============================================================
   创建 / 加入房间
   ============================================================ */

async function onCreateRoom() {
  const name = prompt('输入你的名字（房主）:', '');
  if (!name || !name.trim()) return;
  _myPlayerName = name.trim();

  _showNetLoading('正在创建房间...');
  try {
    const roomId = await netCreateRoom(_myPlayerName);
    _onlineRoomId = roomId;
    _mySeatIndex  = 0;
    _isHost       = true;
    _gameStarted  = false;
    _saveSession();
    _knownSeatCount = 1;
    _departedHandled = false;
    _subscribeToRoom(roomId);
    renderWaitingRoom({ seats: [{ name: _myPlayerName, seatIndex: 0 }] });
  } catch (e) {
    alert('创建房间失败: ' + e.message);
  } finally {
    _hideNetLoading();
  }
}

async function onJoinRoom() {
  const roomId = (document.getElementById('joinRoomInput').value || '').trim().toUpperCase();
  const name   = (document.getElementById('joinNameInput').value  || '').trim();
  if (!roomId || roomId.length !== 4) { alert('请输入4位房间号'); return; }
  if (!name)                           { alert('请输入你的名字');  return; }

  _myPlayerName = name;
  _showNetLoading('正在加入房间...');
  try {
    const { seatIndex, room } = await netJoinRoom(roomId, name);
    _onlineRoomId = roomId;
    _mySeatIndex  = seatIndex;
    _isHost       = false;
    _gameStarted  = false;
    _saveSession();
    _departedHandled = false;
    _subscribeToRoom(roomId);
    const seats = [...(room.seats || []), { name, joinedAt: new Date().toISOString(), seatIndex }];
    _knownSeatCount = seats.length;
    if (room.status === 'playing' && room.state) {
      // 加入时游戏已开始 → 直接进入
      _applyRemoteState(room.state);
      _gameStarted = true;
      document.getElementById('online').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      if (typeof HOOK_render === 'function') HOOK_render();
    } else {
      renderWaitingRoom({ ...room, seats });
    }
  } catch (e) {
    alert(e.message || '加入失败');
  } finally {
    _hideNetLoading();
  }
}

/* ============================================================
   等候室
   ============================================================ */

function renderWaitingRoom(room) {
  // 房主选关同步到成员端（等待阶段只读展示）
  window._olPendingChallenge = (room.state && room.state.pendingChallenge) || null;
  const seats = room.seats || [];
  const colors = typeof HOOK_getPlayerColors === 'function' ? HOOK_getPlayerColors() : [];
  const seatsHTML = seats.map(s =>
    `<div class="setup-chip" style="margin-bottom:8px;width:100%;justify-content:space-between;padding:10px 14px;">
      <span><span class="setup-dot" style="background:${colors[s.seatIndex] || '#888'}"></span> ${_esc(s.name)}</span>
      <span style="font-size:.7em;color:var(--text-dim)">${s.seatIndex === 0 ? '房主' : '座位 ' + (s.seatIndex + 1)}</span>
    </div>`
  ).join('');

  const canStart = _isHost && seats.length >= 2;
  const extrasHTML = typeof HOOK_waitingExtras === 'function' ? HOOK_waitingExtras() : '';
  const startBtnHTML = _isHost
    ? `<button class="start-btn" onclick="startOnlineGame()"
         ${canStart ? '' : 'disabled'} style="margin-top:16px;">开始游戏 (${seats.length}/${NET_CONFIG.MAX_PLAYERS}人)</button>`
    : `<div style="text-align:center;color:var(--text-dim);padding:16px;margin-top:16px;">
         等待房主开始游戏...
       </div>`;

  document.getElementById('online').innerHTML = `
    <div class="setup-header" style="width:100%;">
      <h1>房间 ${_onlineRoomId}</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 退出</button>
    </div>
    <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px;text-align:center;">
      分享房间号给朋友加入
    </p>
    <div style="width:100%;margin:0 auto;">
      <div style="text-align:center;font-size:2rem;letter-spacing:.4em;
                  color:var(--gold);font-weight:bold;margin-bottom:20px;">
        ${_onlineRoomId}
      </div>
      ${seatsHTML}
      ${extrasHTML}
      <div style="margin-top:16px;text-align:center;">${startBtnHTML}</div>
    </div>`;
}

/* ============================================================
   Realtime 订阅
   ============================================================ */

function _subscribeToRoom(roomId) {
  if (_unsubscribe) _unsubscribe();

  _unsubscribe = netSubscribeRoom(roomId, (row) => {
    // 检测成员离开
    if (Array.isArray(row.seats) && row.seats.length < _knownSeatCount && _knownSeatCount > 0 && !_departedHandled) {
      _departedHandled = true;
      const players = typeof HOOK_getPlayers === 'function' ? HOOK_getPlayers() : [];
      const departedSeat = players.length > 0
        ? players.findIndex((_, i) =>
            i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
        : -1;
      const departedName = departedSeat >= 0 && players[departedSeat]
        ? players[departedSeat].name : '未知玩家';
      if (_isHost) {
        _showPlayerLeftDialog(departedName, departedSeat);
      } else {
        alert(_esc(departedName) + ' 退出了房间，等待房主处理...');
      }
      _knownSeatCount = row.seats.length;
    }

    // 等候室阶段
    if (row.status === 'waiting' && row.seats) {
      renderWaitingRoom(row);
      return;
    }

    // 游戏结束
    if (row.status === 'finished') {
      _handleRemoteFinished(row);
      return;
    }

    // 游戏阶段
    if (row.status === 'playing' && row.state) {
      _handleRemoteState(row);
    }
  });
}

/** 处理远程游戏状态更新 */
function _handleRemoteState(row) {
  const curPlayer = row.state.currentPlayer;
  const departed = row.state.departedPlayers || [];
  const iTakeover = _isHost && departed.includes(curPlayer)
    && (row.state._src === _mySeatIndex);
  const localCur = typeof HOOK_getCurrentPlayer === 'function' ? HOOK_getCurrentPlayer() : undefined;
  const iAmAlreadyOperator = curPlayer === _mySeatIndex && localCur === _mySeatIndex;
  if (iAmAlreadyOperator || iTakeover) return;

  const remotePushId = row.state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;

  _isReceiving = true;
  _gameStarted = true;
  _pendingPushSeat = row.state.currentPlayer;

  // 从等候室切换到游戏界面
  if (document.getElementById('app').style.display === 'none') {
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  }

  _applyRemoteState(row.state);

  _isReceiving = false;
}

/** 处理远程游戏结束 */
function _handleRemoteFinished(row) {
  const remotePushId = row.state && row.state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;

  _isReceiving = true;
  if (row.state) {
    const alreadyOver = typeof HOOK_getPlayers === 'function'
      && HOOK_getPlayers() && HOOK_getPlayers().length > 0
      && row.state.gameOver;
    _applyRemoteState(row.state);
    if (row.state.gameOver && !alreadyOver) {
      if (document.getElementById('app').style.display === 'none') {
        document.getElementById('online').style.display = 'none';
        document.getElementById('app').style.display = 'block';
      }
      if (typeof HOOK_render === 'function') HOOK_render();
      if (typeof HOOK_showEndModal === 'function') HOOK_showEndModal();
      _patchEndModalBtn();
    }
  } else {
    // 房主解散房间
    _cleanupOnline();
    if (typeof HOOK_clearState === 'function') HOOK_clearState();
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    alert('房主已离开，房间已解散');
    if (typeof HOOK_showLanding === 'function') HOOK_showLanding();
  }
  _isReceiving = false;
}

/** 应用远程状态到本地 S */
function _applyRemoteState(state) {
  // 游戏应暴露全局 S 用于状态覆盖
  // 各游戏根据自身状态结构实现
  if (typeof window._applyOnlineState === 'function') {
    window._applyOnlineState(state);
  }
}

/* ============================================================
   房主开始游戏
   ============================================================ */

async function startOnlineGame() {
  if (!_isHost) return;
  _showNetLoading('正在开始游戏...');
  try {
    const room = await netGetRoom(_onlineRoomId);
    const seats = room.seats || [];
    _knownSeatCount = seats.length;
    _departedHandled = false;
    _gameStarted = true;
    const names = seats.map(s => s.name);
    if (typeof HOOK_dealGame === 'function') {
      HOOK_dealGame(names);
    }
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    if (typeof HOOK_render === 'function') HOOK_render();
    await _markPushAndSend(window._getOnlineState(), 'playing');
  } catch (e) {
    alert('开始游戏失败: ' + e.message);
  } finally {
    _hideNetLoading();
  }
}

/* ============================================================
   游戏集成：状态推送
   ============================================================ */

/**
 * 游戏方应调用此函数来推送状态（通常在 saveState 中触发）
 * 示例：
 *   const _originalSaveState = window.saveState;
 *   window.saveState = function() {
 *     _originalSaveState();
 *     onlinePushState();
 *   };
 */
function onlinePushState() {
  if (!_onlineRoomId || _isReceiving || !_gameStarted) return;

  const state = window._getOnlineState();
  if (state && state.gameOver) return;

  // 操作者判定
  const hasDeparted = _isHost && state && state.departedPlayers && state.departedPlayers.length > 0;
  const isCurrentActor = state && state.currentPlayer === _mySeatIndex;
  const isOutgoingActor = _pendingPushSeat === _mySeatIndex;
  const turnJustHandedOff =
    _lastPushedCurrentSeat !== null
    && _lastPushedCurrentSeat !== state.currentPlayer
    && _lastPushedCurrentSeat === _mySeatIndex;
  const canPush = isCurrentActor || isOutgoingActor || turnJustHandedOff || hasDeparted;
  if (!canPush) {
    if (state && typeof state.currentPlayer === 'number') {
      _pendingPushSeat = state.currentPlayer;
    }
    return;
  }

  const stateSnapshot = JSON.parse(JSON.stringify(state));
  _markPushAndSend(stateSnapshot);

  if (isCurrentActor) {
    _pendingPushSeat = _mySeatIndex;
  } else if (isOutgoingActor) {
    _pendingPushSeat = null;
  }
}

async function _markPushAndSend(stateObj, status) {
  _myPushSeq++;
  const pushId = _mySeatIndex + '-' + _myPushSeq;
  stateObj._pushId = pushId;
  stateObj._src = _mySeatIndex;
  _myPushedIds.add(pushId);
  _lastPushedCurrentSeat = typeof stateObj.currentPlayer === 'number'
    ? stateObj.currentPlayer : null;
  netUpdateGameState(_onlineRoomId, stateObj, status);
}

/**
 * 联机模式下判断当前客户端是否为"有效行动者"：
 * 当前回合玩家本人，或接管离席玩家的房主。
 * 游戏方在关键操作守卫中调用此函数（单机时不存在该函数，守卫自动跳过）。
 */
window._olIsActor = function() {
  if (!_onlineRoomId) return true;
  const state = window._getOnlineState();
  if (!state || typeof state.currentPlayer !== 'number') return false;
  if (state.currentPlayer === _mySeatIndex) return true;
  const departed = state.departedPlayers || [];
  return _isHost && departed.includes(state.currentPlayer);
};

/** 当前客户端座位号（未加入房间时返回 null） */
window._olSeatIndex = function() {
  if (!_onlineRoomId || _mySeatIndex === null) return null;
  return _mySeatIndex;
};

/** 当前客户端是否为房主 */
window._olIsHost = function() {
  return _onlineRoomId ? _isHost : false;
};

/** 刷新等候室界面（选关等本地操作后调用） */
window._olRefreshWaitingRoom = async function() {
  if (!_onlineRoomId || _gameStarted) return;
  try {
    // 房主把当前选关推送到房间状态，成员端通过 Realtime 同步展示
    if (_isHost && typeof window._olGetPendingChallenge === 'function') {
      const ch = window._olGetPendingChallenge();
      if (ch) await netUpdateGameState(_onlineRoomId, { pendingChallenge: ch }, 'waiting');
    }
    const room = await netGetRoom(_onlineRoomId);
    renderWaitingRoom(room);
  } catch (e) {
    console.warn('[online] refresh waiting room failed:', e);
  }
};

/* ============================================================
   游戏集成：渲染拦截
   ============================================================ */

// 注入联机模式专用样式
const _onlineStyleId = 'ol-style';
if (!document.getElementById(_onlineStyleId)) {
  const style = document.createElement('style');
  style.id = _onlineStyleId;
  style.textContent = `
    .online-waiting .act-btn,
    .online-waiting .dice-o2-card,
    .online-waiting .btn-keep,
    .online-waiting .btn-stop,
    .online-waiting .tile,
    .online-waiting .discarded-supply-tile {
      pointer-events: none !important;
      opacity: 0.45 !important;
    }
    .online-waiting .dice-o2-card {
      filter: grayscale(1);
    }
    .online-waiting .rescue-link {
      pointer-events: none !important;
      opacity: 0.45 !important;
    }
    .online-waiting h3 {
      color: var(--text-dim);
    }
  `;
  document.head.appendChild(style);
}

/**
 * 游戏方应调用此函数来包装 render，实现观战模式
 * 示例：
 *   const _originalRender = window.render;
 *   window.render = function() {
 *     _originalRender();
 *     onlineAfterRender();
 *   };
 */
function onlineAfterRender() {
  if (!_onlineRoomId || !_gameStarted) return;

  const app = document.getElementById('app');
  if (!app) return;

  // 游戏头部添加退出按钮
  const headerBtns = app.querySelector('.game-header .header-btns');
  if (headerBtns && !document.getElementById('exitRoomBtn')) {
    const resetBtn = headerBtns.querySelector('button[onclick*="resetGame"]');
    if (resetBtn) resetBtn.style.display = 'none';
    const btn = document.createElement('button');
    btn.id = 'exitRoomBtn';
    btn.textContent = '🚪 退出';
    btn.className = 'icon-btn';
    btn.onclick = exitOnlineRoom;
    headerBtns.insertBefore(btn, headerBtns.firstChild);
  }

  // 游戏已结束则跳过
  const state = window._getOnlineState();
  if (state && state.gameOver) return;

  // 游戏方应实现 onlineUpdateDiceAreaUI() 来更新骰子/行动区域
  if (typeof window.onlineUpdateDiceAreaUI === 'function') {
    window.onlineUpdateDiceAreaUI();
  }
}

/* ============================================================
   游戏中退出房间
   ============================================================ */

function exitOnlineRoom() {
  const content = `
    <h2>退出房间</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">
      确定退出当前联机房间？<br>游戏进度将丢失
    </p>
    <button class="btn-full btn-primary" style="margin-bottom:8px;" onclick="confirmExitRoom()">确认退出</button>
    <button class="btn-full btn-secondary" onclick="closeModal('modalOverlay')">取消</button>`;
  const modal = document.getElementById('modalOverlay');
  const contentDiv = document.getElementById('modalContent');
  contentDiv.innerHTML = content;
  modal.classList.add('show');
}

async function confirmExitRoom() {
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  const modal = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('show');
  // 退出即重置本关进度（需在 clearState 之前读取当前关卡）
  if (typeof window._olResetProgress === 'function') window._olResetProgress();
  _cleanupOnline();
  if (typeof HOOK_clearState === 'function') HOOK_clearState();
  document.getElementById('online').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (roomId && seatIndex !== null) {
    if (wasHost) {
      netUpdateGameState(roomId, null, 'finished');
    } else {
      netLeaveRoom(roomId, seatIndex);
    }
  }
  if (typeof HOOK_showLanding === 'function') HOOK_showLanding();
}

/* ============================================================
   成员离开处理
   ============================================================ */

let _pendingDepartedSeat = null;

function _showPlayerLeftDialog(name, seatIndex) {
  _pendingDepartedSeat = seatIndex;
  const content = `
    <h2>⚠️ 玩家离开</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">
      <strong style="color:var(--danger)">${_esc(name)}</strong> 退出了房间
    </p>
    <p style="text-align:center;font-size:.85rem;color:var(--text-dim);margin-bottom:16px;">
      选择如何处理：
    </p>
    <button class="btn-full btn-primary" style="margin-bottom:8px;" onclick="_onTakeoverPlayer()">
      接管操作<br><span style="font-size:.75rem;opacity:.7">后续该玩家的回合由你代操作</span>
    </button>
    <button class="btn-full btn-danger" onclick="_onResetAfterDeparture()">
      重置游戏<br><span style="font-size:.75rem;opacity:.7">关闭房间，所有人回到首页</span>
    </button>`;
  const modal = document.getElementById('modalOverlay');
  const contentDiv = document.getElementById('modalContent');
  contentDiv.innerHTML = content;
  modal.classList.add('show');
}

function _onTakeoverPlayer() {
  const modal = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('show');
  const seat = _pendingDepartedSeat;
  _pendingDepartedSeat = null;
  if (seat === null) return;

  const state = window._getOnlineState();
  if (!state) return;

  state.departedPlayers = state.departedPlayers || [];
  if (!state.departedPlayers.includes(seat)) {
    state.departedPlayers.push(seat);
  }
  if (typeof HOOK_addLog === 'function') {
    const players = typeof HOOK_getPlayers === 'function' ? HOOK_getPlayers() : [];
    HOOK_addLog((players[seat] ? players[seat].name : '') + ' 离开了房间，房主接管操作');
  }

  _isReceiving = false;
  _markPushAndSend(state);
  if (typeof HOOK_render === 'function') HOOK_render();
}

function _onResetAfterDeparture() {
  const modal = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('show');
  _pendingDepartedSeat = null;
  _isReceiving = false;
  netUpdateGameState(_onlineRoomId, null, 'finished');
  _cleanupOnline();
  if (typeof HOOK_clearState === 'function') HOOK_clearState();
  document.getElementById('online').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (typeof HOOK_showLanding === 'function') HOOK_showLanding();
}

/* ============================================================
   游戏结束处理
   ============================================================ */

/**
 * 游戏方应在 endGame 中调用此函数
 * 示例：
 *   const _originalEndGame = window.endGame;
 *   window.endGame = function(forcedLose) {
 *     _originalEndGame(forcedLose);
 *     onlineEndGame();
 *   };
 */
function onlineEndGame() {
  if (!_onlineRoomId) return;

  const state = window._getOnlineState();
  _markPushAndSend(state);
  netUpdateGameState(_onlineRoomId, state, 'finished');

  _patchEndModalBtn();
}

/** 联机模式下把结算弹窗的"确认"改为"退出房间" */
function _patchEndModalBtn() {
  requestAnimationFrame(() => {
    const content = document.getElementById('endModalContent');
    if (!content) return;
    const btns = content.querySelectorAll('button');
    btns.forEach(btn => {
      if (btn.textContent.includes('确认')) {
        btn.textContent = '退出房间';
        btn.onclick = function() {
          closeModal('endModal');
          confirmExitRoom();
        };
      }
    });
  });
}

/* ============================================================
   页面刷新重连
   ============================================================ */

async function _tryReconnect() {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_CONFIG.SESSION_KEY));
    if (!saved || !saved.roomId) return false;

    const room = await netGetRoom(saved.roomId);
    if (!room || room.status === 'finished') {
      _clearSession();
      return false;
    }

    // 座位校验：自己的座位必须还在（避免刷新后重复加入）
    const mySeat = (room.seats || []).find(s => s.seatIndex === saved.seatIndex);
    if (!mySeat || mySeat.name !== saved.playerName) {
      _clearSession();
      return false;
    }

    _onlineRoomId = saved.roomId;
    _mySeatIndex  = saved.seatIndex;
    _isHost       = saved.isHost;
    _myPlayerName = saved.playerName;
    _knownSeatCount = (room.seats || []).length;
    _departedHandled = false;
    _myPushSeq = 0;
    _myPushedIds = new Set();
    _pendingPushSeat = null;
    _lastPushedCurrentSeat = null;
    _subscribeToRoom(saved.roomId);

    if (room.status === 'playing' && room.state) {
      // 游戏进行中：直接恢复对局
      _gameStarted = true;
      // 恢复「上一手推送上下文」：否则刷新后轮到自己出牌时 canPush 全 false，推送被吞
      _lastPushedCurrentSeat = (typeof room.state.currentPlayer === 'number')
        ? room.state.currentPlayer : null;
      _applyRemoteState(room.state);
      document.getElementById('online').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      if (typeof HOOK_render === 'function') HOOK_render();
    } else {
      // 等候室（waiting）：恢复房间界面，等待房主开始。
      // 座位校验通过即复用原座位，不重新 join，房主侧不会出现重复成员
      _gameStarted = false;
      document.getElementById('online').style.display = 'flex';
      document.getElementById('online').style.flexDirection = 'column';
      document.getElementById('online').style.alignItems = 'center';
      document.getElementById('online').style.minHeight = 'calc(100dvh - 24px)';
      document.getElementById('online').style.padding = '28px';
      document.getElementById('app').style.display = 'none';
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
   启动函数
   ============================================================ */

/**
 * 初始化联机模式
 * @param {object} hooks - 游戏定制钩子
 *
 * 必需钩子：
 *   dealGame(names)       - 初始化游戏
 *   render()              - 渲染游戏界面
 *   renderLanding()       - 渲染着陆页（返回 HTML 字符串）
 *   clearState()          - 清空游戏状态
 *   getOnlineState()      - 获取当前游戏状态快照（返回 S 或等义对象）
 *   applyOnlineState(s)   - 应用远程状态到本地
 *
 * 可选钩子：
 *   addLog(msg, cls)      - 添加日志
 *   showEndModal()        - 显示结算弹窗
 *   getPlayers()          - 返回玩家数组
 *   getCurrentPlayer()    - 返回当前回合玩家索引
 *   getPlayerColors()     - 返回玩家颜色数组
 *   showLanding()         - 显示着陆页
 *   updateDiceAreaUI()    - 更新骰子/行动区域 UI（观战模式）
 */
function initOnline(hooks) {
  // 注册钩子
  HOOK_dealGame = hooks.dealGame || null;
  HOOK_render = hooks.render || null;
  HOOK_renderLanding = hooks.renderLanding || null;
  HOOK_clearState = hooks.clearState || null;
  HOOK_addLog = hooks.addLog || null;
  HOOK_showEndModal = hooks.showEndModal || null;
  HOOK_getPlayers = hooks.getPlayers || null;
  HOOK_getCurrentPlayer = hooks.getCurrentPlayer || null;
  HOOK_getPlayerColors = hooks.getPlayerColors || null;
  HOOK_showLanding = hooks.showLanding || null;
  HOOK_waitingExtras = hooks.waitingExtras || null;

  // 注册全局接口
  window._getOnlineState = hooks.getOnlineState || function() { return null; };
  window._applyOnlineState = hooks.applyOnlineState || function(s) {};

  // 注册观战 UI 更新
  window.onlineUpdateDiceAreaUI = hooks.updateDiceAreaUI || function() {};

  // 覆盖着陆页渲染
  if (HOOK_renderLanding) {
    window.renderLanding = function() {
      const landingHTML = HOOK_renderLanding();
      const btn = `<button class="start-btn" onclick="showOnlineLobby()" style="background:var(--surface);border:2px solid var(--gold);color:var(--gold);margin-top:12px;">🌐 联机模式</button>`;
      if (landingHTML.includes('<!--ONLINE_BTN-->')) {
        return landingHTML.replace('<!--ONLINE_BTN-->', btn);
      }
      // 兜底：插到最后一个闭合 div 之前
      const insertPos = landingHTML.lastIndexOf('</div>');
      const before = landingHTML.slice(0, insertPos);
      const after = landingHTML.slice(insertPos);
      return before + btn + after;
    };
  }

  // 启动重连检测
  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof HOOK_clearState === 'function') HOOK_clearState();
    if (typeof HOOK_render === 'function') HOOK_render();

    try {
      const saved = localStorage.getItem(ONLINE_CONFIG.SESSION_KEY);
      if (saved) {
        await _tryReconnect();
      }
    } finally {
      const overlay = document.getElementById('init-loading-overlay');
      if (overlay) overlay.remove();
    }
  });
}