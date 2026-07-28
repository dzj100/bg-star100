/**
 * online.js - 联机大厅 UI + 游戏集成
 * 依赖: game.js（全局函数）、net.js（Supabase 通信）
 * 不修改 game.js，通过拦截 saveState / renderGame 实现联机同步
 */

/* ============================================================
   联机状态（模块级变量）
   ============================================================ */

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

let _onlineRoomId  = null;   // 当前房间号
let _mySeatIndex   = null;   // 我的座位索引
let _myPlayerName  = null;   // 我的玩家名
let _isHost        = false;  // 是否为房主
let _unsubscribe   = null;   // Realtime 取消订阅函数
let _isReceiving   = false;  // 正在接收远端更新（防止 saveState 回推）
let _knownSeatCount  = 0;    // 上次已知的座位数（用于检测成员离开）
let _departedHandled = false; // 当前离开事件是否已处理
let _myBossAnimVersion = 0;   // 本地已播放的 Boss 动画阶段版本号，用于抑制 Realtime 动画回声

// Realtime 回声识别：每次推送生成唯一 pushId = "{座位号}-{本座位自增序号}"，
// 把自己推过的 pushId 记入 _myPushedIds。接收时若 pushId 属于自己的集合（含 host 转发），视为回声跳过。
let _myPushSeq  = 0;           // 本座位的推送序号（单调递增）
let _myPushedIds = new Set();  // 本客户端推过的 pushId 集合

// 推送权传递：nextTurn 后 currentPlayerIndex 已切到下一家，但原操作者仍需要把"切回合"这一次状态推出去。
// 用 _pendingPushSeat 记住上一次的操作座位，让它在紧随其后的那次 saveState 里仍可推送。
let _pendingPushSeat = null;

// Boss 动画防重复播放
let _prevBossAnimState = null;  // 上一次渲染时的 bossAnim 值
let _bossAnimVersion = 0;       // 本地观察到的 bossAnim 状态机版本
let _bossAnimRendered = false;  // 当前版本的动画是否已渲染过一次

const ONLINE_SESSION_KEY = 'regicide-online';

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
  document.getElementById('landing').style.display  = 'none';
  document.getElementById('setup').style.display    = 'none';
  document.getElementById('game').style.display     = 'none';
  document.getElementById('online').style.display   = 'flex';
  renderOnlineLobby();
}

async function onlineBackToLanding() {
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  _cleanupOnline();
  document.getElementById('online').style.display = 'none';
  // 通知 Supabase 移除自己
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
  _isHost       = false;
  _knownSeatCount = 0;
  _departedHandled = false;
  _myBossAnimVersion = 0;
  _prevBossAnimState = null;
  _bossAnimVersion = 0;
  _bossAnimRendered = false;
  _myPushSeq = 0;
  _myPushedIds = new Set();
  _pendingPushSeat = null;
  _clearSession();
}

/* ============================================================
   大厅 UI
   ============================================================ */

function renderOnlineLobby() {
  document.getElementById('online').innerHTML = `
    <div class="setup-header">
      <h1>⚔️ 联机模式</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 返回</button>
    </div>
    <div style="width:100%;max-width:320px;margin:0 auto;">
      <div style="margin-bottom:20px;">
        <button class="start-game-btn" onclick="onCreateRoom()" style="margin-bottom:12px;">创建房间</button>
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
        <button class="start-game-btn" onclick="onJoinRoom()" style="background:transparent;border:2px solid var(--gold);color:var(--gold);">加入房间</button>
      </div>
    </div>`;
}

/* ============================================================
   网络请求 Loading 遮罩
   ============================================================ */

