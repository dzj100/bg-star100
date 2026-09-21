/**
 * online.js — 渗透因子 · 联机协作（2~5 人：1 房主 + 1~4 成员）
 * 依赖加载顺序：game_ol.js → render_ol.js → supabase CDN → net.js → online.js（index_ol.html）
 *
 * 架构：
 *   - 房间行 state 广播完整对局快照（含 seats / hands / watches / intel）；手牌与盯梢目标
 *     的保密只是 UI 级 —— 每台客户端只渲染本座位应见内容（render_ol.js）。
 *   - 轮到谁操作，谁就在本地执行规则（game_ol.js）并把新快照 + 本次事件表（_evs）推送回房间；
 *     其余客户端应用快照并按 _evs 回放同一段演出（applyRemote）。
 *   - 等候室：房主编辑任务配置（颜色 / 数字 1 / 叛徒数 / 额外子弹）落库到 state.cfg，成员只读；
 *     2~5 人时房主可点【开始对战】—— 开局弹窗（配置 + 发牌动画 + 随机先手 5 秒倒计时）由 UI 层演出。
 *   - 座位映射：房间 seatIndex（加入顺序，可有空洞）↔ 引擎座位（0..n-1 数组序），
 *     由快照里的 _seatMap 携带，各端据此定位"我"。
 *   - localStorage 只用 infiltraitors-ol-* 前缀：单机存档（infiltraitors-state / infiltraitors-cfg）不受影响。
 */

const OL_SESSION_KEY = 'infiltraitors-ol-session'; // 房间会话（刷新重连）
const OL_NAME_KEY    = 'infiltraitors-ol-name';    // 记住昵称
const OL_CFG_KEY     = 'infiltraitors-ol-cfg';     // 房主任务配置记忆（联机专用键）

/* ============================================================
   联机会话状态
   ============================================================ */

let _roomId        = null;    // 短房间号（4 位）
let _mySeat        = -1;      // 房间座位号（0 = 房主）
let _engSeat       = -1;      // 引擎座位号（快照数组下标）
let _seatMap       = [];      // 引擎座位 → 房间座位号
let _isHost        = false;
let _playerName    = '';
let _unsub         = null;
let _receiving     = false;
let _started       = false;   // 已进入对局（房间 status=playing）
let _busy          = false;   // 网络动作互斥
let _knownSeats    = 0;
let _knownSeatList = [];
let _departedHandled = false;
let _lastRow       = null;    // 最近一次房间行（等候室重绘用）
let _lastSig       = '';      // 等候室内容签名（座位 + 配置）：未变则跳过重绘
let _cfg           = { colors: 4, one: false, traitors: 7, extra: 3 };
let _pushSeq       = 0;
let _epoch         = 0;       // 推送世代：页面/房间/重开时轮换，接收端据此重置乱序守卫
let _seenPushSeq   = {};      // 每座位已应用的最新推送 {src: {epoch, seq}}：同代旧推送忽略，防回卷
let _lastPushCur   = null;    // 上次推送时"当前行动座位"（引擎座位）
let _pending       = null;    // { act, evs } 待随下一份推送携带的本次行动事件（成功后清空）
let _pushInFlight  = false;   // 推送在途（串行化：防并发 UPDATE 竞速覆盖）
let _pushQueued    = false;   // 在途期间又有状态变化：完成后补发最新
let _cfgQ          = Promise.resolve(); // 等候室配置写入串行队列（防连点 / 与 playing 推送竞态）
let _waitTimer     = null;    // 等候室对账轮询（兜住订阅窗口内错过的 UPDATE 事件）
let _waitActiveAt  = 0;       // 等候室最后一次活动（我上报成功 / 收到房间信息）的时间戳
let _waitIdleWarned = false;  // 超出心跳窗口只提示一次
const WAIT_IDLE_MS = 5 * 60 * 1000; // 等候室轮询上限：最后一次上报/信息回传后 5 分钟暂停拉取（有活动自动恢复）
let _reconcileTimer = null;   // 对局中对账轮询：兜住实时推送漏收（断线窗口/丢包）
let _reconcileBusy  = false;
let _reconcileIdle  = 0;
const RECONCILE_IDLE_LIMIT = 20; // 连续空轮询上限：约 20×5s≈100s 无新推送即停表

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

/* ============================================================
   小工具
   ============================================================ */

