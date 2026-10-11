-- DPA Cards — commitment offer paid in one go ("Paiement en une fois").
--
-- The commitment offer can now be paid either monthly (unchanged: Stripe subscription) or in one
-- go: setup fee + monthly price × commitment months, no discount, one Stripe Checkout payment
-- (mode=payment, no saved card, no subscription). It covers the same months and the same features,
-- and never renews: nothing is charged at its end, the shop then falls back to the existing
-- "no valid offer" mode (locked dashboard, data kept, a new offer can be chosen).
--
-- prepaid_purchases  one row per attempt, with the price frozen at purchase time (a later price
--                    change never alters it). Written by the billing Edge Function only, after
--                    it has checked the payment with Stripe (never from the success page alone).
-- subscriptions      the shop's current offer, as before. A paid prepaid purchase sets it to
--                    billing_mode = 'prepaid', status 'active', current_period_* = the paid period.
--                    The access rule now also checks that period, so access ends on time even
--                    before the 'expired' status is written (pg_cron, every 15 minutes).
-- sales_payments     one row per payment, kind 'prepaid', recorded once at the payment date with
--                    the covered period. No commission rule applies to it (the existing rules are
--                    for setup fees and monthly payments): it is tracked, with no amount computed.
--
-- Everything is service_role only, like the sales tables.

-- ---------------------------------------------------------------- subscriptions: billing mode, 'expired'

alter table public.subscriptions
  add column billing_mode text not null default 'monthly' check (billing_mode in ('monthly', 'prepaid')),
  add column prepaid_purchase_id uuid;
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'expired'));
alter table public.subscriptions add constraint subscriptions_prepaid_shape check (
  billing_mode = 'monthly'
  or (plan_type = 'commitment' and stripe_subscription_id is null and prepaid_purchase_id is not null and status <> 'trialing')
);

-- Access: a valid monthly subscription as before, or a prepaid period that has not ended.
create or replace function app_private.merchant_active(p_merchant uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.merchant_id = p_merchant and s.status in ('trialing', 'active')
      and (s.billing_mode = 'monthly' or (s.current_period_start <= now() and s.current_period_end > now()))
  );
$$;

-- ---------------------------------------------------------------- prepaid purchases

create table public.prepaid_purchases (
  id                         uuid primary key default gen_random_uuid(),
  merchant_id                uuid not null references public.merchants (id) on delete cascade,
  created_by                 uuid,
  plan_type                  text not null default 'commitment' check (plan_type = 'commitment'),
  months                     integer not null check (months between 1 and 60),
  monthly_cents              integer not null check (monthly_cents > 0),
  base_cents                 integer not null,
  setup_cents                integer not null check (setup_cents >= 0),
  total_cents                integer not null,
  currency                   text not null default 'eur' check (currency = 'eur'),
  auto_renew                 boolean not null default false check (auto_renew = false),
  status                     text not null default 'pending'
                             check (status in ('pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded')),
  conflict                   boolean not null default false,
  dispute_status             text check (dispute_status in ('open', 'won', 'lost')),
  stripe_checkout_session_id text unique,
  stripe_customer_id         text,
  stripe_payment_intent_id   text,
  stripe_invoice_id          text,
  access_start               timestamptz,
  access_end                 timestamptz,
  paid_at                    timestamptz,
  failed_at                  timestamptz,
  canceled_at                timestamptz,
  refunded_cents             integer not null default 0 check (refunded_cents >= 0),
  refunded_at                timestamptz,
  disputed_at                timestamptz,
  access_revoked_at          timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint prepaid_price check (base_cents = monthly_cents * months and total_cents = base_cents + setup_cents),
  constraint prepaid_refund_le_total check (refunded_cents <= total_cents),
  constraint prepaid_access_shape check ((access_start is null) = (access_end is null) and (access_end is null or access_end > access_start)),
  constraint prepaid_paid_shape check (status not in ('paid', 'refunded', 'partially_refunded') or paid_at is not null)
);
-- One checkout at a time per shop: a second concurrent attempt fails on this index.
create unique index prepaid_one_open on public.prepaid_purchases (merchant_id) where status in ('pending', 'processing');
create index prepaid_merchant_idx on public.prepaid_purchases (merchant_id);
create index prepaid_pi_idx on public.prepaid_purchases (stripe_payment_intent_id);
create trigger prepaid_purchases_touch before update on public.prepaid_purchases
  for each row execute function app_private.touch_updated_at();
alter table public.prepaid_purchases enable row level security;
revoke all on public.prepaid_purchases from public, anon, authenticated;

