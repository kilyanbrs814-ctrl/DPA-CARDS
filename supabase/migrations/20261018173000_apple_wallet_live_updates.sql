-- Apple Wallet PassKit registrations and durable update queue.
-- Secret push tokens are accessible to service_role only. No client SQL grants.
begin;
create sequence public.apple_wallet_revision_seq;
create table public.apple_wallet_devices (
  device_library_id text primary key check(char_length(device_library_id) between 10 and 200),
  push_token text not null check(char_length(push_token) between 16 and 512),
  updated_at timestamptz not null default now()
);
create table public.apple_wallet_registrations (
  device_library_id text not null references public.apple_wallet_devices(device_library_id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key(device_library_id,card_id)
);
create index apple_wallet_registrations_card_idx on public.apple_wallet_registrations(card_id);
create table public.apple_wallet_changes (
  card_id uuid primary key references public.cards(id) on delete cascade,
  revision bigint not null default nextval('public.apple_wallet_revision_seq'),
  changed_at timestamptz not null default now(),
  push_pending boolean not null default false,
  -- Optional message shown by a changing Apple Wallet field. The nonce ensures
  -- a repeated message still causes a changed field value.
  message_text text check(char_length(message_text) <= 200),
  message_nonce uuid not null default gen_random_uuid()
);
create index apple_wallet_changes_due_idx on public.apple_wallet_changes(changed_at) where push_pending;

alter table public.apple_wallet_devices enable row level security;
alter table public.apple_wallet_registrations enable row level security;
alter table public.apple_wallet_changes enable row level security;
revoke all on public.apple_wallet_devices,public.apple_wallet_registrations,public.apple_wallet_changes from public,anon,authenticated;
grant all on public.apple_wallet_devices,public.apple_wallet_registrations,public.apple_wallet_changes to service_role;
grant usage,select on sequence public.apple_wallet_revision_seq to service_role;

create function app_private.apple_wallet_bump(p_card uuid, p_message text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.apple_wallet_changes(card_id,push_pending,message_text)
    values(p_card,true,case when p_message is null then null else left(btrim(p_message),200) end)
  on conflict(card_id) do update
    set revision=nextval('public.apple_wallet_revision_seq'),
        changed_at=now(),push_pending=true,
        message_text=case when p_message is null then public.apple_wallet_changes.message_text
          else left(btrim(p_message),200) end,
        message_nonce=case when p_message is null then public.apple_wallet_changes.message_nonce else gen_random_uuid() end;
end;
$$;
revoke all on function app_private.apple_wallet_bump(uuid,text) from public,anon,authenticated;
grant execute on function app_private.apple_wallet_bump(uuid,text) to service_role;

-- Card ledger is the source of truth. Every visit/redemption/correction
-- advances the Apple version without changing any Wallet signing/design data.
create function app_private.apple_wallet_on_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.apple_wallet_bump(new.card_id,null);
  return new;
end;
$$;
revoke all on function app_private.apple_wallet_on_event() from public,anon,authenticated;
create trigger card_events_apple_wallet_update after insert on public.card_events
  for each row execute function app_private.apple_wallet_on_event();

-- Updating approved program artwork also refreshes the installed passes.
create function app_private.apple_wallet_on_program() returns trigger
language plpgsql security definer set search_path='' as $$
declare c record;
begin
  if old.design_status = 'validated' and new.design_status = 'validated' and
    (old.card_design is distinct from new.card_design
       or old.logo_path is distinct from new.logo_path
       or old.goal is distinct from new.goal
       or old.reward is distinct from new.reward) then
    for c in select id from public.cards where merchant_id=new.merchant_id and program_id=new.id loop
      perform app_private.apple_wallet_bump(c.id,null);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function app_private.apple_wallet_on_program() from public,anon,authenticated;
create trigger programs_apple_wallet_update after update on public.programs
  for each row execute function app_private.apple_wallet_on_program();

-- Existing signed passes (prior to this feature) are not claimed as installed.
-- Once re-added, the PassKit registration endpoint stores a real device token.
commit;