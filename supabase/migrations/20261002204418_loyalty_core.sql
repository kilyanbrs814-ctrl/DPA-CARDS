-- DPA Cards — loyalty core.
--
-- Merchants, their members, loyalty programs, customers, cards and an
-- append-only ledger of card events. Every table has RLS and explicit grants:
-- anon gets nothing, authenticated users only reach rows of the merchant they
-- belong to. No SECURITY DEFINER function: every function runs as the caller,
-- so RLS applies inside them too.
--
-- Balances are never written by clients. The card_events BEFORE INSERT trigger
-- serialises writes per card, computes seq / delta / balance_after from the
-- program rules and the previous event, and stamps author and date, whether
-- the insert comes from an RPC or straight from the REST API.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- ---------------------------------------------------------------- tables

create table public.merchants (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 1 and 120),
  first_name    text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name     text not null default '' check (char_length(last_name) <= 80),
  activity      text not null default '' check (char_length(activity) <= 60),
  phone         text not null default '' check (char_length(phone) <= 40),
  address       text not null default '' check (char_length(address) <= 200),
  slug          text not null unique check (char_length(slug) <= 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint merchants_one_per_creator unique (created_by)
);

-- Who may act for a merchant. Roles live here, never in user metadata.
create table public.merchant_members (
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (merchant_id, user_id),
  constraint merchant_members_one_merchant_per_user unique (user_id)
);

