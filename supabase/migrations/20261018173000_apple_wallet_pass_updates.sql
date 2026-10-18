-- PassKit update registrations (not APNs delivery). No public access to device tokens.
-- Clients are authenticated by the per-pass authenticationToken at the Edge.
create table public.apple_wallet_pass_devices (
  device_library_hash text primary key check (device_library_hash ~ '^[0-9a-f]{64}$'),
  push_token text not null check (length(push_token) between 16 and 512),
  updated_at timestamptz not null default now()
);
create table public.apple_wallet_pass_registrations (
  card_id uuid not null references public.cards(id) on delete cascade,
  device_library_hash text not null references public.apple_wallet_pass_devices(device_library_hash) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id,device_library_hash)
);
create index apple_wallet_pass_registrations_device_idx on public.apple_wallet_pass_registrations(device_library_hash);
create table public.apple_wallet_pass_updates (
  card_id uuid primary key references public.cards(id) on delete cascade,
  revision bigint not null default 1 check(revision>0),
  changed_at timestamptz not null default now()
);
-- A new revision only when ledger content changes, not on every API read.
create function app_private.bump_apple_wallet_pass_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.apple_wallet_pass_updates(card_id,revision,changed_at)
  values(new.card_id,1,now())
  on conflict(card_id) do update
  set revision=public.apple_wallet_pass_updates.revision+1, changed_at=now();
  return new;
end; $$;
create trigger bump_apple_wallet_on_card_event
after insert on public.card_events for each row
execute function app_private.bump_apple_wallet_pass_revision();
alter table public.apple_wallet_pass_devices enable row level security;
alter table public.apple_wallet_pass_registrations enable row level security;
alter table public.apple_wallet_pass_updates enable row level security;
revoke all on public.apple_wallet_pass_devices,public.apple_wallet_pass_registrations,public.apple_wallet_pass_updates from public,anon,authenticated;
grant all on public.apple_wallet_pass_devices,public.apple_wallet_pass_registrations,public.apple_wallet_pass_updates to service_role;
revoke all on function app_private.bump_apple_wallet_pass_revision() from public,anon,authenticated;
