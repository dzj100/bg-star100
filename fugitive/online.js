/**
 * online.js — 神探缉凶 · 联机对战（2 人：1 房主 + 1 成员）
 * 依赖加载顺序：game.js → supabase CDN → net.js → online.js（index_ol.html）
 *
 * 架构：
 *   - 房间状态行广播完整对局 state（含 seats 身份映射）；双方客户端持有同一份
 *     state，暗牌/手牌保密为 UI 级（渲染层只显示本座位应见内容）。
 *   - 轮到谁操作，谁就在本地执行规则并把新 state 推送回房间（save() → onlinePushState()）。
 *   - 房主在大厅三选身份：房主警探+成员大盗 / 房主大盗+成员警探 / 随机分配。
 *   - 对局中成员退出 → 房主弹窗确认解散；房主退出 → 直接解散房间。
 */

const OL_NAME_KEY = 'fugitive-ol-name';      // 记住昵称
const OL_SESSION_KEY = 'fugitive-online';    // 房间会话（刷新重连）

/* ============================================================
   联机会话状态
   ============================================================ */

let _roomId        = null;    // 短房间号（4 位）
let _mySeat        = -1;
let _isHost        = false;
let _playerName    = '';      // 本人昵称（会话持久化用）
let _unsub         = null;
let _receiving     = false;
let _started       = false;   // 已进入对局（房间 status=playing）
let _knownSeats    = 0;
let _knownSeatList = [];
let _departedHandled = false;
let _lastRow       = null;    // 最近一次房间行（等候室重绘用）
let _pushSeq       = 0;
let _epoch         = 0;      // 推送世代：页面/房间/重开时轮换，接收端据此重置乱序守卫
let _seenPushSeq   = {};     // 每座位已应用的最新推送 {src: {epoch, seq}}：同代旧推送忽略，防回卷
let _lastPushCur   = null;    // 上次推送时"当前行动座位"
let _pushInFlight  = false;   // 推送在途（串行化：防并发 UPDATE 竞速覆盖）
let _pushQueued    = false;   // 在途期间又有状态变化：完成后补发最新
let _pendingFx     = null;    // 猜测宣言标记：推送在途时暂存，随下一份快照发出（只发一次）
let _reconcileTimer = null;   // 对局中对账轮询：兜住实时推送漏收（断线窗口/丢包），拉权威状态补账
let _reconcileBusy  = false;
const RECONCILE_IDLE_LIMIT = 20; // 等待方连续空轮询上限：约 20×5s≈100s 无新推送即停止，省去无谓拉取
let _reconcileIdle  = 0;
function _newEpoch(){ return 1 + Math.floor(Math.random() * 0x3fffffff); }
function _resetPushState(){
  _pushSeq = 0;
  _epoch = _newEpoch(); // 世代轮换：接收端看到新世代会重置序号守卫，旧世代的高序号不会误拦新局推送
}
function _parsePushId(pushId){
  const m = /^(\d+)-(\d+)$/.exec(String(pushId || ''));
  if(!m) return null;
  return { src: Number(m[1]), seq: Number(m[2]) };
}
function _isPushNewer(st){
  const p = _parsePushId(st && st._pushId);
  if(!p) return false;
  const seen = _seenPushSeq[p.src];
  return !seen || seen.epoch !== st._epoch || p.seq > seen.seq;
}
function _recordSeenPush(st){
  const p = _parsePushId(st && st._pushId);
  if(!p) return;
  _seenPushSeq[p.src] = { epoch: st._epoch, seq: p.seq };
}
let _busy          = false;   // 网络动作互斥
let _assign        = 'random'; // 房主身份分配选择：host-mar | host-fug | random（默认「随机分配」，建房间即落库）
let _waitTimer     = null;    // 等候室对账轮询（兜住订阅窗口内错过的 UPDATE 事件）

/* ============================================================
   小工具
   ============================================================ */

