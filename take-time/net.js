/**
 * net.js — Supabase 网络通信层（通用模板）
 * 负责房间 CRUD + Realtime 订阅
 *
 * 用法：
 *   1. 在 HTML 中引入 supabase CDN：
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   2. 修改下方 CONFIG 中的项目凭证
 *   3. 按需调整 ROOM_PREFIX 和 MAX_PLAYERS
 */

// ════════════════════════════════════════════════════════════════
//  配置区（按项目修改）
// ════════════════════════════════════════════════════════════════

const NET_CONFIG = {
  SUPABASE_URL: 'https://smcplxyjjvehbizirvrw.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM',
  ROOM_PREFIX: 'taketime-',  // 不同游戏用不同前缀，避免数据冲突
  MAX_PLAYERS: 4,            // 时序谜局支持 2-4 人
};

// ════════════════════════════════════════════════════════════════

const _supabase = supabase.createClient(NET_CONFIG.SUPABASE_URL, NET_CONFIG.SUPABASE_ANON);

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

/* ------------------------------------------------------------------ */

function generateRoomId() {
  let id = '';
  for (let i = 0; i < 4; i++) id += Math.floor(Math.random() * 10);
  return NET_CONFIG.ROOM_PREFIX + id;
}

/**
 * 创建房间
 * @returns {string} 用户可见的 4 位房间号
 */
async function netCreateRoom(hostName) {
  let roomId;
  let exists = true;
  while (exists) {
    roomId = generateRoomId();
    const { data } = await _supabase.from('rooms').select('id').eq('id', roomId).single();
    exists = !!data;
  }
  const { error } = await _supabase.from('rooms').insert({
    id: roomId,
    host_name: hostName,
    status: 'waiting',
    seats: [{ name: hostName, joinedAt: new Date().toISOString(), seatIndex: 0 }],
  });
  if (error) throw error;
  return _shortId(roomId);
}

/**
 * 加入房间
 * @param {string} shortId - 用户输入的 4 位房间号（无前缀）
 * @param {string} playerName - 玩家昵称
 * @returns {{seatIndex: number, room: object}}
 */
async function netJoinRoom(shortId, playerName) {
  const roomId = _fullId(shortId);
  const { data: room, error } = await _supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('房间不存在');
  if (room.status === 'playing') throw new Error('游戏已开始');
  if (room.seats.length >= NET_CONFIG.MAX_PLAYERS) throw new Error('房间已满');

  const seats = [...room.seats];
  const seatIndex = seats.length;
  seats.push({ name: playerName, joinedAt: new Date().toISOString(), seatIndex });

  const { error: updateError } = await _supabase
    .from('rooms')
    .update({ seats })
    .eq('id', roomId);
  if (updateError) throw updateError;

  return { seatIndex, room };
}

/**
 * 房主：更新游戏状态（触发 Realtime 推送给所有订阅者）
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {object|null} gameState - 游戏状态快照，null 表示解散
 * @param {'waiting'|'playing'|'finished'} [status] - 房间状态
 */
async function netUpdateGameState(shortId, gameState, status) {
  const roomId = _fullId(shortId);
  const update = { state: gameState };
  if (status) update.status = status;
  const { error } = await _supabase.from('rooms').update(update).eq('id', roomId);
  if (error) console.error('[net] updateGameState error:', error);
}

/**
 * 离开房间：从 seats 中移除自己
 * @param {string} shortId - 用户可见的 4 位房间号
 * @param {number} seatIndex - 自己的座位索引
 */
async function netLeaveRoom(shortId, seatIndex) {
  const roomId = _fullId(shortId);
  const { data: room, error } = await _supabase
    .from('rooms').select('seats').eq('id', roomId).single();
  if (error || !room) {
    console.warn('[net] netLeaveRoom: fetch failed', error);
    return;
  }
  const seats = (room.seats || []).filter(s => s.seatIndex !== seatIndex);
  const { error: updateError } = await _supabase
    .from('rooms').update({ seats }).eq('id', roomId);
  if (updateError) console.warn('[net] netLeaveRoom update failed:', updateError);
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
 * @returns {function} unsubscribe
 */
function netSubscribeRoom(shortId, onChange) {
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
    .subscribe((status) => {
      console.log('[net] Realtime:', status);
    });

  return () => _supabase.removeChannel(channel);
}