alter table public.subscriptions add constraint subscriptions_prepaid_fk
  foreign key (prepaid_purchase_id) references public.prepaid_purchases (id) on delete set null;

-- End of a prepaid period: same local time (Europe/Paris), p_months calendar months later.
-- Postgres clamps to the month's last day (31 Jan + 1 month = 28/29 Feb; 29 Feb 2028 + 12 = 28 Feb 2029).
create function app_private.prepaid_end(p_start timestamptz, p_months integer) returns timestamptz
language sql stable set search_path = ''
as $$ select ((p_start at time zone 'Europe/Paris') + make_interval(months => p_months)) at time zone 'Europe/Paris' $$;

-- Prepaid periods that have ended: status 'expired' (data kept, dashboard locked as for any ended offer).
create function public.prepaid_expire(p_merchant uuid) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.subscriptions set status = 'expired'
   where billing_mode = 'prepaid' and status = 'active' and current_period_end <= now()
     and (p_merchant is null or merchant_id = p_merchant);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- New prepaid attempt. Eligibility is checked here, under a lock on the shop's subscription row:
-- new subscriptions only (no conversion of a running offer), no payment issue to settle first,
-- no other attempt in progress (the caller expires abandoned Stripe sessions before calling).
create function public.prepaid_begin(p_merchant uuid, p_user uuid, p_months integer, p_monthly integer, p_setup integer)
returns public.prepaid_purchases
language plpgsql set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v     public.prepaid_purchases;
begin
  perform public.prepaid_expire(p_merchant);
  select * into v_sub from public.subscriptions where merchant_id = p_merchant for update;
  if found then
    if app_private.merchant_active(p_merchant) then raise exception 'already_subscribed' using errcode = 'P0001'; end if;
    if v_sub.stripe_subscription_id is not null and v_sub.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused') then
      raise exception 'payment_issue' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.prepaid_purchases where merchant_id = p_merchant and status in ('pending', 'processing')) then
    raise exception 'checkout_in_progress' using errcode = 'P0001';
  end if;
  insert into public.prepaid_purchases (merchant_id, created_by, months, monthly_cents, base_cents, setup_cents, total_cents)
  values (p_merchant, p_user, p_months, p_monthly, p_monthly * p_months, p_setup, p_monthly * p_months + p_setup)
  returning * into v;
  return v;
end;
$$;

create function public.prepaid_attach_session(p_id uuid, p_session text, p_customer text) returns void
language sql set search_path = ''
as $$
  update public.prepaid_purchases set stripe_checkout_session_id = p_session, stripe_customer_id = p_customer
   where id = p_id and status = 'pending' and stripe_checkout_session_id is null;
$$;

-- Attempt states before payment: 'processing' (deferred method), 'failed', 'canceled' (abandoned or
-- expired). A paid or refunded purchase is never moved back by these.
create function public.prepaid_mark(p_id uuid, p_status text) returns public.prepaid_purchases
language plpgsql set search_path = ''
as $$
declare v public.prepaid_purchases;
begin
  if p_status not in ('processing', 'failed', 'canceled') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.prepaid_purchases set status = p_status,
         failed_at = case when p_status = 'failed' then coalesce(failed_at, now()) else failed_at end,
         canceled_at = case when p_status = 'canceled' then coalesce(canceled_at, now()) else canceled_at end
   where id = p_id and status in ('pending', 'processing')
  returning * into v;
  if v.id is null then select * into v from public.prepaid_purchases where id = p_id; end if;
  return v;
end;
$$;

-- Payment confirmed by Stripe (checked by the caller: session paid, amount, currency). Idempotent:
-- a purchase already paid (or refunded since) is returned unchanged, so a replayed webhook or a
-- reload of the success page never opens a second period. The period starts at the payment.
create function public.prepaid_confirm(p_id uuid, p_session text, p_amount integer, p_currency text,
                                       p_payment_intent text, p_invoice text, p_customer text, p_paid_at timestamptz)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v       public.prepaid_purchases;
  v_sub   public.subscriptions;
  v_paid  timestamptz := coalesce(p_paid_at, now());
  v_other boolean;