function _saveSession(){
  if(!_roomId) return;
  try {
    localStorage.setItem(OL_SESSION_KEY, JSON.stringify({
      roomId: _roomId, seatIndex: _mySeat, isHost: _isHost, playerName: _playerName,
    }));
  } catch(e){}
}
function _clearSession(){ try { localStorage.removeItem(OL_SESSION_KEY); } catch(e){} }
function _nickName(){ try { return localStorage.getItem(OL_NAME_KEY) || ''; } catch(e){ return ''; } }
function _saveNick(name){ try { localStorage.setItem(OL_NAME_KEY, name); } catch(e){} }
function _curSeatOf(st){
  // 当前行动座位：由 state.turn + seats 身份映射推导
  const role = (st && (st.turn === 'fugitive' || st.turn === 'marshal')) ? st.turn : null;
  if(!role || !st.seats) return -1;
  const seat = st.seats.find(s => s.role === role);
  return seat ? seat.seatIndex : -1;
}
function _inGame(){ return _started && !!_roomId; }
function _setLoading(on){
  let el = document.getElementById('ol-busy');
  if(on){
    if(!el){
      el = document.createElement('div');
      el.id = 'ol-busy';
      el.className = 'ol-busy';
      el.innerHTML = '<div class="ob-spin"></div><div class="ob-text">处理中…</div>';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  } else if(el){ el.style.display = 'none'; }
}
function _toastNet(msg){
  const el = document.createElement('div');
  el.className = 'ol-net-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 2200);
}

/* ============================================================
   页面切换
   ============================================================ */

function _showGameUI(){
  const on = document.getElementById('online');
  const app = document.getElementById('app');
  if(on) on.style.display = 'none';
  if(app) app.style.display = 'block';
}
function _showLobbyUI(){
  const on = document.getElementById('online');
  const app = document.getElementById('app');
  if(app) app.style.display = 'none';
  if(on){ on.style.display = 'flex'; on.style.flexDirection = 'column'; on.style.alignItems = 'center'; }
}

/* ============================================================
   首页（点击【联机模式】进入连接大厅）
   ============================================================ */

function showOnlineLanding(){
  OL.active = false;
  OL.mySeat = -1; OL.myRole = null; OL.oppName = ''; OL.oppSeat = -1; OL.seats = [];
  _showLobbyUI();
  renderOnlineLanding();
}
function renderOnlineLanding(){
  document.getElementById('online').innerHTML =
    '<div class="ol-landing">' +
      '<div class="rules-corner"><button onclick="showModal(\'rules\')">📖 规则</button></div>' +
      '<div class="ol-landing-icon">🕵️</div>' +
      '<h1 class="ol-landing-title">神探缉凶</h1>' +
      '<div class="ol-landing-sub">大盗藏匿 · 警探追捕 · 1v1 实时对战</div>' +
      '<button id="ol-enter-online" class="btn btn-primary ol-landing-btn" onclick="showOnlineLobby()">🌐 联机模式</button>' +
      // '<a class="ol-link" href="index.html">🏠 返回人机对战版</a>' +
      '<div class="ol-credit">@imStar100</div>' +
    '</div>';
}

/* ============================================================
   连接大厅（创建 / 加入）
   ============================================================ */

function showOnlineLobby(){
  OL.active = false;
  OL.mySeat = -1; OL.myRole = null; OL.oppName = ''; OL.oppSeat = -1; OL.seats = [];
  _showLobbyUI();
  renderOnlineLobby();
}
function renderOnlineLobby(){
  document.getElementById('online').innerHTML =
    '<div class="ol-lobby">' +
      '<div class="ol-head">' +
        '<h1 class="ol-head-title">🌐 联机对战</h1>' +
        '<button class="icon-btn" onclick="showOnlineLanding()">✕ 返回</button>' +
      '</div>' +
      '<button id="ol-create" class="btn btn-primary ol-btn" onclick="olCreateRoom()">🏠 创建房间</button>' +
      '<div class="ol-divider">— 或加入好友的房间 —</div>' +
      '<label class="ol-label" for="ol-code">房间号</label>' +
      '<input id="ol-code" class="ol-input ol-code-input" type="text" inputmode="numeric" maxlength="4" placeholder="4 位数字">' +
      '<label class="ol-label" for="ol-name">你的昵称</label>' +
      '<input id="ol-name" class="ol-input" type="text" maxlength="8" placeholder="昵称" value="' + esc(_nickName()) + '">' +
      '<button id="ol-join" class="ol-btn ol-join-btn" onclick="olJoinRoom()">🚪 加入房间</button>' +
    '</div>';
  document.getElementById('ol-name').addEventListener('input', e => { _saveNick(e.target.value.trim()); });
}

/* 房主创建房间：昵称取记忆值；没有则先弹昵称输入（页面风格内嵌，不用系统 prompt） */
async function olCreateRoom(){
  if(_busy) return;
  let name = _nickName();
  if(!name){
    name = await _askNick('输入你的昵称');
    if(!name) return;
    _saveNick(name);
  }
  _createRoom(name);
}

async function _createRoom(name){
  _busy = true; _setLoading(true);
  try {
    const code = await netCreateRoom(name);
    _roomId = code; _mySeat = 0; _isHost = true; _playerName = name;
    _started = false; _resetPushState(); _departedHandled = false;
    OL.active = true; OL.isHost = true; OL.mySeat = 0;
    _knownSeats = 1;
    _knownSeatList = [{ name, joinedAt: '', seatIndex: 0 }];
    _saveSession();
    _subscribe(code);
    // 身份配置（默认「随机分配」）随建房间落库：不等房主显式点选，
    // 否则成员首屏看不到任何分配（与房主 UI 已高亮的默认态不一致）
    _assignQ = _assignQ
      .then(() => _pushAssignOnce(_assign))
      .catch(e => console.warn('[online] assign init push:', e && e.message));
    _lastRow = { status: 'waiting', seats: _knownSeatList };
    renderWaitingRoom(_lastRow);
    _startWaitReconcile();
  } catch(e){
    alert('创建房间失败：' + e.message);
  } finally { _busy = false; _setLoading(false); }
}

let _nickAskResolve = null;
function _askNick(title){
  return new Promise(resolve => {
    _nickAskResolve = resolve;
    let ov = document.getElementById('ol-modal-nick');
    if(ov) ov.remove();
    ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'ol-modal-nick';
    ov.innerHTML = '<div class="modal">' +
      '<h3>' + esc(title) + '</h3>' +
      '<input id="ol-nick-input" class="ol-input" type="text" maxlength="8" placeholder="昵称" value="' + esc(_nickName()) + '">' +
      '<button id="ol-nick-ok" class="btn btn-primary ol-btn" onclick="olNickOk()">确定</button>' +
      '<button class="btn btn-ghost ol-btn" onclick="olNickCancel()">取消</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.classList.add('show');
    ov.addEventListener('click', e => { if(e.target === ov) olNickCancel(); });
    const input = ov.querySelector('#ol-nick-input');
    input.focus(); input.select();
    input.addEventListener('keydown', e => { if(e.key === 'Enter') olNickOk(); });
  });
}
function _closeNickAsk(val){
  const ov = document.getElementById('ol-modal-nick');
  if(ov) ov.remove();
  const r = _nickAskResolve; _nickAskResolve = null;
  if(r) r(val);
}
function olNickOk(){
  const input = document.getElementById('ol-nick-input');
  const val = input ? input.value.trim() : '';
  if(!val){ if(input) input.focus(); return; }
  _closeNickAsk(val);
}
function olNickCancel(){ _closeNickAsk(null); }

async function _nameFromLobby(){
  const input = document.getElementById('ol-name');
  const name = input ? input.value.trim() : '';
  if(!name){ alert('请输入你的昵称'); return null; }
  _saveNick(name);
  return name;
}

async function olJoinRoom(){
  if(_busy) return;
  const name = await _nameFromLobby();
  if(!name) return;
  const input = document.getElementById('ol-code');
  const code = (input ? input.value : '').trim().toUpperCase();
  if(!/^\d{4}$/.test(code)){ alert('请输入 4 位数字房间号'); return; }
  _busy = true; _setLoading(true);
  try {
    const { seatIndex } = await netJoinRoom(code, name);
    _roomId = code; _mySeat = seatIndex; _isHost = false; _playerName = name;
    _started = false; _resetPushState(); _departedHandled = false;
    OL.active = true; OL.isHost = false; OL.mySeat = seatIndex;
    _saveSession();
    _subscribe(code);
    const row = await _fetchRoomRow(code);
    const seats = (row && row.seats) || [];
    _knownSeats = seats.length;
    _knownSeatList = seats;
    // 携带 state.assign：房主若已选好身份，成员进入房间的第一屏就要看到
    _lastRow = { status: 'waiting', seats, state: (row && row.state) || null };
    renderWaitingRoom(_lastRow);
    _startWaitReconcile();
    // 房主的身份选择若恰在「加入读写」间隙落库，首屏会暂时缺失：
    // 800ms 后快速补一次对账，避免等满 2.5s 轮询才出现
    setTimeout(() => { if(!_started && _roomId) _reconcileRoom(); }, 800);
  } catch(e){
    alert(e.message || '加入失败');
  } finally { _busy = false; _setLoading(false); }
}

async function _fetchRoomRow(code){
  try {
    return await netGetRoom(code);
  } catch(e){ return null; }
}

/* ============================================================
   等候室（含房主身份三选）
   ============================================================ */

const ASSIGN_OPTIONS = [
  { v: 'host-mar', icon: '🕵️', label: '房主警探', sub: '成员大盗' },
  { v: 'host-fug', icon: '🕶️', label: '房主大盗', sub: '成员警探' },
  { v: 'random',   icon: '🎲', label: '随机分配', sub: '开局时决定' },
];

/* 等候室身份选择 → 写入房间行 state.assign，成员侧实时可见；
   串行队列防连点/与开始对战推送竞态（先排空再推 playing）。 */
let _assignQ = Promise.resolve();
function olPickAssign(v){
  if(!_isHost) return;
  _assign = v;
  if(_lastRow) renderWaitingRoom(_lastRow);
  if(_roomId && !_started){
    const assign = _assign;
    _assignQ = _assignQ
      .then(() => _pushAssignOnce(assign))
      .catch(e => console.warn('[online] assign push:', e && e.message));
  }
}
async function _pushAssignOnce(assign){
  for(let attempt = 0; attempt < 2; attempt++){
    try { if(await netUpdateGameState(_roomId, { assign }, 'waiting')) return; }
    catch(e){}
    if(attempt === 0) await _sleep(400);
  }
  console.warn('[online] assign push failed:', assign);
}
async function _flushAssignPush(){
  try { await _assignQ; } catch(e){}
}

function _assignOf(row){
  return (row && row.state && row.state.assign) || null;
}

function renderWaitingRoom(row){
  const seats = (row && row.seats) || [];
  _lastRow = row;
  const hasMember = seats.length >= 2;
  const me = seats.find(s => s.seatIndex === _mySeat);
  const seatChips = seats.map(s => {
    const host = s.seatIndex === 0;
    const self = s.seatIndex === _mySeat;
    return '<div class="ol-seat' + (host ? ' host' : '') + (self ? ' me' : '') + '">' +
      '<span class="os-dot"></span>' +
      '<span class="os-name">' + esc(s.name) + (self ? '（你）' : '') + '</span>' +
      '<span class="os-tag">' + (host ? '房主' : '成员') + '</span>' +
    '</div>';
  }).join('');
  const emptySlot = !hasMember
    ? '<div class="ol-seat empty">' +
        '<span class="os-dot"></span>' +
        '<span class="os-name">等待成员加入…</span>' +
      '</div>'
    : '';

  let hostPanel = '';
  if(_isHost){
    hostPanel =
      '<div class="ol-card">' +
        '<div class="ol-label">身份分配（房主选择）</div>' +
        ASSIGN_OPTIONS.map(o =>
          '<button class="ol-assign' + (_assign === o.v ? ' sel' : '') + '" onclick="olPickAssign(\'' + o.v + '\')">' +
            '<span class="oa-icon">' + o.icon + '</span>' +
            '<span class="oa-txt"><b>' + o.label + '</b><i>' + o.sub + '</i></span>' +
          '</button>').join('') +
        '<button id="ol-start" class="btn btn-primary ol-btn' + (hasMember ? '' : ' dis') + '" ' +
          (hasMember ? '' : 'disabled') + ' onclick="olStartGame()">' +
          '⚔️ 开始对战' + (hasMember ? '' : '（等待成员加入）') + '</button>' +
      '</div>';
  } else {
    const picked = _assignOf(row);
    const opt = picked ? ASSIGN_OPTIONS.find(o => o.v === picked) : null;
    hostPanel =
      '<div class="ol-card">' +
        (opt
          ? '<div class="ol-label">身份分配（房主选择）</div>' +
            '<div class="ol-assign sel ol-assign-ro">' +
              '<span class="oa-icon">' + opt.icon + '</span>' +
              '<span class="oa-txt"><b>' + opt.label + '</b><i>' + opt.sub + '</i></span>' +
            '</div>' +
            '<div class="ol-wait-note">⏳ 等待房主开始对战…</div>'
          : '<div class="ol-wait-note">⏳ 等待房主选择身份并开始对战…</div>') +
      '</div>';
  }

  const label = _isHost ? '把房间号发给好友加入' : '房主：' + esc(seats[0] ? seats[0].name : '…');
  document.getElementById('online').innerHTML =
    '<div class="ol-room">' +
      '<div class="ol-room-top">' +
        '<h1 class="ol-title">房间</h1>' +
        '<button class="icon-btn" onclick="olLeaveWaiting()">✕ 退出</button>' +
      '</div>' +
      '<div class="ol-code">' + _roomId + '</div>' +
      '<div class="ol-sub">' + label + '</div>' +
      '<div class="ol-card ol-w">' + seatChips + emptySlot + '</div>' +
      hostPanel +
    '</div>';
}

function olLeaveWaiting(){
  _leaveRoomAndLobby('离开房间？');
}

/* ============================================================
   等候室对账轮询
   Realtime 只推送订阅建立之后的事件；若成员加入恰在订阅完成前，
   房主会错过 join 事件。轮询兜底：等待阶段每 2.5s 拉一次房间行。
   ============================================================ */

function _startWaitReconcile(){
  _stopWaitReconcile();
  _waitTimer = setInterval(() => { _reconcileRoom(); }, 2500);
  _reconcileRoom();
}
function _stopWaitReconcile(){
  if(_waitTimer){ clearInterval(_waitTimer); _waitTimer = null; }
}
/* ============================================================
   对局中对账轮询：实时推送偶有漏收（网络抖动/断线窗口），
   等待对方行动时每 5s 拉一次房间行，发现更新推送则补账，防双方僵等。
   ============================================================ */

function _startReconcile(){
  _stopReconcile();
  _reconcileIdle = 0; // 重新开播（新回合/新推送/重进对局）时清空空轮询计数
  _reconcileTimer = setInterval(() => { _reconcileOnce(); }, 5000);
}
function _stopReconcile(){
  if(_reconcileTimer){ clearInterval(_reconcileTimer); _reconcileTimer = null; }
}
async function _reconcileOnce(){
  if(!_roomId || !_started || _receiving || _pushInFlight || _reconcileBusy) return;
  const overPhase = !!(state && state.phase === 'over');
  const cur = state ? _curSeatOf(state) : -1;
  // 对局中我的回合：本地即权威，无需对账；结算页则继续盯房主动向（再来一局/重选身份/解散），
  // 兜住这三类跳转的实时行漏收——因此结算页即使轮到"我"（按残余 turn 判断）也要轮询
  if(!overPhase && cur === _mySeat) return;
  if(typeof revealBusy !== 'undefined' && revealBusy) return; // 翻牌补播动画中：等动画结束的下一轮再对账
  _reconcileBusy = true;
  let applied = false;
  try {
    const room = await netGetRoom(_roomId);
    if(!room){ /* 行读不到：下一轮再试 */ }
    else if(room.status === 'finished'){
      _roomDissolved(); // 房主解散漏收实时行（结算页/对局中均适用）→ 兜底回首页
    } else if(overPhase && room.status === 'waiting'){
      _resetToWaitingRoom(room); // 房主「重选身份」漏收实时行 → 对账补回等候室
      applied = true;
    } else {
      const rs = room.state;
      if(rs && rs._pushId && rs._src !== _mySeat && _isPushNewer(rs)){
        // 保留 _guessFx 交给 applyOnlineState 消费：reconcile 能见到它说明实时推送漏了
        // 这份宣言行（seen 守卫保证只应用一次），大盗端仍需补播气泡+翻牌动画；
        // 若在此剥除，结算行到达后地点牌直接翻明，观感与警探端不一致。
        _recordSeenPush(rs);
        applyOnlineState(rs);
        _lastPushCur = _curSeatOf(state); // 镜像行动座位：与实时路径一致，避免后续移交回合被误判
        applied = true;
        console.warn('[online] reconcile applied ' + rs._pushId + ' (missed realtime row)');
      }
    }
  } catch(e){ /* 网络抖动：下一轮再试 */ }
  finally { _reconcileBusy = false; }
  if(applied){
    _reconcileIdle = 0; // 补到账即视为进展：刷新空轮询计数
  } else {
    _reconcileIdle++; // 拉取完成但无新推送（含我方最近移交行、网络抖动）→ 计一次空轮询
    if(_reconcileIdle >= RECONCILE_IDLE_LIMIT){
      console.warn('[online] reconcile idle ' + _reconcileIdle + ' polls without new push, stop polling');
      _stopReconcile(); // 连续 20 次无进展：对局已稳定（或对方已弃局），停表
    }
  }
}
async function _reconcileRoom(){
  if(!_roomId || _started) return;
  let room = null;
  try { room = await netGetRoom(_roomId); } catch(e){ return; }
  if(!room || room.status === 'finished'){ _roomDissolved(); return; }
  const seats = room.seats || [];
  if(!seats.some(s => s.seatIndex === _mySeat)){ _roomDissolved(); return; } // 座位已无我（异常兜底）
  if(room.status === 'playing' && room.state){
    _handleRemoteState(room); // 错过 playing 首推（订阅晚到）时补进对局
    return;
  }
  // 房主自愈：本地配置与库中不一致（初始落库失败/推送被迟到写入覆盖）→ 补推，
  // 保证「成员任何时候进入房间」都能立即读到 state.assign
  if(_isHost && _assignOf(room) !== _assign){
    const assign = _assign;
    _assignQ = _assignQ
      .then(() => _pushAssignOnce(assign))
      .catch(e => console.warn('[online] assign repush:', e && e.message));
  }
  const same = seats.length === _knownSeats &&
    JSON.stringify(seats.map(s => [s.seatIndex, s.name])) ===
    JSON.stringify(_knownSeatList.map(s => [s.seatIndex, s.name]));
  const assignChanged = _assignOf(room) !== _assignOf(_lastRow);
  _syncSeats(room);
  if(room.status === 'waiting' && (!same || assignChanged)) renderWaitingRoom(room);
}

/* ============================================================
   房主发牌：身份三选 → 建 state → 推 playing
   ============================================================ */

async function olStartGame(){
  if(!_isHost || _busy) return;
  await _flushAssignPush(); // 先把身份选择写库，避免与 playing 推送并发竞态
  _busy = true; _setLoading(true);
  try {
    const room = await netGetRoom(_roomId);
    const seats = (room && room.seats) || [];
    if(seats.length < 2){ alert('需要 2 名玩家才能开始'); return; }
    // 计算身份：座位 0 = 房主
    const roles = _pickRoles();
    OL.active = true; OL.isHost = true; OL.mySeat = 0;
    OL.seats = seats.map((s, i) => ({ seatIndex: s.seatIndex, name: s.name, role: roles[i] }));
    OL.myRole = roles[0];
    OL.oppSeat = OL.seats[1] ? OL.seats[1].seatIndex : 1;
    OL.oppName = OL.seats[1] ? OL.seats[1].name : '';
    _knownSeats = seats.length;
    _knownSeatList = seats;
    _departedHandled = false;
    _resetPushState();
    _lastPushCur = null;
    _started = true;   // 开门：此后 save() → onlinePushState 生效
    _stopWaitReconcile();
    _startReconcile();
    _showGameUI();

    newGame(roles[0]); // 本地建局（联机分支不调度 AI、不写单机存档）
    state.seats = OL.seats.map(s => ({ ...s }));
    const r0 = roles[0] === 'fugitive' ? '大盗' : '警探';
    const r1 = roles[1] === 'fugitive' ? '大盗' : '警探';
    log('身份分配：房主「' + esc(OL.seats[0].name) + '」扮演' + r0 +
        '，成员「' + esc(OL.seats[1].name) + '」扮演' + r1, '');
    state.humanRole = OL.myRole;
    render();
    _markPush(state, 'playing');
  } catch(e){
    alert('开始游戏失败：' + e.message);
  } finally { _busy = false; _setLoading(false); }
}

function _pickRoles(){
  // 座位 0 = 房主；返回 [座位0角色, 座位1角色]
  if(_assign === 'host-mar') return ['marshal', 'fugitive'];
  if(_assign === 'host-fug') return ['fugitive', 'marshal'];
  return Math.random() < 0.5 ? ['fugitive', 'marshal'] : ['marshal', 'fugitive'];
}

/** 再来一局：保持原身份（房主专用，结算页按钮调用） */
function olRematch(){
  if(!_isHost || !_started) return;
  if(!OL.seats || OL.seats.length < 2){ alert('需要成员在场才能再来一局'); return; }
  _resetPushState(); _lastPushCur = null;
  _showGameUI();
  _startReconcile();
  const roles = [OL.seats[0].role, OL.seats[1].role];
  newGame(roles[0]);
  state.seats = OL.seats.map(s => ({ ...s }));
  const r0 = roles[0] === 'fugitive' ? '大盗' : '警探';
  const r1 = roles[1] === 'fugitive' ? '大盗' : '警探';
  log('再来一局：房主「' + esc(OL.seats[0].name) + '」扮演' + r0 +
      '，成员「' + esc(OL.seats[1].name) + '」扮演' + r1, '');
  state.humanRole = OL.myRole;
  render();
  _markPush(state, 'playing');
}

/** 对局/结算 → 等候室（房主「重选身份」推送后本地复位，或收到 waiting 行时随行复位）：
   清掉对局快照与推送世代，回到未开赛的匹配页；座位保留，房主可重选身份再次开局。 */
function _resetToWaitingRoom(row){
  _stopReconcile();
  _started = false;
  _resetPushState(); _lastPushCur = null;
  state = null; // 旧对局快照作废（含双方角色与牌面），等待房主重新开局
  OL.active = true;
  OL.myRole = null; OL.oppName = ''; OL.oppSeat = -1;
  OL.seats = (row.seats || []).map(s => ({ seatIndex: s.seatIndex, name: s.name }));
  _knownSeats = (row.seats || []).length;
  _knownSeatList = row.seats || [];
  _departedHandled = false;
  _lastRow = row;
  _showLobbyUI();
  renderWaitingRoom(row);
  _startWaitReconcile();
}

/** 结算页「重选身份」（房主专用，底部按钮）：房间行退回 waiting（保留当前身份选择），
   成员实时收到后同样回到等候室；房主在等候室可切换房主大盗/警探/随机并再次开局。 */
async function olBackToRoom(){
  if(!_isHost || !_roomId || _busy) return;
  _busy = true; _setLoading(true);
  try {
    const assign = _assign;
    try { await _assignQ; } catch(e){}
    _assignQ = _pushAssignOnce(assign).catch(e => console.warn('[online] back-to-room push:', e && e.message));
    await _assignQ;
    let row = { status: 'waiting', seats: _knownSeatList.slice(), state: { assign } };
    try { const r = await netGetRoom(_roomId); if(r) row = r; } catch(e){}
    _resetToWaitingRoom(row);
    _toastNet('已回到等候室，可重新分配身份');
  } finally { _busy = false; _setLoading(false); }
}

/* ============================================================
   状态推送 / 接收（Realtime）
   ============================================================ */

function onlinePushState(){
  if(!ONLINE_MODE || !_roomId || _receiving || !_started) return;
  const st = state;
  if(!st || !st.seats || !st.seats.length) return;
  const cur = _curSeatOf(st);
  const iCur = cur === _mySeat;
  const justHanded = _lastPushCur !== null && _lastPushCur === _mySeat && cur !== _mySeat;
  if(!(iCur || justHanded)) return; // 不是我的操作回合 → 不推送
  _markPush(st, 'playing');
}

/* 警探猜测宣言即时报：把瞬态标记交给 _pendingFx，由 _sendLatest 克隆快照时
   附带到「下一份」快照上发出。不在途则立即随本次快照发出；在途则随补发快照发出，
   避免标记挂在 state 上被串行补发路径克隆前就删除。 */
function onlinePushGuessFx(nums, allHit, manhunt){
  if(!ONLINE_MODE || !_roomId || _receiving || !_started) return;
  const st = state;
  if(!st || !st.seats || !st.seats.length) return;
  if(_curSeatOf(st) !== _mySeat) return; // 只有当前行动方（警探）能上报猜测
  if(!nums || !nums.length) return;
  _pendingFx = { nums: nums.slice(), allHit: !!allHit, manhunt: !!manhunt };
  onlinePushState(); // 统一串行推送：随后结算的 save() 推送不含标记的完整状态
}

function _markPush(st, status){
  // 串行化：上一次推送在途时只记录，由 _sendLatest 完成后补发最新状态，
  // 避免同一操作内多次 save() 产生并发 UPDATE 竞速、旧快照最后落库。
  if(_pushInFlight){ _pushQueued = true; return; }
  _sendLatest(status);
}

async function _sendLatest(status){
  if(!_roomId || !_started || !state || !state.seats || !state.seats.length) return;
  _pushSeq++;
  _lastPushCur = _curSeatOf(state);
  _pushInFlight = true;
  let carriedFx = false; // 本份推送是否真正携带了猜测宣言标记
  try {
    let ok = false;
    for(let attempt = 0; attempt < 2 && !ok; attempt++){
      // 每次尝试都重新序列化最新本地状态：重试若复用首次快照，旧状态晚到会覆盖对方已应用的新进度（回卷）
      const snap = JSON.parse(JSON.stringify(state));
      if(_pendingFx){ snap._guessFx = { ..._pendingFx }; carriedFx = true; }
      snap._pushId = _mySeat + '-' + _pushSeq;
      snap._epoch = _epoch;
      snap._src = _mySeat;
      try { ok = await netUpdateGameState(_roomId, snap, status); }
      catch(e){ console.warn('[online] push exception:', e && e.message); }
      if(!ok && attempt === 0) await _sleep(400);
    }
    if(ok && carriedFx) _pendingFx = null; // 标记随本份成功快照发出（只发一次）；未携带则留给后续推送
    if(!ok) console.warn('[online] push failed after retry:', _pushSeq);
  } finally {
    _pushInFlight = false;
    if(_pushQueued){
      _pushQueued = false;
      if(_roomId && _started && state && state.seats && state.seats.length){
        _sendLatest(status); // 补发期间产生的最新状态
      }
    }
  }
}

function _sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function _subscribe(code){
  if(_unsub) _unsub();
  _unsub = netSubscribeRoom(code, _onRoomRow);
}

function _onRoomRow(row){
  const seats = row.seats || [];

  if(row.status === 'finished'){
    _roomDissolved();
    return;
  }

  // 座位减少（有人主动退出）：找出离开者
  const shrunk = _knownSeats > 0 && seats.length < _knownSeats && !_departedHandled;
  if(shrunk && _knownSeatList.length){
    const gone = _knownSeatList.find(s => seats.every(x => x.seatIndex !== s.seatIndex));
    _syncSeats(row);
    if(gone){
      if(gone.seatIndex === _mySeat){ return; } // 自己退出的 echo（_doExitRoom 已在处理）
      if(gone.seatIndex === 0){
        // 房主离开：房间无法继续，回大厅
        _cleanupOnline();
        showOnlineLanding();
        alert('房主已离开，房间已解散');
        return;
      }
      if(_started){
        _departedHandled = true; // 对局中成员离开：弹解散确认，只弹一次
        _onOpponentLeft(gone, row);
        return;
      }
      renderWaitingRoom(row); // 等候室阶段：重绘空位，等待新成员
      return;
    }
  } else {
    _syncSeats(row);
  }

  // 房主结算页「重选身份」：房间行退回 waiting → 我若停在结算页也随行回等候室
  // （对局中途收到 waiting 行不可能是合法推进，只有结算页这个入口会产生）
  if(row.status === 'waiting' && _started && state && state.phase === 'over'){
    _resetToWaitingRoom(row);
    return;
  }
  if(row.status === 'playing' && row.state){
    _handleRemoteState(row); // 含成员首条 playing 推送（_started 尚为 false 时也处理）
    return;
  }
  if(!_started && row.status === 'waiting'){
    renderWaitingRoom(row);
    return;
  }
  if(row.status === 'playing' && !row.state){ /* 中间态忽略 */ }
}

function _syncSeats(row){
  const seats = row.seats || [];
  _knownSeats = seats.length;
  _knownSeatList = seats;
}

function _handleRemoteState(row){
  const st = row.state;
  if(!st) return;
  if(st._src === _mySeat) return; // 自己推送的 echo，本地已是最新
  // 乱序守卫：同世代序号不高于已应用的最新推送（重试/乱序晚到）→ 忽略，防旧状态回卷
  if(st._pushId && !_isPushNewer(st)) return;
  if(st._pushId) _recordSeenPush(st);
  _receiving = true;
  try {
    const firstEnter = !_started;
    _started = true;
    OL.isHost = _mySeat === 0;
    _stopWaitReconcile();
    _startReconcile();
    if(firstEnter) _showGameUI(); // 首次收到对局状态（成员由房主发牌进入）
    applyOnlineState(st);
    _lastPushCur = _curSeatOf(st); // 镜像对方推送的当前行动座位：避免在对方新局上重复补推
    if(firstEnter) _toastNet('对局开始：' + (OL.oppName ? '对手 ' + esc(OL.oppName) : '对手') + ' 已就位');
  } finally {
    _receiving = false;
  }
}

/** 房主解散房间（null state + finished） */
function _dissolveRoom(){
  _busy = true; _setLoading(true);
  try {
    netUpdateGameState(_roomId, null, 'finished');
    _cleanupOnline();
    _toastNet('房间已解散');
    showOnlineLanding();
  } finally { _busy = false; _setLoading(false); }
}

/** 房间解散（我收到 finished + 无 state） */
function _roomDissolved(){
  if(!_roomId) return; // 幂等：重复 finished 推送只处理一次
  const wasHost = _isHost;
  _cleanupOnline();
  showOnlineLanding();
  alert(wasHost ? '房间已解散' : '房主已离开，房间已解散');
}

/** 对局中对方离开：房主弹窗确认解散；成员侧视为房间终止 */
function _onOpponentLeft(gone, row){
  const name = gone.name || '对方';
  if(_isHost){
    _showMemberLeftDialog(name);
    return;
  }
  // 非房主侧遇到对方（房主）离开 → _onRoomRow 已按座位 0 处理；此处兜底
  _cleanupOnline();
  showOnlineLanding();
  alert(name + ' 已离开，房间已结束');
}

/* ============================================================
   退出房间
   ============================================================ */

function olConfirmQuit(){
  const ov = _ensureModal('ol-modal-quit', '退出房间？',
    '对局进度将丢失，确定退出当前房间？',
    '<button class="btn btn-primary ol-modal-btn" onclick="olConfirmExit()">确认退出</button>' +
    '<button class="btn btn-ghost ol-modal-btn" onclick="olCloseModal(\'ol-modal-quit\')">取消</button>');
  ov.classList.add('show');
}

function _ensureModal(id, title, body, buttonsHTML, outsideClose){
  let ov = document.getElementById(id);
  if(!ov){
    ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = id;
    ov.innerHTML = '<div class="modal"><h3>' + esc(title) + '</h3>' +
      '<p>' + body + '</p>' + buttonsHTML + '</div>';
    if(outsideClose !== false){
      ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('show'); });
    }
    document.body.appendChild(ov);
  }
  return ov;
}