function _sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function _esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const _ui = () => window.INFIL_OL_UI;
const _curSeatOf = st => (st && Number.isInteger(st.turnSeat)) ? st.turnSeat : -1;
function _overNow(){ const st = _ui().state(); return !!(st && st.over); }
function _engineSeatOf(st){
  const map = (st && Array.isArray(st._seatMap) && st._seatMap.length) ? st._seatMap : _seatMap;
  if(map && map.length){ const i = map.indexOf(_mySeat); if(i >= 0) return i; }
  const seats = (st && st.seats) || [];
  return seats.findIndex(s => s.seatIndex === _mySeat);
}
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
function _saveCfg(){ try { localStorage.setItem(OL_CFG_KEY, JSON.stringify(_cfg)); } catch(e){} }
function _loadCfg(){
  try {
    const raw = JSON.parse(localStorage.getItem(OL_CFG_KEY));
    if(raw) _cfg = window.INFIL_OL.normCfg(raw);
  } catch(e){}
}
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
   页面切换（#online 装大厅/等候室，#app 装菜单/对局）
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
/* 回首页（菜单） */
function _goHome(){
  _ui().setSeat(-1);
  _ui().showMenu();
  _showGameUI();
  _syncResumeBtn();
}
/* 菜单「继续联机对局」按钮：本地有会话且当前不在房间时亮起 */
function _syncResumeBtn(){
  const btn = document.getElementById('btnResume');
  if(!btn) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OL_SESSION_KEY)); } catch(e){}
  const on = !!(saved && saved.roomId && !_roomId);
  btn.classList.toggle('hidden', !on);
  if(on){
    const sub = document.getElementById('resumeSub');
    if(sub) sub.textContent = '房间 ' + saved.roomId + ' · 点这里重连';
  }
}

/* ============================================================
   首页 → 连接大厅（创建 / 加入）
   ============================================================ */