function _showNetLoading(text) {
  let el = document.getElementById('net-loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'net-loading-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);';
    el.innerHTML = `<div style="background:#1a1a24;padding:24px 36px;border-radius:12px;text-align:center;color:#e8e6e3;font-size:1rem;">
      <div style="width:32px;height:32px;border:3px solid #444;border-top-color:#d4a843;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px;"></div>
      <span id="net-loading-text"></span>
    </div>`;
    const style = document.createElement('style');
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
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
    _saveSession();
    _departedHandled = false;
    _subscribeToRoom(roomId);
    // room.seats 是加入前的快照，需要手动追加自己
    const seats = [...(room.seats || []), { name, joinedAt: new Date().toISOString(), seatIndex }];
    _knownSeatCount = seats.length;
    if (room.status === 'playing' && room.state) {
      state = room.state;
      document.getElementById('online').style.display = 'none';
      showGame();
    } else {
      renderWaitingRoom({ seats });
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
    `<div class="player-input" style="margin-bottom:8px;">
       <label>座位 ${s.seatIndex + 1}</label>
       <input type="text" value="${_esc(s.name)}${s.seatIndex === 0 ? ' (房主)' : ''}" readonly
         style="background:var(--surface);color:var(--text);border:1px solid #2a2a32;
                border-radius:6px;padding:8px;width:100%;">
     </div>`
  ).join('');

  const canStart = _isHost && seats.length >= 2;
  const startBtnHTML = _isHost
    ? `<button class="start-game-btn" onclick="startOnlineGame()"
         ${canStart ? '' : 'disabled'}>开始游戏 (${seats.length}/4人)</button>`
    : `<div style="text-align:center;color:var(--text-dim);padding:16px;">
         等待房主开始游戏...
       </div>`;

  document.getElementById('online').innerHTML = `
    <div class="setup-header">
      <h1>房间 ${_onlineRoomId}</h1>
      <button class="back-btn" onclick="onlineBackToLanding()">✕ 退出</button>
    </div>
    <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px;">
      分享房间号给朋友加入
    </p>
    <div style="width:100%;max-width:320px;margin:0 auto;">
      <div style="text-align:center;font-size:2rem;letter-spacing:.4em;
                  color:var(--gold);font-weight:bold;margin-bottom:20px;">
        ${_onlineRoomId}
      </div>
      ${seatsHTML}
      <div style="margin-top:16px;">${startBtnHTML}</div>
    </div>`;
}

/* ============================================================
   Realtime 订阅
   ============================================================ */

