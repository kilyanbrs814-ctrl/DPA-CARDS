-- A narrow privileged lookup: the caller can only learn their OWN support role.
-- This is private because auth.users/factors are not readable by app clients.
create function app_private.support_actor(p_merchant uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists(select 1 from public.admin_users a where lower(a.email)=lower(u.email)) then 'admin'
    when exists(select 1 from public.merchant_members m where m.user_id=u.id and m.merchant_id=p_merchant) then 'merchant'
    else null end
  from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null
    and ((select auth.jwt())->>'aal'='aal2' or not exists(
      select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'));
$$;
revoke all on function app_private.support_actor(uuid) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.support_actor(uuid) to authenticated;

create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  merchant_name text not null default 'Commerce',
  subject text not null check(length(btrim(subject)) between 3 and 140 and subject !~ E'[\r\n]'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  client_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(created_by,client_id)
);
create index support_conversations_merchant on public.support_conversations(merchant_id,created_at desc);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid default auth.uid() references auth.users(id) on delete set null,
  author_type text not null check(author_type in ('admin','merchant')),
  body text not null check(length(btrim(body)) between 1 and 5000),
  client_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(sender_id,client_id)
);
create index support_messages_conversation on public.support_messages(conversation_id,created_at desc,id desc);
create index support_messages_sender_rate on public.support_messages(sender_id,created_at desc);
create table public.support_reads (
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  last_read_at timestamptz not null,
  last_read_id uuid not null,
  primary key(conversation_id,user_id)
);
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_reads enable row level security;

create policy support_conversations_read on public.support_conversations for select to authenticated
  using(app_private.support_actor(merchant_id) is not null);
create policy support_conversations_create on public.support_conversations for insert to authenticated
  with check(created_by=(select auth.uid()) and app_private.support_actor(merchant_id) is not null);
create policy support_messages_read on public.support_messages for select to authenticated
  using(exists(select 1 from public.support_conversations c where c.id=conversation_id));
create policy support_messages_create on public.support_messages for insert to authenticated
  with check(sender_id=(select auth.uid()) and exists(select 1 from public.support_conversations c where c.id=conversation_id));
create policy support_reads_own_read on public.support_reads for select to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.support_conversations c where c.id=conversation_id));
create policy support_reads_own_insert on public.support_reads for insert to authenticated
  with check(user_id=(select auth.uid()) and exists(select 1 from public.support_conversations c where c.id=conversation_id));
create policy support_reads_own_update on public.support_reads for update to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.support_conversations c where c.id=conversation_id))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.support_conversations c where c.id=conversation_id));

revoke all on public.support_conversations,public.support_messages,public.support_reads from public,anon,authenticated;
grant select on public.support_conversations,public.support_messages,public.support_reads to authenticated;
grant insert(merchant_id,subject,client_id) on public.support_conversations to authenticated;
grant insert(conversation_id,body,client_id) on public.support_messages to authenticated;
grant insert(conversation_id,last_read_at,last_read_id),update(last_read_at,last_read_id) on public.support_reads to authenticated;
grant all on public.support_conversations,public.support_messages,public.support_reads to service_role;

create function app_private.support_prepare_conversation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if app_private.support_actor(new.merchant_id) is null then raise exception 'support_forbidden' using errcode='42501'; end if;
  new.created_by:=(select auth.uid());new.created_at:=clock_timestamp();new.subject:=btrim(new.subject);
  select m.business_name into new.merchant_name from public.merchants m where m.id=new.merchant_id;
  new.merchant_name:=coalesce(new.merchant_name,'Commerce');
  return new;
end; $$;
create trigger support_prepare_conversation before insert on public.support_conversations
for each row execute function app_private.support_prepare_conversation();

create function app_private.support_prepare_message() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_mid uuid;v_role text;
begin
  select c.merchant_id into v_mid from public.support_conversations c where c.id=new.conversation_id;
  v_role:=app_private.support_actor(v_mid);
  if v_mid is null or v_role is null then raise exception 'support_forbidden' using errcode='42501'; end if;
  new.sender_id:=(select auth.uid());new.author_type:=v_role;new.created_at:=clock_timestamp();new.body:=btrim(new.body);
  perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text,91823));
  if not exists(select 1 from public.support_messages m where m.sender_id=new.sender_id and m.client_id=new.client_id)
     and (select count(*) from public.support_messages m where m.sender_id=new.sender_id and m.created_at>clock_timestamp()-interval '1 minute')>=30 then
    raise exception 'support_rate_limited' using errcode='P0001';
  end if;
  return new;
end; $$;
create trigger support_prepare_message before insert on public.support_messages
for each row execute function app_private.support_prepare_message();
revoke all on function app_private.support_prepare_conversation(),app_private.support_prepare_message() from public,anon;