begin
  select * into v from public.prepaid_purchases where id = p_id for update;
  if not found then raise exception 'purchase_not_found' using errcode = 'P0001'; end if;
  if v.stripe_checkout_session_id is distinct from p_session then raise exception 'session_mismatch' using errcode = 'P0001'; end if;
  if v.status in ('paid', 'refunded', 'partially_refunded') then
    return jsonb_build_object('purchase', to_jsonb(v), 'subscription', (select to_jsonb(s) from public.subscriptions s where s.merchant_id = v.merchant_id));
  end if;
  if p_amount is distinct from v.total_cents or lower(p_currency) is distinct from v.currency then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  select * into v_sub from public.subscriptions where merchant_id = v.merchant_id for update;
  perform public.prepaid_expire(v.merchant_id);
  -- Paid although the shop already has a valid offer (e.g. two tabs): the money is recorded, no
  -- second access is opened, and the purchase is flagged for a manual refund.
  v_other := app_private.merchant_active(v.merchant_id)
             or (v_sub.stripe_subscription_id is not null and v_sub.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused'));

  update public.prepaid_purchases set
    status = case when refunded_cents >= total_cents then 'refunded' when refunded_cents > 0 then 'partially_refunded' else 'paid' end,
    paid_at = v_paid, stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
    stripe_invoice_id = coalesce(p_invoice, stripe_invoice_id), stripe_customer_id = coalesce(p_customer, stripe_customer_id),
    conflict = v_other,
    access_start = case when v_other or refunded_cents >= total_cents then null else v_paid end,
    access_end = case when v_other or refunded_cents >= total_cents then null else app_private.prepaid_end(v_paid, months) end
  where id = p_id
  returning * into v;

  if v.access_start is not null then
    insert into public.subscriptions as s (merchant_id, stripe_customer_id, stripe_checkout_session_id, plan_type, billing_mode, prepaid_purchase_id,
      status, monthly_amount_cents, setup_amount_cents, setup_paid_at, stripe_setup_payment_intent_id, commitment_months,
      current_period_start, current_period_end, commitment_start, commitment_end)
    values (v.merchant_id, v.stripe_customer_id, v.stripe_checkout_session_id, 'commitment', 'prepaid', v.id,
      'active', v.monthly_cents, v.setup_cents, v.paid_at, v.stripe_payment_intent_id, 12,
      v.access_start, v.access_end, v.access_start, v.access_end)
    on conflict (merchant_id) do update set
      stripe_customer_id = excluded.stripe_customer_id, stripe_checkout_session_id = excluded.stripe_checkout_session_id,
      stripe_subscription_id = null, stripe_price_id = null, stripe_setup_price_id = null,
      plan_type = 'commitment', billing_mode = 'prepaid', prepaid_purchase_id = excluded.prepaid_purchase_id, status = 'active',
      monthly_amount_cents = excluded.monthly_amount_cents, setup_amount_cents = excluded.setup_amount_cents,
      setup_paid_at = excluded.setup_paid_at, stripe_setup_payment_intent_id = excluded.stripe_setup_payment_intent_id,
      commitment_months = 12, trial_start = null, trial_end = null, billing_cycle_anchor = null,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      commitment_start = excluded.commitment_start, commitment_end = excluded.commitment_end,
      cancel_at_period_end = false, cancel_at = null, canceled_at = null, cancel_requested_at = null, latest_invoice_status = 'paid';
  end if;
  return jsonb_build_object('purchase', to_jsonb(v), 'subscription', (select to_jsonb(s) from public.subscriptions s where s.merchant_id = v.merchant_id));
end;
$$;

-- Access of a purchase ends now (full refund, lost dispute): the shop goes back to "no valid offer".
create function app_private.prepaid_revoke(p_id uuid) returns void
language sql set search_path = ''
as $$
  update public.prepaid_purchases set access_revoked_at = coalesce(access_revoked_at, now()) where id = p_id and access_start is not null;
  update public.subscriptions set status = 'canceled', canceled_at = coalesce(canceled_at, now())
   where prepaid_purchase_id = p_id and billing_mode = 'prepaid' and status = 'active';
$$;

-- Refund (cumulative amount from Stripe's charge, so replays and partial refunds are safe).
-- Full refund: access ends. Partial refund: recorded, access kept (a commercial gesture).
create function public.prepaid_refund(p_payment_intent text, p_refunded integer) returns uuid
language plpgsql set search_path = ''
as $$
declare v public.prepaid_purchases;
begin
  if coalesce(p_payment_intent, '') = '' or coalesce(p_refunded, 0) <= 0 then return null; end if;
  update public.prepaid_purchases p set
    refunded_cents = least(p.total_cents, greatest(p.refunded_cents, p_refunded)),
    refunded_at = coalesce(p.refunded_at, now()),
    status = case when p.status in ('paid', 'partially_refunded', 'refunded')
                  then case when least(p.total_cents, greatest(p.refunded_cents, p_refunded)) >= p.total_cents then 'refunded' else 'partially_refunded' end
                  else p.status end
   where p.stripe_payment_intent_id = p_payment_intent
  returning * into v;
  if v.id is null then return null; end if;
  if v.status = 'refunded' then perform app_private.prepaid_revoke(v.id); end if;
  return v.id;
end;
$$;

-- Dispute (chargeback): recorded while open (access kept, as for monthly payments); lost = access ends.
create function public.prepaid_dispute(p_payment_intent text, p_status text) returns uuid
language plpgsql set search_path = ''
as $$
declare v public.prepaid_purchases;
begin
  if p_status not in ('open', 'won', 'lost') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.prepaid_purchases set dispute_status = p_status, disputed_at = coalesce(disputed_at, now())
   where stripe_payment_intent_id = p_payment_intent and (dispute_status is null or dispute_status = 'open')
  returning * into v;
  if v.id is not null and p_status = 'lost' then perform app_private.prepaid_revoke(v.id); end if;
  return v.id;
end;
$$;

revoke all on function app_private.prepaid_end(timestamptz, integer), app_private.prepaid_revoke(uuid) from public, anon, authenticated;
grant execute on function app_private.prepaid_end(timestamptz, integer), app_private.prepaid_revoke(uuid) to service_role;
revoke all on function public.prepaid_expire(uuid), public.prepaid_begin(uuid, uuid, integer, integer, integer),
  public.prepaid_attach_session(uuid, text, text), public.prepaid_mark(uuid, text),
  public.prepaid_confirm(uuid, text, integer, text, text, text, text, timestamptz),
  public.prepaid_refund(text, integer), public.prepaid_dispute(text, text) from public, anon, authenticated;
grant execute on function public.prepaid_expire(uuid), public.prepaid_begin(uuid, uuid, integer, integer, integer),
  public.prepaid_attach_session(uuid, text, text), public.prepaid_mark(uuid, text),
  public.prepaid_confirm(uuid, text, integer, text, text, text, text, timestamptz),
  public.prepaid_refund(text, integer), public.prepaid_dispute(text, text) to service_role;

select cron.schedule('prepaid-expire', '*/15 * * * *', $$select public.prepaid_expire(null)$$);

-- ---------------------------------------------------------------- sales ledger: kind 'prepaid'

alter table public.sales_payments drop constraint sales_payments_kind_check;
alter table public.sales_payments add constraint sales_payments_kind_check
  check (kind in ('setup', 'subscription', 'prepaid', 'design', 'other'));
-- sales_reconcile_payment maps only 'setup' and 'subscription' to a commission kind: a 'prepaid'
-- payment never gets a commission computed ("règle de commission à définir").

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
      'recurring', exists (select 1 from public.commission_rules r where r.kind = 'recurring' and r.disabled_at is null),
      'prepaid', false),
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
      'revenue_initial_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'setup' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'revenue_monthly_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'subscription' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
      'revenue_prepaid_cents', (select coalesce(sum(x.amount_cents - x.refunded_cents), 0) from pay x where x.sales_rep_id = r.id and x.kind = 'prepaid' and x.paid_at is not null and app_private.sales_in(x.paid_at, p_from, p_to)),
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
      'setup_paid_at', (select min(x.paid_at) from public.sales_payments x where x.merchant_id = m.id and x.kind in ('setup', 'prepaid')),
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
      'paid_at', x.paid_at, 'failed_at', x.failed_at, 'refunded_at', x.refunded_at, 'plan_type', x.plan_type,
      'period_start', x.period_start, 'period_end', x.period_end,
      'prepaid', (select jsonb_build_object('months', pp.months, 'monthly_cents', pp.monthly_cents, 'setup_cents', pp.setup_cents,
                    'base_cents', pp.base_cents, 'dispute_status', pp.dispute_status, 'conflict', pp.conflict)
                  from public.prepaid_purchases pp where x.kind = 'prepaid' and pp.stripe_invoice_id = x.provider_payment_id)
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

create or replace function public.sales_merchant(p_merchant uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'details', l.details) order by l.at desc)
                from public.sales_audit l where l.merchant_id = p_merchant), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('ref', x.provider_payment_id, 'provider', x.provider, 'kind', x.kind, 'status', x.status,
                'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'paid_at', x.paid_at, 'failed_at', x.failed_at,
                'period_start', x.period_start, 'period_end', x.period_end) order by x.created_at desc)
                from public.sales_payments x where x.merchant_id = p_merchant), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'period', c.period, 'amount_cents', c.amount_cents,
                'status', c.status, 'sales_rep_id', c.sales_rep_id, 'reverses_id', c.reverses_id, 'paid_at', c.paid_at) order by c.created_at desc)
                from public.commissions c where c.merchant_id = p_merchant), '[]'::jsonb)
  )
$$;
