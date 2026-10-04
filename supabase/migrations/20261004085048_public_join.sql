-- DPA Cards — public sign-up through /join/<slug>.
--
-- A customer who scans the shop's QR code has no session. The browser never
-- writes to the database: it calls the `wallet` Edge Function, which calls
-- public_enroll() with the service role. The merchant and program are derived
-- from merchants.slug on the server; the browser never sends an id.
--
-- anon and authenticated get nothing new: public_enroll is executable by
-- service_role only, and the ledger trigger only lets a session-less insert
-- through when it is a 'join' event written by service_role.

-- The card number default lives in app_private.
grant usage on schema app_private to service_role;
grant execute on function app_private.new_card_number() to service_role;

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

-- Idempotent public enrolment: a retried request_id returns the first result.
create function public.public_enroll(
  p_slug text, p_request_id uuid, p_first text, p_email text, p_consent boolean
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_mid  uuid;
  v_prog public.programs%rowtype;
  v_cust public.customers%rowtype;
  v_card public.cards%rowtype;
  v_ev   public.card_events%rowtype;
  i      integer;
begin
  if current_user <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  select m.id into v_mid from public.merchants m where m.slug = lower(btrim(coalesce(p_slug, '')));
  if v_mid is null then
    raise exception 'program_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'program_not_found' using errcode = 'P0002';
  end if;

  select c.* into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
  if not found then
    -- Abuse guard: a printed QR code is public, so cap session-less sign-ups per shop.
    if (select count(*) from public.customers c
        where c.merchant_id = v_mid and c.created_by is null and c.created_at > now() - interval '10 minutes') >= 100 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    begin
      insert into public.customers (merchant_id, first_name, last_name, email, consent_at, request_id)
      values (v_mid, btrim(p_first), '', nullif(lower(btrim(coalesce(p_email, ''))), ''), now(), p_request_id)
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
    begin
      insert into public.card_events (merchant_id, card_id, type, request_id)
      values (v_mid, v_card.id, 'join', p_request_id)
      returning * into v_ev;
    exception when unique_violation then
      select e.* into v_ev from public.card_events e where e.card_id = v_card.id and e.type = 'join';
      if not found then raise; end if;
    end;
  end if;

  return jsonb_build_object(
    'card', jsonb_build_object('id', v_card.id, 'card_number', v_card.card_number, 'qr_token', v_card.qr_token, 'created_at', v_card.created_at),
    'customer', jsonb_build_object('first_name', v_cust.first_name),
    'event', jsonb_build_object('seq', v_ev.seq, 'balance_after', v_ev.balance_after)
  );
end;
$$;

revoke all on function public.public_enroll(text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.public_enroll(text, uuid, text, text, boolean) to service_role;