/* game.js 的 closeModal(id) 按「modal-"+id」查找，而联机弹窗 id 直接是 ol-*
   前缀，因此取消按钮需走这里收起抽屉 */
function olCloseModal(id){
  const el = document.getElementById(id);
  if(el) el.classList.remove('show');
}

function olConfirmExit(){
  const ov = document.getElementById('ol-modal-quit');
  if(ov) ov.classList.remove('show');
  _doExitRoom();
}

function _doExitRoom(){
  const code = _roomId;
  const seat = _mySeat;
  const wasHost = _isHost;
  if(code && seat >= 0){
    if(wasHost){
      netUpdateGameState(code, null, 'finished'); // 房主退出 = 解散
    } else {
      netLeaveRoom(code, seat);                   // 成员退出 = 让出座位
    }
  }
  _cleanupOnline();
  _toastNet(wasHost ? '已解散房间' : '已退出房间');
  showOnlineLanding();
}

function _leaveRoomAndLobby(msg){
  const ov = _ensureModal('ol-modal-leave', msg,
    '当前等候室将退出，房间号可再次使用。',
    '<button class="btn btn-primary ol-modal-btn" onclick="olLeaveRoomConfirm()">确认退出</button>' +
    '<button class="btn btn-ghost ol-modal-btn" onclick="olCloseModal(\'ol-modal-leave\')">取消</button>');
  ov.classList.add('show');
}
function olLeaveRoomConfirm(){
  const ov = document.getElementById('ol-modal-leave');
  if(ov) ov.classList.remove('show');
  const code = _roomId;
  const seat = _mySeat;
  const wasHost = _isHost;
  if(code && seat >= 0){
    if(wasHost) netUpdateGameState(code, null, 'finished');
    else netLeaveRoom(code, seat);
  }
  _cleanupOnline();
  showOnlineLanding();
}

