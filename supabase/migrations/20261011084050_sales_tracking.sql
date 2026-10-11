-- DPA Cards — sales reps, attribution, payments ledger and commissions.
--
-- Roles: admin_users.role = 'admin' (existing dashboard features) or 'director' (also sales
-- tracking, commission rules, manual attribution, payouts). The wallet Edge Function checks the
-- role on every call, and every director function below checks it again from the actor e-mail
-- the function passes (taken from the verified session, never from the browser).
--
-- Three different people, never mixed:
--   sales rep   (sales_reps)            the DPA Cards seller who brought the shop
--   merchant    (merchants.created_by)  the shop owner, who owns the account and the card
--   customers   (customers / cards)     the shop's loyalty card holders
--
-- Money: sales_payments records what a payment provider actually collected (Stripe invoices
-- today; the provider column leaves room for in-app or other payment methods). One row per
-- provider payment: (provider, provider_payment_id) is unique, so a webhook received twice
-- updates the same row. Commissions are derived from those rows only, never from a
-- subscription status, and only once the director has defined a rule.
--
-- Everything is service_role only (RLS on, no policy, no grant to anon/authenticated).

-- ---------------------------------------------------------------- roles and reps

alter table public.admin_users
  add column role text not null default 'admin' check (role in ('admin', 'director'));
update public.admin_users set role = 'director' where email = 'contact@digitalprojectagency.fr';
-- Zak: same access as Maël (role admin).
insert into public.admin_users (email, role) values ('zakariabouras2020@gmail.com', 'admin') on conflict (email) do nothing;

create table public.sales_reps (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email = lower(btrim(email)) and email like '%@%'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
insert into public.sales_reps (email, display_name) values
  ('kilyan.brs814@gmail.com', 'Kilyan'),
  ('zakariabouras2020@gmail.com', 'Zak'),
  ('mael.81400@icloud.com', 'Maël');

-- ---------------------------------------------------------------- attribution

create table public.merchant_attributions (
  merchant_id    uuid primary key references public.merchants (id) on delete cascade,
  sales_rep_id   uuid not null references public.sales_reps (id),
  source         text not null check (source in ('admin_creation', 'manual')),
  attributed_by  text not null,
  attributed_at  timestamptz not null default now()
);
create index merchant_attributions_rep_idx on public.merchant_attributions (sales_rep_id);

-- Important actions (attribution, rules, validations, payouts). Append-only.
create table public.sales_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  merchant_id uuid references public.merchants (id) on delete set null,
  details     jsonb not null default '{}'::jsonb
);
create index sales_audit_merchant_idx on public.sales_audit (merchant_id);

-- ---------------------------------------------------------------- payments ledger

