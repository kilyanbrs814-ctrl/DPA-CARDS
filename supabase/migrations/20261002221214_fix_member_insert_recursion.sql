-- merchant_members_insert read merchants, whose SELECT policy reads
-- merchant_members: Postgres rejects that as infinite policy recursion.
-- The creator check moves into a plpgsql function. It still runs as the caller
-- (RLS applies inside it) but is evaluated in its own query, which breaks the
-- policy cycle.

create function app_private.is_creator(p_merchant uuid) returns boolean
language plpgsql stable security invoker set search_path = ''
as $$
begin
  return exists (
    select 1 from public.merchants m
    where m.id = p_merchant and m.created_by = (select auth.uid())
  );
end;
$$;

revoke all on function app_private.is_creator(uuid) from public, anon;
grant execute on function app_private.is_creator(uuid) to authenticated;

drop policy merchant_members_insert on public.merchant_members;
create policy merchant_members_insert on public.merchant_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and app_private.is_creator(merchant_id)
  );