/** 成员离开弹窗（对局中，房主侧；必须解散，遮罩点击不关闭） */
function _showMemberLeftDialog(name){
  const ov = _ensureModal('ol-modal-member-gone', '⚠️ 成员已离开',
    '「' + esc(name) + '」退出了房间，本局无法继续，只能解散房间。',
    '<button class="btn btn-primary ol-modal-btn" onclick="olDissolveConfirm()">解散房间</button>', false);
  ov.classList.add('show');
}
function olDissolveConfirm(){
  const ov = document.getElementById('ol-modal-member-gone');
  if(ov) ov.classList.remove('show');
  _dissolveRoom();
}

function _cleanupOnline(){
  if(_unsub){ _unsub(); _unsub = null; }
  _stopWaitReconcile();
  _stopReconcile();
  _seenPushSeq = {};
  const ovs = ['ol-modal-quit', 'ol-modal-leave', 'ol-modal-member-gone'];
  ovs.forEach(id => { const el = document.getElementById(id); if(el) el.remove(); });
  _roomId = null; _mySeat = -1; _isHost = false;
  _started = false; _receiving = false;
  _knownSeats = 0; _knownSeatList = []; _departedHandled = false;
  _lastRow = null; _resetPushState(); _lastPushCur = null;
  _pushInFlight = false; _pushQueued = false;
  OL.active = false; OL.isHost = false; OL.mySeat = -1; OL.myRole = null;
  OL.oppName = ''; OL.oppSeat = -1; OL.seats = [];
  _clearSession();
}

