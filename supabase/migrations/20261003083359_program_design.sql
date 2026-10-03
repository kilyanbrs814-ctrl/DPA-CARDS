-- DPA Cards — card design at program creation.
--
-- A new program starts in design_status 'draft'. The merchant either
--   * customises it (names, logo, optional cover, background colour) and the
--     `wallet` Edge Function validates the files and sets 'validated', or
--   * asks DPA Cards for a custom design: a design_requests row is stored and
--     the program moves to 'pending_dpa' (no Wallet class is created).
-- Once out of 'draft', the visual fields can no longer be changed by a
-- merchant, whatever the client: enforced by a trigger. Loyalty rules
-- (mode, goal, reward, conditions) are untouched by this migration.

-- ---------------------------------------------------------------- programs

alter table public.programs
  add column design_mode text check (design_mode in ('custom', 'dpa')),
  add column design_status text not null default 'draft'
    check (design_status in ('draft', 'pending_dpa', 'validated')),
  add column design_validated_at timestamptz,
  add column logo_path text check (char_length(logo_path) <= 300),
  add column hero_path text check (char_length(hero_path) <= 300);

-- Programs created before this flow keep working exactly as today.
update public.programs set design_status = 'validated', design_mode = 'custom', design_validated_at = now();

grant update (logo_path, hero_path, design_mode, design_status) on public.programs to authenticated;

-- Server-side design lock. Applies to client roles only; the Edge Function
-- (service role) performs the validation transition itself.
create function app_private.programs_design_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.design_status <> 'draft' and (
       new.name, new.bg, new.accent, new.pattern, new.logo, new.logo_path, new.hero_path, new.design_mode
     ) is distinct from (
       old.name, old.bg, old.accent, old.pattern, old.logo, old.logo_path, old.hero_path, old.design_mode
     ) then
    raise exception 'design_locked' using errcode = '42501';
  end if;
  if new.design_status is distinct from old.design_status then
    -- The only transition a merchant may make: draft → pending_dpa, with an open request.
    if not (old.design_status = 'draft' and new.design_status = 'pending_dpa' and exists (
      select 1 from public.design_requests r
      where r.program_id = old.id and r.status in ('submitted', 'in_progress')
    )) then
      raise exception 'design_status_forbidden' using errcode = '42501';
    end if;
  end if;
  -- Image paths must live in the merchant's own storage folder.
  if (new.logo_path is not null and new.logo_path not like old.merchant_id::text || '/' || old.id::text || '/%')
     or (new.hero_path is not null and new.hero_path not like old.merchant_id::text || '/' || old.id::text || '/%') then
    raise exception 'invalid_image_path' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- design requests

create table public.design_requests (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references public.merchants (id) on delete cascade,
  program_id      uuid not null,
  request_id      uuid not null,
  status          text not null default 'submitted'
                  check (status in ('submitted', 'in_progress', 'delivered', 'cancelled')),
  logo_path       text check (char_length(logo_path) <= 300),
  reference_paths text[] not null default '{}' check (cardinality(reference_paths) <= 6),
  colors          text check (char_length(colors) <= 200),
  description     text not null check (char_length(btrim(description)) between 10 and 2000),
  contact_name    text not null check (char_length(btrim(contact_name)) between 1 and 120),
  contact_email   text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  contact_phone   text check (char_length(contact_phone) <= 40),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint design_requests_contact check (contact_email is not null or nullif(btrim(contact_phone), '') is not null),
  constraint design_requests_program_same_merchant foreign key (program_id, merchant_id)
    references public.programs (id, merchant_id) on delete cascade,
  constraint design_requests_request_once unique (merchant_id, request_id)
);
-- One open request per program: a retry or double click cannot create a second one.
create unique index design_requests_one_open on public.design_requests (program_id)
  where status in ('submitted', 'in_progress');
create index design_requests_merchant_idx on public.design_requests (merchant_id);
create index design_requests_created_by_idx on public.design_requests (created_by);

create trigger design_requests_touch before update on public.design_requests
  for each row execute function app_private.touch_updated_at();

create trigger programs_design_guard before update on public.programs
  for each row execute function app_private.programs_design_guard();

alter table public.design_requests enable row level security;
create policy design_requests_select on public.design_requests for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy design_requests_insert on public.design_requests for insert to authenticated
  with check (
    merchant_id in (select mm.merchant_id from public.merchant_members mm
                    where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.id = program_id and p.merchant_id = design_requests.merchant_id and p.design_status = 'draft')
  );

