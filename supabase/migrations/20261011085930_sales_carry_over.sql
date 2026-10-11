-- Monthly statement: commissions of earlier months still to validate or to pay are carried over to the
-- selected month, and a payout may settle them (period <= the statement month). A negative adjustment
-- left from a refund is therefore deducted from the next transfer instead of staying open forever.
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
  select * into v from public.commission_payouts where idempotency_key = p_key;
  if found then return v; end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Europe/Paris')::date then raise exception 'invalid_paid_on' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_to_pay' using errcode = '22023'; end if;
  perform 1 from public.commissions where id = any (p_ids) for update;
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

create or replace function public.sales_dashboard(p_from date, p_to date) returns jsonb
language sql stable set search_path = ''
as $$
  with att as (
    select a.*, r.display_name from public.merchant_attributions a join public.sales_reps r on r.id = a.sales_rep_id
  ), pay as (
    select sp.*, a.sales_rep_id from public.sales_payments sp left join public.merchant_attributions a on a.merchant_id = sp.merchant_id
  ), com as (
    select c.* from public.commissions c where (p_from is null or c.period >= p_from) and (p_to is null or c.period <= p_to)
  ), com_list as (
    -- the period's commissions, plus earlier ones still to validate or to pay (carried over to this statement)
    select c.* from public.commissions c
    where ((p_from is null or c.period >= p_from) and (p_to is null or c.period <= p_to))
       or (c.status in ('to_validate', 'to_pay') and (p_to is null or c.period <= p_to))
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'rules_in_force', jsonb_build_object(
      'initial', exists (select 1 from public.commission_rules r where r.kind = 'initial' and r.disabled_at is null),
      'recurring', exists (select 1 from public.commission_rules r where r.kind = 'recurring' and r.disabled_at is null)),
    'reps', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.display_name, 'email', r.email, 'active', r.active,
      'merchants', (select count(*) from att a join public.merchants m on m.id = a.merchant_id where a.sales_rep_id = r.id and app_private.sales_in(m.created_at, p_from, p_to)),
      'cards', (select count(*) from att a join public.programs p on p.merchant_id = a.merchant_id and p.is_active
                where a.sales_rep_id = r.id and app_private.sales_in(p.card_design_validated_at, p_from, p_to)),
      'sales_paid', (select count(distinct x.merchant_id) from pay x where x.sales_rep_id = r.id and x.kind = 'setup'
                     and x.status in ('paid', 'partially_refunded') and app_private.sales_in(x.paid_at, p_from, p_to)),
      'active', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.status = 'active' and not s.cancel_at_period_end),
      'trialing', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.status = 'trialing' and not s.cancel_at_period_end),
      'canceled', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and (s.status = 'canceled' or s.cancel_at_period_end)),
      'past_due', (select count(*) from att a join public.subscriptions s on s.merchant_id = a.merchant_id where a.sales_rep_id = r.id and s.status in ('past_due', 'unpaid')),
      'payments_failed', (select count(*) from pay x where x.sales_rep_id = r.id and x.status = 'failed' and app_private.sales_in(x.failed_at, p_from, p_to)),
      'refunds', (select count(*) from pay x where x.sales_rep_id = r.id and x.refunded_cents > 0 and app_private.sales_in(x.refunded_at, p_from, p_to)),
      'revenue_initial_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'setup' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'revenue_monthly_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'subscription' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'comm_initial_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.kind = 'initial' and c.status <> 'cancelled'),
      'comm_recurring_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.kind = 'recurring' and c.status <> 'cancelled'),
      'comm_paid_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'paid'),
      'comm_to_validate_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'to_validate'),
      'comm_to_pay_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.sales_rep_id = r.id and c.status = 'to_pay')
    ) order by r.created_at) from public.sales_reps r), '[]'::jsonb),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'business_name', m.business_name, 'created_at', m.created_at,
      'sales_rep_id', a.sales_rep_id, 'sales_rep', a.display_name, 'source', a.source, 'attributed_at', a.attributed_at,
      'subscription_status', s.status, 'cancel_at_period_end', s.cancel_at_period_end, 'plan_type', s.plan_type,
      'card_validated_at', (select p.card_design_validated_at from public.programs p where p.merchant_id = m.id and p.is_active),
      'setup_paid_at', (select min(x.paid_at) from public.sales_payments x where x.merchant_id = m.id and x.kind = 'setup'),
      'revenue_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from public.sales_payments x where x.merchant_id = m.id and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'commission_cents', (select coalesce(sum(c.amount_cents), 0) from com c where c.merchant_id = m.id and c.status <> 'cancelled')
    ) order by m.created_at desc)
      from public.merchants m left join att a on a.merchant_id = m.id left join public.subscriptions s on s.merchant_id = m.id), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'merchant_id', c.merchant_id, 'merchant_name', c.merchant_name, 'sales_rep_id', c.sales_rep_id, 'kind', c.kind,
      'period', c.period, 'base_cents', c.base_cents, 'amount_cents', c.amount_cents, 'status', c.status, 'rule', c.rule_snapshot,
      'reverses_id', c.reverses_id, 'note', c.note, 'payout_id', c.payout_id, 'paid_at', c.paid_at, 'validated_at', c.validated_at,
      'cancel_reason', c.cancel_reason, 'created_at', c.created_at,
      'payment', (select jsonb_build_object('provider', x.provider, 'ref', x.provider_payment_id, 'kind', x.kind, 'status', x.status,
                    'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'paid_at', x.paid_at, 'period_start', x.period_start, 'period_end', x.period_end)
                  from public.sales_payments x where x.id = c.payment_id)
    ) order by c.period desc, c.created_at desc) from com_list c), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'merchant_id', x.merchant_id, 'merchant_name', x.merchant_name, 'sales_rep_id', x.sales_rep_id, 'provider', x.provider,
      'ref', x.provider_payment_id, 'kind', x.kind, 'status', x.status, 'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents,
      'paid_at', x.paid_at, 'failed_at', x.failed_at, 'refunded_at', x.refunded_at, 'plan_type', x.plan_type
    ) order by coalesce(x.paid_at, x.failed_at, x.created_at) desc)
      from pay x where app_private.sales_in(coalesce(x.paid_at, x.failed_at, x.created_at), p_from, p_to)), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'sales_rep_id', o.sales_rep_id, 'period', o.period, 'amount_cents', o.amount_cents,
      'commission_count', o.commission_count, 'paid_on', o.paid_on, 'reference', o.reference, 'note', o.note, 'created_by', o.created_by, 'created_at', o.created_at)
      order by o.created_at desc) from public.commission_payouts o), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.disabled_at is not null, r.created_at desc) from public.commission_rules r), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'merchant_id', l.merchant_id,
      'merchant_name', (select m.business_name from public.merchants m where m.id = l.merchant_id), 'details', l.details) order by l.at desc)
      from (select * from public.sales_audit order by at desc limit 60) l), '[]'::jsonb)
  )
$$;
