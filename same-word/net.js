/**
 * net.js — Supabase 房间通信层（同词相遇）
 * 房间 CRUD + Realtime 订阅 + rev 乐观锁写状态
 *
 * 与 take-time/net.js 的差异：
 *  - 前缀 sameword-，最大 4 人；加入时按最小空位分配座位（离席后不留空洞冲突）；
 *  - netUpdateGameState 支持 expectRev 条件更新（state->>rev），
 *    返回 { ok, conflict } 而不再抛错；PostgREST 不支持该过滤时自动降级为
 *    「无条件更新 + 读回校验」；
 *  - 重试/退避全部上移到 online.js（本文件每调用只发一次请求）。
 */

const NET_CONFIG = {
  SUPABASE_URL: 'https://smcplxyjjvehbizirvrw.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM',
  ROOM_PREFIX: 'sameword-',
  MAX_PLAYERS: 4,
};

// 统一禁用 HTTP 缓存（no-store）：iOS WebKit 可能复用 GET 响应导致"读到旧数据"，
// 断线重连/轮询拉取必须是网络最新值
const _supabase = supabase.createClient(NET_CONFIG.SUPABASE_URL, NET_CONFIG.SUPABASE_ANON, {
  global: {
    fetch: (input, init) => fetch(input, Object.assign({}, init, { cache: 'no-store' })),
  },
});

// state->>rev 条件过滤是否可用：null=未知 / true=可用 / false=已确认不可用（此后走降级路径）
let _revFilterSupported = null;

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

function generateRoomId() {
  let id = '';
  for (let i = 0; i < 4; i++) id += Math.floor(Math.random() * 10);
  return NET_CONFIG.ROOM_PREFIX + id;
}

/* ------------------------------------------------------------------ */
/*  房间 CRUD                                                          */
/* ------------------------------------------------------------------ */

/**
 * 创建房间
 * @param {string} hostName
 * @param {object} [initialState] - 写入 rooms.state 的初始状态（等候室 pending）
 * @param {'waiting'|'playing'} [status='waiting']
 * @returns {Promise<string>} 用户可见的 4 位房间号
 */
async function netCreateRoom(hostName, initialState, status) {
  let roomId = null;
  for (let i = 0; i < 8; i++) {
    const candidate = generateRoomId();
    const { data } = await _supabase.from('rooms').select('id').eq('id', candidate).maybeSingle();
    if (!data) { roomId = candidate; break; }
  }
  if (!roomId) throw new Error('房间号分配失败，请重试');

  const row = {
    id: roomId,
    host_name: hostName,
    status: status || 'waiting',
    seats: [{ name: hostName, joinedAt: new Date().toISOString(), seatIndex: 0 }],
  };
  if (initialState !== undefined && initialState !== null) row.state = initialState;

  const { error } = await _supabase.from('rooms').insert(row);
  if (error) throw error;
  return _shortId(roomId);
}

/**
 * 加入房间（仅 waiting；双人房满 2 席即锁定）
 * @param {string} shortId - 4 位房间号（无前缀）
 * @param {string} playerName
 * @returns {Promise<{seatIndex:number, room:object}>} room 为写回后的最新行快照
 */
async function netJoinRoom(shortId, playerName) {
  const roomId = _fullId(shortId);
  const { data: room, error } = await _supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  if (error || !room) throw new Error('房间不存在');
  if (room.state && room.state.closed) throw new Error('房间已解散');
  if (room.status === 'finished') throw new Error('房间已结束');
  if (room.status === 'playing') throw new Error('游戏已开始');

  const seats = Array.isArray(room.seats) ? room.seats.slice() : [];
  if (seats.length >= NET_CONFIG.MAX_PLAYERS) throw new Error('房间已满');
  const pendingMode = room.state && room.state.pending && room.state.pending.mode;
  if (pendingMode === 'duel' && seats.length >= 2) throw new Error('双人房间已满');

  // 最小空位：成员离席后不留空洞（否则新座位号会与旧座位冲突）
  let seatIndex = -1;
  for (let i = 0; i < NET_CONFIG.MAX_PLAYERS; i++) {
    if (!seats.some(s => s && s.seatIndex === i)) { seatIndex = i; break; }
  }
  if (seatIndex < 0) throw new Error('房间已满');

  seats.push({ name: playerName, joinedAt: new Date().toISOString(), seatIndex });
  seats.sort((a, b) => a.seatIndex - b.seatIndex);

  const { error: updateError } = await _supabase
    .from('rooms')
    .update({ seats })
    .eq('id', roomId);
  if (updateError) throw updateError;

  room.seats = seats;
  return { seatIndex, room };
}

/**
 * 离开房间：从 seats 中移除自己的座位（不改 status，房主另行处理）
 * @returns {Promise<void>}
 */
async function netLeaveRoom(shortId, seatIndex) {
  const roomId = _fullId(shortId);
  const { data: room, error } = await _supabase
    .from('rooms').select('seats').eq('id', roomId).maybeSingle();
  if (error || !room) {
    console.warn('[net] netLeaveRoom: fetch failed', error && error.message);
    return;
  }
  const seats = (room.seats || []).filter(s => s && s.seatIndex !== seatIndex);
  const { error: updateError } = await _supabase
    .from('rooms').update({ seats }).eq('id', roomId);
  if (updateError) console.warn('[net] netLeaveRoom update failed:', updateError.message);
}

/**
 * 读取房间整行
 * @returns {Promise<object>} room 行；不存在时抛错（code='PGRST116' 表示 0 行）
 */