create function public.support_send_message(p_conversation uuid,p_body text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_message public.support_messages%rowtype;
begin
  if (select auth.uid()) is null or not exists(select 1 from public.support_conversations c where c.id=p_conversation) then
    raise exception 'support_forbidden' using errcode='42501';
  end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 5000 or p_request_id is null then
    raise exception 'invalid_support_message' using errcode='22023';
  end if;
  insert into public.support_messages(conversation_id,body,client_id) values(p_conversation,btrim(p_body),p_request_id)
    on conflict(sender_id,client_id) do nothing returning * into v_message;
  if v_message.id is null then
    select * into v_message from public.support_messages m where m.sender_id=(select auth.uid()) and m.client_id=p_request_id;
    if v_message.id is null or v_message.conversation_id<>p_conversation or v_message.body<>btrim(p_body) then
      raise exception 'support_request_conflict' using errcode='22023';
    end if;
  end if;
  return to_jsonb(v_message);
end; $$;

create function public.support_start_conversation(p_merchant uuid,p_subject text,p_body text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_conversation public.support_conversations%rowtype;v_message jsonb;
begin
  if app_private.support_actor(p_merchant) is null then raise exception 'support_forbidden' using errcode='42501'; end if;
  if p_subject is null or length(btrim(p_subject)) not between 3 and 140 or p_request_id is null then
    raise exception 'invalid_support_subject' using errcode='22023';
  end if;
  insert into public.support_conversations(merchant_id,subject,client_id) values(p_merchant,btrim(p_subject),p_request_id)
    on conflict(created_by,client_id) do nothing returning * into v_conversation;
  if v_conversation.id is null then
    select * into v_conversation from public.support_conversations c where c.created_by=(select auth.uid()) and c.client_id=p_request_id;
    if v_conversation.id is null or v_conversation.merchant_id<>p_merchant or v_conversation.subject<>btrim(p_subject) then
      raise exception 'support_request_conflict' using errcode='22023';
    end if;
  end if;
  v_message:=public.support_send_message(v_conversation.id,p_body,p_request_id);
  return jsonb_build_object('conversation',to_jsonb(v_conversation),'message',v_message);
end; $$;

create function public.support_mark_read(p_conversation uuid,p_message uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare v_at timestamptz;
begin
  select m.created_at into v_at from public.support_messages m where m.id=p_message and m.conversation_id=p_conversation;
  if v_at is null then raise exception 'support_forbidden' using errcode='42501'; end if;
  insert into public.support_reads as r(conversation_id,last_read_at,last_read_id) values(p_conversation,v_at,p_message)
    on conflict(conversation_id,user_id) do update set last_read_at=excluded.last_read_at,last_read_id=excluded.last_read_id
    where (excluded.last_read_at,excluded.last_read_id)>(r.last_read_at,r.last_read_id);
end; $$;

create function public.support_inbox(p_merchant uuid default null)
returns table(id uuid,merchant_id uuid,merchant_name text,subject text,created_at timestamptz,last_at timestamptz,preview text,unread bigint)
language sql stable security invoker set search_path='' as $$
  select c.id,c.merchant_id,c.merchant_name,c.subject,c.created_at,last.created_at,left(last.body,140),
    (select count(*) from public.support_messages m where m.conversation_id=c.id and m.sender_id is distinct from (select auth.uid())
       and (m.created_at,m.id)>(coalesce(r.last_read_at,'-infinity'::timestamptz),coalesce(r.last_read_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  from public.support_conversations c
  left join lateral(select m.body,m.created_at from public.support_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) last on true
  left join public.support_reads r on r.conversation_id=c.id and r.user_id=(select auth.uid())
  where p_merchant is null or c.merchant_id=p_merchant
  order by coalesce(last.created_at,c.created_at) desc,c.id;
$$;
create function public.support_messages_page(p_conversation uuid,p_before timestamptz default null,p_before_id uuid default null)
returns setof public.support_messages language sql stable security invoker set search_path='' as $$
  select m.* from public.support_messages m where m.conversation_id=p_conversation
    and (p_before is null or (m.created_at,m.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc,m.id desc limit 80;
$$;
revoke all on function public.support_send_message(uuid,text,uuid),public.support_start_conversation(uuid,text,text,uuid),public.support_mark_read(uuid,uuid),public.support_inbox(uuid),public.support_messages_page(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.support_send_message(uuid,text,uuid),public.support_start_conversation(uuid,text,text,uuid),public.support_mark_read(uuid,uuid),public.support_inbox(uuid),public.support_messages_page(uuid,timestamptz,uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_conversations') then
    alter publication supabase_realtime add table public.support_conversations,public.support_messages,public.support_reads;
  end if;
end; $$;
notify pgrst,'reload schema';