create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  mode        text not null default 'passages' check (mode in ('passages', 'points')),
  goal        integer not null,
  reward      text not null check (char_length(btrim(reward)) between 1 and 120),
  conditions  text not null default '' check (char_length(conditions) <= 600),
  bg          text not null default '#F6A9C9' check (bg ~ '^#[0-9A-Fa-f]{6}$'),
  accent      text not null default '#A9DDF7' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  pattern     text not null default 'stripes' check (pattern in ('stripes', 'dots', 'solid', 'none')),
  logo        text not null default '' check (char_length(logo) <= 4),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Same bounds as the card editor: 3–20 passages, 50–1000 points.
  constraint programs_goal_range check (
    (mode = 'passages' and goal between 3 and 20) or (mode = 'points' and goal between 50 and 1000)
  ),
  constraint programs_id_merchant unique (id, merchant_id)
);
create unique index programs_one_active_per_merchant on public.programs (merchant_id) where is_active;

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  first_name  text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name   text not null default '' check (char_length(last_name) <= 80),
  email       text check (email is null or (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  consent_at  timestamptz not null,
  request_id  uuid not null,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint customers_id_merchant unique (id, merchant_id),
  constraint customers_request_once unique (merchant_id, request_id)
);

create function app_private.new_card_number() returns text
language sql volatile security invoker set search_path = ''
as $$
  select 'DPA ' || lpad((floor(random() * 10000))::int::text, 4, '0')
              || ' ' || lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

-- A card ties one customer to one program of the same merchant: the composite
-- foreign keys make cross-merchant associations impossible.
create table public.cards (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  program_id  uuid not null,
  customer_id uuid not null,
  card_number text not null unique default app_private.new_card_number()
              check (card_number ~ '^DPA [0-9]{4} [0-9]{4}$'),
  -- Opaque value for the future QR code. Identifies a card, authorises nothing.
  qr_token    uuid not null unique default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  constraint cards_program_same_merchant foreign key (program_id, merchant_id)
    references public.programs (id, merchant_id) on delete cascade,
  constraint cards_customer_same_merchant foreign key (customer_id, merchant_id)
    references public.customers (id, merchant_id) on delete cascade,
  constraint cards_one_per_customer_program unique (customer_id, program_id),
  constraint cards_id_merchant unique (id, merchant_id)
);
create index cards_program_merchant_idx on public.cards (program_id, merchant_id);
create index cards_customer_merchant_idx on public.cards (customer_id, merchant_id);
create index cards_merchant_idx on public.cards (merchant_id);

-- Append-only ledger. Nobody gets UPDATE or DELETE on it.
create table public.card_events (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchants (id) on delete cascade,
  card_id           uuid not null,
  seq               integer not null check (seq >= 1),
  type              text not null check (type in ('join', 'visit', 'reward', 'correction')),
  delta             integer not null,
  balance_after     integer not null check (balance_after >= 0),
  request_id        uuid not null,
  corrects_event_id uuid,
  motif             text check (motif in ('Erreur de saisie', 'Passage en double', 'Mauvais client', 'Autre')),
  note              text check (char_length(note) <= 300),
  reward_label      text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint card_events_card_same_merchant foreign key (card_id, merchant_id)
    references public.cards (id, merchant_id) on delete cascade,
  constraint card_events_id_card unique (id, card_id),
  constraint card_events_corrects_same_card foreign key (corrects_event_id, card_id)
    references public.card_events (id, card_id) on delete cascade,
  constraint card_events_seq_per_card unique (card_id, seq),
  constraint card_events_request_once unique (merchant_id, request_id),
  constraint card_events_correction_shape check (
    (type = 'correction') = (corrects_event_id is not null) and (type = 'correction') = (motif is not null)
  ),
  constraint card_events_delta_sign check (
    (type = 'join' and delta = 0 and seq = 1) or (type = 'visit' and delta > 0)
    or (type = 'reward' and delta < 0) or (type = 'correction' and delta <> 0)
  )
);
-- A visit can be corrected once.
create unique index card_events_one_correction on public.card_events (corrects_event_id)
  where corrects_event_id is not null;
create index card_events_corrects_idx on public.card_events (corrects_event_id, card_id);
create index card_events_card_merchant_idx on public.card_events (card_id, merchant_id);
create index card_events_merchant_created_idx on public.card_events (merchant_id, created_at desc);
create index customers_merchant_idx on public.customers (merchant_id);
create index customers_created_by_idx on public.customers (created_by);
create index card_events_created_by_idx on public.card_events (created_by);

-- ---------------------------------------------------------------- helpers

create function app_private.is_member(p_merchant uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.merchant_members mm
    where mm.merchant_id = p_merchant and mm.user_id = (select auth.uid())
  );
$$;

create function app_private.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger merchants_touch before update on public.merchants
  for each row execute function app_private.touch_updated_at();
create trigger programs_touch before update on public.programs
  for each row execute function app_private.touch_updated_at();

-- The ledger rules. Runs as the caller, so the reads below are RLS-scoped too.
create function app_private.card_events_before_insert() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_prog    public.programs%rowtype;
  v_prev    public.card_events%rowtype;
  v_target  public.card_events%rowtype;
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not app_private.is_member(new.merchant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- One writer per card at a time; the (card_id, seq) unique key backs it up.
  perform pg_advisory_xact_lock(hashtextextended(new.card_id::text, 0));

  select p.* into v_prog
  from public.cards c
  join public.programs p on p.id = c.program_id and p.merchant_id = c.merchant_id
  where c.id = new.card_id and c.merchant_id = new.merchant_id;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  select e.* into v_prev from public.card_events e
  where e.card_id = new.card_id order by e.seq desc limit 1;
  v_balance := coalesce(v_prev.balance_after, 0);

  new.seq          := coalesce(v_prev.seq, 0) + 1;
  new.created_by   := v_uid;
  new.created_at   := now();
  new.reward_label := null;

  if new.type = 'join' then
    if v_prev.id is not null then
      raise exception 'already_joined' using errcode = '23505';
    end if;
    new.delta := 0;
  elsif new.type = 'visit' then
    if v_prev.id is null then
      raise exception 'card_not_joined' using errcode = 'P0001';
    end if;
    new.delta := case v_prog.mode when 'points' then 10 else 1 end;
  elsif new.type = 'reward' then
    if v_balance < v_prog.goal then
      raise exception 'reward_not_available' using errcode = 'P0001';
    end if;
    new.delta := -v_prog.goal;
    new.reward_label := v_prog.reward;
  elsif new.type = 'correction' then
    select e.* into v_target from public.card_events e
    where e.id = new.corrects_event_id and e.card_id = new.card_id;
    if not found or v_target.type <> 'visit' then
      raise exception 'correction_invalid' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.card_events e where e.corrects_event_id = v_target.id) then
      raise exception 'already_corrected' using errcode = '23505';
    end if;
    new.delta := -v_target.delta;
  end if;

  if new.type <> 'correction' then
    new.corrects_event_id := null;
    new.motif := null;
  end if;

  new.balance_after := v_balance + new.delta;
  if new.balance_after < 0 then
    raise exception 'balance_negative' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger card_events_rules before insert on public.card_events
  for each row execute function app_private.card_events_before_insert();

-- Idempotent write of one event: a retried request_id returns the first result.
create function app_private.record_event(
  p_card_id uuid, p_request_id uuid, p_type text,
  p_corrects uuid default null, p_motif text default null, p_note text default null
) returns public.card_events
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_card public.cards%rowtype;
  v_ev   public.card_events%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_card_id is null or p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select c.* into v_card from public.cards c where c.id = p_card_id;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;
  if not app_private.is_member(v_card.merchant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select e.* into v_ev from public.card_events e
  where e.merchant_id = v_card.merchant_id and e.request_id = p_request_id;
  if found then
    if v_ev.card_id <> p_card_id or v_ev.type <> p_type then
      raise exception 'request_conflict' using errcode = '22023';
    end if;
    return v_ev;
  end if;

  begin
    insert into public.card_events (merchant_id, card_id, type, request_id, corrects_event_id, motif, note)
    values (v_card.merchant_id, p_card_id, p_type, p_request_id, p_corrects, p_motif, nullif(btrim(p_note), ''))
    returning * into v_ev;
  exception when unique_violation then
    -- Same request committed concurrently: hand back its result.
    select e.* into v_ev from public.card_events e
    where e.merchant_id = v_card.merchant_id and e.request_id = p_request_id;
    if not found or v_ev.card_id <> p_card_id or v_ev.type <> p_type then
      raise;
    end if;
  end;
  return v_ev;
end;
$$;

-- ---------------------------------------------------------------- RPC

create function public.create_merchant(
  p_business text, p_first text, p_last text, p_activity text, p_slug text, p_program jsonb
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_id   uuid;
  v_slug text;
  v_con  text;
  v_m    public.merchants%rowtype;
  v_p    public.programs%rowtype;
  i      integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Already set up (double submit, retry): return what exists.
  select m.* into v_m from public.merchants m
  join public.merchant_members mm on mm.merchant_id = m.id
  where mm.user_id = v_uid;
  if found then
    select p.* into v_p from public.programs p where p.merchant_id = v_m.id and p.is_active;
    return jsonb_build_object('merchant', to_jsonb(v_m), 'program', to_jsonb(v_p));
  end if;

  v_slug := left(coalesce(nullif(p_slug, ''), 'commerce'), 24);
  for i in 1..6 loop
    begin
      v_id := gen_random_uuid();
      insert into public.merchants (id, business_name, first_name, last_name, activity, slug)
      values (v_id, btrim(p_business), btrim(p_first), btrim(coalesce(p_last, '')), coalesce(p_activity, ''), v_slug);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'merchants_one_per_creator' then
        -- Concurrent call won: reuse its merchant.
        select m.* into v_m from public.merchants m where m.created_by = v_uid;
        v_id := v_m.id;
        exit;
      end if;
      if i = 6 then raise; end if;
      v_slug := left(coalesce(nullif(p_slug, ''), 'commerce'), 19) || '-'
                || substr(md5(gen_random_uuid()::text), 1, 4);
    end;
  end loop;

  insert into public.merchant_members (merchant_id, user_id, role)
  values (v_id, v_uid, 'owner')
  on conflict do nothing;

  if not exists (select 1 from public.programs p where p.merchant_id = v_id and p.is_active) then
    insert into public.programs (merchant_id, name, mode, goal, reward, conditions, bg, accent, pattern, logo)
    values (
      v_id,
      p_program ->> 'name',
      coalesce(p_program ->> 'mode', 'passages'),
      (p_program ->> 'goal')::integer,
      p_program ->> 'reward',
      coalesce(p_program ->> 'conditions', ''),
      coalesce(p_program ->> 'bg', '#F6A9C9'),
      coalesce(p_program ->> 'accent', '#A9DDF7'),
      coalesce(p_program ->> 'pattern', 'stripes'),
      upper(left(coalesce(p_program ->> 'logo', ''), 4))
    );
  end if;

  select m.* into v_m from public.merchants m where m.id = v_id;
  select p.* into v_p from public.programs p where p.merchant_id = v_id and p.is_active;
  return jsonb_build_object('merchant', to_jsonb(v_m), 'program', to_jsonb(v_p));
end;
$$;

-- Merchant-side enrolment (the merchant is signed in). Not a public sign-up.
create function public.enroll_customer(
  p_request_id uuid, p_first text, p_last text, p_email text, p_consent boolean
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_mid  uuid;
  v_prog public.programs%rowtype;
  v_cust public.customers%rowtype;
  v_card public.cards%rowtype;
  v_ev   public.card_events%rowtype;
  i      integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  select mm.merchant_id into v_mid from public.merchant_members mm where mm.user_id = v_uid;
  if v_mid is null or not app_private.is_member(v_mid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'no_program' using errcode = 'P0002';
  end if;

  select c.* into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
  if not found then
    begin
      insert into public.customers (merchant_id, first_name, last_name, email, consent_at, request_id)
      values (v_mid, btrim(p_first), btrim(coalesce(p_last, '')), nullif(lower(btrim(coalesce(p_email, ''))), ''), now(), p_request_id)
      returning * into v_cust;
    exception when unique_violation then
      select c.* into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
      if not found then raise; end if;
    end;
  end if;

  select k.* into v_card from public.cards k where k.customer_id = v_cust.id and k.program_id = v_prog.id;
  if not found then
    for i in 1..5 loop
      begin
        insert into public.cards (merchant_id, program_id, customer_id)
        values (v_mid, v_prog.id, v_cust.id)
        returning * into v_card;
        exit;
      exception when unique_violation then
        -- Card number collision, or the same enrolment committed concurrently.
        select k.* into v_card from public.cards k where k.customer_id = v_cust.id and k.program_id = v_prog.id;
        exit when found;
        if i = 5 then raise; end if;
      end;
    end loop;
  end if;

  select e.* into v_ev from public.card_events e where e.card_id = v_card.id and e.type = 'join';
  if not found then
    v_ev := app_private.record_event(v_card.id, p_request_id, 'join');
  end if;

  return jsonb_build_object('customer', to_jsonb(v_cust), 'card', to_jsonb(v_card), 'event', to_jsonb(v_ev));
end;
$$;

create function public.add_visit(p_card_id uuid, p_request_id uuid) returns public.card_events
language sql volatile security invoker set search_path = ''
as $$ select * from app_private.record_event(p_card_id, p_request_id, 'visit'); $$;

create function public.redeem_reward(p_card_id uuid, p_request_id uuid) returns public.card_events
language sql volatile security invoker set search_path = ''
as $$ select * from app_private.record_event(p_card_id, p_request_id, 'reward'); $$;

create function public.correct_event(p_event_id uuid, p_motif text, p_note text, p_request_id uuid)
returns public.card_events
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_card uuid;
begin
  select e.card_id into v_card from public.card_events e where e.id = p_event_id;
  if v_card is null then
    raise exception 'correction_invalid' using errcode = 'P0001';
  end if;
  return app_private.record_event(v_card, p_request_id, 'correction', p_event_id, p_motif, p_note);
end;
$$;

-- ---------------------------------------------------------------- RLS

alter table public.merchants        enable row level security;
alter table public.merchant_members enable row level security;
alter table public.programs         enable row level security;
alter table public.customers        enable row level security;
alter table public.cards            enable row level security;
alter table public.card_events      enable row level security;

create policy merchants_select on public.merchants for select to authenticated
  using (
    created_by = (select auth.uid())
    or id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid()))
  );
create policy merchants_insert on public.merchants for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy merchants_update on public.merchants for update to authenticated
  using (id in (select mm.merchant_id from public.merchant_members mm
                where mm.user_id = (select auth.uid()) and mm.role = 'owner'))
  with check (id in (select mm.merchant_id from public.merchant_members mm
                     where mm.user_id = (select auth.uid()) and mm.role = 'owner'));

create policy merchant_members_select on public.merchant_members for select to authenticated
  using (user_id = (select auth.uid()));
-- Only the creator of a merchant can make themselves its owner.
create policy merchant_members_insert on public.merchant_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and merchant_id in (select m.id from public.merchants m where m.created_by = (select auth.uid()))
  );

create policy programs_select on public.programs for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy programs_insert on public.programs for insert to authenticated
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm
                              where mm.user_id = (select auth.uid()) and mm.role = 'owner'));
