-- DPA Cards — paid features need a valid subscription; the custom design is a paid order.
--
-- 1. Access rule: a merchant whose subscription is not 'trialing' or 'active' can still
--    read its space, but every business write is refused with SQLSTATE PT402, which
--    PostgREST returns as HTTP 402: ledger events (visits, rewards, corrections, joins —
--    public sign-ups included), enrolment, card lookup (scanner), direct inserts of
--    customers / cards / notification drafts.
-- 2. "Confier le design à DPA Cards" costs 29 € TTC (Stripe price STRIPE_PRICE_CUSTOM_DESIGN):
--    the request is created as 'pending_payment' and becomes an order ('submitted') only
--    after the billing Edge Function has confirmed the Stripe payment.

-- ---------------------------------------------------------------- access rule

create function app_private.merchant_active(p_merchant uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (select 1 from public.subscriptions s where s.merchant_id = p_merchant and s.status in ('trialing', 'active'));
$$;

create function app_private.require_active(p_merchant uuid) returns void
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not app_private.merchant_active(p_merchant) then
    raise exception 'subscription_required' using errcode = 'PT402';
  end if;
end;
$$;

revoke all on function app_private.merchant_active(uuid) from public, anon;
revoke all on function app_private.require_active(uuid) from public, anon;
grant execute on function app_private.merchant_active(uuid) to authenticated, service_role;
grant execute on function app_private.require_active(uuid) to authenticated, service_role;

-- One rule: the Edge Functions' check uses the same function.
create or replace function public.merchant_has_access(p_merchant uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$ select app_private.merchant_active(p_merchant); $$;

create or replace function app_private.card_events_before_insert() returns trigger
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
    -- Public sign-up: only the server may open a card without a session, and only that.
    if not (new.type = 'join' and current_user = 'service_role') then
      raise exception 'not_authenticated' using errcode = '42501';
    end if;
  elsif not app_private.is_member(new.merchant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Paid feature: no join, visit, reward or correction without a valid subscription.
  perform app_private.require_active(new.merchant_id);

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

create or replace function public.enroll_customer(
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
  perform app_private.require_active(v_mid);
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

create or replace function public.lookup_card(p_code text)
returns table (card_id uuid, matched_by text)
language plpgsql stable security invoker set search_path = ''
as $$
#variable_conflict use_column
declare
  v_mid    uuid;
  v_code   text := btrim(coalesce(p_code, ''));
  v_token  text;
  v_digits text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select mm.merchant_id into v_mid from public.merchant_members mm where mm.user_id = (select auth.uid());
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app_private.require_active(v_mid);
  if char_length(v_code) > 120 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  v_token := substring(lower(v_code) from '^(?:dpa1:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
  if v_token is not null then
    return query
      select k.id, 'qr'::text from public.cards k
      where k.qr_token = v_token::uuid and k.merchant_id = v_mid;
    return;
  end if;

  v_digits := regexp_replace(v_code, '[^0-9]', '', 'g');
  if v_code !~* '^(dpa)?[0-9 .-]+$' or char_length(v_digits) < 4 or char_length(v_digits) > 8 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if char_length(v_digits) = 8 then
    return query
      select k.id, 'number'::text from public.cards k
      where k.card_number = 'DPA ' || left(v_digits, 4) || ' ' || right(v_digits, 4) and k.merchant_id = v_mid;
    return;
  end if;
  return query
    select k.id, 'suffix'::text from public.cards k
    where k.merchant_id = v_mid and replace(k.card_number, ' ', '') like '%' || v_digits
    order by k.created_at desc
    limit 6;
end;
$$;

alter policy customers_insert on public.customers
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid()))
              and app_private.merchant_active(merchant_id));
alter policy cards_insert on public.cards
  with check (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid()))
              and app_private.merchant_active(merchant_id));
alter policy notifications_insert on public.notifications
  with check (
    status = 'draft' and created_by = (select auth.uid())
    and merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid()))
    and app_private.merchant_active(merchant_id)
  );

-- ---------------------------------------------------------------- paid custom design

alter table public.design_requests drop constraint design_requests_status_check;
alter table public.design_requests add constraint design_requests_status_check
  check (status in ('pending_payment', 'submitted', 'in_progress', 'delivered', 'cancelled'));
