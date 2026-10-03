-- Inside the programs sub-queries, an unqualified `name` resolved to programs.name
-- instead of the storage object's path, so owners could not upload into their own
-- folder. Qualify every reference with objects.name.

drop policy program_assets_insert on storage.objects;
drop policy program_assets_delete on storage.objects;
drop policy design_requests_files_insert on storage.objects;

create policy program_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'program-assets'
    and (storage.foldername(objects.name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                                  where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(objects.name))[1]
                  and p.id::text = (storage.foldername(objects.name))[2]
                  and p.design_status = 'draft')
  );

create policy program_assets_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'program-assets'
    and (storage.foldername(objects.name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                                  where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(objects.name))[1]
                  and p.id::text = (storage.foldername(objects.name))[2]
                  and p.design_status = 'draft'
                  and objects.name is distinct from p.logo_path and objects.name is distinct from p.hero_path)
  );

create policy design_requests_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'design-requests'
    and (storage.foldername(objects.name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                                  where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(objects.name))[1] and p.is_active and p.design_status = 'draft')
  );
