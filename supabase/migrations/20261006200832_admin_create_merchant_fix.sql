-- admin_create_merchant: the local variable no longer shares its name with the id column.
create or replace function public.admin_create_merchant(p_user uuid, p_business text, p_first text, p_last text, p_activity text,
                                             p_slug text, p_program jsonb, p_phone text, p_address text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r    jsonb;
  v_id uuid;
begin
  if p_user is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if exists (select 1 from public.merchant_members mm where mm.user_id = p_user) then
    raise exception 'user_has_merchant' using errcode = '23505';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  r    := public.create_merchant(p_business, p_first, p_last, p_activity, p_slug, p_program);
  v_id := (r -> 'merchant' ->> 'id')::uuid;
  update public.merchants m set phone = coalesce(btrim(p_phone), ''), address = coalesce(btrim(p_address), '') where m.id = v_id;
  insert into public.admin_created_merchants (merchant_id) values (v_id) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('merchant', (select to_jsonb(m) from public.merchants m where m.id = v_id), 'program', r -> 'program');
end;
$$;
revoke all on function public.admin_create_merchant(uuid, text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_merchant(uuid, text, text, text, text, text, jsonb, text, text) to service_role;
