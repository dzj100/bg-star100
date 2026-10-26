-- ============================================================
-- 桌游助手合集 · 留言板 Supabase 初始化
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。
--
-- 身份方案：浏览器 localStorage 保存 64 位随机令牌，服务端只保存
-- SHA-256 哈希；列表 RPC 不返回哈希，编辑/删除必须携带原令牌。
-- 清空浏览器数据会失去旧留言的编辑权限，这是无账号设计的预期行为。
-- 后台管理：把 feedback_messages.is_visible 改为 false 即可隐藏该留言。
-- 点赞：同一令牌对同一留言只能赞一次，计数保存在 likes 字段。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.feedback_messages (
  id bigint generated always as identity primary key,
  nickname text not null,
  content text not null,
  likes integer not null default 0,
  is_visible boolean not null default true,
  owner_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint feedback_nickname_len check (char_length(nickname) between 1 and 12),
  constraint feedback_content_len check (char_length(content) between 1 and 300),
  constraint feedback_likes_nonneg check (likes >= 0)
);

-- 点赞去重：同一令牌对同一条留言只保留一行，取消点赞时删除
create table if not exists public.feedback_likes (
  message_id bigint not null references public.feedback_messages(id) on delete cascade,
  owner_hash text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, owner_hash)
);

create index if not exists feedback_messages_created_idx
  on public.feedback_messages (created_at desc);

create index if not exists feedback_messages_owner_idx
  on public.feedback_messages (owner_hash, created_at desc);

-- 只允许通过下面的 RPC 访问，禁止客户端直接读写表
alter table public.feedback_messages enable row level security;
revoke all on table public.feedback_messages from anon, authenticated;
alter table public.feedback_likes enable row level security;
revoke all on table public.feedback_likes from anon, authenticated;

-- 最近 10 条（跳过已隐藏）；is_mine / liked_by_me 由传入令牌的哈希判断，不会泄露 owner_hash
create or replace function public.feedback_list(p_token text default '')
returns table (
  id bigint,
  nickname text,
  content text,
  likes integer,
  created_at timestamptz,
  updated_at timestamptz,
  is_mine boolean,
  liked_by_me boolean
)
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') as h
  )
  select
    m.id,
    m.nickname,
    m.content,
    m.likes,
    m.created_at,
    m.updated_at,
    m.owner_hash = me.h as is_mine,
    exists (
      select 1
        from public.feedback_likes l
       where l.message_id = m.id
         and l.owner_hash = me.h
    ) as liked_by_me
  from public.feedback_messages m, me
  where m.is_visible
  order by m.created_at desc
  limit 10;
$$;

-- 发布：同一令牌 20 秒内只能发一条
create or replace function public.feedback_create(
  p_token text,
  p_nickname text,
  p_content text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_content text := btrim(coalesce(p_content, ''));
  v_hash text;
  v_id bigint;
begin
  if char_length(v_token) < 32 then
    raise exception '身份标识无效，请刷新页面后重试';
  end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 12 then
    raise exception '昵称需为 1~12 个字符';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 300 then
    raise exception '留言需为 1~300 个字符';
  end if;

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  if exists (
    select 1
      from public.feedback_messages m
     where m.owner_hash = v_hash
       and m.created_at > now() - interval '20 seconds'
  ) then
    raise exception '发得太快啦，请稍后再试';
  end if;

  insert into public.feedback_messages (nickname, content, owner_hash)
  values (v_nickname, v_content, v_hash)
  returning id into v_id;

  return v_id;
end;
$$;

-- 编辑：仅同一令牌可改
create or replace function public.feedback_update(
  p_id bigint,
  p_token text,
  p_nickname text,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text := encode(digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex');
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_content text := btrim(coalesce(p_content, ''));
begin
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 12 then
    raise exception '昵称需为 1~12 个字符';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 300 then
    raise exception '留言需为 1~300 个字符';
  end if;

  update public.feedback_messages
     set nickname = v_nickname,
         content = v_content,
         updated_at = now()
   where id = p_id
     and owner_hash = v_hash;

  if not found then
    raise exception '只能编辑自己的留言，或留言已不存在';
  end if;

  return true;
end;
$$;

-- 删除：仅同一令牌可删
create or replace function public.feedback_delete(
  p_id bigint,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text := encode(digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex');
begin
  delete from public.feedback_messages
   where id = p_id
     and owner_hash = v_hash;

  if not found then
    raise exception '只能删除自己的留言，或留言已不存在';
  end if;

  return true;
end;
$$;

-- 点赞 / 取消点赞：同一令牌只能赞一次，返回最新状态和计数
create or replace function public.feedback_toggle_like(
  p_id bigint,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_hash text;
  v_likes integer;
begin
  if char_length(v_token) < 32 then
    raise exception '身份标识无效，请刷新页面后重试';
  end if;
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- 行锁串行化同一条留言的点赞/取消，避免计数竞争
  perform 1
    from public.feedback_messages
   where id = p_id
     and is_visible
     for update;
  if not found then
    raise exception '留言不存在或已隐藏';
  end if;

  delete from public.feedback_likes
   where message_id = p_id
     and owner_hash = v_hash;

  if found then
    update public.feedback_messages
       set likes = greatest(likes - 1, 0)
     where id = p_id
     returning likes into v_likes;
    return jsonb_build_object('liked', false, 'likes', v_likes);
  end if;

  insert into public.feedback_likes (message_id, owner_hash)
  values (p_id, v_hash);

  update public.feedback_messages
     set likes = likes + 1
   where id = p_id
   returning likes into v_likes;

  return jsonb_build_object('liked', true, 'likes', v_likes);
end;
$$;

revoke all on function public.feedback_list(text) from public;
revoke all on function public.feedback_create(text, text, text) from public;
revoke all on function public.feedback_update(bigint, text, text, text) from public;
revoke all on function public.feedback_delete(bigint, text) from public;
revoke all on function public.feedback_toggle_like(bigint, text) from public;

grant execute on function public.feedback_list(text) to anon, authenticated;
grant execute on function public.feedback_create(text, text, text) to anon, authenticated;
grant execute on function public.feedback_update(bigint, text, text, text) to anon, authenticated;
grant execute on function public.feedback_delete(bigint, text) to anon, authenticated;
grant execute on function public.feedback_toggle_like(bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
