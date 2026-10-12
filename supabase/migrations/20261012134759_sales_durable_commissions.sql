-- Durable attribution and the approved 70% agreement. No historical attribution/backfill is implicit.
-- Amounts: actually collected gross (amount_paid), discounts already included, no fee deduction.
-- Unknown historical Stripe modes are quarantined until a director checks provider evidence.
alter table public.sales_payments add column sales_rep_id uuid references public.sales_reps(id),
  add column livemode boolean, add column disputed_cents integer not null default 0 check(disputed_cents>=0);
alter table public.sales_payments drop constraint sales_payments_provider_provider_payment_id_key;
alter table public.sales_payments add unique(provider,provider_payment_id,livemode);
drop index public.commissions_one_initial;
create unique index commission_payouts_rep_reference_unique on public.commission_payouts(sales_rep_id,lower(btrim(reference))) where btrim(reference)<>'';
alter table public.merchant_attributions drop constraint merchant_attributions_source_check;
alter table public.merchant_attributions add check(source in ('admin_creation','manual','direct_signup'));

create function app_private.sales_new_merchant() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor text; rep uuid; src text;
begin
  if current_setting('role',true)='service_role' then
    actor:=nullif(current_setting('dpa.sales_actor',true),'');
    if actor is null or not exists(select 1 from public.admin_users where email=actor) then raise exception 'creation_actor_required'; end if;
    src:='admin_creation';
  else
    if auth.uid() is null or new.created_by<>auth.uid() then raise exception 'not_authenticated'; end if;
    actor:='direct_signup'; src:='direct_signup';
  end if;
  select id into rep from public.sales_reps where email=case when actor in ('direct_signup','contact@digitalprojectagency.fr') then 'kilyan.brs814@gmail.com' else actor end and active;
  if rep is null then raise exception 'sales_rep_not_configured'; end if;
  insert into public.merchant_attributions(merchant_id,sales_rep_id,source,attributed_by) values(new.id,rep,src,actor);
  insert into public.sales_audit(actor,action,merchant_id,details) values(actor,'attribution_auto',new.id,jsonb_build_object('sales_rep_id',rep,'source',src));
  return new;
end $$;
revoke all on function app_private.sales_new_merchant() from public,anon,authenticated;
create trigger sales_new_merchant after insert on public.merchants for each row execute function app_private.sales_new_merchant();