async function netGetRoom(shortId) {
  const roomId = _fullId(shortId);
  const { data, error } = await _supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error('房间不存在或已解散');
    err.code = 'PGRST116';
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  写状态（rev 乐观锁）                                                */
/* ------------------------------------------------------------------ */

/**
 * 条件更新：state->>rev = expectRev 才写入。
 * @returns {Promise<object|null>} 结果对象；null 表示 PostgREST 不支持该过滤（需降级）
 */
async function _updateConditional(roomId, update, expectRev) {
  let res;
  try {
    res = await _supabase
      .from('rooms')
      .update(update)
      .eq('id', roomId)
      .eq('state->>rev', String(expectRev))
      .select('id');
  } catch (e) {
    _revFilterSupported = false;
    console.warn('[net] conditional update threw, fallback to plain update:', e && e.message);
    return null;
  }

  const { data, error, status } = res;
  if (error) {
    const code = error.code || '';
    const msg = String(error.message || '');
    // 400 / PGRST100 / 解析类错误 → 视为不支持 JSON 路径过滤
    if (status === 400 || code === 'PGRST100' || /filter|operator|json/i.test(msg)) {
      _revFilterSupported = false;
      console.warn('[net] PostgREST 拒绝 state->>rev 过滤，降级为无条件更新+读回校验:', msg);
      return null;
    }
    return { ok: false, conflict: false, error: msg || code };
  }
  _revFilterSupported = true;
  // .select('id') 后 0 行 = rev 已被抢写
  if (!Array.isArray(data) || data.length === 0) return { ok: false, conflict: true };
  return { ok: true, conflict: false };
}

/**
 * 无条件更新 + 读回校验（降级路径）。冲突窗口约一个网络往返，由 online.js 的
 * 重试 + 轮询 + 房主校正兜住。
 */
async function _updatePlain(roomId, update) {
  const { error } = await _supabase.from('rooms').update(update).eq('id', roomId);
  if (error) return { ok: false, conflict: false, error: error.message };

  try {
    const { data, error: readErr } = await _supabase
      .from('rooms').select('state').eq('id', roomId).maybeSingle();
    if (readErr || !data) return { ok: true, conflict: false, verified: false };
    const remote = data.state || {};
    const mine = update.state || {};
    if (remote._pushId && mine._pushId && remote._pushId === mine._pushId) {
      return { ok: true, conflict: false, verified: true };
    }
    const rrev = Number(remote.rev) || 0;
    const mrev = Number(mine.rev) || 0;
    // 读回已是我写的内容 → 被更新的一次写入覆盖（rev 更高）→ 报冲突让上层重合并
    if (rrev > mrev) return { ok: false, conflict: true, verified: true };
    return { ok: true, conflict: false, verified: false };
  } catch (e) {
    return { ok: true, conflict: false, verified: false };
  }
}

/**
 * 写房间状态（单一写入方语义由调用方保证）
 * @param {string} shortId
 * @param {object|null} gameState - 新状态快照（null 表示清空）
 * @param {'waiting'|'playing'|'finished'} [status]
 * @param {number|null} [expectRev] - 期望的远端 rev；提供时走条件更新
 * @returns {Promise<{ok:boolean, conflict:boolean, error?:string, verified?:boolean}>}
 *   永不抛错：conflict=true 表示 rev 被抢写（调用方重读重合并）；
 *   ok=false 且 conflict=false 表示传输层错误。
 */
async function netUpdateGameState(shortId, gameState, status, expectRev) {
  const roomId = _fullId(shortId);
  const update = { state: gameState };
  if (status) update.status = status;

  try {
    // 只有房主记录开局/结算，避免成员推自己字段时误结掉本地残留的起点
    const isHostView = !window.SWN || typeof SWN.isHost !== 'function' || SWN.isHost();
    if (window.BG && isHostView) {
      // 结算：带上同词相遇自己的 result（match/allmatch/agree/limit/giveup），
      // 有起点时才真正落库；随后 onlineState 的通用兜底会因起点已清而跳过
      if (status === 'finished' && gameState && gameState.result && typeof BG.onlineEnd === 'function') {
        BG.onlineEnd(String(gameState.result));
      }
      if (typeof BG.onlineState === 'function') BG.onlineState(status, gameState);
    }
  } catch (e) {}

  const hasExpect = typeof expectRev === 'number' && isFinite(expectRev);

  try {
    if (hasExpect && _revFilterSupported !== false) {
      const result = await _updateConditional(roomId, update, expectRev);
      if (result) return result;
    }
    return await _updatePlain(roomId, update);
  } catch (e) {
    console.error('[net] updateGameState exception:', e);
    return { ok: false, conflict: false, error: String((e && e.message) || e) };
  }
}

/* ------------------------------------------------------------------ */
/*  Realtime                                                           */
/* ------------------------------------------------------------------ */

/**
 * 订阅房间变化
 * @param {string} shortId
 * @param {function} onChange - (row) => void；row=null 表示房间已删除
 * @param {function} [onStatus] - (status, err) => void
 * @returns {function} unsubscribe（附带 getStatus()）
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
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`,
    }, () => {
      onChange(null);
    })
    .subscribe((status, err) => {
      console.log('[net] Realtime:', status, err ? String(err.message || err) : '');
      if (typeof onStatus === 'function') onStatus(status, err);
    });

  const unsubscribe = () => _supabase.removeChannel(channel);
  unsubscribe.getStatus = () => channel.state;
  return unsubscribe;
}