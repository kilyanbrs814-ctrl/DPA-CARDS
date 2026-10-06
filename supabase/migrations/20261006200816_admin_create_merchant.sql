-- Admin "Ajouter un client": a merchant account prepared by DPA Cards (wallet Edge Function,
-- after the admin_users check). Everything below is service_role only.
-- (admin_create_merchant is replaced in 20261006200832_admin_create_merchant_fix.)

-- Same creation as the merchant app: public.create_merchant runs as the new owner (auth.uid() =
-- p_user for this transaction), so merchant, owner membership, program and every rule it applies
-- stay identical. Phone and address are then set like the merchant's own settings page does.
create function public.admin_create_merchant(p_user uuid, p_business text, p_first text, p_last text, p_activity text,
                                             p_slug text, p_program jsonb, p_phone text, p_address text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r  jsonb;
  id uuid;
begin
  if p_user is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if exists (select 1 from public.merchant_members mm where mm.user_id = p_user) then
    raise exception 'user_has_merchant' using errcode = '23505';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  r  := public.create_merchant(p_business, p_first, p_last, p_activity, p_slug, p_program);
  id := (r -> 'merchant' ->> 'id')::uuid;
  update public.merchants set phone = coalesce(btrim(p_phone), ''), address = coalesce(btrim(p_address), '') where merchants.id = id;
  insert into public.admin_created_merchants (merchant_id) values (id) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('merchant', (select to_jsonb(m) from public.merchants m where m.id = id), 'program', r -> 'program');
end;
$$;

-- Duplicate check before creating a login: the Auth user of an e-mail and whether it already owns a shop.
create function public.admin_user_by_email(p_email text)
returns table (user_id uuid, has_merchant boolean, confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, exists (select 1 from public.merchant_members mm where mm.user_id = u.id), u.email_confirmed_at is not null
  from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;

-- Shops prepared by the admin, and when their owner was sent the access link.
create table public.admin_created_merchants (
  merchant_id       uuid primary key references public.merchants(id) on delete cascade,
  created_at        timestamptz not null default now(),
  access_sent_at    timestamptz,
  access_sent_count integer not null default 0,
  access_last_error text check (char_length(access_last_error) <= 300)
);
alter table public.admin_created_merchants enable row level security;
revoke all on public.admin_created_merchants from anon, authenticated;

revoke all on function public.admin_create_merchant(uuid, text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.admin_user_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_create_merchant(uuid, text, text, text, text, text, jsonb, text, text) to service_role;
grant execute on function public.admin_user_by_email(text) to service_role;