create policy programs_update on public.programs for update to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm
                         where mm.user_id = (select auth.uid()) and mm.role = 'owner'))
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm
                              where mm.user_id = (select auth.uid()) and mm.role = 'owner'));

create policy customers_select on public.customers for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy customers_insert on public.customers for insert to authenticated
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

create policy cards_select on public.cards for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy cards_insert on public.cards for insert to authenticated
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

create policy card_events_select on public.card_events for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy card_events_insert on public.card_events for insert to authenticated
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- grants
-- The project's default privileges give anon and authenticated everything on
-- new public tables; take it all back and grant column by column. Server-owned
-- columns (created_by, seq, delta, balance_after, card_number…) are never
-- writable by clients.

revoke all on public.merchants, public.merchant_members, public.programs,
              public.customers, public.cards, public.card_events
  from public, anon, authenticated;

grant select on public.merchants, public.merchant_members, public.programs,
                public.customers, public.cards, public.card_events
  to authenticated;

grant insert (id, business_name, first_name, last_name, activity, phone, address, slug)
  on public.merchants to authenticated;
grant update (business_name, first_name, last_name, activity, phone, address)
  on public.merchants to authenticated;
grant insert (merchant_id, user_id, role) on public.merchant_members to authenticated;
grant insert (merchant_id, name, mode, goal, reward, conditions, bg, accent, pattern, logo)
  on public.programs to authenticated;
grant update (name, mode, goal, reward, conditions, bg, accent, pattern, logo)
  on public.programs to authenticated;
grant insert (merchant_id, first_name, last_name, email, consent_at, request_id)
  on public.customers to authenticated;
grant insert (merchant_id, program_id, customer_id) on public.cards to authenticated;
grant insert (merchant_id, card_id, type, request_id, corrects_event_id, motif, note)
  on public.card_events to authenticated;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated;

revoke all on function public.create_merchant(text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.enroll_customer(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.add_visit(uuid, uuid) from public, anon;
revoke all on function public.redeem_reward(uuid, uuid) from public, anon;
revoke all on function public.correct_event(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_merchant(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.enroll_customer(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.add_visit(uuid, uuid) to authenticated;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
grant execute on function public.correct_event(uuid, text, text, uuid) to authenticated;
