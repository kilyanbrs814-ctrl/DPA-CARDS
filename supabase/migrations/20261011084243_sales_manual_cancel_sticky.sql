-- A commission the director cancelled by hand stays cancelled for that payment, even after the
-- shop is reattributed to another rep (previously only for the same rep).
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
  k := case pay.kind when 'setup' then 'initial' when 'subscription' then 'recurring' end;
  if k is null then return; end if;
  net := case when pay.status in ('paid', 'partially_refunded', 'refunded') then greatest(pay.amount_cents - pay.refunded_cents, 0) else 0 end;

  select * into prim from public.commissions c
  where c.payment_id = pay.id and c.kind = k and c.reverses_id is null and c.status <> 'cancelled' for update;

  if not found then
    if net <= 0 or pay.merchant_id is null or pay.paid_at is null then return; end if;
    select a.sales_rep_id into v_rep from public.merchant_attributions a where a.merchant_id = pay.merchant_id;
    if v_rep is null then return; end if;
    if exists (select 1 from public.commissions c where c.payment_id = pay.id and c.kind = k and c.reverses_id is null
               and c.status = 'cancelled' and c.cancel_kind = 'manual') then return; end if;
    if k = 'initial' then
      -- Initial commission: the shop's first collected setup payment only.
      if exists (select 1 from public.commissions c where c.merchant_id = pay.merchant_id and c.kind = 'initial'
                 and c.reverses_id is null and c.status <> 'cancelled') then return; end if;
      if exists (select 1 from public.sales_payments o where o.merchant_id = pay.merchant_id and o.kind = 'setup' and o.paid_at is not null
                 and o.id <> pay.id and (o.paid_at, o.id) < (pay.paid_at, pay.id)) then return; end if;
    end if;
    r := app_private.sales_pick_rule(v_rep, pay.plan_type, k, pay.paid_at);
    if r.id is null then return; end if;
    if k = 'recurring' and r.duration_months is not null then
      select min(o.paid_at) into first_paid from public.sales_payments o
      where o.merchant_id = pay.merchant_id and o.kind = 'subscription' and o.paid_at is not null;
      if pay.paid_at >= first_paid + make_interval(months => r.duration_months) then return; end if;
    end if;
    snap := jsonb_build_object('rule_id', r.id, 'kind', r.kind, 'calc', r.calc, 'amount_cents', r.amount_cents, 'percent', r.percent,
      'duration_months', r.duration_months, 'plan_type', r.plan_type, 'sales_rep_id', r.sales_rep_id, 'valid_from', r.valid_from);
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
