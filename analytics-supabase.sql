-- ============================================================
-- 桌游助手合集 · 游客行为采集 Supabase 初始化
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。
--
-- 只采集：进入平台 / 打开游戏 / 联机开局 / 联机结算。
-- 身份沿用留言板方案：浏览器保存 64 位随机令牌，服务端只存 SHA-256。
-- 匿名端只能通过 analytics_track 写入，不能读取任何明细。
-- 日切分按 Asia/Shanghai。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.analytics_events (
  event_id     uuid primary key,
  visitor_hash text not null,
  session_id   uuid not null,
  name         text not null,
  game         text,
  props        jsonb not null default '{}'::jsonb,
  ts           timestamptz not null,
  received_at  timestamptz not null default now()
);

create index if not exists analytics_events_ts_idx
  on public.analytics_events (ts desc);
create index if not exists analytics_events_visitor_idx
  on public.analytics_events (visitor_hash, received_at desc);
create index if not exists analytics_events_name_idx
  on public.analytics_events (name, ts desc);

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from anon, authenticated;

-- 写入：白名单事件名、单批 ≤30 条、props ≤1KB、时间夹在最近 7 天到未来 5 分钟、
-- 单令牌每分钟 ≤120 条；event_id 幂等。
create or replace function public.analytics_track(
  p_token text,
  p_session uuid,
  p_events jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_hash text;
  v_allowed text[] := array['platform_enter', 'game_enter', 'online_start', 'online_end'];
begin
  if char_length(v_token) < 32 then
    raise exception '身份标识无效';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception '事件格式无效';
  end if;
  if jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 30 then
    raise exception '事件数量无效';
  end if;

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  if (
    select count(*)
      from public.analytics_events e
     where e.visitor_hash = v_hash
       and e.received_at > now() - interval '1 minute'
  ) > 120 then
    raise exception '上报过于频繁';
  end if;

  insert into public.analytics_events
    (event_id, visitor_hash, session_id, name, game, props, ts)
  select
    (e.ev->>'id')::uuid,
    v_hash,
    coalesce(p_session, gen_random_uuid()),
    e.ev->>'name',
    left(coalesce(e.ev->>'game', ''), 40),
    case
      when jsonb_typeof(e.ev->'props') = 'object' then e.ev->'props'
      else '{}'::jsonb
    end,
    greatest(
      least(coalesce((e.ev->>'ts')::timestamptz, now()), now() + interval '5 minutes'),
      now() - interval '7 days'
    )
  from jsonb_array_elements(p_events) as e(ev)
  where (e.ev->>'name') = any(v_allowed)
    and coalesce(e.ev->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(pg_column_size(e.ev->'props'), 0) <= 1024
  on conflict (event_id) do nothing;
end;
$$;

revoke all on function public.analytics_track(text, uuid, jsonb) from public;
grant execute on function public.analytics_track(text, uuid, jsonb) to anon, authenticated;

-- ============================================================
-- 统计视图（看板用；当前不对 anon / authenticated 开放）
-- ============================================================

-- 每天每个游戏：打开数、联机开局数、平均时长、总时长
create or replace view public.v_daily_game as
select
  day,
  game,
  count(*) filter (where name = 'game_enter') as opens,
  count(*) filter (where name = 'online_start') as online_starts,
  count(*) filter (where name = 'online_end') as online_ends,
  round(avg(ms) filter (where name = 'online_end' and ms > 0)) as avg_seconds,
  round(sum(ms) filter (where name = 'online_end' and ms > 0) / 60.0) as total_minutes,
  round(avg(ms) filter (where name = 'online_end' and ms > 0 and result <> 'left')) as avg_completed_seconds
from (
  select
    (ts at time zone 'Asia/Shanghai')::date as day,
    name,
    game,
    case when (props->>'ms') ~ '^\d+$' then round((props->>'ms')::numeric / 1000) end as ms,
    coalesce(props->>'result', '') as result
  from public.analytics_events
) t
group by day, game
order by day desc, opens desc;

-- 每天活跃：访客数 / 新增访客数 / 会话数
create or replace view public.v_daily_active as
with daily as (
  select distinct
    (ts at time zone 'Asia/Shanghai')::date as day,
    visitor_hash
  from public.analytics_events
),
first_seen as (
  select visitor_hash, min(day) as first_day
  from daily
  group by visitor_hash
),
sessions as (
  select
    (ts at time zone 'Asia/Shanghai')::date as day,
    count(distinct session_id) as session_count
  from public.analytics_events
  group by 1
)
select
  d.day,
  count(*) as visitors,
  count(*) filter (where f.first_day = d.day) as new_visitors,
  coalesce(s.session_count, 0) as sessions
from daily d
join first_seen f using (visitor_hash)
left join sessions s using (day)
group by d.day, s.session_count
order by d.day desc;

-- 游戏切换：from → to
create or replace view public.v_game_switch as
select
  (ts at time zone 'Asia/Shanghai')::date as day,
  props->>'from' as from_game,
  game as to_game,
  count(*) as switches
from public.analytics_events
where name = 'game_enter'
  and coalesce(props->>'from', '') <> ''
  and props->>'from' <> game
group by 1, 2, 3
order by 1 desc, 4 desc;

-- 留存：按首次活跃日分组的次留 / 7 日留存
create or replace view public.v_retention as
with daily as (
  select distinct
    (ts at time zone 'Asia/Shanghai')::date as day,
    visitor_hash
  from public.analytics_events
),
first_seen as (
  select visitor_hash, min(day) as first_day
  from daily
  group by visitor_hash
)
select
  f.first_day as cohort_day,
  count(*) as cohort_size,
  count(*) filter (where exists (
    select 1 from daily d
     where d.visitor_hash = f.visitor_hash
       and d.day = f.first_day + 1
  )) as d1_visitors,
  count(*) filter (where exists (
    select 1 from daily d
     where d.visitor_hash = f.visitor_hash
       and d.day = f.first_day + 7
  )) as d7_visitors
from first_seen f
group by f.first_day
order by f.first_day desc;

revoke all on public.v_daily_game from anon, authenticated;
revoke all on public.v_daily_active from anon, authenticated;
revoke all on public.v_game_switch from anon, authenticated;
revoke all on public.v_retention from anon, authenticated;

-- ============================================================
-- 看板：聚合接口（admin.html 使用）
--
-- 本地自用，不鉴权：直接打开 admin.html 即加载。
-- 若未来需要公开部署，请自行加鉴权后再放开 grant。
-- ============================================================

-- 旧版口令表如已建过，一并清理
drop function if exists public.analytics_set_dashboard_password(text);
drop function if exists public.analytics_dashboard(text, int);
drop table if exists public.analytics_config;

create or replace function public.analytics_dashboard(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_days   int := greatest(1, least(coalesce(p_days, 30), 180));
  v_since  date;
  v_result jsonb;
begin
  v_since := (now() at time zone 'Asia/Shanghai')::date - (v_days - 1);

  with ev as (
    select
      (ts at time zone 'Asia/Shanghai')::date as day,
      name,
      coalesce(game, '') as game,
      visitor_hash,
      session_id,
      props,
      case
        when (props->>'ms') ~ '^\d+$' and (props->>'ms')::bigint between 0 and 21600000
        then (props->>'ms')::numeric
      end as ms
    from public.analytics_events
    where (ts at time zone 'Asia/Shanghai')::date >= v_since
  ),
  daily as (
    select
      day,
      count(distinct visitor_hash) as visitors,
      count(distinct session_id) as sessions,
      count(*) filter (where name = 'game_enter') as opens,
      count(*) filter (where name = 'online_start') as online_starts,
      coalesce(round(sum(ms) / 60000.0), 0)::int as online_minutes
    from ev
    group by day
  ),
  first_seen as (
    select visitor_hash, min((ts at time zone 'Asia/Shanghai')::date) as first_day
    from public.analytics_events
    group by visitor_hash
  ),
  new_by_day as (
    select first_day as day, count(*) as new_visitors
    from first_seen
    group by first_day
  ),
  daily_out as (
    select
      d.day,
      d.visitors,
      coalesce(n.new_visitors, 0) as new_visitors,
      d.sessions,
      d.opens,
      d.online_starts,
      d.online_minutes
    from daily d
    left join new_by_day n using (day)
  ),
  games as (
    select
      game,
      count(*) filter (where name = 'game_enter') as opens,
      count(*) filter (where name = 'online_start') as online_starts,
      coalesce(round((avg(ms) filter (where name = 'online_end' and ms > 0)) / 1000.0), 0)::int as avg_seconds,
      coalesce(round((sum(ms) filter (where name = 'online_end')) / 60000.0), 0)::int as online_minutes
    from ev
    where game <> ''
    group by game
    order by opens desc
    limit 50
  ),
  switches as (
    select
      props->>'from' as from_game,
      game as to_game,
      count(*) as switches
    from ev
    where name = 'game_enter'
      and coalesce(props->>'from', '') <> ''
      and props->>'from' <> game
    group by 1, 2
    order by 3 desc
    limit 20
  ),
  daily_all as (
    select distinct (ts at time zone 'Asia/Shanghai')::date as day, visitor_hash
    from public.analytics_events
  ),
  retention as (
    select
      f.first_day as cohort_day,
      count(*) as cohort_size,
      count(*) filter (where exists (
        select 1 from daily_all d
         where d.visitor_hash = f.visitor_hash
           and d.day = f.first_day + 1
      )) as d1_visitors,
      count(*) filter (where exists (
        select 1 from daily_all d
         where d.visitor_hash = f.visitor_hash
           and d.day = f.first_day + 7
      )) as d7_visitors
    from first_seen f
    where f.first_day >= v_since
    group by f.first_day
    order by f.first_day desc
    limit 30
  ),
  totals as (
    select
      count(distinct visitor_hash) as visitors,
      count(distinct visitor_hash) filter (where visitor_hash in (
        select visitor_hash from first_seen where first_day >= v_since
      )) as new_visitors,
      count(distinct session_id) as sessions,
      count(*) filter (where name = 'game_enter') as opens,
      count(*) filter (where name = 'online_start') as online_starts,
      coalesce(round(sum(ms) / 60000.0), 0)::int as online_minutes
    from ev
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from daily_out d), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(to_jsonb(g)) from games g), '[]'::jsonb),
    'switches', coalesce((select jsonb_agg(to_jsonb(s)) from switches s), '[]'::jsonb),
    'retention', coalesce((select jsonb_agg(to_jsonb(r) order by r.cohort_day) from retention r), '[]'::jsonb),
    'totals', (select to_jsonb(t) from totals t),
    'range_days', v_days
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.analytics_dashboard(int) from public;
grant execute on function public.analytics_dashboard(int) to anon, authenticated;

notify pgrst, 'reload schema';
