-- DPA Cards — admin dashboard aggregates.
--
-- Read-only summaries for the admin dashboard. Executable by service_role only:
-- the `wallet` Edge Function calls them after checking that the caller's
-- confirmed e-mail is in admin_users. No table becomes readable by clients.

create function public.admin_overview() returns jsonb
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
      'wallet_passes', (select count(*) from public.wallet_passes)
    ),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'business_name', m.business_name, 'activity', m.activity, 'address', m.address,
        'created_at', m.created_at, 'owner_id', m.created_by, 'owner_name', btrim(m.first_name || ' ' || m.last_name),
        'program', (select jsonb_build_object('name', p.name, 'mode', p.mode, 'goal', p.goal, 'reward', p.reward,
                      'bg', p.bg, 'accent', p.accent, 'logo', p.logo, 'design_status', p.design_status)
                    from public.programs p where p.merchant_id = m.id and p.is_active),
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

create function public.admin_merchant_detail(p_merchant uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'merchant', jsonb_build_object('id', m.id, 'business_name', m.business_name, 'activity', m.activity, 'address', m.address,
      'phone', m.phone, 'slug', m.slug, 'created_at', m.created_at, 'owner_id', m.created_by,
      'owner_name', btrim(m.first_name || ' ' || m.last_name)),
    'program', (select jsonb_build_object('name', p.name, 'mode', p.mode, 'goal', p.goal, 'reward', p.reward,
                  'bg', p.bg, 'accent', p.accent, 'logo', p.logo, 'design_status', p.design_status, 'created_at', p.created_at)
                from public.programs p where p.merchant_id = m.id and p.is_active),
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

revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_merchant_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
grant execute on function public.admin_merchant_detail(uuid) to service_role;
