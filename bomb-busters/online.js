/**
 * online.js — 联机模式通用模板
 *
 * 职责：房间管理、状态同步、重连
 * 依赖：net.js（Supabase 通信层）、game.js（本局游戏逻辑）
 *
 * ── 接入步骤 ──────────────────────────────────────────
 *  1. 复制 net.js 和本文件到项目，修改 NET_CONFIG
 *  2. 在 HTML 中按顺序加载：
 *     <script src="game.js"></script>
 *     <script src="render.js"></script>
 *     <script src="supabase.min.js"></script>
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
  SESSION_KEY: 'bomb-online',       // localStorage 键名，不同游戏用不同值
  GAME_TITLE: '炸弹克星',           // 游戏名称
  // 定时轮询节奏（毫秒）：兜住实时推送漏收（断线窗口/丢包/僵尸连接），
  // 对齐神探缉凶/fugitive 的在产方案——等候室 2.5s，对局中 5s 防各端僵等
  POLL_WAIT_MS: 2500,
  POLL_GAME_MS: 5000,
  // 状态新鲜度排序值（同一房间内单调不减）：用于判断"房间状态是否落后于我的最后一次推送"。
  // 炸弹克星用 S.turnNo（每次操作 +1，全局单调）；无 turnNo 的状态（等候室等）退化为推送时间戳。
  getOrderValue: (s) => (s && typeof s.turnNo === 'number') ? s.turnNo : ((s && s._ts) || 0),
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

// ── 移动端健壮性（iOS 切前后台会挂死 WebSocket、丢事件、丢请求） ──
let _channelStatus  = null;       // 最近一次频道订阅状态（SUBSCRIBED/CHANNEL_ERROR/...）
let _resubTimer     = null;       // 频道故障后的重订阅定时器
let _lastAppliedTs  = 0;          // 已应用的远端状态最大时间戳（拒绝乱序/重放的过期快照）
let _lastAppliedPushId = null;    // 已应用的远端状态 pushId（同一条状态重复投递去重）
let _lastPushPayload = null;      // 最近一次推送 { pushId, stateObj, status }（未确认时供补发）
let _lastPushVerified = false;    // 最近一次推送是否已确认到达服务端
let _resyncing      = false;      // 重同步进行中
let _lastResyncAt   = 0;          // 重同步限频
let _lastRecoverAt  = 0;          // 前台恢复重建频道限频
let _pollTimer      = null;       // 定时轮询定时器（僵尸连接兜底）
let _pollIntervalMs = 0;          // 当前轮询间隔（等候室/对局两种节奏）
let _pushInFlight   = false;      // 推送在途（串行化：防并发 UPDATE 竞速、旧快照后到覆盖）
let _pushQueued     = false;      // 在途期间又有推送请求：完成后以最新本地状态补发
let _pushStatus     = '';         // 粘性状态标记：开局等一次性 status 随排队补发送达，不因串行化丢失
let _lastWaitingSig = '';         // 等候室渲染签名（座位/选关未变则跳过重绘）

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
  if (_resubTimer) { clearTimeout(_resubTimer); _resubTimer = null; }
  _stopPolling();
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
  _channelStatus = null;
  _lastAppliedTs = 0;
  _lastAppliedPushId = null;
  _lastPushPayload = null;
  _lastPushVerified = false;
  _resyncing = false;
  _lastResyncAt = 0;
  _lastRecoverAt = 0;
  _pushInFlight = false;
  _pushQueued = false;
  _pushStatus = '';
  _lastWaitingSig = '';
  window._olDialogLock = false;
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
        <button class="start-btn" onclick="onJoinRoom()" style="background:var(--surface);border:2px solid var(--gold);color:var(--gold);">加入房间</button>
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
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(37,50,78,.4);';
    el.innerHTML = `<div style="background:var(--surface);padding:24px 36px;border-radius:14px;text-align:center;color:var(--text);font-size:1rem;border:2.5px solid var(--ink);box-shadow:0 3px 0 0 var(--ink);">
      <div style="width:32px;height:32px;border:3px solid #e4dac2;border-top-color:var(--gold);border-radius:50%;animation:ol-spin .7s linear infinite;margin:0 auto 12px;"></div>
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
    // join_room 返回的是加入后的权威快照（已包含自己）；
    // 不能再用旧 room.seats 本地拼接，否则并发加入时会渲染出错误成员列表
    _knownSeatCount = (room.seats || []).length;
    if (room.status === 'playing' && room.state) {
      // 加入时游戏已开始 → 直接进入
      _applyRemoteState(room.state);
      _gameStarted = true;
      _startPolling(ONLINE_CONFIG.POLL_GAME_MS);
      document.getElementById('online').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      if (typeof HOOK_render === 'function') HOOK_render();
    } else {
      renderWaitingRoom(room);
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
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _channelStatus = 'CONNECTING';

  _unsubscribe = netSubscribeRoom(roomId, (row) => {
    // 对局中成员离开 → 解散弹窗/提示；等候室离开只更新席位（与轮询共用同一套检测，漏收的实时行也能兜住）
    _syncSeatTracking(row);

    // 等候室阶段（内容未变不重绘，避免重置选关等交互）
    if (row.status === 'waiting' && row.seats) {
      _renderWaitingIfChanged(row);
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
  }, (status) => {
    _channelStatus = status;
    if (status === 'SUBSCRIBED') {
      // 首次订阅与断线重连都会到这里：断线期间的事件不会重放，
      // 因此每次订阅成功都补拉一次房间状态（幂等，由新鲜度守卫去重）
      _resyncRoom();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      _scheduleResubscribe();
    }
  });

  // 定时轮询兜底（幂等；所有进入房间的路径都经过本函数）
  _startPolling(_gameStarted ? ONLINE_CONFIG.POLL_GAME_MS : ONLINE_CONFIG.POLL_WAIT_MS);
}

/** 处理远程游戏状态更新
 *  @param {object} row - rooms 表行
 *  @param {boolean} [force] - 权威重同步（房间是数据源真相，跳过新鲜度过滤）
 */