create table public.sales_payments (
  id                       uuid primary key default gen_random_uuid(),
  provider                 text not null check (provider ~ '^[a-z_]{2,30}$'),
  provider_payment_id      text not null check (char_length(provider_payment_id) between 1 and 200),
  merchant_id              uuid references public.merchants (id) on delete set null,
  merchant_name            text not null,
  kind                     text not null check (kind in ('setup', 'subscription', 'design', 'other')),
  status                   text not null check (status in ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  amount_cents             integer not null check (amount_cents >= 0),
  refunded_cents           integer not null default 0 check (refunded_cents >= 0),
  currency                 text not null default 'eur',
  plan_type                text check (plan_type in ('no_commitment', 'commitment')),
  provider_subscription_id text,
  provider_charge_ref      text,
  period_start             timestamptz,
  period_end               timestamptz,
  paid_at                  timestamptz,
  failed_at                timestamptz,
  refunded_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (provider, provider_payment_id),
  constraint sales_payments_refund_le_amount check (refunded_cents <= amount_cents)
);
create index sales_payments_merchant_idx on public.sales_payments (merchant_id);
create index sales_payments_charge_idx on public.sales_payments (provider, provider_charge_ref);
create trigger sales_payments_touch before update on public.sales_payments
  for each row execute function app_private.touch_updated_at();

-- Provider events already received (information and replay check; processing itself is idempotent).
create table public.sales_provider_events (
  provider    text not null,
  event_id    text not null,
  type        text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------- commission rules, commissions, payouts

-- A rule is never edited: the director disables it and creates a new one, so every commission
-- keeps the exact rule it was computed with. No rule = nothing computed, nothing payable.
create table public.commission_rules (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('initial', 'recurring')),
  calc            text not null check (calc in ('fixed', 'percent')),
  amount_cents    integer check (amount_cents between 0 and 10000000),
  percent         numeric(5, 2) check (percent > 0 and percent <= 100),
  sales_rep_id    uuid references public.sales_reps (id),
  plan_type       text check (plan_type in ('no_commitment', 'commitment')),
  duration_months integer check (duration_months between 1 and 120),
  valid_from      date not null,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_by     text,
  constraint commission_rules_shape check (
    (calc = 'fixed' and amount_cents is not null and amount_cents > 0 and percent is null)
    or (calc = 'percent' and percent is not null and amount_cents is null)),
  constraint commission_rules_duration check (kind = 'recurring' or duration_months is null)
);

create table public.commission_payouts (
  id              uuid primary key default gen_random_uuid(),
  sales_rep_id    uuid not null references public.sales_reps (id),
  period          date not null check (extract(day from period) = 1),
  amount_cents    integer not null,
  commission_count integer not null check (commission_count > 0),
  paid_on         date not null,
  reference       text not null default '' check (char_length(reference) <= 120),
  note            text not null default '' check (char_length(note) <= 500),
  idempotency_key uuid not null unique,
  created_by      text not null,
  created_at      timestamptz not null default now()
);

create table public.commissions (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.sales_payments (id),
  merchant_id    uuid references public.merchants (id) on delete set null,
  merchant_name  text not null,
  sales_rep_id   uuid not null references public.sales_reps (id),
  kind           text not null check (kind in ('initial', 'recurring')),
  period         date not null check (extract(day from period) = 1),
  base_cents     integer not null,
  amount_cents   integer not null,
  rule_id        uuid references public.commission_rules (id),
  rule_snapshot  jsonb not null,
  status         text not null default 'to_validate' check (status in ('to_validate', 'to_pay', 'paid', 'cancelled')),
  reverses_id    uuid references public.commissions (id),
  note           text not null default '',
  payout_id      uuid references public.commission_payouts (id),
  paid_at        date,
  validated_at   timestamptz,
  validated_by   text,
  cancelled_at   timestamptz,
  cancelled_by   text,
  cancel_kind    text check (cancel_kind in ('refund', 'reattribution', 'manual')),
  cancel_reason  text check (char_length(cancel_reason) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint commissions_paid_shape check ((status = 'paid') = (payout_id is not null and paid_at is not null))
);
-- One live commission per payment and kind; one live initial commission per merchant;
-- at most one open adjustment per paid commission.
create unique index commissions_one_live on public.commissions (payment_id, kind) where reverses_id is null and status <> 'cancelled';
create unique index commissions_one_initial on public.commissions (merchant_id) where kind = 'initial' and reverses_id is null and status <> 'cancelled';
create unique index commissions_one_open_adjustment on public.commissions (reverses_id) where reverses_id is not null and status in ('to_validate', 'to_pay');
create index commissions_rep_period_idx on public.commissions (sales_rep_id, period);
create index commissions_payout_idx on public.commissions (payout_id);
create index commissions_merchant_idx on public.commissions (merchant_id);
create trigger commissions_touch before update on public.commissions
  for each row execute function app_private.touch_updated_at();

-- Paid commissions are accounting records: amount, rep and payout can no longer change.
create function app_private.commissions_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'paid' and (new.status <> 'paid' or new.amount_cents <> old.amount_cents or new.sales_rep_id <> old.sales_rep_id
                              or new.payout_id is distinct from old.payout_id) then
    raise exception 'commission_paid_locked' using errcode = '23514';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'commission_cancelled_locked' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger commissions_guard before update on public.commissions
  for each row execute function app_private.commissions_guard();

alter table public.sales_reps enable row level security;
alter table public.merchant_attributions enable row level security;
alter table public.sales_audit enable row level security;
alter table public.sales_payments enable row level security;
alter table public.sales_provider_events enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commission_payouts enable row level security;
alter table public.commissions enable row level security;
revoke all on public.sales_reps, public.merchant_attributions, public.sales_audit, public.sales_payments, public.sales_provider_events,
  public.commission_rules, public.commission_payouts, public.commissions from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

-- Month (1st day) of an instant, in Paris time.
create function app_private.sales_month(p_at timestamptz) returns date
language sql stable set search_path = ''
as $$ select (date_trunc('month', p_at at time zone 'Europe/Paris'))::date $$;

-- p_at within the months [p_from, p_to] (Paris time); null bounds are open.
create function app_private.sales_in(p_at timestamptz, p_from date, p_to date) returns boolean
language sql stable set search_path = ''
as $$
  select p_at is not null
     and (p_from is null or p_at >= (p_from::timestamp at time zone 'Europe/Paris'))
     and (p_to is null or p_at < ((p_to + interval '1 month')::timestamp at time zone 'Europe/Paris'))
$$;

create function app_private.sales_is_director(p_email text) returns boolean
language sql stable set search_path = ''
as $$ select exists (select 1 from public.admin_users a where a.email = lower(btrim(coalesce(p_email, ''))) and a.role = 'director') $$;

create function app_private.sales_require_director(p_email text) returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not app_private.sales_is_director(p_email) then raise exception 'not_director' using errcode = '42501'; end if;
end;
$$;

-- Most specific rule in force for that payment: rep + offer > rep > offer > everyone.
create function app_private.sales_pick_rule(p_rep uuid, p_plan text, p_kind text, p_at timestamptz) returns public.commission_rules
language sql stable set search_path = ''
as $$
  select r.* from public.commission_rules r
  where r.kind = p_kind
    and (r.sales_rep_id is null or r.sales_rep_id = p_rep)
    and (r.plan_type is null or r.plan_type = p_plan)
    and r.valid_from <= (p_at at time zone 'Europe/Paris')::date
    and (r.disabled_at is null or r.disabled_at > p_at)
  order by (r.sales_rep_id is not null) desc, (r.plan_type is not null) desc, r.valid_from desc, r.created_at desc
  limit 1
$$;

create function app_private.sales_amount(p_rule jsonb, p_base integer) returns integer
language sql immutable set search_path = ''
as $$
  select case when p_base <= 0 then 0
              when p_rule ->> 'calc' = 'fixed' then (p_rule ->> 'amount_cents')::integer
              else round(p_base * (p_rule ->> 'percent')::numeric / 100)::integer end
$$;

-- Brings the commissions of one payment in line with what was actually collected. Deterministic
-- and idempotent: running it twice, or for a webhook received twice, changes nothing.
--   no live commission yet → created (to_validate) when the payment is collected, the shop has a
--     rep and a rule is in force; a commission the director cancelled is never recreated
--   unpaid commission      → amount follows the net amount; cancelled when fully refunded
--   paid commission        → never changed; the difference becomes one adjustment (negative after a refund)
create function app_private.sales_reconcile_payment(p_payment uuid) returns void
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
               and c.status = 'cancelled' and c.cancel_kind = 'manual' and c.sales_rep_id = v_rep) then return; end if;
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

create function app_private.sales_reconcile_merchant(p_merchant uuid) returns void
language plpgsql set search_path = ''
as $$
declare p record;
begin
  for p in select id from public.sales_payments where merchant_id = p_merchant order by paid_at nulls last, created_at loop
    perform app_private.sales_reconcile_payment(p.id);
  end loop;
end;
$$;

create function app_private.sales_reconcile_all() returns void
language plpgsql set search_path = ''
as $$
declare p record;
begin
  for p in select id from public.sales_payments order by paid_at nulls last, created_at loop
    perform app_private.sales_reconcile_payment(p.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- provider → ledger (billing Edge Function)

-- One provider payment (a Stripe invoice). Idempotent; a status never goes back
-- (paid is never overwritten by a late "failed", a refund is never undone by a replayed "paid").
create function public.sales_record_payment(p jsonb) returns public.sales_payments
language plpgsql set search_path = ''
as $$
declare
  v_row      public.sales_payments;
  v_merchant uuid := nullif(p ->> 'merchant_id', '')::uuid;
  v_name     text;
  v_status   text := p ->> 'status';
begin
  if v_status not in ('pending', 'paid', 'failed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  select m.business_name into v_name from public.merchants m where m.id = v_merchant;
  if v_name is null then return null; end if;   -- unknown shop: nothing to attribute
  insert into public.sales_payments as s (provider, provider_payment_id, merchant_id, merchant_name, kind, status, amount_cents, currency,
    plan_type, provider_subscription_id, provider_charge_ref, period_start, period_end, paid_at, failed_at)
  values (p ->> 'provider', p ->> 'provider_payment_id', v_merchant, v_name, p ->> 'kind', v_status, (p ->> 'amount_cents')::integer,
    coalesce(nullif(p ->> 'currency', ''), 'eur'), nullif(p ->> 'plan_type', ''), nullif(p ->> 'provider_subscription_id', ''),
    nullif(p ->> 'provider_charge_ref', ''), (p ->> 'period_start')::timestamptz, (p ->> 'period_end')::timestamptz,
    case when v_status = 'paid' then coalesce((p ->> 'paid_at')::timestamptz, now()) end,
    case when v_status = 'failed' then coalesce((p ->> 'failed_at')::timestamptz, now()) end)
  on conflict (provider, provider_payment_id) do update set
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
  perform app_private.sales_reconcile_payment(v_row.id);
  return v_row;
end;
$$;

-- Refund of a collected payment, by the provider's charge reference (Stripe payment intent).
-- p_refunded is the cumulative refunded amount, so replays and partial refunds are safe.
create function public.sales_record_refund(p_provider text, p_charge_ref text, p_refunded integer) returns uuid
language plpgsql set search_path = ''
as $$
declare v_id uuid;
begin
  if coalesce(p_refunded, 0) <= 0 or coalesce(p_charge_ref, '') = '' then return null; end if;
  update public.sales_payments s
     set refunded_cents = least(s.amount_cents, greatest(s.refunded_cents, p_refunded)),
         status = case when least(s.amount_cents, greatest(s.refunded_cents, p_refunded)) >= s.amount_cents then 'refunded' else 'partially_refunded' end,
         refunded_at = coalesce(s.refunded_at, now())
   where s.provider = p_provider and s.provider_charge_ref = p_charge_ref and s.status in ('paid', 'partially_refunded', 'refunded')
  returning s.id into v_id;
  if v_id is not null then perform app_private.sales_reconcile_payment(v_id); end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- attribution (wallet Edge Function)

-- p_source 'admin_creation': the shop was just created by p_actor (the verified admin session);
--   attributed to that admin's rep profile, only if the shop has no rep yet.
-- p_source 'manual': director only; p_rep null removes the attribution. Unpaid commissions of the
--   previous rep are cancelled and recomputed for the new one; paid ones stay where they were paid.
create function public.sales_attribute(p_merchant uuid, p_rep uuid, p_actor text, p_source text, p_reason text)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_actor text := lower(btrim(coalesce(p_actor, '')));
  v_old   public.merchant_attributions;
  v_rep   uuid;
begin
  if not exists (select 1 from public.merchants m where m.id = p_merchant) then raise exception 'merchant_not_found' using errcode = 'P0002'; end if;
  select * into v_old from public.merchant_attributions a where a.merchant_id = p_merchant for update;

  if p_source = 'admin_creation' then
    if v_old.merchant_id is not null then return jsonb_build_object('attributed', false, 'reason', 'already_attributed'); end if;
    select r.id into v_rep from public.sales_reps r where r.email = v_actor and r.active;
    if v_rep is null then return jsonb_build_object('attributed', false, 'reason', 'not_a_sales_rep'); end if;
    insert into public.merchant_attributions (merchant_id, sales_rep_id, source, attributed_by) values (p_merchant, v_rep, 'admin_creation', v_actor);
    insert into public.sales_audit (actor, action, merchant_id, details)
    values (v_actor, 'attribution_auto', p_merchant, jsonb_build_object('sales_rep_id', v_rep));
    perform app_private.sales_reconcile_merchant(p_merchant);
    return jsonb_build_object('attributed', true, 'sales_rep_id', v_rep);
  elsif p_source <> 'manual' then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  perform app_private.sales_require_director(v_actor);
  if p_rep is not null and not exists (select 1 from public.sales_reps r where r.id = p_rep) then raise exception 'rep_not_found' using errcode = 'P0002'; end if;
  if v_old.sales_rep_id is not distinct from p_rep then return jsonb_build_object('attributed', p_rep is not null, 'unchanged', true); end if;

  update public.commissions c set status = 'cancelled', cancel_kind = 'reattribution', cancelled_at = now(), cancelled_by = v_actor,
         cancel_reason = 'Commerce réattribué'
   where c.merchant_id = p_merchant and c.reverses_id is null and c.status in ('to_validate', 'to_pay');
  if p_rep is null then
    delete from public.merchant_attributions where merchant_id = p_merchant;
  else
    insert into public.merchant_attributions (merchant_id, sales_rep_id, source, attributed_by, attributed_at)
    values (p_merchant, p_rep, 'manual', v_actor, now())
    on conflict (merchant_id) do update set sales_rep_id = excluded.sales_rep_id, source = 'manual', attributed_by = excluded.attributed_by, attributed_at = now();
  end if;
  insert into public.sales_audit (actor, action, merchant_id, details)
  values (v_actor, 'attribution_manual', p_merchant, jsonb_build_object('from', v_old.sales_rep_id, 'to', p_rep, 'reason', left(coalesce(p_reason, ''), 300)));
  perform app_private.sales_reconcile_merchant(p_merchant);
  return jsonb_build_object('attributed', p_rep is not null, 'sales_rep_id', p_rep);
end;
$$;

-- ---------------------------------------------------------------- director actions

create function public.sales_rule_create(p_actor text, p_rule jsonb) returns public.commission_rules
language plpgsql set search_path = ''
as $$
declare v public.commission_rules;
begin
  perform app_private.sales_require_director(p_actor);
  insert into public.commission_rules (kind, calc, amount_cents, percent, sales_rep_id, plan_type, duration_months, valid_from, created_by)
  values (p_rule ->> 'kind', p_rule ->> 'calc', (p_rule ->> 'amount_cents')::integer, (p_rule ->> 'percent')::numeric,
          nullif(p_rule ->> 'sales_rep_id', '')::uuid, nullif(p_rule ->> 'plan_type', ''), (p_rule ->> 'duration_months')::integer,
          coalesce((p_rule ->> 'valid_from')::date, (now() at time zone 'Europe/Paris')::date), lower(btrim(p_actor)))
  returning * into v;
  insert into public.sales_audit (actor, action, details) values (lower(btrim(p_actor)), 'rule_created', to_jsonb(v));
  perform app_private.sales_reconcile_all();
  return v;
end;
$$;

create function public.sales_rule_disable(p_actor text, p_rule uuid) returns public.commission_rules
language plpgsql set search_path = ''
as $$
declare v public.commission_rules;
begin
  perform app_private.sales_require_director(p_actor);
  update public.commission_rules set disabled_at = now(), disabled_by = lower(btrim(p_actor))
   where id = p_rule and disabled_at is null returning * into v;
  if v.id is null then raise exception 'rule_not_found' using errcode = 'P0002'; end if;
  insert into public.sales_audit (actor, action, details) values (lower(btrim(p_actor)), 'rule_disabled', jsonb_build_object('rule_id', p_rule));
  return v;
end;
$$;

-- À valider → à payer.
create function public.sales_validate(p_actor text, p_ids uuid[]) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  perform app_private.sales_require_director(p_actor);
  update public.commissions set status = 'to_pay', validated_at = now(), validated_by = lower(btrim(p_actor))
   where id = any (p_ids) and status = 'to_validate';
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.sales_audit (actor, action, details) values (lower(btrim(p_actor)), 'commissions_validated', jsonb_build_object('ids', to_jsonb(p_ids), 'count', n));
  end if;
  return n;
end;
$$;

create function public.sales_cancel(p_actor text, p_id uuid, p_reason text) returns public.commissions
language plpgsql set search_path = ''
as $$
declare v public.commissions;
begin
  perform app_private.sales_require_director(p_actor);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.commissions set status = 'cancelled', cancel_kind = 'manual', cancelled_at = now(), cancelled_by = lower(btrim(p_actor)),
         cancel_reason = left(btrim(p_reason), 300)
   where id = p_id and status in ('to_validate', 'to_pay') returning * into v;
  if v.id is null then raise exception 'not_cancellable' using errcode = '22023'; end if;
  insert into public.sales_audit (actor, action, merchant_id, details)
  values (lower(btrim(p_actor)), 'commission_cancelled', v.merchant_id, jsonb_build_object('commission_id', p_id, 'amount_cents', v.amount_cents, 'reason', v.cancel_reason));
  return v;
end;
$$;

-- "Marquer comme payé": records a transfer the director already made. Never moves money.
-- The exact list and total the director saw must still be valid (all "à payer", same rep and
-- month, same total), and the idempotency key makes a double click return the same payout.
create function public.sales_payout(p_actor text, p_rep uuid, p_period date, p_ids uuid[], p_expected integer,
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
   where id = any (p_ids) and status = 'to_pay' and sales_rep_id = p_rep and period = p_period;
  if v_count <> array_length(p_ids, 1) or v_count <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'selection_changed' using errcode = '40001'; end if;
  if v_total <> p_expected then raise exception 'total_changed' using errcode = '40001'; end if;
  insert into public.commission_payouts (sales_rep_id, period, amount_cents, commission_count, paid_on, reference, note, idempotency_key, created_by)
  values (p_rep, p_period, v_total, v_count, p_paid_on, left(btrim(coalesce(p_reference, '')), 120), left(btrim(coalesce(p_note, '')), 500), p_key, lower(btrim(p_actor)))
  returning * into v;
  update public.commissions set status = 'paid', payout_id = v.id, paid_at = p_paid_on where id = any (p_ids);
  insert into public.sales_audit (actor, action, details)
  values (lower(btrim(p_actor)), 'payout_recorded', jsonb_build_object('payout_id', v.id, 'sales_rep_id', p_rep, 'period', p_period, 'amount_cents', v_total, 'count', v_count));
  return v;
end;
$$;

-- ---------------------------------------------------------------- read models (wallet Edge Function)

-- Director dashboard for the months [p_from, p_to] (null = all time).
create function public.sales_dashboard(p_from date, p_to date) returns jsonb
language sql stable set search_path = ''
as $$
  with att as (
    select a.*, r.display_name from public.merchant_attributions a join public.sales_reps r on r.id = a.sales_rep_id
  ), pay as (
    select sp.*, a.sales_rep_id from public.sales_payments sp left join public.merchant_attributions a on a.merchant_id = sp.merchant_id
  ), com as (
    select c.* from public.commissions c where (p_from is null or c.period >= p_from) and (p_to is null or c.period <= p_to)
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
    ) order by c.period desc, c.created_at desc) from com c), '[]'::jsonb),
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

-- One shop for the director's merchant sheet: rep, attribution history, payments, commissions.
create function public.sales_merchant(p_merchant uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'details', l.details) order by l.at desc)
                from public.sales_audit l where l.merchant_id = p_merchant), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('ref', x.provider_payment_id, 'provider', x.provider, 'kind', x.kind, 'status', x.status,
                'amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents, 'paid_at', x.paid_at, 'failed_at', x.failed_at) order by x.created_at desc)
                from public.sales_payments x where x.merchant_id = p_merchant), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'period', c.period, 'amount_cents', c.amount_cents,
                'status', c.status, 'sales_rep_id', c.sales_rep_id, 'reverses_id', c.reverses_id, 'paid_at', c.paid_at) order by c.created_at desc)
                from public.commissions c where c.merchant_id = p_merchant), '[]'::jsonb)
  )
