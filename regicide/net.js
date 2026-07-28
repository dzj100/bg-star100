/**
 * net.js - Supabase 网络通信层
 * 负责房间 CRUD + Realtime 订阅
 */

const SUPABASE_URL  = 'https://smcplxyjjvehbizirvrw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ------------------------------------------------------------------ */

function generateRoomId() {
  let id = '';
  for (let i = 0; i < 4; i++) id += Math.floor(Math.random() * 10);
  return id;
}

/**
 * 创建房间
 * @returns {string} roomId
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
  return roomId;
}

/**
 * 加入房间
 * @returns {{seatIndex: number, room: object}}
 */
async function netJoinRoom(roomId, playerName) {
  roomId = roomId.toUpperCase();
  const { data: room, error } = await _supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('房间不存在');
  if (room.status === 'playing') throw new Error('游戏已开始');
  if (room.seats.length >= 4) throw new Error('房间已满');

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
 */
async function netUpdateGameState(roomId, gameState, status) {
  const update = { state: gameState };
  if (status) update.status = status;
  const { error } = await _supabase.from('rooms').update(update).eq('id', roomId);
  if (error) console.error('[net] updateGameState error:', error);
}

/**
 * 离开房间：从 seats 中移除自己
 */
async function netLeaveRoom(roomId, seatIndex) {
  roomId = roomId.toUpperCase();
  const { data: room, error } = await _supabase
    .from('rooms').select('seats').eq('id', roomId).single();
  if (error || !room) {
    console.warn('[net] netLeaveRoom: fetch failed', error);
    return;
  }
  const seats = (room.seats || []).filter(s => s.seatIndex !== seatIndex);
  console.log('[net] netLeaveRoom: roomId=', roomId, 'seatIndex=', seatIndex,
    'before=', room.seats.length, 'after=', seats.length);
  const { error: updateError } = await _supabase
    .from('rooms').update({ seats }).eq('id', roomId);
  if (updateError) console.warn('[net] netLeaveRoom update failed:', updateError);
}

/**
 * 获取房间当前数据
 */
async function netGetRoom(roomId) {
  roomId = roomId.toUpperCase();
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
 * @param {function} onChange - (row) => void，row 为更新后的完整行
 * @returns {function} unsubscribe
 */
function netSubscribeRoom(roomId, onChange) {
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
