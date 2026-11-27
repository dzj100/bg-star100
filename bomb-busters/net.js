/**
 * net.js — Supabase 网络通信层（通用模板）
 * 负责房间 CRUD + Realtime 订阅
 *
 * 用法：
 *   1. 在 HTML 中引入本地 supabase 库：
 *      <script src="supabase.min.js"></script>
 *   2. 修改下方 CONFIG 中的项目凭证
 *   3. 按需调整 ROOM_PREFIX 和 MAX_PLAYERS
 *   4. 在 Supabase SQL Editor 执行 room-rpc.sql（join_room / leave_room 原子入座）
 */

// ════════════════════════════════════════════════════════════════
//  配置区（按项目修改）
// ════════════════════════════════════════════════════════════════

const NET_CONFIG = {
  SUPABASE_URL: 'https://smcplxyjjvehbizirvrw.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM',
  ROOM_PREFIX: 'bomb-',      // 不同游戏用不同前缀，避免数据冲突
  MAX_PLAYERS: 5,            // 炸弹克星支持 2-5 人
};

// ════════════════════════════════════════════════════════════════

// 统一禁用 HTTP 缓存（no-store）：iOS WebKit 可能复用 GET 响应导致"读到旧数据"，
// 断线重连/轮询拉取必须是网络最新值。
// 同时给每个请求加超时：部分网络到 supabase.co 的链路会被静默丢弃，
// 没有超时的话 loading 会一直转圈，玩家只能杀进程。
const NET_TIMEOUT_MS = 8000;