$$;

revoke all on function public.sales_record_payment(jsonb), public.sales_record_refund(text, text, integer),
  public.sales_attribute(uuid, uuid, text, text, text), public.sales_rule_create(text, jsonb), public.sales_rule_disable(text, uuid),
  public.sales_validate(text, uuid[]), public.sales_cancel(text, uuid, text),
  public.sales_payout(text, uuid, date, uuid[], integer, date, text, text, uuid),
  public.sales_dashboard(date, date), public.sales_merchant(uuid) from public, anon, authenticated;
grant execute on function public.sales_record_payment(jsonb), public.sales_record_refund(text, text, integer),
  public.sales_attribute(uuid, uuid, text, text, text), public.sales_rule_create(text, jsonb), public.sales_rule_disable(text, uuid),
  public.sales_validate(text, uuid[]), public.sales_cancel(text, uuid, text),
  public.sales_payout(text, uuid, date, uuid[], integer, date, text, text, uuid),
  public.sales_dashboard(date, date), public.sales_merchant(uuid) to service_role;
revoke all on function app_private.sales_month(timestamptz), app_private.sales_in(timestamptz, date, date), app_private.sales_is_director(text),
  app_private.sales_require_director(text), app_private.sales_pick_rule(uuid, text, text, timestamptz), app_private.sales_amount(jsonb, integer),
  app_private.sales_reconcile_payment(uuid), app_private.sales_reconcile_merchant(uuid), app_private.sales_reconcile_all(),
  app_private.commissions_guard() from public, anon, authenticated;
-- The public functions above run as service_role (security invoker) and call these helpers.
grant execute on function app_private.sales_month(timestamptz), app_private.sales_in(timestamptz, date, date), app_private.sales_is_director(text),
  app_private.sales_require_director(text), app_private.sales_pick_rule(uuid, text, text, timestamptz), app_private.sales_amount(jsonb, integer),
  app_private.sales_reconcile_payment(uuid), app_private.sales_reconcile_merchant(uuid), app_private.sales_reconcile_all() to service_role;
