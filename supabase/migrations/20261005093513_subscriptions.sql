-- DPA Cards — merchant subscriptions (Stripe).
--
-- One row per merchant, mirroring Stripe (source of truth). Written only by the
-- `billing` Edge Function with the service role (checkout, success check and
-- signed webhooks); merchants can read their own row. The dashboard is open
-- while status is 'trialing' or 'active'.

create table public.subscriptions (
  id                             uuid primary key default gen_random_uuid(),
  merchant_id                    uuid not null unique references public.merchants (id) on delete cascade,
  stripe_customer_id             text,
  stripe_checkout_session_id     text,
  stripe_subscription_id         text unique,
  stripe_setup_payment_intent_id text,
  stripe_price_id                text,
  stripe_setup_price_id          text,
  plan_type                      text not null check (plan_type in ('no_commitment', 'commitment')),
  status                         text not null default 'incomplete'
                                 check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  monthly_amount_cents           integer,
  setup_amount_cents             integer,
  currency                       text not null default 'eur',
  setup_paid_at                  timestamptz,
  trial_start                    timestamptz,
  trial_end                      timestamptz,
  current_period_start           timestamptz,
  current_period_end             timestamptz,
  billing_cycle_anchor           timestamptz,
  commitment_months              integer not null default 0 check (commitment_months in (0, 12)),
  commitment_start               timestamptz,
  commitment_end                 timestamptz,
  cancel_at_period_end           boolean not null default false,
  cancel_at                      timestamptz,
  canceled_at                    timestamptz,
  cancel_requested_at            timestamptz,
  latest_invoice_status          text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint subscriptions_commitment_shape check (
    (plan_type = 'commitment') = (commitment_months = 12)
  )
);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function app_private.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;

-- Server-side access rule shared by the Edge Functions.
create function public.merchant_has_access(p_merchant uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (select 1 from public.subscriptions s where s.merchant_id = p_merchant and s.status in ('trialing', 'active'));
$$;
revoke all on function public.merchant_has_access(uuid) from public, anon, authenticated;
grant execute on function public.merchant_has_access(uuid) to service_role;

-- ---------------------------------------------------------------- admin aggregates, now with the subscription

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
      'subscriptions_valid', (select count(*) from public.subscriptions s where s.status in ('trialing', 'active'))
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

create or replace function public.admin_merchant_detail(p_merchant uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'merchant', jsonb_build_object('id', m.id, 'business_name', m.business_name, 'activity', m.activity, 'address', m.address,
      'phone', m.phone, 'slug', m.slug, 'created_at', m.created_at, 'owner_id', m.created_by,
      'owner_name', btrim(m.first_name || ' ' || m.last_name)),
    'program', (select jsonb_build_object('name', p.name, 'mode', p.mode, 'goal', p.goal, 'reward', p.reward,
                  'bg', p.bg, 'accent', p.accent, 'logo', p.logo, 'design_status', p.design_status, 'created_at', p.created_at)
                from public.programs p where p.merchant_id = m.id and p.is_active),
    'subscription', (select jsonb_build_object('plan_type', s.plan_type, 'status', s.status, 'trial_start', s.trial_start, 'trial_end', s.trial_end,
                  'monthly_amount_cents', s.monthly_amount_cents, 'setup_amount_cents', s.setup_amount_cents, 'setup_paid_at', s.setup_paid_at,
                  'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
                  'commitment_start', s.commitment_start, 'commitment_end', s.commitment_end,
                  'cancel_at_period_end', s.cancel_at_period_end, 'latest_invoice_status', s.latest_invoice_status)
                from public.subscriptions s where s.merchant_id = m.id),
    'counts', jsonb_build_object(
      'customers', (select count(*) from public.customers c where c.merchant_id = m.id),
      'cards', (select count(*) from public.cards k where k.merchant_id = m.id),
      'events', (select count(*) from public.card_events e where e.merchant_id = m.id),
      'visits', (select count(*) from public.card_events e where e.merchant_id = m.id and e.type = 'visit'),
      'rewards', (select count(*) from public.card_events e where e.merchant_id = m.id and e.type = 'reward'),
      'wallet_passes', (select count(*) from public.wallet_passes w where w.merchant_id = m.id),
      'notifications_sent', (select count(*) from public.notifications n where n.merchant_id = m.id and n.status in ('sent', 'partial'))
    ),
    'clients', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'card_number', k.card_number,
          'created_at', k.created_at, 'wallet', exists (select 1 from public.wallet_passes w where w.card_id = k.id),
          'balance', coalesce((select e.balance_after from public.card_events e where e.card_id = k.id order by e.seq desc limit 1), 0)) as x
        from public.cards k join public.customers c on c.id = k.customer_id
        where k.merchant_id = m.id
        order by k.created_at desc limit 200
      ) t
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('type', e.type, 'delta', e.delta, 'balance_after', e.balance_after, 'created_at', e.created_at,
          'first_name', c.first_name, 'card_number', k.card_number) as x
        from public.card_events e join public.cards k on k.id = e.card_id join public.customers c on c.id = k.customer_id
        where e.merchant_id = m.id
        order by e.created_at desc limit 30
      ) t
    ), '[]'::jsonb)
  )
  from public.merchants m where m.id = p_merchant;
$$;
