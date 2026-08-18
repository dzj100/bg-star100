/**
 * online.js - 月面探险联机模式
 * 依赖: game.js（全局 S、函数）、render.js、net.js（Supabase 通信）
 * 通过拦截 saveState / render 实现联机同步
 */

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
let _rescueSheetShown = false;

const ONLINE_SESSION_KEY = 'moon-adv-online';

function _saveSession() {
  if (_onlineRoomId) {
    try {
      localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify({
        roomId: _onlineRoomId, seatIndex: _mySeatIndex,
        isHost: _isHost, playerName: _myPlayerName,
      }));
    } catch (e) {}
  }
}

function _clearSession() {
  try { localStorage.removeItem(ONLINE_SESSION_KEY); } catch (e) {}
}

/* ============================================================
   页面导航
   ============================================================ */

function showOnlineLobby() {
  document.getElementById('online').style.display = 'flex';
  document.getElementById('online').style.flexDirection = 'column';
  document.getElementById('online').style.alignItems = 'center';
  document.getElementById('online').style.minHeight = 'calc(100dvh - 24px)';
  document.getElementById('online').style.padding = '28px 12px';
  document.getElementById('app').style.display = 'none';
  document.getElementById('online').style.maxWidth = '480px';
  document.getElementById('online').style.margin = 'auto';
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
  showLanding();
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
  _rescueSheetShown = false;
  _clearSession();
}

/* ============================================================
   大厅 UI
   ============================================================ */