function olEnterLobby(){
  _showLobbyUI();
  renderOnlineLobby();
}
function renderOnlineLobby(){
  document.getElementById('online').innerHTML =
    '<div class="ol-lobby">' +
      '<div class="ol-head">' +
        '<h1 class="ol-head-title">🌐 联机协作</h1>' +
        '<button class="icon-btn" onclick="olExitLobby()">✕ 返回</button>' +
      '</div>' +
      '<button id="ol-create" class="btn-main primary ol-btn" onclick="olCreateRoom()">🏠 创建房间</button>' +
      '<div class="ol-divider">— 或加入好友的房间（2~5 人）—</div>' +
      '<label class="ol-label" for="ol-code">房间号</label>' +
      '<input id="ol-code" class="ol-input ol-code-input" type="text" inputmode="numeric" maxlength="4" placeholder="4 位数字">' +
      '<label class="ol-label" for="ol-name">你的昵称</label>' +
      '<input id="ol-name" class="ol-input" type="text" maxlength="8" placeholder="昵称" value="' + _esc(_nickName()) + '">' +
      '<button id="ol-join" class="btn-main ol-btn" onclick="olJoinRoom()">🚪 加入房间</button>' +
      '<div class="ol-credit">@imStar100</div>' +
    '</div>';
  const name = document.getElementById('ol-name');
  name.addEventListener('input', e => { _saveNick(e.target.value.trim()); });
}
function olExitLobby(){
  if(_roomId) return; // 已在房间内（异常路径）：交给房间内的退出按钮
  _goHome();
}

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
    _roomId = code; _mySeat = 0; _engSeat = 0; _isHost = true; _playerName = name;
    _started = false; _resetPushState(); _departedHandled = false;
    _knownSeats = 1;
    _knownSeatList = [{ name, joinedAt: '', seatIndex: 0 }];
    _saveSession();
    _subscribe(code);
    // 任务配置随建房间落库：不等房主显式点选，成员进房第一屏就能看到当前配置
    _cfgQ = _cfgQ
      .then(() => _pushCfgOnce())
      .catch(e => console.warn('[online] cfg init push:', e && e.message));
    _lastRow = { status: 'waiting', seats: _knownSeatList, state: { cfg: _cfg } };
    renderWaitingRoom(_lastRow);
    _startWaitReconcile();
  } catch(e){
    alert('创建房间失败：' + (e && e.message || e));
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
      '<h3>' + _esc(title) + '</h3>' +
      '<input id="ol-nick-input" class="ol-input" type="text" maxlength="8" placeholder="昵称" value="' + _esc(_nickName()) + '">' +
      '<button id="ol-nick-ok" class="btn-main primary ol-btn" onclick="olNickOk()">确定</button>' +
      '<button class="btn-main ol-btn" onclick="olNickCancel()">取消</button>' +
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

async function olJoinRoom(){
  if(_busy) return;
  const input = document.getElementById('ol-name');
  const name = input ? input.value.trim() : '';
  if(!name){ alert('请输入你的昵称'); return; }
  _saveNick(name);
  const codeInput = document.getElementById('ol-code');
  const code = (codeInput ? codeInput.value : '').trim().toUpperCase();
  if(!/^\d{4}$/.test(code)){ alert('请输入 4 位数字房间号'); return; }
  _busy = true; _setLoading(true);
  try {
    const { seatIndex } = await netJoinRoom(code, name);
    _roomId = code; _mySeat = seatIndex; _engSeat = -1; _isHost = false; _playerName = name;
    _started = false; _resetPushState(); _departedHandled = false;
    _saveSession();
    _subscribe(code);
    const row = await _fetchRoomRow(code);
    const seats = (row && row.seats) || [];
    _knownSeats = seats.length;
    _knownSeatList = seats;
    _lastRow = { status: 'waiting', seats, state: (row && row.state) || null };
    renderWaitingRoom(_lastRow);
    _startWaitReconcile();
    // 房主的配置若恰在「加入读写」间隙落库，首屏会暂时缺失：800ms 后快速补一次对账
    setTimeout(() => { if(!_started && _roomId) _reconcileRoom(); }, 800);
  } catch(e){
    alert(e && e.message || '加入失败');
  } finally { _busy = false; _setLoading(false); }
}

async function _fetchRoomRow(code){
  try {
    return await netGetRoom(code);
  } catch(e){ return null; }
}

/* ============================================================
   等候室（房主编辑任务配置 / 成员只读 + 满 2 人开战）
   ============================================================ */

const CFG_SWITCH = [
  { k: 'colors', label: '颜色数量', opts: [
    { v: 4, label: '4 色', sub: '红黄绿蓝' },
    { v: 5, label: '5 色', sub: '+黑' },
  ] },
  { k: 'one', label: '数字 1', opts: [
    { v: 0, label: '不含', sub: '数字 2~15' },
    { v: 1, label: '含 1', sub: '只判 同色 · 同数' },
  ] },
];
const CFG_NUMS = [
  { k: 'traitors', label: '叛徒数量', lo: 7, hi: 11 },
  { k: 'extra',    label: '额外子弹', lo: 0, hi: 3 },
];

function _cfgOf(row){
  return (row && row.state && row.state.cfg) ? window.INFIL_OL.normCfg(row.state.cfg) : window.INFIL_OL.normCfg(_cfg);
}
function _cfgPanelHtml(cfg, editable){
  /* one 在 normCfg 里是布尔值，段位的 v 是 0/1 —— 先归一化再比，否则该行永远没有选中态 */
  const seg = (k, items) => {
    const cur = k === 'one' ? (cfg.one ? 1 : 0) : cfg[k];
    return '<span class="seg' + (k === 'traitors' || k === 'extra' ? ' num' : '') + (editable ? '' : ' ro') + '" data-k="' + k + '">' +
      items.map(o =>
        '<button type="button" class="' + (cur === o.v ? 'on' : '') + '"' +
        (editable ? ' onclick="olPickCfg(\'' + k + '\',' + o.v + ')"' : ' disabled') + '>' +
        o.label + (o.sub ? '<small>' + o.sub + '</small>' : '') +
        '</button>').join('') +
      '</span>';
  };
  const nums = (lo, hi) => { const out = []; for(let v = lo; v <= hi; v++) out.push({ v, label: String(v) }); return out; };
  const rows = CFG_SWITCH.map(r => '<div class="cfg-row"><span class="cfg-label">' + r.label + '</span>' + seg(r.k, r.opts) + '</div>').join('') +
    CFG_NUMS.map(r => '<div class="cfg-row"><span class="cfg-label">' + r.label + '</span>' + seg(r.k, nums(r.lo, r.hi)) + '</div>').join('');
  return '<div class="cfg-panel">' + rows + '</div>';
}

function olPickCfg(k, v){
  if(!_isHost) return;
  _cfg[k] = k === 'one' ? (v === 1) : v;
  _saveCfg();
  if(_lastRow){
    _lastRow.state = _lastRow.state || {};
    _lastRow.state.cfg = { colors: _cfg.colors, one: _cfg.one, traitors: _cfg.traitors, extra: _cfg.extra };
    renderWaitingRoom(_lastRow);
  }
  if(_roomId && !_started){
    _cfgQ = _cfgQ
      .then(() => _pushCfgOnce())
      .catch(e => console.warn('[online] cfg push:', e && e.message));
  }
}
// 配置整份推送（state 列为整行替换，避免分字段推送互相覆盖）
async function _pushCfgOnce(){
  for(let attempt = 0; attempt < 2; attempt++){
    try {
      if(await netUpdateGameState(_roomId, { cfg: { colors: _cfg.colors, one: _cfg.one, traitors: _cfg.traitors, extra: _cfg.extra } }, 'waiting')){ _touchWait(); return; }
    } catch(e){}
    if(attempt === 0) await _sleep(400);
  }
  console.warn('[online] cfg push failed:', JSON.stringify(_cfg));
}
async function _flushCfgPush(){ try { await _cfgQ; } catch(e){} }

function _rowSig(row){
  return JSON.stringify([
    (row.seats || []).map(s => [s.seatIndex, s.name]),
    (row.state && row.state.cfg) || null,
  ]);
}
function _renderWaitingIfChanged(row){
  const sig = _rowSig(row);
  if(sig === _lastSig) return;
  renderWaitingRoom(row);
}

function renderWaitingRoom(row){
  const seats = (row && row.seats) || [];
  const GO = window.INFIL_OL;
  _lastRow = row;
  _lastSig = _rowSig(row);
  const cfg = _isHost ? window.INFIL_OL.normCfg(_cfg) : _cfgOf(row);
  const hasMember = seats.length >= 2;
  const free = Math.max(0, GO.SEAT_MAX - seats.length);

  const seatChips = seats.map(s => {
    const host = s.seatIndex === 0;
    const self = s.seatIndex === _mySeat;
    return '<div class="ol-seat' + (host ? ' host' : '') + (self ? ' me' : '') + '">' +
      '<span class="os-dot"></span>' +
      '<span class="os-name">' + _esc(s.name) + (self ? '（你）' : '') + '</span>' +
      '<span class="os-tag">' + (host ? '房主' : '成员') + '</span>' +
    '</div>';
  }).join('');
  const emptySlot = free > 0
    ? '<div class="ol-seat empty">' +
        '<span class="os-dot"></span>' +
        '<span class="os-name">' + (hasMember ? '还可加入 ' + free + ' 人' : '等待成员加入…（至少 2 人）') + '</span>' +
      '</div>'
    : '';

  let panel;
  if(_isHost){
    panel =
      '<div class="ol-card">' +
        '<div class="ol-label">任务配置（房主选择 · 成员实时可见）</div>' +
        _cfgPanelHtml(cfg, true) +
        '<div class="cfg-read">' + _ui().cfgReadHtml(cfg, Math.max(2, seats.length)) +
          ' · ' + seats.length + ' 人 × 5 张</div>' +
      '</div>' +
      '<button id="ol-start" class="btn-main primary ol-btn' + (hasMember ? '' : ' dis') + '" ' +
        (hasMember ? '' : 'disabled') + ' onclick="olStartGame()">' +
        '⚔️ 开始对战' + (hasMember ? '' : '（等待成员加入）') + '</button>';
  } else {
    panel =
      '<div class="ol-card">' +
        '<div class="ol-label">任务配置（房主选择）</div>' +
        _cfgPanelHtml(cfg, false) +
        '<div class="cfg-read">' + _ui().cfgReadHtml(cfg, Math.max(2, seats.length)) +
          ' · ' + seats.length + ' 人 × 5 张</div>' +
        '<div class="ol-wait-note">⏳ 等待房主开始对战…</div>' +
      '</div>';
  }

  const label = _isHost
    ? '把房间号发给好友加入（' + seats.length + '/' + GO.SEAT_MAX + ' 人）'
    : '房主：' + _esc(seats[0] ? seats[0].name : '…');
  document.getElementById('online').innerHTML =
    '<div class="ol-room">' +
      '<div class="ol-room-top">' +
        '<h1 class="ol-title">房间</h1>' +
        '<button class="icon-btn" onclick="olLeaveWaiting()">✕ 退出</button>' +
      '</div>' +
      '<div class="ol-code">' + _roomId + '</div>' +
      '<div class="ol-sub">' + label + '</div>' +
      '<div class="ol-card ol-w">' + seatChips + emptySlot + '</div>' +
      panel +
    '</div>';
}

function olLeaveWaiting(){
  _leaveRoomAndLobby('离开房间？');
}

/* ============================================================
   等候室对账轮询
   Realtime 只推送订阅建立之后的事件；若成员加入恰在订阅完成前，
   房主会错过 join 事件。轮询兜底：等待阶段每 2.5s 拉一次房间行。
   心跳上限：最后一次上报 / 信息回传后 5 分钟——窗口内无活动即暂停
   拉取（定时器保留），任何上报 / 信息回传都会自动续期恢复。
   ============================================================ */

function _startWaitReconcile(){
  _stopWaitReconcile();
  _touchWait();
  _waitTimer = setInterval(_waitTick, 2500);
  _reconcileRoom();
}
function _stopWaitReconcile(){
  if(_waitTimer){ clearInterval(_waitTimer); _waitTimer = null; }
}
/* 等候室活动打点：我上报成功 / 收到房间信息 → 心跳窗口从此刻起再续 5 分钟 */
function _touchWait(){
  _waitActiveAt = Date.now();
  _waitIdleWarned = false;
}
function _waitTick(){
  if(Date.now() - _waitActiveAt >= WAIT_IDLE_MS){
    if(!_waitIdleWarned){
      _waitIdleWarned = true;
      console.warn('[online] wait reconcile idle 5min, polling paused until next activity');
    }
    return; // 窗口内无活动：暂停拉取；任何上报 / 信息回传都会自动恢复
  }
  _reconcileRoom();
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
  // 保证「成员任何时候进入房间」都能立即读到 state.cfg
  if(_isHost && JSON.stringify(_cfgOf(room)) !== JSON.stringify(window.INFIL_OL.normCfg(_cfg))){
    _cfgQ = _cfgQ
      .then(() => _pushCfgOnce())
      .catch(e => console.warn('[online] cfg repush:', e && e.message));
  }
  const sigBefore = _lastSig;
  _syncSeats(room);
  if(room.status === 'waiting') _renderWaitingIfChanged(room);
  if(_lastSig !== sigBefore) _touchWait(); // 信息回传：座位 / 配置有变化 → 心跳窗口续期
}

/* ============================================================
   房主开局：任务配置落库 → 建 state（随机先手）→ 推 playing
   ============================================================ */

async function olStartGame(){
  if(!_isHost || _busy) return;
  if(_started) return;
  await _flushCfgPush(); // 先把配置写库，避免与 playing 推送并发竞态
  _busy = true; _setLoading(true);
  try {
    const room = await netGetRoom(_roomId);
    const seats = (room && room.seats) || [];
    if(seats.length < window.INFIL_OL.SEAT_MIN){ alert('至少需要 2 名玩家才能开始'); return; }
    if(seats.length > window.INFIL_OL.SEAT_MAX){ alert('最多 ' + window.INFIL_OL.SEAT_MAX + ' 名玩家'); return; }
    await _launchGame(seats);
  } catch(e){
    alert('开始游戏失败：' + (e && e.message || e));
  } finally { _busy = false; _setLoading(false); }
}

/* 建局 + 本地进入对局 + 推送（房主开局 / 再来一局共用） */
async function _launchGame(seats){
  const GO = window.INFIL_OL;
  _knownSeats = seats.length;
  _knownSeatList = seats;
  _seatMap = seats.map(s => s.seatIndex);
  _engSeat = _seatMap.indexOf(_mySeat);
  _resetPushState(); _lastPushCur = null; _pending = null; _departedHandled = false;
  _started = true;
  _stopWaitReconcile();
  const st = GO.newGame(_cfg, seats.map(s => ({ name: s.name })));
  st.seats = seats.map((s, i) => ({ seatIndex: i, name: s.name }));
  st._seatMap = _seatMap.slice();
  _ui().setSeat(_engSeat);
  _ui().setRoom(_roomId, seats.length);
  _showGameUI();
  _ui().showGame();
  await _ui().applyRemote(st, { replay: false }); // 开局弹窗（配置 + 发牌 + 随机先手）由 UI 层演出
  _startReconcile();
  _markPush('playing');
}

/** 再来一局：沿用当前任务配置（房主专用，结算页按钮调用） */
async function olRematch(){
  if(!_isHost || !_started || _busy) return;
  _busy = true; _setLoading(true);
  try {
    let seats = _knownSeatList;
    try {
      const room = await netGetRoom(_roomId);
      if(room && room.seats) seats = room.seats;
    } catch(e){}
    if(!seats || seats.length < window.INFIL_OL.SEAT_MIN){
      alert('人数不足，无法再来一局');
      return;
    }
    await _launchGame(seats);
  } catch(e){
    alert('再来一局失败：' + (e && e.message || e));
  } finally { _busy = false; _setLoading(false); }
}

/** 结算页「返回房间改配置」（房主专用，底部按钮）：房间行退回 waiting（保留当前配置），
    成员实时收到后同样回到等候室；房主可改配置并再次开局。 */
async function olBackToRoom(){
  if(!_isHost || !_roomId || _busy) return;
  _busy = true; _setLoading(true);
  try {
    try { await _cfgQ; } catch(e){}
    _cfgQ = _pushCfgOnce().catch(e => console.warn('[online] back-to-room push:', e && e.message));
    await _cfgQ;
    let row = { status: 'waiting', seats: _knownSeatList.slice(), state: { cfg: _cfg } };
    try { const r = await netGetRoom(_roomId); if(r) row = r; } catch(e){}
    _resetToWaitingRoom(row);
    _toastNet('已回到等候室，可调整任务配置');
  } finally { _busy = false; _setLoading(false); }
}

/** 对局/结算 → 等候室（房主「返回房间改配置」推送后本地复位，或收到 waiting 行时随行复位） */
function _resetToWaitingRoom(row){
  _stopReconcile();
  _started = false;
  _resetPushState(); _lastPushCur = null; _pending = null;
  _engSeat = -1;
  _ui().resetIntro();
  _ui().showMenu(); // 清掉对局快照与结算面板（紧接着被等候室覆盖）
  _knownSeats = (row.seats || []).length;
  _knownSeatList = row.seats || [];
  _departedHandled = false;
  _lastRow = row;
  _lastSig = '';
  _showLobbyUI();
  renderWaitingRoom(row);
  _startWaitReconcile();
}

/* ============================================================
   状态推送（本机 = 行动方，本地即权威）
   ============================================================ */

/* render_ol.js 在每次成功行动后调用：把最新快照 + 本次事件表交给推送队列 */
function onlinePushState(act, evs){
  if(!_roomId || _receiving || !_started) return;
  const st = _ui().state();
  if(!st || !st.seats || !st.seats.length) return;
  _pending = { act: act || '', evs: (evs && evs.length) ? evs : null };
  _markPush('playing');
}

function _markPush(status){
  // 串行化：上一次推送在途时只记录，由 _sendLatest 完成后补发最新状态，
  // 避免同一操作内多次推送产生并发 UPDATE 竞速、旧快照最后落库。
  if(_pushInFlight){ _pushQueued = true; return; }
  _sendLatest(status);
}

async function _sendLatest(status){
  if(!_roomId || !_started) return;
  const st = _ui().state();
  if(!st || !st.seats || !st.seats.length) return;
  const pending = _pending; // 本份要携带的动作事件（在途期间可能被更新的动作覆盖）
  _pushSeq++;
  _lastPushCur = _curSeatOf(st);
  _pushInFlight = true;
  let carried = false;
  try {
    let ok = false;
    for(let attempt = 0; attempt < 2 && !ok; attempt++){
      // 每次尝试都重新序列化最新本地状态：重试若复用首次快照，旧状态晚到会覆盖对方已应用的新进度（回卷）
      const snap = JSON.parse(JSON.stringify(st));
      // _evs 必须每份都显式赋值（可为 null）：否则接收端会重放上一份残留事件
      snap._evs = (pending && pending.evs) ? JSON.parse(JSON.stringify(pending.evs)) : null;
      snap._act = (pending && pending.act) || '';
      snap._pushId = _mySeat + '-' + _pushSeq;
      snap._epoch = _epoch;
      snap._src = _mySeat;
      snap._seatMap = _seatMap.slice();
      carried = !!pending;
      try { ok = await netUpdateGameState(_roomId, snap, status); }
      catch(e){ console.warn('[online] push exception:', e && e.message); }
      if(!ok && attempt === 0) await _sleep(400);
    }
    if(ok && _pending === pending) _pending = null; // 事件已随成功快照发出（只发一次）
    if(!ok) console.warn('[online] push failed after retry:', _pushSeq);
  } finally {
    _pushInFlight = false;
    if(_pushQueued){
      _pushQueued = false;
      if(_roomId && _started) _sendLatest(status); // 补发期间产生的最新状态
    }
  }
}

/* ============================================================
   状态接收（Realtime + 对账轮询）
   ============================================================ */

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
  const gone = shrunk ? _knownSeatList.find(s => seats.every(x => x.seatIndex !== s.seatIndex)) : null;
  _syncSeats(row);

  if(gone && gone.seatIndex === _mySeat) return; // 自己退出的 echo（退出流程已在处理）

  if(gone && gone.seatIndex === 0){
    // 房主离开：房间无法继续，回首页
    _cleanupOnline();
    _goHome();
    alert('房主已离开，房间已解散');
    return;
  }
  if(gone && _started){
    _departedHandled = true; // 对局中成员离开：弹出处理，只弹一次
    _onMemberLeft(gone);
    return;
  }

  // 房主结算页「返回房间改配置」：房间行退回 waiting → 我若停在结算页也随行回等候室
  // （对局中途收到 waiting 行不可能是合法推进，只有结算页这个入口会产生）
  if(row.status === 'waiting' && _started && _overNow()){
    _resetToWaitingRoom(row);
    return;
  }
  if(row.status === 'playing' && row.state){
    _handleRemoteState(row); // 含成员首条 playing 推送（_started 尚为 false 时也处理）
    return;
  }
  if(!_started && row.status === 'waiting'){
    _touchWait(); // 信息回传：实时行送达 → 心跳窗口续期
    _renderWaitingIfChanged(row);
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
  if(!st) return false;
  if(st._src === _mySeat) return false;             // 自己推送的 echo，本地已是最新
  if(st._pushId && !_isPushNewer(st)) return false; // 乱序守卫：同世代旧推送忽略，防回卷
  _receiveState(st, !_started);
  return true;
}

/* 应用远端快照：定位我的引擎座位 → 交给 UI 层（含 _evs 回放 / 首局弹窗） */
async function _receiveState(st, firstEnter){
  _receiving = true;
  try {
    if(st._pushId) _recordSeenPush(st);
    _started = true;
    _isHost = _mySeat === 0;
    if(Array.isArray(st._seatMap)) _seatMap = st._seatMap.slice();
    _engSeat = _engineSeatOf(st);
    _stopWaitReconcile();
    if(firstEnter){
      _showGameUI();
      _ui().showGame();
    }
    _ui().setSeat(_engSeat);
    _ui().setRoom(_roomId, (st.seats || []).length);
    await _ui().applyRemote(st, { replay: true });
    _lastPushCur = _curSeatOf(st); // 镜像对方推送的当前行动座位：避免在对方新局上重复补推
    if(firstEnter) _toastNet('对局开始：' + (st.seats || []).length + ' 人协作');
    _startReconcile();
  } finally {
    _receiving = false;
  }
}

/* ============================================================
   对局中对账轮询：实时推送偶有漏收（网络抖动 / 断线窗口），
   等待其他玩家行动时每 5s 拉一次房间行，发现更新推送则补账，防各端僵等。
   ============================================================ */

function _startReconcile(){
  _stopReconcile();
  _reconcileIdle = 0; // 重新开播（新回合 / 新推送 / 重进对局）时清空空轮询计数
  _reconcileTimer = setInterval(() => { _reconcileOnce(); }, 5000);
}
function _stopReconcile(){
  if(_reconcileTimer){ clearInterval(_reconcileTimer); _reconcileTimer = null; }
}
async function _reconcileOnce(){
  if(!_roomId || !_started || _receiving || _pushInFlight || _reconcileBusy) return;
  const cur = _ui().state();
  const overPhase = !!(cur && cur.over);
  // 对局中我的回合：本地即权威，无需对账；结算页则继续盯房主动向（再来一局 / 返回房间 / 解散），
  // 兜住这三类跳转的实时行漏收——因此结算页即使轮到"我"（按残余 turnSeat 判断）也要轮询
  if(!overPhase && _curSeatOf(cur) === _engSeat) return;
  if(_ui().busy()) return; // 本机演出中：等下一轮再对账
  _reconcileBusy = true;
  let applied = false;
  try {
    const room = await netGetRoom(_roomId);
    if(!room){ /* 行读不到：下一轮再试 */ }
    else if(room.status === 'finished'){
      _roomDissolved(); // 房主解散漏收实时行（结算页 / 对局中均适用）→ 兜底回首页
    } else if(overPhase && room.status === 'waiting'){
      _resetToWaitingRoom(room); // 房主「返回房间改配置」漏收实时行 → 对账补回等候室
      applied = true;
    } else {
      const rs = room.state;
      if(rs && rs._pushId && rs._src !== _mySeat && _isPushNewer(rs)){
        // 保留 _evs / _act 交给 applyRemote 消费：reconcile 能见到它说明实时推送漏了这份行动行
        // （seen 守卫保证只应用一次），接收端仍需补播同一段演出，观感与实时路径一致。
        _receiveState(rs, !_started);
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
      _stopReconcile(); // 连续 20 次无进展：对局已稳定（或他人已弃局），停表
    }
  }
}

/* ============================================================
   解散 / 退出
   ============================================================ */

/** 房主解散房间（null state + finished） */
function _dissolveRoom(){
  _busy = true; _setLoading(true);
  try {
    netUpdateGameState(_roomId, null, 'finished');
    _cleanupOnline();
    _toastNet('房间已解散');
    _goHome();
  } finally { _busy = false; _setLoading(false); }
}

/** 房间解散（我收到 finished + 无 state） */
function _roomDissolved(){
  if(!_roomId) return; // 幂等：重复 finished 推送只处理一次
  const wasHost = _isHost;
  _cleanupOnline();
  _goHome();
  alert(wasHost ? '房间已解散' : '房主已离开，房间已解散');
}

/** 对局中有成员离开：房主只能解散（少一名玩家的手牌 / 盯梢目标无法接续）；成员等房主处理 */
function _onMemberLeft(gone){
  const name = gone.name || '成员';
  if(_isHost){
    _showMemberLeftDialog(name);
    return;
  }
  alert(name + ' 已离开，本局无法继续，等待房主解散房间');
}

function olConfirmQuit(){
  if(!_roomId){ _goHome(); return; }
  const title = _started ? '退出房间？' : '离开房间？';
  const body = _started ? '对局进度将丢失，确定退出当前房间？' : '当前等候室将退出，房间号可再次使用。';
  const ov = _ensureModal('ol-modal-quit', title, body,
    '<button class="btn-main primary ol-btn" onclick="olConfirmExit()">确认退出</button>' +
    '<button class="btn-main ol-btn" onclick="olCloseModal(\'ol-modal-quit\')">取消</button>');
  ov.classList.add('show');
}

function _ensureModal(id, title, body, buttonsHTML, outsideClose){
  let ov = document.getElementById(id);
  if(!ov){
    ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = id;
    ov.innerHTML = '<div class="modal"><h3>' + _esc(title) + '</h3>' +
      '<p>' + body + '</p>' + buttonsHTML + '</div>';
    if(outsideClose !== false){
      ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('show'); });
    }
    document.body.appendChild(ov);
  }
  return ov;
}
function olCloseModal(id){
  const el = document.getElementById(id);
  if(el) el.classList.remove('show');
}