alter table public.design_requests alter column status set default 'pending_payment';
alter table public.design_requests
  add column stripe_checkout_session_id text unique,
  add column stripe_payment_intent_id   text,
  add column payment_status             text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  add column paid_at                    timestamptz,
  add column amount_cents               integer,
  add column currency                   text,
  add column notified_at                timestamptz,
  add column notify_error               text check (char_length(notify_error) <= 300),
  add column in_progress_at             timestamptz,
  add column delivered_at               timestamptz,
  add column merchant_notified_at       timestamptz,
  -- NOT VALID: rows from the former free flow are kept as they are; every new or updated row must comply.
  add constraint design_requests_paid_shape check (status in ('pending_payment', 'cancelled') or payment_status = 'paid') not valid;
create index design_requests_status_idx on public.design_requests (status) where status in ('submitted', 'in_progress');

create or replace function public.submit_design_request(
  p_request_id uuid, p_logo_path text, p_reference_paths text[], p_colors text,
  p_description text, p_contact_name text, p_contact_email text, p_contact_phone text
) returns public.design_requests
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_mid    uuid;
  v_prog   public.programs%rowtype;
  v_req    public.design_requests%rowtype;
  v_prefix text;
  v_path   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select mm.merchant_id into v_mid from public.merchant_members mm where mm.user_id = v_uid and mm.role = 'owner';
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'no_program' using errcode = 'P0002';
  end if;

  -- Retry of the same submission, or a paid request already open: return it.
  select r.* into v_req from public.design_requests r
  where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
  order by (r.request_id = p_request_id) desc limit 1;
  if found then
    return v_req;
  end if;
  -- Older unpaid orders stay as they are (the merchant cannot update requests); they are
  -- cancelled server side when one order of the program is paid (design_mark_paid).
  if v_prog.design_status <> 'draft' then
    raise exception 'design_locked' using errcode = '42501';
  end if;

  v_prefix := v_mid::text || '/' || p_request_id::text || '/';
  foreach v_path in array coalesce(p_reference_paths, '{}') || coalesce(array[p_logo_path], '{}') loop
    if v_path is not null and v_path not like v_prefix || '%' then
      raise exception 'invalid_file_path' using errcode = '22023';
    end if;
  end loop;

  begin
    insert into public.design_requests (merchant_id, program_id, request_id, logo_path, reference_paths, colors,
                                        description, contact_name, contact_email, contact_phone)
    values (v_mid, v_prog.id, p_request_id, p_logo_path, coalesce(p_reference_paths, '{}'), nullif(btrim(p_colors), ''),
            btrim(p_description), btrim(p_contact_name), nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_contact_phone), ''))
    returning * into v_req;
  exception when unique_violation then
    select r.* into v_req from public.design_requests r
    where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
    limit 1;
    if not found then raise; end if;
    return v_req;
  end;

  -- Not an order yet: it becomes one (and the program moves to pending_dpa) only once
  -- Stripe confirms the payment, through public.design_mark_paid (service role).
  return v_req;
end;
$$;

-- After Stripe confirmed the payment (billing Edge Function, service role). Idempotent:
-- returns the request; 'newly_paid' is true only for the call that made it an order.
create function public.design_mark_paid(p_request uuid, p_session text, p_payment_intent text, p_amount integer, p_currency text)
returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_req public.design_requests%rowtype;
  v_new boolean := false;
begin
  update public.design_requests
     set status = 'submitted', payment_status = 'paid', paid_at = now(), stripe_checkout_session_id = p_session,
         stripe_payment_intent_id = p_payment_intent, amount_cents = p_amount, currency = p_currency
   where id = p_request and status = 'pending_payment'
  returning * into v_req;
  if found then
    v_new := true;
    update public.programs set design_mode = 'dpa', design_status = 'pending_dpa'
     where id = v_req.program_id and design_status = 'draft';
    -- The other unpaid orders of this program are superseded.
    update public.design_requests set status = 'cancelled'
     where program_id = v_req.program_id and status = 'pending_payment' and id <> v_req.id;
  else
    select r.* into v_req from public.design_requests r where r.id = p_request;
    if not found then
      raise exception 'design_request_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('request', to_jsonb(v_req), 'newly_paid', v_new);
end;
$$;