function _netFetch(input, init) {
  const opts = Object.assign({}, init, { cache: 'no-store' });
  if (typeof AbortController !== 'function') return fetch(input, opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, NET_TIMEOUT_MS);
  return fetch(input, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

const _supabase = supabase.createClient(NET_CONFIG.SUPABASE_URL, NET_CONFIG.SUPABASE_ANON, {
  global: { fetch: _netFetch },
});

/** 将用户输入的短房间号转为完整数据库 ID */
function _fullId(shortId) {
  return NET_CONFIG.ROOM_PREFIX + (shortId || '').toUpperCase();
}

/** 从完整数据库 ID 提取用户可见的短房间号 */
function _shortId(fullId) {
  return (fullId || '').startsWith(NET_CONFIG.ROOM_PREFIX)
    ? fullId.slice(NET_CONFIG.ROOM_PREFIX.length)
    : fullId;
}

/** 把 PostgREST / PL/pgSQL 错误转成玩家能看懂的提示 */
function _rpcError(error, fallback) {
  if (!error) return fallback;
  const msg = String(error.message || error.details || '');
  if (error.code === 'PGRST202' || /Could not find the function|schema cache/i.test(msg)) {
    return '联机服务未初始化：请先在 Supabase SQL Editor 执行 room-rpc.sql';
  }
  const known = msg.match(/(房间不存在|游戏已开始|房间已满|房间号无效|昵称不能为空)/);
  return known ? known[1] : (msg || fallback);
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 链路层失败（断网/超时/被重置），区别于服务端返回的业务错误 */
function _isNetworkError(error) {
  if (!error) return false;
  const name = String(error.name || '');
  const msg = String(error.message || error.details || error || '');
  return /AbortError|TimeoutError/i.test(name)
    || /failed to fetch|load failed|networkerror|network request failed|abort|timed? out|econn|enotfound|err_internet|offline/i.test(msg);
}

/** 面向玩家的错误文案：网络类统一引导切换网络，业务类原样透出 */
function netErrorText(error, fallback) {
  if (_isNetworkError(error)) {
    return '网络连不上联机服务，请切换 Wi-Fi / 移动数据后再试';
  }
  const msg = String((error && (error.message || error.details)) || error || '');
  return msg || fallback || '网络异常，请稍后再试';
}

/** 轻量连通性探测（大厅自检）：只读一行，判断当前网络能否连到联机服务 */
async function netPing() {
  const t0 = Date.now();
  try {
    const { error } = await _supabase.from('rooms').select('id').limit(1);
    return { ok: !error, ms: Date.now() - t0, error: error || null };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e };
  }
}

/* ------------------------------------------------------------------ */

function generateRoomId() {
  let id = '';
  for (let i = 0; i < 4; i++) id += Math.floor(Math.random() * 10);
  return NET_CONFIG.ROOM_PREFIX + id;
}

/**
 * 创建房间
 *
 * 不再先 SELECT 判重（弱网下多一次往返就多一次失败面），直接 INSERT，
 * 由主键冲突兜住撞号；网络错误用同一房间号重试：
 * 若上一次其实已写入成功，重试会命中 23505，回查确认是自己的房后就按成功返回，
 * 不会给玩家留下"房间里没有人、但房号已创建"的幽灵局。
 *
 * @returns {string} 用户可见的 4 位房间号
 */
async function netCreateRoom(hostName) {
  const ATTEMPTS = 3;
  let roomId = generateRoomId();
  let lastError = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let error = null;
    try {
      ({ error } = await _supabase.from('rooms').insert({
        id: roomId,
        host_name: hostName,
        status: 'waiting',
        seats: [{ name: hostName, joinedAt: new Date().toISOString(), seatIndex: 0 }],
      }));
    } catch (e) {
      error = e;
    }
    if (!error) return _shortId(roomId);

    // 房间号撞车 or 上一次超时其实已建成功：回查确认
    if (error.code === '23505') {
      try {
        const { data } = await _supabase
          .from('rooms').select('id,host_name,status').eq('id', roomId).single();
        if (data && data.host_name === hostName && data.status === 'waiting') {
          return _shortId(roomId);
        }
      } catch (e) {}
      roomId = generateRoomId();
      lastError = error;
      continue;
    }

    lastError = error;
    if (!_isNetworkError(error) || attempt === ATTEMPTS - 1) break;
    await _sleep(500 * (attempt + 1));
  }
  throw lastError || new Error('创建房间失败');
}

/**
 * 加入房间（服务端原子操作）
 *
 * 并发加入必须由数据库串行化：join_room 会 SELECT ... FOR UPDATE 锁住房间行，
 * 校验人数后在服务端分配 max(seatIndex)+1，避免两个客户端读到同一份旧 seats、
 * 拿到同一个座位号、后写覆盖先写。RPC 见 room-rpc.sql。
 *
 * @param {string} shortId - 用户输入的 4 位房间号（无前缀）
 * @param {string} playerName - 玩家昵称
 * @returns {{seatIndex: number, room: object}} room 为加入后的权威房间行
 */
async function netJoinRoom(shortId, playerName) {
  const roomId = _fullId(shortId);
  const { data, error } = await _supabase.rpc('join_room', {
    p_room_id: roomId,
    p_name: playerName,
    p_max_players: NET_CONFIG.MAX_PLAYERS,
  });
  if (error) throw new Error(_rpcError(error, '加入房间失败'));
  if (!data || typeof data.seatIndex !== 'number' || !data.room || !Array.isArray(data.room.seats)) {
    throw new Error('加入房间失败：服务端返回异常');
  }
  return { seatIndex: data.seatIndex, room: data.room };
}

/**
 * 房主：更新游戏状态（触发 Realtime 推送给所有订阅者）
 * 移动端网络抖动（iOS 切前后台 / Wi-Fi↔蜂窝切换）会让单次请求静默失败，
 * 因此失败后指数退避重试；返回是否最终成功，调用方可用于补发判断。
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {object|null} gameState - 游戏状态快照，null 表示解散
 * @param {'waiting'|'playing'|'finished'} [status] - 房间状态
 * @returns {Promise<boolean>} 是否推送成功
 */
async function netUpdateGameState(shortId, gameState, status) {
  const roomId = _fullId(shortId);
  const update = { state: gameState };
  if (status) update.status = status;
  try { if (window.BG) BG.onlineState(status, gameState); } catch (e) {}
  const ATTEMPTS = 3;
  for (let i = 0; i < ATTEMPTS; i++) {
    const { error } = await _supabase.from('rooms').update(update).eq('id', roomId);
    if (!error) return true;
    console.error(`[net] updateGameState error (attempt ${i + 1}/${ATTEMPTS}):`, error);
    if (i < ATTEMPTS - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
  }
  return false;
}

/**
 * 仅更新房间状态，不动状态载荷。
 * 用于「返回房间」：成员端只改 status，避免自己的旧快照覆盖房主维护的 state（选关等）。
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {'waiting'|'playing'|'finished'} status - 房间状态
 * @returns {Promise<boolean>} 是否更新成功
 */
async function netSetRoomStatus(shortId, status) {
  const roomId = _fullId(shortId);
  const ATTEMPTS = 3;
  for (let i = 0; i < ATTEMPTS; i++) {
    const { error } = await _supabase.from('rooms').update({ status }).eq('id', roomId);
    if (!error) return true;
    console.error(`[net] setRoomStatus error (attempt ${i + 1}/${ATTEMPTS}):`, error);
    if (i < ATTEMPTS - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
  }
  return false;
}

/**
 * 离开房间：服务端原子移除自己
 * 与加入共用房间行锁，避免离开时整份覆盖掉同时加入的成员。
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {number} seatIndex - 自己的座位索引
 */
async function netLeaveRoom(shortId, seatIndex) {
  const roomId = _fullId(shortId);
  const { error } = await _supabase.rpc('leave_room', {
    p_room_id: roomId,
    p_seat_index: seatIndex,
  });
  if (error) console.warn('[net] netLeaveRoom failed:', _rpcError(error, '离开房间失败'));
}

/**
 * 获取房间当前数据
 * @param {string} shortId - 用户可见的 4 位房间号
 * @returns {object} room 行数据
 */
async function netGetRoom(shortId) {
  const roomId = _fullId(shortId);
  const { data, error } = await _supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * 订阅房间变化（Realtime WebSocket）
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {function} onChange - (row) => void，row 为更新后的完整行
 * @param {function} [onStatus] - (status, err) => void，透传频道状态
 *   SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED，供上层做重订阅与重同步
 * @returns {function} unsubscribe（附带 getStatus() 返回 channel.state）
 */
function netSubscribeRoom(shortId, onChange, onStatus) {
  const roomId = _fullId(shortId);
  const channel = _supabase
    .channel('room-' + roomId)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`,
    }, (payload) => {
      onChange(payload.new);
    })
    .subscribe((status, err) => {
      console.log('[net] Realtime:', status, err ? String(err.message || err) : '');
      if (typeof onStatus === 'function') onStatus(status, err);
    });

  const unsubscribe = () => _supabase.removeChannel(channel);
  unsubscribe.getStatus = () => channel.state;
  return unsubscribe;
}