function renderOnlineLobby() {
  document.getElementById('online').innerHTML = `
    <div class="setup-header" style="width:100%;padding:0 16px;">
      <h1>🌕 联机模式</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 返回</button>
    </div>
    <div style="width:100%;max-width:280px;margin:0 auto;">
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
      S = room.state;
      initUidCounter();
      S.phase = 'playing';
      _gameStarted = true;
      document.getElementById('online').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      render();
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
  const seats = room.seats || [];
  const seatsHTML = seats.map(s =>
    `<div class="setup-chip" style="margin-bottom:8px;width:100%;justify-content:space-between;padding:10px 14px;">
      <span><span class="setup-dot" style="background:${PLAYER_COLORS[s.seatIndex]}"></span> ${_esc(s.name)}</span>
      <span style="font-size:.7em;color:var(--text-dim)">${s.seatIndex === 0 ? '房主' : '座位 ' + (s.seatIndex + 1)}</span>
    </div>`
  ).join('');

  const useExt = !!(room.state && room.state.useExtension);
  const extHTML = _isHost
    ? `<label class="setup-ext" style="margin:12px 0;justify-content:center;width:auto;">
        <input type="checkbox" ${useExt ? 'checked' : ''} onchange="onlineSetExtension(this.checked)">
        <span class="setup-ext-mark" style="display:none;">🌙</span> 使用扩展角色
      </label>`
    : `<label class="setup-ext" style="margin:12px 0;justify-content:center;width:auto;opacity:.6;cursor:default;">
        <input type="checkbox" ${useExt ? 'checked' : ''} disabled>
        <span class="setup-ext-mark" style="display:none;">🌙</span> 使用扩展角色
      </label>`;

  const canStart = _isHost && seats.length >= 2;
  const startBtnHTML = _isHost
    ? `<button class="start-btn" onclick="startOnlineGame()"
         ${canStart ? '' : 'disabled'} style="margin-top:8px;">开始游戏 (${seats.length}/5人)</button>`
    : `<div style="text-align:center;color:var(--text-dim);padding:16px;margin-top:8px;">
         等待房主开始游戏...
       </div>`;

  document.getElementById('online').innerHTML = `
    <div class="setup-header" style="width:100%;max-width:320px;">
      <h1>房间 ${_onlineRoomId}</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 退出</button>
    </div>
    <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px;text-align:center;">
      分享房间号给朋友加入
    </p>
    <div style="width:100%;max-width:320px;margin:0 auto;">
      <div style="text-align:center;font-size:2rem;letter-spacing:.4em;
                  color:var(--gold);font-weight:bold;margin-bottom:20px;">
        ${_onlineRoomId}
      </div>
      ${seatsHTML}
      ${extHTML}
      <div style="text-align:center;">${startBtnHTML}</div>
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
      const departedSeat = S && S.players
        ? S.players.findIndex((_, i) =>
            i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
        : -1;
      const departedName = departedSeat >= 0 && S
        ? S.players[departedSeat].name : '未知玩家';
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
      const remotePushId = row.state && row.state._pushId;
      if (remotePushId && _myPushedIds.has(remotePushId)) return;

      _isReceiving = true;
      if (row.state) {
        const alreadyOver = S && S.gameOver;
        S = row.state;
        initUidCounter();
        S.phase = 'playing';
        if (S.gameOver && !alreadyOver) {
          if (document.getElementById('app').style.display === 'none') {
            document.getElementById('online').style.display = 'none';
            document.getElementById('app').style.display = 'block';
          }
          render();
          showEndModal();
          _patchEndModalBtn();
        }
      } else {
        _cleanupOnline();
        clearState();
        S = {
          phase: 'landing', playerCount: 0, players: [],
          drawPile: [], discardPile: [], stormReserve: 0,
          currentPlayer: 0, ap: 0, turnPhase: 'idle',
          dice: [], diceTotal: 0,
          tiles: [], path: [], ogsCount: 0,
          roverPos: -1, roverUsed: false, robotPos: -1, hasEngineer: false, robotMoved: false,
          accelMarks: [], accelPlacedThisTurn: false,
          drawnThisTurn: [], isDrawing: false, isRescue: false, rescueDebt: false,
          log: [], shareState: null, rescueState: null, gameOver: false, gameResult: null,
        };
        document.getElementById('online').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        document.getElementById('gameover-overlay') && document.getElementById('gameover-overlay').classList.remove('show');
        alert('房主已离开，房间已解散');
        showLanding();
      }
      _isReceiving = false;
      return;
    }

    // 游戏阶段
    if (row.status === 'playing' && row.state) {
      const curPlayer = row.state.currentPlayer;
      const departed = row.state.departedPlayers || [];
      const iTakeover = _isHost && departed.includes(curPlayer)
        && (row.state._src === _mySeatIndex);
      const localCur = S && S.currentPlayer;
      const iAmAlreadyOperator = curPlayer === _mySeatIndex && localCur === _mySeatIndex;
      if (iAmAlreadyOperator || iTakeover) return;

      const remotePushId = row.state._pushId;
      if (remotePushId && _myPushedIds.has(remotePushId)) return;

      _isReceiving = true;

      const newState = row.state;
      const changed = JSON.stringify(S) !== JSON.stringify(newState);
      const alreadyOver = S && S.gameOver;
      const oldStorm = S && S.stormEvent;

      _gameStarted = true;
      _pendingPushSeat = newState.currentPlayer;

      S = newState;
      initUidCounter();
      S.phase = 'playing';

      if (changed) {
        if (document.getElementById('app').style.display === 'none') {
          document.getElementById('online').style.display = 'none';
          document.getElementById('app').style.display = 'block';
        }
        render();
        // 收到 gameOver 状态：补弹结算弹窗（触发方已在本机弹过）
        if (S.gameOver && !alreadyOver) {
          showEndModal();
          _patchEndModalBtn();
        }
      }
      // 收到新的磁暴事件：非触发方补弹磁暴弹窗（seq增大才弹，避免重复）
      const newStorm = S.stormEvent;
      if (newStorm && (!oldStorm || newStorm.seq > oldStorm.seq)) {
        showStormModal(newStorm.name);
      }
      _isReceiving = false;
    }
  });
}

/* ============================================================
   扩展角色开关（仅房主）
   ============================================================ */

async function onlineSetExtension(checked) {
  if (!_isHost) return;
  try {
    await netUpdateGameState(_onlineRoomId, { useExtension: !!checked }, 'waiting');
  } catch (e) {
    console.error('[online] setExtension error:', e);
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
    const useExt = !!(room.state && room.state.useExtension);
    dealGame(names, useExt);
    S.phase = 'playing';
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    render();
    await _markPushAndSend(S, 'playing');
  } catch (e) {
    alert('开始游戏失败: ' + e.message);
  } finally {
    _hideNetLoading();
  }
}