-- Admin transitions (service role, after the admin_users check in the Edge Function):
-- submitted → in_progress → delivered. Delivered validates the program design (the
-- final visuals are set on the program beforehand, as documented in the README).
create function public.design_set_status(p_request uuid, p_status text) returns public.design_requests
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_req public.design_requests%rowtype;
begin
  select r.* into v_req from public.design_requests r where r.id = p_request for update;
  if not found then
    raise exception 'design_request_not_found' using errcode = 'P0002';
  end if;
  if not ((v_req.status = 'submitted' and p_status = 'in_progress') or (v_req.status = 'in_progress' and p_status = 'delivered')) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update public.design_requests
     set status = p_status,
         in_progress_at = case when p_status = 'in_progress' then now() else in_progress_at end,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end
   where id = p_request
  returning * into v_req;
  if p_status = 'delivered' then
    update public.programs set design_status = 'validated', design_validated_at = now()
     where id = v_req.program_id and design_status = 'pending_dpa';
  end if;
  return v_req;
end;
$$;

revoke all on function public.design_mark_paid(uuid, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.design_set_status(uuid, text) from public, anon, authenticated;
grant execute on function public.design_mark_paid(uuid, text, text, integer, text) to service_role;
grant execute on function public.design_set_status(uuid, text) to service_role;

-- Admin: paid requests to process, with the merchant and its program.
create function public.admin_design_requests() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'created_at', r.created_at, 'paid_at', r.paid_at, 'amount_cents', r.amount_cents, 'currency', r.currency,
    'colors', r.colors, 'description', r.description, 'contact_name', r.contact_name, 'contact_email', r.contact_email, 'contact_phone', r.contact_phone,
    'logo_path', r.logo_path, 'reference_paths', r.reference_paths, 'notified_at', r.notified_at, 'notify_error', r.notify_error,
    'in_progress_at', r.in_progress_at, 'delivered_at', r.delivered_at,
    'merchant_id', m.id, 'business_name', m.business_name, 'owner_name', btrim(m.first_name || ' ' || m.last_name), 'owner_id', m.created_by,
    'program_name', p.name, 'program_design_status', p.design_status
  ) order by r.paid_at desc nulls last), '[]'::jsonb)
  from public.design_requests r
  join public.merchants m on m.id = r.merchant_id
  join public.programs p on p.id = r.program_id
  where r.payment_status = 'paid';
$$;
revoke all on function public.admin_design_requests() from public, anon, authenticated;
grant execute on function public.admin_design_requests() to service_role;

create or replace function public.admin_overview() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'merchants', (select count(*) from public.merchants),
      'programs', (select count(*) from public.programs),
      'customers', (select count(*) from public.customers),
      'cards', (select count(*) from public.cards),
      'events', (select count(*) from public.card_events),
      'notifications_sent', (select count(*) from public.notifications n where n.status in ('sent', 'partial')),
      'wallet_passes', (select count(*) from public.wallet_passes),
      'subscriptions_valid', (select count(*) from public.subscriptions s where s.status in ('trialing', 'active')),
      'designs_to_process', (select count(*) from public.design_requests r where r.status in ('submitted', 'in_progress') and r.payment_status = 'paid')
    ),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'business_name', m.business_name, 'activity', m.activity, 'address', m.address,
        'created_at', m.created_at, 'owner_id', m.created_by, 'owner_name', btrim(m.first_name || ' ' || m.last_name),
        'program', (select jsonb_build_object('name', p.name, 'mode', p.mode, 'goal', p.goal, 'reward', p.reward,
                      'bg', p.bg, 'accent', p.accent, 'logo', p.logo, 'design_status', p.design_status)
                    from public.programs p where p.merchant_id = m.id and p.is_active),
        'subscription', (select jsonb_build_object('plan_type', s.plan_type, 'status', s.status, 'trial_end', s.trial_end,
                      'monthly_amount_cents', s.monthly_amount_cents, 'commitment_end', s.commitment_end,
                      'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end)
                    from public.subscriptions s where s.merchant_id = m.id),
        'customers', (select count(*) from public.customers c where c.merchant_id = m.id),
        'cards', (select count(*) from public.cards k where k.merchant_id = m.id),
        'events', (select count(*) from public.card_events e where e.merchant_id = m.id),
        'visits', (select count(*) from public.card_events e where e.merchant_id = m.id and e.type = 'visit'),
        'wallet_passes', (select count(*) from public.wallet_passes w where w.merchant_id = m.id),
        'last_activity', (select max(e.created_at) from public.card_events e where e.merchant_id = m.id)
      ) order by m.created_at desc)
      from public.merchants m
    ), '[]'::jsonb)
  );
$$;
