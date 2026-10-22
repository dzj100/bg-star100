-- ============================================================
-- 炸弹克星：房间加入/离开的原子操作
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。
--
-- 为什么需要它：
--   客户端原来的 netJoinRoom 是「SELECT seats → 本地追加 → UPDATE seats」，
--   两人同时加入会读到同一份旧数据、拿到同一个座位号，后写覆盖先写。
--   这里用 PostgreSQL 行锁（SELECT ... FOR UPDATE）把同房间的加入/离开串行化，
--   座位号按 max(seatIndex)+1 在服务端分配。
-- ============================================================

create or replace function public.join_room(
  p_room_id text,
  p_name text,
  p_max_players integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_seats jsonb;
  v_seat_index integer;
  v_max_players integer;
  v_new_seat jsonb;
begin
  if p_room_id is null or btrim(p_room_id) = '' then
    raise exception '房间号无效';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception '昵称不能为空';
  end if;

  -- 同一房间的加入/离开在这里排队，读到的一定是上一笔提交后的最新 seats
  select * into v_room
    from public.rooms
   where id = p_room_id
     for update;

  if not found then
    raise exception '房间不存在';
  end if;
  if v_room.status = 'playing' then
    raise exception '游戏已开始';
  end if;

  v_seats := coalesce(v_room.seats::jsonb, '[]'::jsonb);
  if jsonb_typeof(v_seats) <> 'array' then
    v_seats := '[]'::jsonb;
  end if;

  v_max_players := greatest(2, least(coalesce(p_max_players, 5), 100));
  if jsonb_array_length(v_seats) >= v_max_players then
    raise exception '房间已满';
  end if;

  select coalesce(max(nullif(s->>'seatIndex', '')::integer), -1) + 1
    into v_seat_index
    from jsonb_array_elements(v_seats) as s
   where jsonb_typeof(s) = 'object';

  v_new_seat := jsonb_build_object(
    'name', p_name,
    'joinedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'seatIndex', v_seat_index
  );

  update public.rooms
     set seats = v_seats || jsonb_build_array(v_new_seat)
   where id = p_room_id
   returning * into v_room;

  return jsonb_build_object(
    'seatIndex', v_seat_index,
    'room', to_jsonb(v_room)
  );
end;
$$;

create or replace function public.leave_room(
  p_room_id text,
  p_seat_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seats jsonb;
  v_next_seats jsonb;
begin
  if p_room_id is null or btrim(p_room_id) = '' or p_seat_index is null then
    return jsonb_build_object('removed', false, 'seats', '[]'::jsonb);
  end if;

  select seats::jsonb
    into v_seats
    from public.rooms
   where id = p_room_id
     for update;

  if not found then
    -- 房间已解散/被删除：离开是幂等的，不算错误
    return jsonb_build_object('removed', false, 'seats', '[]'::jsonb);
  end if;

  v_seats := coalesce(v_seats, '[]'::jsonb);
  if jsonb_typeof(v_seats) <> 'array' then
    v_seats := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(s), '[]'::jsonb)
    into v_next_seats
    from jsonb_array_elements(v_seats) as s
   where coalesce((s->>'seatIndex')::integer, -1) <> p_seat_index;

  if v_next_seats = v_seats then
    return jsonb_build_object('removed', false, 'seats', v_seats);
  end if;

  update public.rooms
     set seats = v_next_seats
   where id = p_room_id;

  return jsonb_build_object('removed', true, 'seats', v_next_seats);
end;
$$;

-- 只允许通过函数读写；表本身仍保留原有 RLS/授权
revoke all on function public.join_room(text, text, integer) from public;
revoke all on function public.leave_room(text, integer) from public;
grant execute on function public.join_room(text, text, integer) to anon, authenticated;
grant execute on function public.leave_room(text, integer) to anon, authenticated;

-- 让 PostgREST 立即刷新 schema cache
notify pgrst, 'reload schema';