create table public.sales_creation_requests(
  request_id uuid primary key, actor text not null, fingerprint text not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.sales_creation_requests enable row level security;
revoke all on public.sales_creation_requests from public,anon,authenticated;
grant all on public.sales_creation_requests to service_role;
create function public.sales_create_merchant(p_actor text,p_key uuid,p_fingerprint text,p_user uuid,p_business text,p_first text,p_last text,p_activity text,p_slug text,p_program jsonb,p_phone text,p_address text) returns jsonb
language plpgsql set search_path='' as $$
declare saved public.sales_creation_requests; result jsonb;
begin
  if not exists(select 1 from public.admin_users where email=p_actor) then raise exception 'not_admin'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select * into saved from public.sales_creation_requests where request_id=p_key;
  if found then
    if saved.actor<>p_actor or saved.fingerprint<>p_fingerprint then raise exception 'idempotency_conflict'; end if;
    return saved.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  perform set_config('dpa.sales_actor',p_actor,true);
  result:=public.admin_create_merchant(p_user,p_business,p_first,p_last,p_activity,p_slug,p_program,p_phone,p_address);
  perform set_config('dpa.sales_actor','',true);
  result:=result || jsonb_build_object('sales_attribution',(select to_jsonb(a) from public.merchant_attributions a where a.merchant_id=(result->'merchant'->>'id')::uuid));
  insert into public.sales_creation_requests(request_id,actor,fingerprint,result) values(p_key,p_actor,p_fingerprint,result);
  return result;
end $$;
revoke all on function public.sales_create_merchant(text,uuid,text,uuid,text,text,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.sales_create_merchant(text,uuid,text,uuid,text,text,text,text,text,jsonb,text,text) to service_role;

create function app_private.sales_payment_owner() returns trigger language plpgsql set search_path='' as $$
begin
  select a.sales_rep_id into new.sales_rep_id from public.merchant_attributions a where a.merchant_id=new.merchant_id;
  return new;
end $$;
revoke all on function app_private.sales_payment_owner() from public,anon,authenticated;
create trigger sales_payment_owner before insert on public.sales_payments for each row execute function app_private.sales_payment_owner();

-- Dedicated rules, no blanket rule paying Kilyan; lifetime recurring, all other receipts initial.
insert into public.commission_rules(kind,calc,percent,sales_rep_id,valid_from,created_by)
select k,'percent',70,r.id,'2000-01-01','contact@digitalprojectagency.fr'
from public.sales_reps r cross join (values('initial'),('recurring')) as kinds(k)
where r.email in ('mael.81400@icloud.com','zakariabouras2020@gmail.com');

-- A cumulative provider refund is retained even when it arrives before its invoice.
create table public.sales_charge_adjustments(
 provider text not null, charge_ref text not null, livemode boolean not null,
 refunded_cents integer not null default 0 check(refunded_cents>=0),
 disputed_cents integer not null default 0 check(disputed_cents>=0),
 dispute_at bigint not null default 0, primary key(provider,charge_ref,livemode)
);
alter table public.sales_charge_adjustments enable row level security;
revoke all on public.sales_charge_adjustments from public,anon,authenticated;
grant all on public.sales_charge_adjustments to service_role;
create function public.sales_record_refund(p_provider text,p_charge_ref text,p_refunded integer,p_live boolean) returns uuid
language plpgsql set search_path='' as $$
declare row public.sales_payments; adj public.sales_charge_adjustments;
begin
 if nullif(p_charge_ref,'') is null then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_provider||p_charge_ref||p_live::text,0));
 insert into public.sales_charge_adjustments as a(provider,charge_ref,livemode,refunded_cents)
 values(p_provider,p_charge_ref,p_live,greatest(p_refunded,0))
 on conflict(provider,charge_ref,livemode) do update set refunded_cents=greatest(a.refunded_cents,excluded.refunded_cents)
 returning * into adj;
 for row in select * from public.sales_payments where provider=p_provider and provider_charge_ref=p_charge_ref and livemode=p_live and paid_at is not null for update loop
   update public.sales_payments set refunded_cents=least(amount_cents,adj.refunded_cents), disputed_cents=least(amount_cents,adj.disputed_cents),
    status=case when adj.refunded_cents>=amount_cents then 'refunded' when adj.refunded_cents>0 then 'partially_refunded' else 'paid' end,
    refunded_at=case when adj.refunded_cents>0 then coalesce(refunded_at,now()) else refunded_at end where id=row.id;
   perform app_private.sales_reconcile_payment(row.id);
 end loop;
 return row.id;
end $$;
-- Old endpoint fails closed: callers must explicitly provide mode.
create or replace function public.sales_record_refund(p_provider text,p_charge_ref text,p_refunded integer) returns uuid language plpgsql set search_path='' as $$ begin raise exception 'payment_mode_required'; end $$;
create function public.sales_record_dispute(p_provider text,p_charge_ref text,p_amount integer,p_live boolean,p_event_at bigint) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_provider||p_charge_ref||p_live::text,0));
 insert into public.sales_charge_adjustments as a(provider,charge_ref,livemode,disputed_cents,dispute_at)
 values(p_provider,p_charge_ref,p_live,p_amount,p_event_at)
 on conflict(provider,charge_ref,livemode) do update set disputed_cents=excluded.disputed_cents,dispute_at=excluded.dispute_at where a.dispute_at<=excluded.dispute_at;
 perform public.sales_record_refund(p_provider,p_charge_ref,0,p_live);
end $$;
revoke all on function public.sales_record_refund(text,text,integer,boolean), public.sales_record_dispute(text,text,integer,boolean,bigint) from public,anon,authenticated;
grant execute on function public.sales_record_refund(text,text,integer,boolean), public.sales_record_dispute(text,text,integer,boolean,bigint) to service_role;