/* ============================================================
   游戏集成：拦截 saveState → 推送到 Supabase
   ============================================================ */

const _originalSaveState = window.saveState;

window.saveState = function() {
  _originalSaveState();
  if (!_onlineRoomId || _isReceiving || !_gameStarted) return;

  if (S && S.gameOver) return;

  // 操作者判定
  const hasDeparted = _isHost && S && S.departedPlayers && S.departedPlayers.length > 0;
  const isCurrentActor = S && S.currentPlayer === _mySeatIndex;
  const isOutgoingActor = _pendingPushSeat === _mySeatIndex;
  const turnJustHandedOff =
    _lastPushedCurrentSeat !== null
    && _lastPushedCurrentSeat !== (S && S.currentPlayer)
    && _lastPushedCurrentSeat === _mySeatIndex;
  const canPush = isCurrentActor || isOutgoingActor || turnJustHandedOff || hasDeparted;
  if (!canPush) {
    if (S && typeof S.currentPlayer === 'number') {
      _pendingPushSeat = S.currentPlayer;
    }
    return;
  }

  const stateSnapshot = JSON.parse(JSON.stringify(S));
  _markPushAndSend(stateSnapshot);

  if (isCurrentActor) {
    _pendingPushSeat = _mySeatIndex;
  } else if (isOutgoingActor) {
    _pendingPushSeat = null;
  }
};