function _subscribeToRoom(roomId) {
  if (_unsubscribe) _unsubscribe();

  _unsubscribe = netSubscribeRoom(roomId, (row) => {
    console.log('[RECV] my=', _mySeatIndex, 'host=', _isHost,
      'status=', row.status,
      'cur=', row.state && row.state.currentPlayerIndex,
      'sub=', row.state && row.state.subPhase,
      'pushId=', row.state && row.state._pushId,
      'src=', row.state && row.state._src,
      'seats=', row.seats && row.seats.length);

    // 检测成员离开（座位数减少）：独立于 state/status 判断，只要有 seats 就检测
    // （netLeaveRoom 只更新 seats 时，row.state 可能为 null，不能依赖 playing && state 分支）
    if (Array.isArray(row.seats) && row.seats.length < _knownSeatCount && _knownSeatCount > 0 && !_departedHandled) {
      _departedHandled = true;
      const departedSeat = state
        ? state.players.findIndex((_, i) =>
            i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
        : -1;
      const departedName = departedSeat >= 0 && state
        ? state.players[departedSeat].name : '未知玩家';
      console.log('[DEPART] fired! departedSeat=', departedSeat, 'name=', departedName,
        'host=', _isHost);
      if (_isHost) {
        _showPlayerLeftDialog(departedName, departedSeat);
      } else {
        alert(_esc(departedName) + ' 退出了房间，等待房主处理...');
      }
      _knownSeatCount = row.seats.length;
    }

    // 等候室阶段：座位变化 → 刷新大厅
    if (row.status === 'waiting' && row.seats) {
      renderWaitingRoom(row);
      return;
    }

    // 游戏阶段：state 变化 → 同步本地
    if (row.status === 'playing' && row.state) {
      // 当前回合进行人（或房主接管已离开玩家回合）是数据源，不同步 Realtime，避免回声二次播放。
      // 但"刚接过回合"的首条推送必须放行（本地 state.cur 还是上一位玩家），否则会丢失回合切换信号。
      // 对房主接管场景：只跳过 src 来自自己（host）的回声；其他人推出的"轮到你接管"通知必须放行。
      const curPlayer = row.state.currentPlayerIndex;
      const departed = row.state.departedPlayers || [];
      const iTakeover = _isHost && departed.includes(curPlayer)
        && (row.state._src === _mySeatIndex);
      const localCur = state && state.currentPlayerIndex;
      const iAmAlreadyOperator = curPlayer === _mySeatIndex && localCur === _mySeatIndex;
      if (iAmAlreadyOperator || iTakeover) return;

      // 回声识别：若远端 pushId 属于本地曾推送过的（含 host 转发），视为回声直接跳过
      const remotePushId = row.state._pushId;
      if (remotePushId && _myPushedIds.has(remotePushId)) return;

      _isReceiving = true;

      const newState = row.state;
      const changed = JSON.stringify(state) !== JSON.stringify(newState);

      // 推送权接棒：始终记住当前操作座位，当其回合结束 nextTurn() 后仍可接棒推送"切回合"状态
      _pendingPushSeat = newState.currentPlayerIndex;

      state = newState;
      if (changed) {
        if (document.getElementById('game').style.display === 'none') {
          document.getElementById('online').style.display = 'none';
          showGame();
        } else {
          renderGame();
          triggerPendingAnims();
        }
      }
      _isReceiving = false;
    }
  });
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
    const players = seats.map(s => ({
      name: s.name,
      hand: [],
      handLimit: HAND_LIMIT[seats.length],
    }));
    initState(players, players.length);
    document.getElementById('online').style.display = 'none';
    showGame();
    await netUpdateGameState(_onlineRoomId, state, 'playing');
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
  console.log('[saveState] ENTER _isReceiving=', _isReceiving,
    'roomId=', _onlineRoomId,
    'cur=', state && state.currentPlayerIndex,
    'sub=', state && state.subPhase,
    'pending=', _pendingPushSeat);
  _originalSaveState();
  if (!_onlineRoomId || _isReceiving) {
    console.log('[saveState] SKIP guard (roomId or _isReceiving)');
    return;
  }

  // 游戏结束后不再推送：renderGameOver 覆盖已推过一次 status='finished'，
  // 之后的 saveState（UI 交互、renderGame 副作用）再推只会产生重复 RECV。
  if (state && state.phase === 'game-over') {
    console.log('[saveState] SKIP phase=game-over');
    return;
  }

  // 操作者判定：当前行动玩家本人，或上一回合行动玩家（用于 nextTurn 后推送"切回合"状态），
  // 或房主接管已离开玩家回合。
  const hasDeparted = _isHost && state && state.departedPlayers && state.departedPlayers.length > 0;
  const isCurrentActor = state && state.currentPlayerIndex === _mySeatIndex;
  const isOutgoingActor = _pendingPushSeat === _mySeatIndex;
  const canPush = isCurrentActor || isOutgoingActor || hasDeparted;
  if (!canPush) {
    console.log('[saveState] SKIP canPush=false (cur=',
      state && state.currentPlayerIndex, ' my=', _mySeatIndex,
      ' pending=', _pendingPushSeat,
      ' departed=', state && state.departedPlayers, ')');
    // 非操作者：记住当前操作座位，等其回合结束时接棒推送权
    if (state && typeof state.currentPlayerIndex === 'number') {
      _pendingPushSeat = state.currentPlayerIndex;
    }
    return;
  }

  // 推送前打标记并发送：抽成 _markPushAndSend 以便 _onTakeoverPlayer 等直接调用点复用，
  // 防止绕过 saveState 的推送被自己的 Realtime 回声覆盖。
  _markPushAndSend(state);

  // 推送成功：本次自己是操作者 → 记录座位；下次若 currentPlayerIndex 切走，仍允许再推一次
  if (isCurrentActor) {
    _pendingPushSeat = _mySeatIndex;
  } else if (isOutgoingActor) {
    _pendingPushSeat = null;
  }
};

/**
 * 给 state 打上 pushId 标记、记入 _myPushedIds，再发到 Supabase。
 * 供 saveState 与直接 netUpdateGameState 的调用点（如 _onTakeoverPlayer）复用。
 */
function _markPushAndSend(stateObj) {
  _myPushSeq++;
  const pushId = _mySeatIndex + '-' + _myPushSeq;
  stateObj._pushId = pushId;
  stateObj._src = _mySeatIndex;
  _myPushedIds.add(pushId);
  const snapshot = JSON.parse(JSON.stringify(stateObj));
  console.log('[PUSH] seat=', _mySeatIndex, 'pushId=', pushId,
    'cur=', snapshot.currentPlayerIndex, 'sub=', snapshot.subPhase);
  netUpdateGameState(_onlineRoomId, snapshot);
}

/* ============================================================
   游戏集成：非我的回合 → 覆盖底部区域
   ============================================================ */

const _originalRenderGame = window.renderGame;

window.renderGame = function() {
  _originalRenderGame();
  if (!_onlineRoomId || !state || state.phase === 'game-over') return;

  // --- Boss 动画防重复：追踪版本，避免同阶段动画被多次重绘导致二次播放 ---
  const curBossAnim = state.bossAnim;
  if (curBossAnim && (curBossAnim === 'dying' || curBossAnim === 'entering')) {
    if (curBossAnim !== _prevBossAnimState) {
      _bossAnimVersion++;
      _bossAnimRendered = false;
    }
  }

  requestAnimationFrame(() => {
    const content = document.getElementById('gameContent');
    if (!content) return;

    // Boss 动画：若当前 dying/entering 类已在之前渲染过，剥离避免动画重放
    const bossArea = content.querySelector('.boss-area');
    if (bossArea && curBossAnim &&
        (curBossAnim === 'dying' || curBossAnim === 'entering')) {
      if (_bossAnimRendered) {
        bossArea.classList.remove('boss-dying', 'boss-entering');
      } else {
        _bossAnimRendered = true;
      }
    }
    _prevBossAnimState = curBossAnim;

    // 游戏头部添加退出按钮（仅一次）
    const headerBtns = document.querySelector('.header-btns');
    if (headerBtns && !document.getElementById('exitRoomBtn')) {
      const btn = document.createElement('button');
      btn.id = 'exitRoomBtn';
      btn.textContent = '🚪 退出';
      btn.onclick = exitOnlineRoom;
      headerBtns.appendChild(btn);
    }

    const bottomSection = content.querySelector('.bottom-section');
    if (!bottomSection) return;

    const isMyTurn = state.currentPlayerIndex === _mySeatIndex;
    const departed = state.departedPlayers || [];
    const isDepartedTurn = departed.includes(state.currentPlayerIndex);
    const isTakeover = isDepartedTurn && _isHost;
    const me = state.players[_mySeatIndex];

    if (isTakeover) {
      // 房主接管已离开玩家 → 保留原始底部（已离开玩家的手牌）+ 接管提示
      bottomSection.classList.remove('online-waiting');
      const departedPlayer = state.players[state.currentPlayerIndex];
      let banner = content.querySelector('.takeover-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'takeover-banner';
        content.insertBefore(banner, content.firstChild);
      }
      banner.innerHTML = `🎮 你正在操作 <strong>${_esc(departedPlayer.name)}</strong> 的回合`;
      // 给房主一个明显的"轮到你"指示，避免和"等待中"混淆
      let indicator = content.querySelector('.my-turn-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'my-turn-indicator';
        content.insertBefore(indicator, content.firstChild);
      }
      indicator.textContent = '✦ 轮到你操作（接管中）';
    } else if (!isMyTurn) {
      // 不是我的回合 → 我的手牌（半透明）+ 等待提示
      bottomSection.classList.add('online-waiting');
      const currentPlayer = state.players[state.currentPlayerIndex];
      const myCards = me.hand.map(c => renderCardHTML(c, '', '')).join('');

      const waitMsg = isDepartedTurn
        ? `<strong>${_esc(currentPlayer.name)}</strong> 已离开，房主接管中...`
        : `等待 <strong>${_esc(currentPlayer.name)}</strong> 操作...`;

      bottomSection.innerHTML = `
        <div class="hand-section">
          <div class="hand-label">${_esc(me.name)} (我) 的手牌 (${me.hand.length}/${me.handLimit})</div>
          <div class="hand-cards">${myCards}</div>
        </div>
        <div class="online-wait-banner">${waitMsg}</div>`;
      const oldIndicator = content.querySelector('.my-turn-indicator');
      if (oldIndicator) oldIndicator.remove();
      const oldBanner = content.querySelector('.takeover-banner');
      if (oldBanner) oldBanner.remove();
    } else {
      // 是我的回合 → 正常操作
      bottomSection.classList.remove('online-waiting');
      const oldBanner = content.querySelector('.takeover-banner');
      if (oldBanner) oldBanner.remove();
      if (!content.querySelector('.my-turn-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'my-turn-indicator';
        indicator.textContent = '✦ 你的回合';
        content.insertBefore(indicator, content.firstChild);
      }
    }
  });
};

/* ============================================================
   侧边栏：隐藏其他玩家手牌
   ============================================================ */

const _originalRenderPlayerSidebar = window.renderPlayerSidebar;
const _originalShowPlayerHand     = window.showPlayerHand;

window.renderPlayerSidebar = function() {
  if (!_onlineRoomId || !state || state.playerCount <= 1) {
    return _originalRenderPlayerSidebar();
  }
  const departed = state.departedPlayers || [];
  let html = '<div class="player-sidebar">';
  state.players.forEach((p, i) => {
    const isMe = i === _mySeatIndex;
    const isCurrent = i === state.currentPlayerIndex;
    const isDeparted = departed.includes(i);
    const label = isDeparted ? ' (已离开)' : isMe ? ' (我)' : isCurrent ? ' ◀' : '';
    const clickable = isMe && !isCurrent && !isDeparted;
    const extraClass = isCurrent ? ' current-turn' : isDeparted ? ' departed' : '';
    html += `<div class="player-widget${extraClass}" ${clickable ? `onclick="showPlayerHand(${i})"` : ''}>
      <div class="widget-avatar">👤</div>
      <div class="widget-name">${_esc(p.name)}${label}</div>
      <div class="widget-count">${p.hand.length}张</div>
    </div>`;
  });
  html += '</div>';
  return html;
};

window.showPlayerHand = function(index) {
  if (!_onlineRoomId) return _originalShowPlayerHand(index);
  const p = state.players[index];
  if (!p) return;
  const isMe = index === _mySeatIndex;
  let html = `<h2>${_esc(p.name)} 的手牌 (${p.hand.length})</h2>`;
  html += '<div class="hand-cards" style="flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px;">';
  if (isMe) {
    p.hand.forEach(c => { html += renderCardHTML(c); });
  } else {
    for (let i = 0; i < p.hand.length; i++) {
      html += '<div class="card card-back" style="pointer-events:none;"></div>';
    }
  }
  html += '</div>';
  openModal(html);
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
    <button class="modal-btn primary" onclick="confirmExitRoom()">确认退出</button>
    <button class="modal-btn secondary" onclick="closeModal()">取消</button>`;
  openModal(content);
}

async function confirmExitRoom() {
  const roomId = _onlineRoomId;
  const seatIndex = _mySeatIndex;
  const wasHost = _isHost;
  console.log('[EXIT] roomId=', roomId, 'seat=', seatIndex, 'host=', wasHost);
  closeModal();
  _cleanupOnline();
  clearState();
  state = null;
  document.getElementById('game').style.display = 'none';
  document.getElementById('gameover-overlay').classList.remove('show');
  // 通知 Supabase
  if (roomId && seatIndex !== null) {
    if (wasHost) {
      netUpdateGameState(roomId, null, 'finished');
    } else {
      netLeaveRoom(roomId, seatIndex).then(() => {
        console.log('[EXIT] netLeaveRoom done');
      }).catch(e => console.error('[EXIT] netLeaveRoom failed:', e));
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
    <button class="modal-btn primary" onclick="_onTakeoverPlayer()" style="margin-bottom:8px;">
      接管操作<br><span style="font-size:.75rem;opacity:.7">后续该玩家的回合由你代操作（自动跳过）</span>
    </button>
    <button class="modal-btn secondary" onclick="_onResetAfterDeparture()">
      重置游戏<br><span style="font-size:.75rem;opacity:.7">关闭房间，所有人回到首页</span>
    </button>`;
  openModal(content);
}

function _onTakeoverPlayer() {
  closeModal();
  const seat = _pendingDepartedSeat;
  _pendingDepartedSeat = null;
  if (seat === null || !state) return;

  // 标记该玩家为已离开
  state.departedPlayers = state.departedPlayers || [];
  if (!state.departedPlayers.includes(seat)) {
    state.departedPlayers.push(seat);
  }
  addLog(_esc(state.players[seat].name) + ' 离开了房间，房主接管操作');

  // 通过 _markPushAndSend 打上 pushId 并记入 _myPushedIds，
  // 防止后续 Realtime 回声把刚写入的 departedPlayers 抹掉
  _isReceiving = false;
  _markPushAndSend(state);
  renderGame();
}

function _onResetAfterDeparture() {
  closeModal();
  _pendingDepartedSeat = null;
  _isReceiving = false;
  // 标记房间为 finished（state=null → 所有人被踢回首页）
  netUpdateGameState(_onlineRoomId, null, 'finished');
  _cleanupOnline();
  clearState();
  state = null;
  document.getElementById('game').style.display = 'none';
  showLanding();
}

/* ============================================================
   游戏结束处理
   ============================================================ */

const _originalRenderGameOver = window.renderGameOver;

window.renderGameOver = function() {
  _originalRenderGameOver();
  if (!_onlineRoomId) return;

  // 更新 Supabase 房间状态为 finished，通过 _markPushAndSend 打上 pushId
  // 不限房主：gameLose 可由任何玩家触发（防御不足时轮到谁就谁点），
  // pushId 回声过滤保证不会循环推送。
  _markPushAndSend(state);
  netUpdateGameState(_onlineRoomId, state, 'finished');

  // 联机模式下：移除"再来一局"，将"返回首页"改为"退出房间"
  requestAnimationFrame(() => {
    const card = document.getElementById('gameoverCard');
    if (!card) return;
    const btns = card.querySelector('.go-btns');
    if (!btns) return;
    const primaryBtn = btns.querySelector('.primary');
    if (primaryBtn) primaryBtn.remove();
    const secondaryBtn = btns.querySelector('.secondary');
    if (secondaryBtn) {
      secondaryBtn.textContent = '退出房间';
      secondaryBtn.onclick = confirmExitRoom;
    }
  });
};

// 订阅回调：房间被标记为 finished 时（非房主玩家）
// 已在 _subscribeToRoom 中处理（status === 'playing' 分支）
// 额外处理 finished 状态
_subscribeToRoom = function(roomId) {
  if (_unsubscribe) _unsubscribe();

  _unsubscribe = netSubscribeRoom(roomId, (row) => {
    console.log('[RECV] my=', _mySeatIndex, 'host=', _isHost,
      'status=', row.status,
      'cur=', row.state && row.state.currentPlayerIndex,
      'sub=', row.state && row.state.subPhase,
      'pushId=', row.state && row.state._pushId,
      'src=', row.state && row.state._src,
      'seats=', row.seats && row.seats.length);

    // 检测成员离开（座位数减少）：独立于 state/status 判断，只要有 seats 就检测
    // （netLeaveRoom 只更新 seats 时，row.state 可能为 null，不能依赖 playing && state 分支）
    if (Array.isArray(row.seats) && row.seats.length < _knownSeatCount && _knownSeatCount > 0 && !_departedHandled) {
      _departedHandled = true;
      const departedSeat = state
        ? state.players.findIndex((_, i) =>
            i < _knownSeatCount && !row.seats.some(s => s.seatIndex === i))
        : -1;
      const departedName = departedSeat >= 0 && state
        ? state.players[departedSeat].name : '未知玩家';
      console.log('[DEPART] fired! departedSeat=', departedSeat, 'name=', departedName,
        'host=', _isHost);
      if (_isHost) {
        _showPlayerLeftDialog(departedName, departedSeat);
      } else {
        alert(_esc(departedName) + ' 退出了房间，等待房主处理...');
      }
      _knownSeatCount = row.seats.length;
    }

    if (row.status === 'waiting' && row.seats) {
      renderWaitingRoom(row);
      return;
    }

    if (row.status === 'finished') {
      // 跳过自己的 finished 回声（pushId 在 _myPushedIds 里）
      const remotePushId = row.state && row.state._pushId;
      if (remotePushId && _myPushedIds.has(remotePushId)) return;

      _isReceiving = true;
      if (row.state) {
        const alreadyOver = state && state.phase === 'game-over';
        state = row.state;
        if (state.phase === 'game-over') {
          // pushId 回声过滤已在上方处理；任何玩家均可推送 game-over，
          // 触发者自身被 pushId 拦截，其余玩家在此渲染结算。
          // alreadyOver：本地已渲染过 game-over（自己触发或其他人推送），
          // 不再重复渲染，避免 renderGameOver 里的 _markPushAndSend 造成级联推送。
          if (!alreadyOver) {
            if (document.getElementById('game').style.display === 'none') {
              document.getElementById('online').style.display = 'none';
              showGame();
            }
            renderGameOver();
          }
        }
      } else {
        // 房主退出/房间解散 → 踢回首页
        _cleanupOnline();
        clearState();
        state = null;
        document.getElementById('online').style.display = 'none';
        document.getElementById('game').style.display = 'none';
        document.getElementById('gameover-overlay').classList.remove('show');
        alert('房主已离开，房间已解散');
        showLanding();
      }
      _isReceiving = false;
      return;
    }

    if (row.status === 'playing' && row.state) {
      // 当前回合进行人（或房主接管已离开玩家回合）是数据源，不同步 Realtime，避免回声二次播放。
      // 但"刚接过回合"的首条推送必须放行（本地 state.cur 还是上一位玩家），否则会丢失回合切换信号。
      // 对房主接管场景：只跳过 src 来自自己（host）的回声；其他人推出的"轮到你接管"通知必须放行。
      const curPlayer = row.state.currentPlayerIndex;
      const departed = row.state.departedPlayers || [];
      const iTakeover = _isHost && departed.includes(curPlayer)
        && (row.state._src === _mySeatIndex);
      const localCur = state && state.currentPlayerIndex;
      const iAmAlreadyOperator = curPlayer === _mySeatIndex && localCur === _mySeatIndex;
      if (iAmAlreadyOperator || iTakeover) return;

      // 回声识别：若远端 pushId 属于本地曾推送过的（含 host 转发），视为回声直接跳过
      const remotePushId = row.state._pushId;
      if (remotePushId && _myPushedIds.has(remotePushId)) return;

      _isReceiving = true;

      const newState = row.state;
      const changed = JSON.stringify(state) !== JSON.stringify(newState);

      // 推送权接棒：始终记住当前操作座位，当其回合结束 nextTurn() 后仍可接棒推送"切回合"状态
      _pendingPushSeat = newState.currentPlayerIndex;

      state = newState;
      if (changed) {
        if (document.getElementById('game').style.display === 'none') {
          document.getElementById('online').style.display = 'none';
          showGame();
        } else {
          renderGame();
          triggerPendingAnims();
        }
      }
      _isReceiving = false;
    }
  });
};

/* ============================================================
   页面刷新重连
   ============================================================ */

async function _tryReconnect() {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY));
    if (!saved || !saved.roomId) return false;

    const room = await netGetRoom(saved.roomId);
    if (room.status !== 'playing' || !room.state) {
      _clearSession();
      return false;
    }

    if (saved.seatIndex >= (room.seats || []).length) {
      _clearSession();
      return false;
    }

    _onlineRoomId = saved.roomId;
    _mySeatIndex  = saved.seatIndex;
    _isHost       = saved.isHost;
    _myPlayerName = saved.playerName;
    _knownSeatCount = (room.seats || []).length;
    _departedHandled = false;
    _myBossAnimVersion = 0;
    _prevBossAnimState = null;
    _bossAnimVersion = 0;
    _bossAnimRendered = false;
    _myPushSeq = 0;
    _myPushedIds = new Set();
    _pendingPushSeat = null;

    state = room.state;
    _subscribeToRoom(saved.roomId);
    document.getElementById('online').style.display = 'none';
    showGame();
    return true;
  } catch (e) {
    console.warn('[online] reconnect failed:', e);
    _clearSession();
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const saved = localStorage.getItem(ONLINE_SESSION_KEY);
    if (saved) {
      await _tryReconnect();
    }
  } finally {
    // 所有 JS 已载入、重连尝试完毕，移除初始化遮罩
    const overlay = document.getElementById('init-loading-overlay');
    if (overlay) overlay.remove();
  }
});