create or replace function app_private.sales_reconcile_payment(p_payment uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  pay        public.sales_payments;
  k          text;
  net        integer;
  prim       public.commissions;
  adj        public.commissions;
  v_rep      uuid;
  r          public.commission_rules;
  snap       jsonb;
  desired    integer;
  settled    integer;
  delta      integer;
  first_paid timestamptz;
begin
  select * into pay from public.sales_payments where id = p_payment for update;
  if not found then return; end if;
  k := case when pay.kind = 'subscription' then 'recurring' else 'initial' end;
  if pay.livemode is null then return; end if;
  if k is null then return; end if;
  net := case when pay.status in ('paid', 'partially_refunded', 'refunded') then greatest(pay.amount_cents - least(pay.amount_cents, pay.refunded_cents + pay.disputed_cents), 0) else 0 end;

  select * into prim from public.commissions c
  where c.payment_id = pay.id and c.kind = k and c.reverses_id is null and c.status <> 'cancelled' for update;

  if not found then
    if net <= 0 or pay.merchant_id is null or pay.paid_at is null then return; end if;
    v_rep := pay.sales_rep_id;
    if exists (select 1 from public.sales_reps where id=v_rep and email='kilyan.brs814@gmail.com') then return; end if;
    if v_rep is null then return; end if;
    if exists (select 1 from public.commissions c where c.payment_id = pay.id and c.kind = k and c.reverses_id is null
               and c.status = 'cancelled' and c.cancel_kind = 'manual') then return; end if;
    r := app_private.sales_pick_rule(v_rep, pay.plan_type, k, pay.paid_at);
    if r.id is null then return; end if;
    if k = 'recurring' and r.duration_months is not null then
      select min(o.paid_at) into first_paid from public.sales_payments o
      where o.merchant_id = pay.merchant_id and o.kind = 'subscription' and o.paid_at is not null;
      if pay.paid_at >= first_paid + make_interval(months => r.duration_months) then return; end if;
    end if;
    snap := jsonb_build_object('rule_id', r.id, 'kind', r.kind, 'calc', r.calc, 'amount_cents', r.amount_cents, 'percent', r.percent,
      'duration_months', r.duration_months, 'plan_type', r.plan_type, 'sales_rep_id', r.sales_rep_id, 'valid_from', r.valid_from, 'basis', 'collected_gross_no_fee_deduction', 'payment_kind', pay.kind);
    insert into public.commissions (payment_id, merchant_id, merchant_name, sales_rep_id, kind, period, base_cents, amount_cents, rule_id, rule_snapshot)
    values (pay.id, pay.merchant_id, pay.merchant_name, v_rep, k, app_private.sales_month(pay.paid_at), net,
            app_private.sales_amount(snap, net), r.id, snap)
    on conflict do nothing;
    return;
  end if;

  desired := app_private.sales_amount(prim.rule_snapshot, net);
  if prim.status in ('to_validate', 'to_pay') then
    if desired = 0 then
      update public.commissions set status = 'cancelled', cancel_kind = 'refund', cancelled_at = now(), cancelled_by = 'system',
        cancel_reason = 'Paiement remboursé' where id = prim.id;
    elsif desired <> prim.amount_cents then
      update public.commissions set amount_cents = desired, base_cents = net where id = prim.id;
    end if;
    return;
  end if;

  -- Paid: compare what the rep should have with what was paid, settle the gap in one adjustment.
  select coalesce(sum(c.amount_cents), 0) into settled from public.commissions c where c.reverses_id = prim.id and c.status = 'paid';
  delta := desired - prim.amount_cents - settled;
  select * into adj from public.commissions c where c.reverses_id = prim.id and c.status in ('to_validate', 'to_pay') for update;
  if found then
    if delta = 0 then
      update public.commissions set status = 'cancelled', cancel_kind = 'refund', cancelled_at = now(), cancelled_by = 'system',
        cancel_reason = 'Régularisation devenue inutile' where id = adj.id;
    elsif delta <> adj.amount_cents then
      update public.commissions set amount_cents = delta, base_cents = net, status = 'to_validate', validated_at = null, validated_by = null where id = adj.id;
    end if;
  elsif delta <> 0 then
    insert into public.commissions (payment_id, merchant_id, merchant_name, sales_rep_id, kind, period, base_cents, amount_cents,
                                    rule_id, rule_snapshot, reverses_id, note)
    values (pay.id, pay.merchant_id, pay.merchant_name, prim.sales_rep_id, prim.kind, app_private.sales_month(now()), net, delta,
            prim.rule_id, prim.rule_snapshot, prim.id, 'Régularisation après remboursement d’une commission déjà versée');
  end if;
end;
$$;

create or replace function public.sales_record_payment(p jsonb) returns public.sales_payments
language plpgsql set search_path = ''
as $$
declare
  v_row      public.sales_payments;
  v_merchant uuid := nullif(p ->> 'merchant_id', '')::uuid;
  v_name     text;
  v_status   text := p ->> 'status';
begin
  if p->>'livemode' not in ('true','false') or p->>'livemode' is null then raise exception 'payment_mode_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended((p->>'provider')||coalesce(p->>'provider_charge_ref','')||(p->>'livemode'),0));
  if v_status not in ('pending', 'paid', 'failed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  select m.business_name into v_name from public.merchants m where m.id = v_merchant;
  if v_name is null then return null; end if;   -- unknown shop: nothing to attribute
  insert into public.sales_payments as s (provider, provider_payment_id, merchant_id, merchant_name, kind, status, amount_cents, currency,
    plan_type, provider_subscription_id, provider_charge_ref, period_start, period_end, paid_at, failed_at, livemode)
  values (p ->> 'provider', p ->> 'provider_payment_id', v_merchant, v_name, p ->> 'kind', v_status, (p ->> 'amount_cents')::integer,
    coalesce(nullif(p ->> 'currency', ''), 'eur'), nullif(p ->> 'plan_type', ''), nullif(p ->> 'provider_subscription_id', ''),
    nullif(p ->> 'provider_charge_ref', ''), (p ->> 'period_start')::timestamptz, (p ->> 'period_end')::timestamptz,
    case when v_status = 'paid' then coalesce((p ->> 'paid_at')::timestamptz, now()) end,
    case when v_status = 'failed' then coalesce((p ->> 'failed_at')::timestamptz, now()) end, (p->>'livemode')::boolean)
  on conflict (provider, provider_payment_id, livemode) do update set
    sales_rep_id = case when s.paid_at is null and excluded.status='paid' then excluded.sales_rep_id else s.sales_rep_id end,
    status = case when s.status in ('paid', 'refunded', 'partially_refunded') then s.status
                  when excluded.status = 'paid' then 'paid'
                  when excluded.status = 'failed' then 'failed'
                  else s.status end,
    amount_cents = case when s.status in ('paid', 'refunded', 'partially_refunded') then s.amount_cents else excluded.amount_cents end,
    paid_at = coalesce(s.paid_at, excluded.paid_at),
    failed_at = coalesce(s.failed_at, excluded.failed_at),
    plan_type = coalesce(s.plan_type, excluded.plan_type),
    provider_subscription_id = coalesce(s.provider_subscription_id, excluded.provider_subscription_id),
    provider_charge_ref = coalesce(excluded.provider_charge_ref, s.provider_charge_ref),
    period_start = coalesce(s.period_start, excluded.period_start),
    period_end = coalesce(s.period_end, excluded.period_end)
  returning * into v_row;
  perform public.sales_record_refund(v_row.provider, v_row.provider_charge_ref, 0, v_row.livemode);
  perform app_private.sales_reconcile_payment(v_row.id);
  return v_row;
end;
$$;



-- Corrections change only future receipts. Historical beneficiaries and payouts are never moved.
create or replace function public.sales_attribute(p_merchant uuid,p_rep uuid,p_actor text,p_source text,p_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare old_rep uuid;
begin
 perform app_private.sales_require_director(p_actor);
 if p_source<>'manual' or nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
 if p_rep is null or not exists(select 1 from public.sales_reps where id=p_rep and active) then raise exception 'rep_not_found'; end if;
 perform 1 from public.merchants where id=p_merchant for update;
 if not found then raise exception 'merchant_not_found'; end if;
 select sales_rep_id into old_rep from public.merchant_attributions where merchant_id=p_merchant;
 insert into public.merchant_attributions(merchant_id,sales_rep_id,source,attributed_by) values(p_merchant,p_rep,'manual',p_actor)
 on conflict(merchant_id) do update set sales_rep_id=excluded.sales_rep_id,source='manual',attributed_by=p_actor,attributed_at=now();
 insert into public.sales_audit(actor,action,merchant_id,details) values(p_actor,'attribution_manual',p_merchant,jsonb_build_object('from',old_rep,'to',p_rep,'reason',p_reason,'scope','future_receipts_only'));
 return jsonb_build_object('attributed',true,'sales_rep_id',p_rep);
end $$;

create or replace function public.sales_payout(p_actor text, p_rep uuid, p_period date, p_ids uuid[], p_expected integer,
                                    p_paid_on date, p_reference text, p_note text, p_key uuid)
returns public.commission_payouts
language plpgsql set search_path = ''
as $$
declare
  v       public.commission_payouts;
  v_count integer;
  v_total integer;
begin
  perform app_private.sales_require_director(p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_rep::text,0));
  select * into v from public.commission_payouts where idempotency_key = p_key;
  if found then
    if v.period<>p_period or v.created_by<>lower(btrim(p_actor)) or
       (select array_agg(id order by id) from public.commissions where payout_id=v.id) is distinct from (select array_agg(x order by x) from unnest(p_ids) x) or
       v.sales_rep_id<>p_rep or v.amount_cents<>p_expected or v.paid_on<>p_paid_on or v.reference<>btrim(coalesce(p_reference,'')) then raise exception 'idempotency_conflict'; end if;
    return v;
  end if;
  if nullif(btrim(p_reference),'') is null then raise exception 'reference_required'; end if;
  if exists(select 1 from public.commission_payouts where sales_rep_id=p_rep and lower(btrim(reference))=lower(btrim(p_reference))) then raise exception 'duplicate_reference'; end if;
  if p_expected <= 0 then raise exception 'positive_payout_required'; end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Europe/Paris')::date then raise exception 'invalid_paid_on' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_to_pay' using errcode = '22023'; end if;
  perform 1 from public.commissions where id = any (p_ids) order by id for update;
  if (select count(distinct p.livemode) from public.commissions c join public.sales_payments p on p.id=c.payment_id where c.id=any(p_ids))<>1
     or exists(select 1 from public.commissions c join public.sales_payments p on p.id=c.payment_id where c.id=any(p_ids) and p.livemode is null) then raise exception 'mixed_payment_modes'; end if;
  select count(*), coalesce(sum(amount_cents), 0) into v_count, v_total from public.commissions
   where id = any (p_ids) and status = 'to_pay' and sales_rep_id = p_rep and period <= p_period;
  if v_count <> array_length(p_ids, 1) or v_count <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'selection_changed'; end if;
  if v_total <> p_expected then raise exception 'total_changed'; end if;
  insert into public.commission_payouts (sales_rep_id, period, amount_cents, commission_count, paid_on, reference, note, idempotency_key, created_by)
  values (p_rep, p_period, v_total, v_count, p_paid_on, left(btrim(coalesce(p_reference, '')), 120), left(btrim(coalesce(p_note, '')), 500), p_key, lower(btrim(p_actor)))
  returning * into v;
  update public.commissions set status = 'paid', payout_id = v.id, paid_at = p_paid_on where id = any (p_ids);
  insert into public.sales_audit (actor, action, details)
  values (lower(btrim(p_actor)), 'payout_recorded', jsonb_build_object('payout_id', v.id, 'sales_rep_id', p_rep, 'period', p_period, 'amount_cents', v_total, 'count', v_count));
  return v;
end;
$$;


create or replace function public.sales_dashboard_mode(p_from date, p_to date, p_live boolean) returns jsonb
language sql stable set search_path = ''
as $$
  with att as (
    select a.*, r.display_name from public.merchant_attributions a join public.sales_reps r on r.id = a.sales_rep_id
  ), pay as (
    select sp.* from public.sales_payments sp where sp.livemode=p_live
  ), com as (
    select c.* from public.commissions c where exists(select 1 from pay x where x.id=c.payment_id) and (p_from is null or c.period >= p_from) and (p_to is null or c.period <= p_to)
  ), com_list as (
    -- the period's commissions, plus earlier ones still to validate or to pay (carried over to this statement)
    select c.* from public.commissions c
    where exists(select 1 from pay x where x.id=c.payment_id) and (((p_from is null or c.period >= p_from) and (p_to is null or c.period <= p_to))
       or (c.status in ('to_validate', 'to_pay') and (p_to is null or c.period <= p_to)))
  )
  select jsonb_build_object(
    'anomalies', jsonb_build_object('unattributed_merchants',(select count(*) from public.merchants m where not exists (select 1 from att a where a.merchant_id=m.id)), 'unattributed_revenue_cents',(select coalesce(sum(amount_cents-least(amount_cents,refunded_cents+disputed_cents)),0) from pay where sales_rep_id is null and paid_at is not null and app_private.sales_in(paid_at,p_from,p_to)), 'unknown_mode_payments',(select count(*) from public.sales_payments where livemode is null)),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'rules_in_force', jsonb_build_object(
      'initial', exists (select 1 from public.commission_rules r where r.kind = 'initial' and r.disabled_at is null),
      'recurring', exists (select 1 from public.commission_rules r where r.kind = 'recurring' and r.disabled_at is null),
      'prepaid', true),
    'reps', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.display_name, 'email', r.email, 'active', r.active,
      'merchants', (select count(*) from att a join public.merchants m on m.id = a.merchant_id where a.sales_rep_id = r.id and app_private.sales_in(m.created_at, p_from, p_to)),
      'cards', (select count(*) from att a join public.programs p on p.merchant_id = a.merchant_id and p.is_active
                where a.sales_rep_id = r.id and app_private.sales_in(p.card_design_validated_at, p_from, p_to)),
      'sales_paid', (select count(distinct x.merchant_id) from pay x where x.sales_rep_id = r.id and x.kind in ('setup', 'prepaid')
                     and x.status in ('paid', 'partially_refunded') and app_private.sales_in(x.paid_at, p_from, p_to)),
      'active', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.billing_mode = 'monthly' and s.status = 'active' and not s.cancel_at_period_end),
      'prepaid_active', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.billing_mode = 'prepaid' and s.status = 'active' and s.current_period_end > now()),
      'trialing', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.status = 'trialing' and not s.cancel_at_period_end),
      'canceled', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and (s.status = 'canceled' or s.cancel_at_period_end)),
      'past_due', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.status in ('past_due', 'unpaid')),
      'payments_failed', (select count(*) from pay x where x.sales_rep_id = r.id and x.status = 'failed' and app_private.sales_in(x.failed_at, p_from, p_to)),
      'refunds', (select count(*) from pay x where x.sales_rep_id = r.id and x.refunded_cents > 0 and app_private.sales_in(x.refunded_at, p_from, p_to)),
      'balance_cents', (select coalesce(sum(c.amount_cents),0) from public.commissions c where c.sales_rep_id=r.id and c.status in ('to_validate','to_pay') and exists(select 1 from pay x where x.id=c.payment_id)),
      'revenue_design_cents', (select coalesce(sum(x.amount_cents-least(x.amount_cents, x.refunded_cents + x.disputed_cents)),0) from pay x where x.sales_rep_id=r.id and x.kind='design' and x.paid_at is not null and app_private.sales_in(x.paid_at,p_from,p_to)),
      'revenue_other_cents', (select coalesce(sum(x.amount_cents-least(x.amount_cents, x.refunded_cents + x.disputed_cents)),0) from pay x where x.sales_rep_id=r.id and x.kind='other' and x.paid_at is not null and app_private.sales_in(x.paid_at,p_from,p_to)),
      'revenue_total_cents', (select coalesce(sum(x.amount_cents-least(x.amount_cents, x.refunded_cents + x.disputed_cents)),0) from pay x where x.sales_rep_id=r.id and x.paid_at is not null and app_private.sales_in(x.paid_at,p_from,p_to)),
      'revenue_initial_cents', (select coalesce(sum(x.amount_cents - least(x.amount_cents, x.refunded_cents + x.disputed_cents)), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'setup' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'revenue_monthly_cents', (select coalesce(sum(x.amount_cents - least(x.amount_cents, x.refunded_cents + x.disputed_cents)), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'subscription' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'revenue_prepaid_cents', (select coalesce(sum(x.amount_cents - least(x.amount_cents, x.refunded_cents + x.disputed_cents)), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'prepaid' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'prepaid_sales', (select count(*) from pay x where x.sales_rep_id = r.id and x.kind = 'prepaid' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'comm_initial_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.kind = 'initial' and c.status <> 'cancelled'),
      'comm_recurring_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.kind = 'recurring' and c.status <> 'cancelled'),
      'comm_paid_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'paid'),
      'comm_to_validate_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'to_validate'),
      'comm_to_pay_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'to_pay')
    ) order by r.created_at) from public.sales_reps r), '[]'::jsonb),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'business_name', m.business_name, 'created_at', m.created_at,
      'sales_rep_id', a.sales_rep_id, 'sales_rep', a.display_name, 'source', a.source, 'attributed_at', a.attributed_at,
      'subscription_status', s.status, 'cancel_at_period_end', s.cancel_at_period_end, 'plan_type', s.plan_type, 'billing_mode', s.billing_mode,
      'period_end', case when s.billing_mode = 'prepaid' then s.current_period_end end,
      'card_validated_at', (select p.card_design_validated_at from public.programs p where p.merchant_id = m.id and p.is_active),
      'setup_paid_at', (select min(x.paid_at) from pay x where x.merchant_id = m.id and x.kind in ('setup', 'prepaid')),
      'revenue_cents', (select coalesce(sum(x.amount_cents - least(x.amount_cents, x.refunded_cents + x.disputed_cents)), 0) from pay x where x.merchant_id = m.id and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'commission_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.merchant_id = m.id and c.status <> 'cancelled')
    ) order by m.created_at desc)
      from public.merchants m left join att a on a.merchant_id = m.id left join public.subscriptions s on s.merchant_id = m.id), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'merchant_id', c.merchant_id, 'merchant_name', c.merchant_name, 'sales_rep_id', c.sales_rep_id, 'kind', c.kind,
      'period', c.period, 'base_cents', c.base_cents, 'amount_cents', c.amount_cents, 'status', c.status, 'rule', c.rule_snapshot,
      'reverses_id', c.reverses_id, 'note', c.note, 'payout_id', c.payout_id, 'paid_at', c.paid_at, 'validated_at', c.validated_at,
      'cancel_reason', c.cancel_reason, 'created_at', c.created_at,
      'payment', (select jsonb_build_object('provider', x.provider, 'ref', x.provider_payment_id, 'kind', x.kind, 'status', x.status,
                    'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'disputed_cents', x.disputed_cents, 'livemode', x.livemode, 'paid_at', x.paid_at, 'period_start', x.period_start, 'period_end', x.period_end)
                  from public.sales_payments x where x.id = c.payment_id)
    ) order by c.period desc, c.created_at desc) from com_list c), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'merchant_id', x.merchant_id, 'merchant_name', x.merchant_name, 'sales_rep_id', x.sales_rep_id, 'provider', x.provider,
      'ref', x.provider_payment_id, 'kind', x.kind, 'status', x.status, 'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'disputed_cents', x.disputed_cents, 'livemode', x.livemode,
      'paid_at', x.paid_at, 'failed_at', x.failed_at, 'refunded_at', x.refunded_at, 'plan_type', x.plan_type,
      'period_start', x.period_start, 'period_end', x.period_end,
      'prepaid', (select jsonb_build_object('months', pp.months, 'monthly_cents', pp.monthly_cents, 'setup_cents', pp.setup_cents,
                    'base_cents', pp.base_cents, 'dispute_status', pp.dispute_status, 'conflict', pp.conflict)
                  from public.prepaid_purchases pp where x.kind = 'prepaid' and pp.stripe_invoice_id = x.provider_payment_id)
    ) order by coalesce(x.paid_at, x.failed_at, x.created_at) desc)
      from pay x where app_private.sales_in(coalesce(x.paid_at, x.failed_at, x.created_at), p_from, p_to)), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'sales_rep_id', o.sales_rep_id, 'period', o.period, 'amount_cents', o.amount_cents,
      'commission_count', o.commission_count, 'paid_on', o.paid_on, 'reference', o.reference, 'note', o.note, 'created_by', o.created_by, 'created_at', o.created_at)
      order by o.created_at desc) from public.commission_payouts o where exists(select 1 from public.commissions c join pay x on x.id=c.payment_id where c.payout_id=o.id)), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.disabled_at is not null, r.created_at desc) from public.commission_rules r), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'merchant_id', l.merchant_id,
      'merchant_name', (select m.business_name from public.merchants m where m.id = l.merchant_id), 'details', l.details) order by l.at desc)
      from (select * from public.sales_audit order by at desc limit 60) l), '[]'::jsonb)
  )