function _markPushAndSend(stateObj, status) {
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
 * 供 game.js 的救援面板/操作守卫调用（单机时不存在该函数，守卫自动跳过）。
 */
window._olIsActor = function() {
  if (!_onlineRoomId) return true;
  if (!S || typeof S.currentPlayer !== 'number') return false;
  if (S.currentPlayer === _mySeatIndex) return true;
  const departed = S.departedPlayers || [];
  return _isHost && departed.includes(S.currentPlayer);
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
    .online-waiting #moreBtn.act-btn {
      pointer-events: auto !important;
    }
    .online-waiting h3 {
      color: var(--text-dim);
    }
    /* 观战方共享抽屉：只读展示，禁止点击 */
    .sheet-readonly .sheet-card,
    .sheet-readonly .sheet-cancel,
    .sheet-readonly .sheet-confirm {
      pointer-events: none !important;
      opacity: 0.6 !important;
    }
  `;
  document.head.appendChild(style);
}

const _originalRender = window.render;

window.render = function() {
  _originalRender();
  if (!_onlineRoomId || !S || S.phase !== 'playing') return;

  // 同步处理：render 后 DOM 已更新，立即禁用交互，避免观战方闪帧看到可点击按钮
  const app = document.getElementById('app');
  if (!app) return;

  // 游戏头部添加退出按钮
  const headerBtns = app.querySelector('.game-header > div');
  if (headerBtns && !document.getElementById('exitRoomBtn')) {
    const resetBtn = headerBtns.querySelector('button[onclick*="resetGame"]');
    if (resetBtn) resetBtn.style.display = 'none';
    const btn = document.createElement('button');
    btn.id = 'exitRoomBtn';
    btn.textContent = '🚪 退出';
    btn.className = 'icon-btn';
    btn.onclick = exitOnlineRoom;
    headerBtns.appendChild(btn);
  }

  if (S.gameOver) return;

  const diceArea = app.querySelector('.dice-area');
  if (!diceArea) return;

  const isMyTurn = S.currentPlayer === _mySeatIndex;
  const departed = S.departedPlayers || [];
  const isDepartedTurn = departed.includes(S.currentPlayer);
  const isTakeover = isDepartedTurn && _isHost;
  const currentPlayer = S.players[S.currentPlayer];

  // 紧急救援：轮到自己（或被接管玩家）且氧气耗尽时，在行动方客户端自动弹出救援面板。
  // _rescueSheetShown 防重入：showRescueSelect 内部会再调 render()，避免递归
  const needsRescue = S.turnPhase === 'idle' && !S.isRescue
    && currentPlayer && currentPlayer.oxygen.length === 0
    && (isMyTurn || isTakeover);
  if (needsRescue) {
    if (!_rescueSheetShown) {
      _rescueSheetShown = true;
      showRescueSelect();
    }
  } else {
    _rescueSheetShown = false;
  }

  // 房主接管已离开玩家
  if (isTakeover) {
    diceArea.classList.remove('online-waiting');
    let banner = app.querySelector('.takeover-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'takeover-banner';
      banner.style.cssText = 'background:rgba(245,197,24,.12);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:.8em;text-align:center;color:var(--gold);';
      diceArea.parentNode.insertBefore(banner, diceArea);
    }
    banner.innerHTML = `🎮 房主正在接管 <strong>${_esc(currentPlayer ? currentPlayer.name : '')}</strong> 的回合`;
    return;
  }

  // 清理接管横幅
  const oldBanner = app.querySelector('.takeover-banner');
  if (oldBanner) oldBanner.remove();

  if (!isMyTurn) {
    // 非自己回合：保持原始界面，但所有交互禁用，h3 显示观战提示
    diceArea.classList.add('online-waiting');
    const h3 = diceArea.querySelector('h3');
    if (h3) {
      h3.innerHTML = '👀 观战 ' + h3.innerHTML;
    }
  } else {
    // 自己的回合
    diceArea.classList.remove('online-waiting');
  }

  // 共享进行中：观战方同步展示只读抽屉，操作方保持可交互
  const sheetEl = document.getElementById('actionSheet');
  if (sheetEl) {
    if (S.shareState) {
      renderShareSheet(S.shareState.fromIdx, S.shareState.toIdx);
      openSheet();
      sheetEl.classList.toggle('sheet-readonly', !isMyTurn);
    } else if (!isMyTurn && sheetEl.classList.contains('show')) {
      // 观战方：共享结束（确认/取消）自动关闭抽屉
      sheetEl.classList.remove('show');
      sheetEl.classList.remove('sheet-readonly');
    }
  }
};

/* ============================================================
   游戏集成：拦截地图点击（非自己回合无响应）
   ============================================================ */

const _originalOnTileClick = window.onTileClick;

window.onTileClick = function(tileIdx) {
  if (_onlineRoomId && S.currentPlayer !== _mySeatIndex) return;
  if (typeof _originalOnTileClick === 'function') {
    _originalOnTileClick(tileIdx);
  }
};

const _originalOnDiscardedClick = window.onDiscardedClick;

window.onDiscardedClick = function(pathIdx) {
  if (_onlineRoomId && S.currentPlayer !== _mySeatIndex) return;
  if (typeof _originalOnDiscardedClick === 'function') {
    _originalOnDiscardedClick(pathIdx);
  }
};

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
  _cleanupOnline();
  clearState();
  S = {
    phase: 'landing', playerCount: 0, players: [],
    drawPile: [], discardPile: [], stormReserve: 0,
    currentPlayer: 0, ap: 0, turnPhase: 'idle',
    dice: [], diceTotal: 0,
    tiles: [], path: [], ogsCount: 0,
    roverPos: -1, roverUsed: false, robotPos: -1, hasEngineer: false, robotMoved: false,
    accelMarks: [], accelPlacedThisTurn: false,
    drawnThisTurn: [], isDrawing: false, isRescue: false, rescueDebt: false,
    log: [], shareState: null, rescueState: null, gameOver: false, gameResult: null,
  };
  document.getElementById('gameover-overlay') && document.getElementById('gameover-overlay').classList.remove('show');
  document.getElementById('online').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (roomId && seatIndex !== null) {
    if (wasHost) {
      netUpdateGameState(roomId, null, 'finished');
    } else {
      netLeaveRoom(roomId, seatIndex);
    }
  }
  showLanding();
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
  if (seat === null || !S) return;

  S.departedPlayers = S.departedPlayers || [];
  if (!S.departedPlayers.includes(seat)) {
    S.departedPlayers.push(seat);
  }
  addLog(_esc(S.players[seat] ? S.players[seat].name : '') + ' 离开了房间，房主接管操作');

  _isReceiving = false;
  _markPushAndSend(S);
  render();
}

function _onResetAfterDeparture() {
  const modal = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('show');
  _pendingDepartedSeat = null;
  _isReceiving = false;
  netUpdateGameState(_onlineRoomId, null, 'finished');
  _cleanupOnline();
  clearState();
  S = {
    phase: 'landing', playerCount: 0, players: [],
    drawPile: [], discardPile: [], stormReserve: 0,
    currentPlayer: 0, ap: 0, turnPhase: 'idle',
    dice: [], diceTotal: 0,
    tiles: [], path: [], ogsCount: 0,
    roverPos: -1, roverUsed: false, robotPos: -1, hasEngineer: false, robotMoved: false,
    accelMarks: [], accelPlacedThisTurn: false,
    drawnThisTurn: [], isDrawing: false, isRescue: false, rescueDebt: false,
    log: [], shareState: null, rescueState: null, gameOver: false, gameResult: null,
  };
  document.getElementById('online').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  showLanding();
}

/* ============================================================
   游戏结束处理
   ============================================================ */

const _originalEndGame = window.endGame;

window.endGame = function(forcedLose) {
  _originalEndGame(forcedLose);
  if (!_onlineRoomId) return;

  // 推送最终状态并标记房间为 finished
  _markPushAndSend(S);
  netUpdateGameState(_onlineRoomId, S, 'finished');

  // 联机模式下：结算弹窗按钮改为"退出房间"
  _patchEndModalBtn();
};

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
    const saved = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY));
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
      S = room.state;
      initUidCounter();
      S.phase = 'playing';
      document.getElementById('online').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      render();
      // 重连后补弹最近的磁暴弹窗
      if (S.stormEvent) {
        showStormModal(S.stormEvent.name);
      }
    } else {
      // 等候室：恢复房间界面，等待房主开始
      _gameStarted = false;
      document.getElementById('online').style.display = 'flex';
      document.getElementById('online').style.flexDirection = 'column';
      document.getElementById('online').style.alignItems = 'center';
      document.getElementById('online').style.minHeight = 'calc(100dvh - 24px)';
      document.getElementById('online').style.padding = '28px 12px';
      document.getElementById('online').style.maxWidth = '480px';
      document.getElementById('online').style.margin = 'auto';
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
   覆盖着陆页渲染
   ============================================================ */

const _originalRenderLanding = window.renderLanding;

window.renderLanding = function() {
  return `
    <div class="landing">
      <div class="rules-corner"><button onclick="showRules()">📖 规则</button></div>
      <span class="moon-icon">🌕️</span>
      <h1>月面探险</h1>
      <p class="subtitle">2~5人 · 合作角色扮演</p>
      <button class="start-btn" onclick="showSetup()" style="display:none;">🚀 开始游戏</button>
      <button class="start-btn" onclick="showOnlineLobby()" style="background:var(--surface);border:2px solid var(--gold);color:var(--gold);margin-top:12px;">🌐 联机模式</button>
      <div class="credit">@imStar100</div>
    </div>`;
};

/* ============================================================
   启动
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  // 联机模式不加载单机存档，重置为初始状态
  clearState();
  S = {
    phase: 'landing', playerCount: 0, players: [],
    drawPile: [], discardPile: [], stormReserve: 0,
    currentPlayer: 0, ap: 0, turnPhase: 'idle',
    dice: [], diceTotal: 0,
    tiles: [], path: [], ogsCount: 0,
    roverPos: -1, roverUsed: false, robotPos: -1, hasEngineer: false, robotMoved: false,
    accelMarks: [], accelPlacedThisTurn: false,
    drawnThisTurn: [], isDrawing: false, isRescue: false, rescueDebt: false,
    log: [], shareState: null, rescueState: null, gameOver: false, gameResult: null,
  };
  render();

  try {
    const saved = localStorage.getItem(ONLINE_SESSION_KEY);
    if (saved) {
      await _tryReconnect();
    }
  } finally {
    const overlay = document.getElementById('init-loading-overlay');
    if (overlay) overlay.remove();
  }
});