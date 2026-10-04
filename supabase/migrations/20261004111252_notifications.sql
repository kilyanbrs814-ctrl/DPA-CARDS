-- DPA Cards — merchant notifications (Google Wallet messages).
--
-- notifications: one row per campaign. Merchants may create, edit and delete
-- their own drafts directly (RLS); everything past 'draft' is written by the
-- `wallet` Edge Function with the service role, after it has checked the
-- caller's session and derived the merchant from it.
-- notification_deliveries: one row per targeted card, read-only for merchants.
-- The composite foreign keys keep a campaign, its deliveries and their cards
-- inside one merchant.

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references public.merchants (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 1 and 60),
  body            text not null default '' check (char_length(body) <= 200),
  kind            text not null default 'message' check (kind in ('points', 'reward', 'message')),
  audience        text not null default 'all' check (audience in ('all', 'reward', 'near', 'inactive', 'selected')),
  card_ids        uuid[] not null default '{}' check (cardinality(card_ids) <= 2000),
  notify          boolean not null default true,
  platform        text not null default 'google' check (platform = 'google'),
  status          text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'partial', 'failed')),
  targeted        integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,
  quota_count     integer not null default 0,
  no_wallet_count integer not null default 0,
  error           text check (char_length(error) <= 300),
  scheduled_at    timestamptz,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- Nothing leaves the draft state without a text.
  constraint notifications_body_when_sent check (status = 'draft' or char_length(btrim(body)) >= 1),
  constraint notifications_id_merchant unique (id, merchant_id)
);
create index notifications_merchant_created_idx on public.notifications (merchant_id, created_at desc);
create index notifications_created_by_idx on public.notifications (created_by);

create table public.notification_deliveries (
  notification_id uuid not null,
  card_id         uuid not null,
  merchant_id     uuid not null,
  platform        text not null default 'google' check (platform = 'google'),
  status          text not null check (status in ('sent', 'failed', 'quota_exceeded', 'no_wallet')),
  error           text check (char_length(error) <= 300),
  sent_at         timestamptz not null default now(),
  primary key (notification_id, card_id),
  constraint notification_deliveries_same_merchant foreign key (notification_id, merchant_id)
    references public.notifications (id, merchant_id) on delete cascade,
  constraint notification_deliveries_card_same_merchant foreign key (card_id, merchant_id)
    references public.cards (id, merchant_id) on delete cascade
);
create index notification_deliveries_card_idx on public.notification_deliveries (card_id, merchant_id);
create index notification_deliveries_merchant_idx on public.notification_deliveries (merchant_id);

create trigger notifications_touch before update on public.notifications
  for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------- RLS

alter table public.notifications           enable row level security;
alter table public.notification_deliveries enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    status = 'draft' and created_by = (select auth.uid())
    and merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid()))
  );
create policy notifications_update on public.notifications for update to authenticated
  using (status = 'draft' and merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())))
  with check (status = 'draft' and merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
-- A campaign being sent cannot be removed under the sender's feet.
create policy notifications_delete on public.notifications for delete to authenticated
  using (status <> 'sending' and merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

revoke all on public.notifications, public.notification_deliveries from public, anon, authenticated;
grant select on public.notifications, public.notification_deliveries to authenticated;
-- Drafts only: status, counters, errors and dates are server-owned.
grant insert (merchant_id, title, body, kind, audience, card_ids, notify) on public.notifications to authenticated;
grant update (title, body, kind, audience, card_ids, notify) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

-- ---------------------------------------------------------------- targeting
-- Cards of the merchant's active program matching an audience, with their Google
-- object when one exists. Same rules as the dashboard: reward = balance >= goal,
-- near = at most 2 short of it, inactive = no uncorrected visit for 14 days.
-- Service role only: the Edge Function passes the merchant it derived from the session.

create function public.notification_targets(p_merchant uuid, p_audience text, p_card_ids uuid[] default '{}')
returns table (card_id uuid, google_object_id text)
language sql stable security invoker set search_path = ''
as $$
  with prog as (
    select p.id, p.goal from public.programs p where p.merchant_id = p_merchant and p.is_active
  ), c as (
    select k.id from public.cards k join prog on prog.id = k.program_id
    where k.merchant_id = p_merchant and (p_audience <> 'selected' or k.id = any (p_card_ids))
  ), st as (
    select c.id,
      coalesce((select e.balance_after from public.card_events e where e.card_id = c.id order by e.seq desc limit 1), 0) as bal,
      (select max(e.created_at) from public.card_events e
        where e.card_id = c.id and e.type = 'visit'
          and not exists (select 1 from public.card_events x where x.corrects_event_id = e.id)) as last_visit
    from c
  )
  select st.id, w.google_object_id
  from st cross join prog
  left join public.wallet_passes w on w.card_id = st.id and w.merchant_id = p_merchant
  where case p_audience
    when 'reward'   then st.bal >= prog.goal
    when 'near'     then st.bal < prog.goal and prog.goal - st.bal <= 2
    when 'inactive' then st.last_visit is null or st.last_visit < now() - interval '14 days'
    else true
  end;
$$;

revoke all on function public.notification_targets(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.notification_targets(uuid, text, uuid[]) to service_role;