$$;

revoke all on function public.sales_dashboard_mode(date,date,boolean) from public,anon,authenticated;
grant execute on function public.sales_dashboard_mode(date,date,boolean) to service_role;
create or replace function public.sales_dashboard(p_from date,p_to date) returns jsonb language sql stable set search_path='' as $$ select public.sales_dashboard_mode(p_from,p_to,true) $$;

-- Safe historical repair: obtain this exact preview first, then pass it back for optimistic validation.
create function public.sales_reconcile_preview(p_actor text,p_ids uuid[]) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
 perform app_private.sales_require_director(p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'merchant_id',p.merchant_id,'kind',p.kind,'livemode',p.livemode,
   'sales_rep_id',coalesce(p.sales_rep_id,a.sales_rep_id),'net_cents',greatest(p.amount_cents-least(p.amount_cents, p.refunded_cents + p.disputed_cents),0),
   'expected_cents',case when r.email in ('mael.81400@icloud.com','zakariabouras2020@gmail.com') and p.paid_at is not null then round(greatest(p.amount_cents-least(p.amount_cents, p.refunded_cents + p.disputed_cents),0)*0.7)::integer else 0 end,
   'existing_commissions',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.commissions c where c.payment_id=p.id)) order by p.id),'[]') into result
 from public.sales_payments p left join public.merchant_attributions a on a.merchant_id=p.merchant_id
 left join public.sales_reps r on r.id=coalesce(p.sales_rep_id,a.sales_rep_id) where p.id=any(p_ids);
 return result;