function _handleRemoteState(row, force) {
  const curPlayer = row.state.currentPlayer;
  const localCur = typeof HOOK_getCurrentPlayer === 'function' ? HOOK_getCurrentPlayer() : undefined;
  const iAmAlreadyOperator = curPlayer === _mySeatIndex && localCur === _mySeatIndex;
  if (iAmAlreadyOperator) return;

  const remotePushId = row.state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;
  if (!force) {
    // 同一条状态重复投递（重订阅/重同步重复拉取）：跳过
    if (remotePushId && remotePushId === _lastAppliedPushId) return;
    // 过期快照防倒灌：Realtime 乱序投递/重连重放可能送来比本地旧的快照（留 3s 时钟偏差余量）
    const remoteTs = row.state._ts || 0;
    if (remoteTs && remoteTs < _lastAppliedTs - 3000) {
      console.log('[online] ignore stale state ts', remoteTs, '<', _lastAppliedTs - 3000);
      return;
    }
  }

  _isReceiving = true;
  _gameStarted = true;
  _startPolling(ONLINE_CONFIG.POLL_GAME_MS); // 进入对局：轮询切到游戏节奏（防各端僵等）
  // 只有当前不是"等待自己出牌"时才更新 pendingPushSeat，
  // 防止 Supabase Realtime 乱序投递旧状态覆盖正确值导致 isOutgoingActor 判定失败
  if (_pendingPushSeat !== _mySeatIndex) {
    _pendingPushSeat = row.state.currentPlayer;
  }

  // 从等候室切换到游戏界面
  if (document.getElementById('app').style.display === 'none') {
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  }

  _applyRemoteState(row.state);

  _isReceiving = false;
}

/** 处理远程游戏结束
 *  @param {boolean} [force] - 权威重同步时跳过过期/重复过滤
 */
function _handleRemoteFinished(row, force) {
  const remotePushId = row.state && row.state._pushId;
  if (remotePushId && _myPushedIds.has(remotePushId)) return;
  if (!force && row.state) {
    if (remotePushId && remotePushId === _lastAppliedPushId) return;
    const remoteTs = row.state._ts || 0;
    if (remoteTs && remoteTs < _lastAppliedTs - 3000) return;
  }

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
    }
  } else {
    // 房间已解散（房主解散 / 房主自己退出）
    _cleanupOnline();
    if (typeof HOOK_clearState === 'function') HOOK_clearState();
    document.getElementById('online').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    alert('房间已解散');
    if (typeof HOOK_showLanding === 'function') HOOK_showLanding();
  }
  _isReceiving = false;
}

