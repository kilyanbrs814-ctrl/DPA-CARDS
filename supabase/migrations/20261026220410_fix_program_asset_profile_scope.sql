-- Storage does not opt into the web-only membership view. Its RLS subqueries
-- therefore see only legacy_primary_merchant(), rejecting an owner's other
-- draft programs. Check the actual membership here without widening that view.
-- This private definer is deliberately bounded by auth.uid(), exact merchant
-- and program folders, owner role for writes, and the existing draft lock.
create or replace function app_private.can_program_asset(p_path text, p_action text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_action in ('select', 'insert', 'delete')
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.merchant_members mm
      where mm.user_id = (select auth.uid())
        and mm.merchant_id::text = split_part(p_path, '/', 1)
        and (
          p_action = 'select'
          or (
            mm.role = 'owner'
            and exists (
              select 1 from public.programs p
              where p.merchant_id = mm.merchant_id
                and p.id::text = split_part(p_path, '/', 2)
                and p.design_status = 'draft'
                and (p_action <> 'delete' or (
                  p_path is distinct from p.logo_path
                  and p_path is distinct from p.hero_path
                ))
            )
          )
        )
    );
$$;

revoke all on function app_private.can_program_asset(text, text) from public, anon;
grant execute on function app_private.can_program_asset(text, text) to authenticated;

alter policy program_assets_select on storage.objects
  using (bucket_id = 'program-assets' and app_private.can_program_asset(name, 'select'));
alter policy program_assets_insert on storage.objects
  with check (bucket_id = 'program-assets' and app_private.can_program_asset(name, 'insert'));
alter policy program_assets_delete on storage.objects
  using (bucket_id = 'program-assets' and app_private.can_program_asset(name, 'delete'));

-- No UPDATE policy: uploads remain unique and validated program images locked.
