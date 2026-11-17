-- Staged only. Apply before enabling the new front end.
begin;
alter table public.programs
  add column points_basis text not null default 'visit' check (points_basis in ('visit','euro')),
  add column points_rate integer not null default 10 check (points_rate between 1 and 100);
alter table public.card_events add column amount_cents integer check (amount_cents between 1 and 10000000);
CREATE OR REPLACE FUNCTION app_private.card_events_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if v_prog.mode <> 'points' then
      new.amount_cents := null;
      new.delta := 1;
    elsif v_prog.points_basis = 'visit' then
      new.amount_cents := null;
      new.delta := v_prog.points_rate;
    else
      if new.amount_cents is null or new.amount_cents not between 1 and 10000000 then
        raise exception 'purchase_amount_required' using errcode = '22023';
      end if;
      new.delta := (new.amount_cents * v_prog.points_rate) / 100;
      if new.delta = 0 then raise exception 'purchase_below_point_minimum' using errcode = '22023'; end if;
    end if;
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

  if new.type <> 'visit' then new.amount_cents := null; end if;
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
$function$;
CREATE OR REPLACE FUNCTION app_private.record_points_visit(p_card_id uuid, p_request_id uuid, p_amount_cents integer)
 RETURNS card_events
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  p_type constant text := 'visit';
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
    if v_ev.amount_cents is distinct from p_amount_cents then raise exception 'request_conflict' using errcode='22023'; end if;
    return v_ev;
  end if;

  begin
    insert into public.card_events (merchant_id, card_id, type, request_id, amount_cents)
    values (v_card.merchant_id, p_card_id, p_type, p_request_id, p_amount_cents)
    returning * into v_ev;
  exception when unique_violation then
    -- Same request committed concurrently: hand back its result.
    select e.* into v_ev from public.card_events e
    where e.merchant_id = v_card.merchant_id and e.request_id = p_request_id;
    if not found or v_ev.card_id <> p_card_id or v_ev.type <> p_type or v_ev.amount_cents is distinct from p_amount_cents then
      raise;
    end if;
  end;
  return v_ev;
end;
$function$;
CREATE OR REPLACE FUNCTION public.add_points_visit_recorded(p_card_id uuid, p_request_id uuid, p_source text, p_amount_cents integer)
 RETURNS card_events
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_event public.card_events%rowtype;
begin
 if p_source not in ('scan','client') then raise exception 'invalid_source' using errcode='22023'; end if;
 v_event := app_private.record_points_visit(p_card_id,p_request_id,p_amount_cents);
 if p_source='scan' and v_event.created_by=(select auth.uid()) then
  insert into public.employee_scan_validations(event_id,merchant_id,user_id) values (v_event.id,v_event.merchant_id,(select auth.uid()))
  on conflict(event_id) do nothing;
 end if;
 return v_event;
end $function$;
revoke all on function app_private.record_points_visit(uuid,uuid,integer) from public,anon;
grant execute on function app_private.record_points_visit(uuid,uuid,integer) to authenticated;
revoke all on function public.add_points_visit_recorded(uuid,uuid,text,integer) from public,anon;
grant execute on function public.add_points_visit_recorded(uuid,uuid,text,integer) to authenticated;
-- Changing earning rates affects future visits only. Never reinterpret existing card balances.
create function app_private.keep_loyalty_units() returns trigger
language plpgsql set search_path to '' as $guard$
begin
  if new.mode is distinct from old.mode and exists (
    select 1 from public.cards c where c.program_id=old.id and c.merchant_id=old.merchant_id
  ) then raise exception 'loyalty_mode_has_cards' using errcode='22023'; end if;
  return new;
end;
$guard$;
revoke all on function app_private.keep_loyalty_units() from public, anon;
create trigger programs_keep_loyalty_units before update of mode on public.programs
for each row execute function app_private.keep_loyalty_units();
commit;