revoke all on public.design_requests from public, anon, authenticated;
grant select on public.design_requests to authenticated;
grant insert (merchant_id, program_id, request_id, logo_path, reference_paths, colors, description,
              contact_name, contact_email, contact_phone)
  on public.design_requests to authenticated;
-- status is only changed by DPA Cards (dashboard / service role).

create function public.submit_design_request(
  p_request_id uuid, p_logo_path text, p_reference_paths text[], p_colors text,
  p_description text, p_contact_name text, p_contact_email text, p_contact_phone text
) returns public.design_requests
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_mid    uuid;
  v_prog   public.programs%rowtype;
  v_req    public.design_requests%rowtype;
  v_prefix text;
  v_path   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select mm.merchant_id into v_mid from public.merchant_members mm where mm.user_id = v_uid and mm.role = 'owner';
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'no_program' using errcode = 'P0002';
  end if;

  -- Retry of the same submission, or any request already open: return it.
  select r.* into v_req from public.design_requests r
  where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
  order by (r.request_id = p_request_id) desc limit 1;
  if found then
    return v_req;
  end if;
  if v_prog.design_status <> 'draft' then
    raise exception 'design_locked' using errcode = '42501';
  end if;

  v_prefix := v_mid::text || '/' || p_request_id::text || '/';
  foreach v_path in array coalesce(p_reference_paths, '{}') || coalesce(array[p_logo_path], '{}') loop
    if v_path is not null and v_path not like v_prefix || '%' then
      raise exception 'invalid_file_path' using errcode = '22023';
    end if;
  end loop;

  begin
    insert into public.design_requests (merchant_id, program_id, request_id, logo_path, reference_paths, colors,
                                        description, contact_name, contact_email, contact_phone)
    values (v_mid, v_prog.id, p_request_id, p_logo_path, coalesce(p_reference_paths, '{}'), nullif(btrim(p_colors), ''),
            btrim(p_description), btrim(p_contact_name), nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_contact_phone), ''))
    returning * into v_req;
  exception when unique_violation then
    select r.* into v_req from public.design_requests r
    where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
    limit 1;
    if not found then raise; end if;
    return v_req;
  end;

  update public.programs set design_mode = 'dpa', design_status = 'pending_dpa' where id = v_prog.id;
  return v_req;
end;
$$;

revoke all on function public.submit_design_request(uuid, text, text[], text, text, text, text, text) from public, anon;
grant execute on function public.submit_design_request(uuid, text, text[], text, text, text, text, text) to authenticated;
revoke all on function app_private.programs_design_guard() from public, anon;

-- ---------------------------------------------------------------- storage

-- Card images: public (Google Wallet fetches them over HTTPS), PNG/JPEG only, 2 MB max.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('program-assets', 'program-assets', true, 2097152, array['image/png', 'image/jpeg']);

-- Design request material: private, read by DPA Cards from the dashboard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-requests', 'design-requests', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

-- Paths are <merchant_id>/<program_id or request_id>/<file>. Only owners write in
-- their merchant's folder, only while the design is still a draft, and nobody
-- overwrites a file (no UPDATE policy): a validated card cannot change behind
-- Google's back.
create policy program_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'program-assets'
    and (storage.foldername(name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                          where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(name))[1]
                  and p.id::text = (storage.foldername(name))[2]
                  and p.design_status = 'draft')
  );
create policy program_assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'program-assets'
    and (storage.foldername(name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                          where mm.user_id = (select auth.uid()))
  );
create policy program_assets_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'program-assets'
    and (storage.foldername(name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                          where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(name))[1]
                  and p.id::text = (storage.foldername(name))[2]
                  and p.design_status = 'draft'
                  and name is distinct from p.logo_path and name is distinct from p.hero_path)
  );

create policy design_requests_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'design-requests'
    and (storage.foldername(name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                          where mm.user_id = (select auth.uid()) and mm.role = 'owner')
    and exists (select 1 from public.programs p
                where p.merchant_id::text = (storage.foldername(name))[1] and p.is_active and p.design_status = 'draft')
  );
create policy design_requests_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'design-requests'
    and (storage.foldername(name))[1] in (select mm.merchant_id::text from public.merchant_members mm
                                          where mm.user_id = (select auth.uid()))
  );