function olConfirmExit(){
  olCloseModal('ol-modal-quit');
  _doExitRoom();
}

function _doExitRoom(){
  const code = _roomId;
  const seat = _mySeat;
  const wasHost = _isHost;
  if(code && seat >= 0){
    if(wasHost) netUpdateGameState(code, null, 'finished'); // 房主退出 = 解散
    else netLeaveRoom(code, seat);                          // 成员退出 = 让出座位
  }
  _cleanupOnline();
  _toastNet(wasHost ? '已解散房间' : '已退出房间');
  _goHome();
}

function _leaveRoomAndLobby(msg){
  const ov = _ensureModal('ol-modal-leave', msg,
    '当前等候室将退出，房间号可再次使用。',
    '<button class="btn-main primary ol-btn" onclick="olLeaveRoomConfirm()">确认退出</button>' +
    '<button class="btn-main ol-btn" onclick="olCloseModal(\'ol-modal-leave\')">取消</button>');
  ov.classList.add('show');
}
function olLeaveRoomConfirm(){
  olCloseModal('ol-modal-leave');
  _doExitRoom();
}

/** 成员离开弹窗（对局中，房主侧；必须解散，遮罩点击不关闭） */
function _showMemberLeftDialog(name){
  const ov = _ensureModal('ol-modal-member-gone', '⚠️ 成员已离开',
    '「' + _esc(name) + '」退出了房间，本局无法继续，只能解散房间。',
    '<button class="btn-main primary ol-btn" onclick="olDissolveConfirm()">解散房间</button>', false);
  ov.classList.add('show');
}
function olDissolveConfirm(){
  olCloseModal('ol-modal-member-gone');
  _dissolveRoom();
}