/** 应用远程状态到本地 S */
function _applyRemoteState(state) {
  // 记录新鲜度标记：后续拒绝比它更旧的快照
  if (state) {
    if (state._pushId) _lastAppliedPushId = state._pushId;
    if (state._ts) _lastAppliedTs = Math.max(_lastAppliedTs, state._ts);
  }
  // 游戏应暴露全局 S 用于状态覆盖
  // 各游戏根据自身状态结构实现
  if (typeof window._applyOnlineState === 'function') {
    window._applyOnlineState(state);
  }
}

/* ============================================================
   断线恢复 / 重同步 / 丢失推送补发
   iOS 上切后台会挂起 WebSocket 与在途请求：事件断线期间不会重放、
   推送请求可能静默失败。恢复策略：
   1) 频道故障 → 自动重订阅；2) 订阅成功/回前台 → 主动补拉房间状态；
   3) 本地最后一次推送未确认时，按状态新鲜度判断是否补发。
   ============================================================ */

function _orderValue(state) {
  try {
    if (typeof ONLINE_CONFIG.getOrderValue === 'function') {
      return ONLINE_CONFIG.getOrderValue(state) || 0;
    }
  } catch (e) {}
  return (state && state._ts) || 0;
}

/** 拉取房间最新状态并应用；若本地有未确认推送且房间落后则先补发 */
async function _resyncRoom() {
  if (!_onlineRoomId || _resyncing) return;
  const now = Date.now();
  if (now - _lastResyncAt < 800) return; // 限频：多次触发只拉一次
  _resyncing = true;
  _lastResyncAt = now;
  try {
    const room = await netGetRoom(_onlineRoomId);
    if (!_onlineRoomId) return; // 拉取期间已退出房间
    _syncSeatTracking(room); // 漏收的成员离开也能兜住（仅对局中触发解散弹窗/提示）

    // 本地最后一次推送未被确认：判断是否需要补发
    if (_lastPushPayload && !_lastPushVerified && _gameStarted) {
      const my = _lastPushPayload;
      const roomState = room.state;
      const roomPushId = roomState && roomState._pushId;
      const startLost = my.status === 'playing' && room.status === 'waiting'; // 开局推送丢失
      if (roomPushId === my.pushId) {
        _lastPushVerified = true; // 其实已到达（响应丢失）
      } else if (startLost || _orderValue(roomState) < _orderValue(my.stateObj)) {
        // 房间落后于我的最后推送 → 补发（走串行化推送通道，避免与在途推送竞速）；
        // 补发后本地即最新，不能再应用刚拉到的旧快照（否则状态回卷）
        console.log('[online] resend unverified push', my.pushId);
        await _markPushAndSend(my.stateObj, my.status);
        return;
      } else {
        _lastPushVerified = true; // 已被更新的状态取代，视为已解决
      }
    }

    // 应用房间最新状态（权威来源，force 跳过新鲜度过滤）。
    // 与本地已应用状态相同则跳过：轮询周期性触发时不得重复渲染（会打断进行中的拖拽/动画）
    const roomPushId = room.state && room.state._pushId;
    if (roomPushId && roomPushId === _lastAppliedPushId) {
      // 载荷无变化；但成员端「返回房间」不改状态载荷（房间仍持有旧快照），需兜住界面切换
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

/** 频道进入错误/关闭状态：延迟重订阅（若已自行恢复则跳过） */
function _scheduleResubscribe() {
  if (_resubTimer || !_onlineRoomId) return;
  _resubTimer = setTimeout(() => {
    _resubTimer = null;
    if (!_onlineRoomId || _channelStatus === 'SUBSCRIBED') return;
    console.warn('[online] channel unhealthy, resubscribe');
    _subscribeToRoom(_onlineRoomId);
  }, 2000);
}

/** 回到前台/网络恢复：重建频道（iOS 后台会挂死 WebSocket，客户端自认 SUBSCRIBED 也不可靠）+ 重同步 */
function _recoverConnection() {
  if (!_onlineRoomId) return;
  const now = Date.now();
  if (now - _lastRecoverAt < 1500) return; // 限频：visibilitychange 可能连续触发
  _lastRecoverAt = now;
  _subscribeToRoom(_onlineRoomId);
  _resyncRoom();
}

/** 启动定时轮询（幂等，间隔变化时切换节奏）：WebSocket 可能静默死亡且自报 SUBSCRIBED、
 *  不触发任何事件，仅靠事件驱动的恢复会漏掉这种"僵尸连接"，轮询拉取房间状态作为最终兜底。 */
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
  // 不按 visibility 跳过（对齐神探缉凶/fugitive 的无条件轮询）：
  // 真后台时 iOS/Android 本就挂起页面定时器，浏览器天然节流；
  // 而 visibilityState 一旦滞留 hidden（WebKit 偶发）会让轮询永久停摆，
  // 只剩可见性变化事件能救——恰恰把唯一兜底通道也堵死了。
  if (!_gameStarted) {
    // 等候室：按内容签名重绘（未变化零副作用，不重置房主选关交互），同步席位并补漏收的离开/开局
    try {
      const room = await netGetRoom(_onlineRoomId);
      if (!_onlineRoomId || !room) return;
      if (room.status !== 'waiting') { _resyncRoom(); return; } // 开局/解散漏收 → 走统一重同步
      _syncSeatTracking(room);
      _renderWaitingIfChanged(room);
    } catch (e) { /* 网络抖动忽略，下个周期再试 */ }
    return;
  }
  _resyncRoom(); // 内部限频；状态无变化不会重复应用（见 _resyncRoom 的 _lastAppliedPushId 守卫），含未确认推送补发
}

/** 席位跟踪（实时与轮询共用）：仅对局中成员离开才弹解散弹窗/提示；
 *  等候室离开只更新席位计数（列表随签名变化重绘），不触发解散流程。 */
function _syncSeatTracking(row) {
  if (!Array.isArray(row.seats)) return;
  if (_gameStarted && row.status === 'playing'
      && row.seats.length < _knownSeatCount && _knownSeatCount > 0 && !_departedHandled) {
    _departedHandled = true;
    const players = typeof HOOK_getPlayers === 'function' ? HOOK_getPlayers() : [];
    const departedSeat = players.length > 0
      ? players.findIndex((_, i) =>
          i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
      : -1;
    const departedName = departedSeat >= 0 && players[departedSeat]
      ? players[departedSeat].name : '未知玩家';
    if (_isHost) {
      _showPlayerLeftDialog(departedName);
    } else {
      alert(departedName + ' 退出了房间，等待房主解散房间...');
    }
  }
  _knownSeatCount = row.seats.length;
}

/** 等候室内容签名：座位 + 选关；未变则跳过重绘（实时行与轮询共用） */
function _waitingSig(room) {
  const seats = (room.seats || []).map(s => s.seatIndex + ':' + s.name).join(',');
  const ch = room.state && room.state.pendingChallenge ? JSON.stringify(room.state.pendingChallenge) : '';
  return seats + '|' + ch;
}

/** 从对局界面切回等候室（房主/成员「返回房间」，实时/轮询/重同步共用；幂等） */
function _switchToWaitingView() {
  _gameStarted = false;
  _startPolling(ONLINE_CONFIG.POLL_WAIT_MS);
  _lastWaitingSig = '';            // 强制重绘等候室 DOM（旧界面可能残留）
  _departedHandled = false;
  // 本局推送流已结束：清掉未确认推送上下文，避免回前台重同步时把终局快照倒灌回房间
  _lastPushPayload = null;
  _lastPushVerified = true;
  _pendingPushSeat = null;
  _lastPushedCurrentSeat = null;
  const em = document.getElementById('endModal');
  if (em) em.classList.remove('show');
  const online = document.getElementById('online');
  online.style.display = 'flex';
  online.style.flexDirection = 'column';
  online.style.alignItems = 'center';
  online.style.minHeight = 'calc(100dvh - 24px)';
  online.style.padding = '28px';
  document.getElementById('app').style.display = 'none';
}

function _renderWaitingIfChanged(room) {
  // 对局中收到 waiting（房主/成员点了「返回房间」）：先切回等候室界面再按签名重绘。
  // 例外（两种情况都必须保持对局界面，否则会被踢出对局）：
  //  1. 开局中间态——dealGame 的先行动画推送会带着旧 status='waiting' 短暂落地（随后 'playing' 更新才到）；
  //  2. 开局瞬间的迟到旧行（加入房间的实时回显 / 开局前发出的轮询响应）——载荷无对局状态。
  // 「返回房间」只可能发生在结算后，因此仅当本地已到 'over' 才允许切出对局界面。
  const rs = room.state;
  const midStart = !!rs && (rs.phase === 'mark' || rs.phase === 'play');
  if (_gameStarted && !midStart) {
    const st = typeof window._getOnlineState === 'function' ? window._getOnlineState() : null;
    if (st && st.phase === 'over') _switchToWaitingView();
  }
  if (_gameStarted) return;   // 对局中（含开局中间态/迟到旧行）：不渲染等候室
  const sig = _waitingSig(room);
  if (sig === _lastWaitingSig) return;
  _lastWaitingSig = sig;
  renderWaitingRoom(room);
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
    _startPolling(ONLINE_CONFIG.POLL_GAME_MS);
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

  // 操作者判定；#10 自由剪线没有唯一行动者，任一端都可推送（由时间戳/推送 ID 去重）
  const isFreeCut = !!(state && state.freeCut);
  const isCurrentActor = state && state.currentPlayer === _mySeatIndex;
  const isOutgoingActor = _pendingPushSeat === _mySeatIndex;
  const turnJustHandedOff =
    _lastPushedCurrentSeat !== null
    && _lastPushedCurrentSeat !== state.currentPlayer
    && _lastPushedCurrentSeat === _mySeatIndex;
  const canPush = isFreeCut || isCurrentActor || isOutgoingActor || turnJustHandedOff;
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
  // 串行化（对齐神探缉凶）：并发 UPDATE 会竞速，旧快照后到会覆盖对方刚应用的新进度；
  // 在途时只记标记，完成后用最新本地状态补发
  if (status) _pushStatus = status; // 粘性：开局推送常被 dealGame 的 saveState 推送挡在队列外，status 必须随补发一起送达
  if (_pushInFlight) { _pushQueued = true; return true; }
  _pushInFlight = true;
  try {
    _myPushSeq++;
    const ts = Date.now();
    // 含时间戳：刷新重连后 _myPushSeq 会重置，仅靠 座位-序号 会与刷新前的推送 ID 撞车
    const pushId = _mySeatIndex + '-' + ts.toString(36) + '-' + _myPushSeq;
    // 深拷贝快照：重试/补发期间本地状态可能继续变化，不能污染在途请求
    const snapshot = JSON.parse(JSON.stringify(stateObj));
    snapshot._pushId = pushId;
    snapshot._src = _mySeatIndex;
    snapshot._ts = ts;
    _myPushedIds.add(pushId);
    _lastAppliedTs = Math.max(_lastAppliedTs, ts);
    _lastPushedCurrentSeat = typeof snapshot.currentPlayer === 'number'
      ? snapshot.currentPlayer : null;
    // 记录本次推送，供"回前台重同步"时检测未到达并补发
    _lastPushPayload = { pushId, stateObj: snapshot, status: _pushStatus };
    _lastPushVerified = false;
    const ok = await netUpdateGameState(_onlineRoomId, snapshot, _pushStatus);
    if (ok && _lastPushPayload && _lastPushPayload.pushId === pushId) {
      _lastPushVerified = true;
    }
    return ok;
  } finally {
    _pushInFlight = false;
    if (_pushQueued) {
      _pushQueued = false;
      if (_onlineRoomId) {
        // 补发在途期间产生的最新本地状态；直接复用推送通道（不经过行动者判定），携带粘性状态
        const latest = (typeof window._getOnlineState === 'function' && window._getOnlineState()) || stateObj;
        _markPushAndSend(latest, _pushStatus);
      }
    }
  }
}

/**
 * 联机模式下判断当前客户端是否为"有效行动者"：
 * 仅当前回合玩家本人可操作（成员离开后房主只能解散房间，不代操作）。
 * 游戏方在关键操作守卫中调用此函数（单机时不存在该函数，守卫自动跳过）。
 */
window._olIsActor = function() {
  if (!_onlineRoomId) return true;
  const state = window._getOnlineState();
  if (state && state.freeCut) return true;   // #10：自由剪线，具体资格由游戏层判定
  return !!state && state.currentPlayer === _mySeatIndex;
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

/**
 * 结算后「返回房间」（房主/成员均可）：房间回到等候室，各端切回并支持新玩家加入。
 * 仅结算阶段可用；对局中途离开请走「退出房间」。
 * 房主重置状态载荷（旧对局快照不再载入，保留选关）；成员只改房间状态，不动载荷。
 */
window._olReturnToWaiting = async function() {
  if (!_onlineRoomId) return false;
  const state = typeof window._getOnlineState === 'function' ? window._getOnlineState() : null;
  if (!state || state.phase !== 'over') return false;
  _showNetLoading('正在返回房间…');
  // 主动结束本局推送流：清未确认上下文（防终局快照被重同步补发倒灌），
  // 并等待在途推送落地，避免其携带旧状态与「返回房间」的房间更新竞速
  _lastPushPayload = null;
  _lastPushVerified = true;
  const t0 = Date.now();
  while (_pushInFlight && Date.now() - t0 < 1500) {
    await new Promise(r => setTimeout(r, 60));
  }
  try {
    let ok;
    if (_isHost) {
      const ch = window._olPendingChallenge || null;
      ok = await netUpdateGameState(_onlineRoomId, ch ? { pendingChallenge: ch } : null, 'waiting');
    } else {
      ok = await netSetRoomStatus(_onlineRoomId, 'waiting');
    }
    if (!ok) {
      showToast('返回房间失败，请重试');
      return false;
    }
    _switchToWaitingView();
    const room = await netGetRoom(_onlineRoomId);
    if (!_onlineRoomId || !room) return true;
    _knownSeatCount = (room.seats || []).length;
    _renderWaitingIfChanged(room);
    return true;
  } catch (e) {
    console.warn('[online] return to waiting failed:', e);
    showToast('返回房间失败，请重试');
    return false;
  } finally {
    _hideNetLoading();
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
    .online-waiting .action-btn,
    .online-waiting .card {
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

  // 游戏方应实现 onlineUpdateDiceAreaUI() 来更新行动区域
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

function _showPlayerLeftDialog(name) {
  // 本弹窗只能「解散房间」：锁定背景点击，防止被误关后对局无人可操作
  window._olDialogLock = true;
  const content = `
    <h2>⚠️ 玩家离开</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">
      <strong style="color:var(--danger)">${_esc(name)}</strong> 退出了房间
    </p>
    <p style="text-align:center;font-size:.85rem;color:var(--text-dim);margin-bottom:16px;">
      本局无法继续，只能解散房间
    </p>
    <button class="btn-full btn-danger" onclick="_onDissolveAfterDeparture()">
      解散房间<br><span style="font-size:.75rem;opacity:.7">关闭房间，所有人回到首页</span>
    </button>`;
  const modal = document.getElementById('modalOverlay');
  const contentDiv = document.getElementById('modalContent');
  contentDiv.innerHTML = content;
  modal.classList.add('show');
}

function _onDissolveAfterDeparture() {
  const modal = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('show');
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
    _lastAppliedTs = 0;
    _lastAppliedPushId = null;
    _lastPushPayload = null;
    _lastPushVerified = false;
    _pushInFlight = false;
    _pushQueued = false;
    _lastWaitingSig = '';
    if (_resubTimer) { clearTimeout(_resubTimer); _resubTimer = null; }
    _resyncing = false;
    _lastResyncAt = 0;
    _lastRecoverAt = 0;
    _subscribeToRoom(saved.roomId);

    if (room.status === 'playing' && room.state) {
      // 游戏进行中：直接恢复对局
      _gameStarted = true;
      _startPolling(ONLINE_CONFIG.POLL_GAME_MS);
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
 *   updateDiceAreaUI()    - 更新行动区域 UI（观战模式）
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

  // 移动端生命周期恢复：iOS 切后台会挂起 WebSocket，且断线期间的事件不会重放，
  // 回前台 / 网络恢复 / bfcache 恢复时统一重建频道并重拉状态
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return;
    _recoverConnection();
  });
  window.addEventListener('online', () => _recoverConnection());
  window.addEventListener('pageshow', (e) => { if (e.persisted) _recoverConnection(); });

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