/* ============================================================
   刷新重连（waiting / playing / over 均恢复）
   ============================================================ */

async function _tryReconnect(){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OL_SESSION_KEY)); } catch(e){}
  if(!saved || !saved.roomId) return false;
  try {
    const room = await netGetRoom(saved.roomId);
    if(!room || room.status === 'finished'){ _clearSession(); return false; }
    const mySeat = (room.seats || []).find(s => s.seatIndex === saved.seatIndex);
    if(!mySeat || mySeat.name !== saved.playerName){ _clearSession(); return false; }

    _roomId = saved.roomId; _mySeat = saved.seatIndex; _isHost = !!saved.isHost;
    _started = false; _resetPushState(); _departedHandled = false;
    OL.active = true; OL.isHost = _isHost; OL.mySeat = _mySeat;
    _knownSeats = (room.seats || []).length;
    _knownSeatList = room.seats || [];
    _subscribe(_roomId);

    if(room.status === 'playing' && room.state){
      _started = true;
      _stopWaitReconcile();
      _recordSeenPush(room.state);
      applyOnlineState(room.state);
      _showGameUI();
      _startReconcile();
      _toastNet('已恢复到房间 ' + _roomId);
    } else if(room.status === 'waiting'){
      if(_isHost && room.state && room.state.assign){
        _assign = room.state.assign; // 房主刷新：恢复库中的身份配置，与成员侧所见一致
      }
      _lastRow = { status: 'waiting', seats: room.seats || [], state: room.state || null };
      _showLobbyUI();
      renderWaitingRoom(_lastRow);
      _startWaitReconcile();
    } else {
      _clearSession();
      return false;
    }
    return true;
  } catch(e){
    console.warn('[online] reconnect failed:', e);
    _clearSession();
    return false;
  }
}

/* ============================================================
   启动
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const ok = await _tryReconnect();
    if(!ok) showOnlineLanding();
  } finally {
    const overlay = document.getElementById('ol-init-loading');
    if(overlay) overlay.remove();
  }
});
