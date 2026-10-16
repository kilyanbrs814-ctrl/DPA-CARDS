-- Public registration appearance is independent of Wallet card designs.
alter table public.programs add column if not exists registration_page jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.programs'::regclass and conname='programs_registration_page_shape') then
    alter table public.programs add constraint programs_registration_page_shape check (jsonb_typeof(registration_page) = 'object' and octet_length(registration_page::text) <= 4096);
  end if;
end $$;
-- Existing owner-scoped SELECT and UPDATE policies apply to this column.

grant update (registration_page) on public.programs to authenticated;