function _cleanupOnline(){
  if(_unsub){ _unsub(); _unsub = null; }
  _stopWaitReconcile();
  _stopReconcile();
  _seenPushSeq = {};
  ['ol-modal-quit', 'ol-modal-leave', 'ol-modal-member-gone'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.remove();
  });
  _roomId = null; _mySeat = -1; _engSeat = -1; _seatMap = [];
  _isHost = false; _started = false; _receiving = false;
  _knownSeats = 0; _knownSeatList = []; _departedHandled = false;
  _lastRow = null; _lastSig = ''; _resetPushState(); _lastPushCur = null;
  _pending = null; _pushInFlight = false; _pushQueued = false;
  _clearSession();
}

/* ============================================================
   刷新重连（waiting / playing 均恢复）
   ============================================================ */

async function _tryReconnect(){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OL_SESSION_KEY)); } catch(e){}
  if(!saved || !saved.roomId || !Number.isInteger(saved.seatIndex)) return false;
  try {
    const room = await netGetRoom(saved.roomId);
    if(!room || room.status === 'finished'){ _clearSession(); return false; }
    const mine = (room.seats || []).find(s => s.seatIndex === saved.seatIndex);
    if(!mine || mine.name !== saved.playerName){ _clearSession(); return false; }

    _roomId = saved.roomId; _mySeat = saved.seatIndex; _isHost = saved.seatIndex === 0;
    _playerName = saved.playerName;
    _started = false; _resetPushState(); _departedHandled = false;
    _knownSeats = (room.seats || []).length;
    _knownSeatList = room.seats || [];
    _subscribe(_roomId);

    if(room.status === 'playing' && room.state){
      _started = true;
      _stopWaitReconcile();
      if(Array.isArray(room.state._seatMap)) _seatMap = room.state._seatMap.slice();
      _engSeat = _engineSeatOf(room.state);
      _recordSeenPush(room.state);
      _ui().setSeat(_engSeat);
      _ui().setRoom(_roomId, (room.seats || []).length);
      _showGameUI();
      _ui().showGame();
      // intro:false —— 中途重连不再回放开局弹窗（把当前 introId 记为已见）
      await _ui().applyRemote(room.state, { replay: false, intro: false });
      _lastPushCur = _curSeatOf(room.state);
      _startReconcile();
      _toastNet('已恢复到房间 ' + _roomId);
    } else if(room.status === 'waiting'){
      if(_isHost && room.state && room.state.cfg){
        _cfg = window.INFIL_OL.normCfg(room.state.cfg); // 房主刷新：恢复库中配置，与成员侧所见一致
        _saveCfg();
      }
      _lastRow = { status: 'waiting', seats: room.seats || [], state: room.state || null };
      _lastSig = '';
      _showLobbyUI();
      renderWaitingRoom(_lastRow);
      _startWaitReconcile();
    } else {
      _clearSession();
      return false;
    }
    _saveSession();
    return true;
  } catch(e){
    console.warn('[online] reconnect failed:', e); // 网络抖动：保留会话，可手动重连
    return false;
  }
}