end $$;
create function public.sales_reconcile_history(p_actor text,p_ids uuid[],p_preview jsonb,p_reason text) returns jsonb language plpgsql set search_path='' as $$
declare row record;
begin
 perform app_private.sales_require_director(p_actor);
 if nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
 perform 1 from public.sales_payments where id=any(p_ids) order by id for update;
 if public.sales_reconcile_preview(p_actor,p_ids) is distinct from p_preview then raise exception 'preview_changed'; end if;
 if exists(select 1 from public.sales_payments p where p.id=any(p_ids) and (p.livemode is null or (p.sales_rep_id is null and not exists(select 1 from public.merchant_attributions a where a.merchant_id=p.merchant_id)))) then raise exception 'historical_evidence_required'; end if;
 for row in select id from public.sales_payments where id=any(p_ids) order by id loop
  update public.sales_payments p set sales_rep_id=a.sales_rep_id from public.merchant_attributions a where p.id=row.id and a.merchant_id=p.merchant_id and p.sales_rep_id is null;
  perform app_private.sales_reconcile_payment(row.id);
 end loop;
 insert into public.sales_audit(actor,action,details) values(p_actor,'history_reconciled',jsonb_build_object('reason',p_reason,'preview',p_preview));
 return public.sales_reconcile_preview(p_actor,p_ids);
end $$;
revoke all on function public.sales_reconcile_preview(text,uuid[]), public.sales_reconcile_history(text,uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_reconcile_preview(text,uuid[]), public.sales_reconcile_history(text,uuid[],jsonb,text) to service_role;

create or replace function public.sales_merchant(p_merchant uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'details', l.details) order by l.at desc)
                from public.sales_audit l where l.merchant_id = p_merchant), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('ref', x.provider_payment_id, 'provider', x.provider, 'kind', x.kind, 'status', x.status,
                'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'disputed_cents', x.disputed_cents, 'livemode', x.livemode, 'paid_at', x.paid_at, 'failed_at', x.failed_at,
                'period_start', x.period_start, 'period_end', x.period_end) order by x.created_at desc)
                from public.sales_payments x where x.merchant_id = p_merchant), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'period', c.period, 'amount_cents', c.amount_cents,
                'status', c.status, 'livemode', (select p.livemode from public.sales_payments p where p.id=c.payment_id), 'sales_rep_id', c.sales_rep_id, 'reverses_id', c.reverses_id, 'paid_at', c.paid_at) order by c.created_at desc)
                from public.commissions c where c.merchant_id = p_merchant), '[]'::jsonb)
  )
$$;