/** 菜单「继续联机对局」：手动重连 */
async function olManualReconnect(){
  if(_busy) return;
  _busy = true; _setLoading(true);
  try {
    const ok = await _tryReconnect();
    if(!ok) _toastNet('无法恢复上次的房间（可能已解散）');
  } finally { _busy = false; _setLoading(false); _syncResumeBtn(); }
}

/* ============================================================
   测试钩子（离线驱动大厅 / 等候室：注入身份与房间号，不触网）
   ============================================================ */

window.INFIL_OL_NET_TEST = {
  identity(host, seat, room){ _isHost = !!host; _mySeat = seat | 0; _roomId = room == null ? null : String(room); },
  info(){ return { host: _isHost, seat: _mySeat, room: _roomId, started: _started }; },
  /* 等候室心跳：开播 / 停表 / 状态 / 活动时间回拨 / 手动触发一次 tick（离线验证 5 分钟上限） */
  waitStart(){ _startWaitReconcile(); },
  waitStop(){ _stopWaitReconcile(); },
  waitPoll(){ return { active: !!_waitTimer, idleMs: Date.now() - _waitActiveAt, warned: _waitIdleWarned }; },
  waitAge(ms){ _waitActiveAt = Date.now() - (ms | 0); _waitIdleWarned = false; },
  waitTick(){ _waitTick(); },
};

/* ============================================================
   启动
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  _loadCfg();
  _ui().setFx(true);
  try {
    await _tryReconnect();
  } catch(e){
    console.warn('[online] boot reconnect:', e && e.message);
  } finally {
    const overlay = document.getElementById('ol-init-loading');
    if(overlay) overlay.remove();
    _syncResumeBtn();
  }
});
