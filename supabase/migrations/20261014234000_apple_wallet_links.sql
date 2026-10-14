-- Download links for Apple Wallet passes. Links are opaque bearer capabilities.
-- No direct access from browser roles: issuance/lookup is service_role only.
create table if not exists public.apple_wallet_links (
  card_id uuid primary key references public.cards(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists apple_wallet_links_expires_at_idx on public.apple_wallet_links (expires_at);
alter table public.apple_wallet_links enable row level security;
revoke all on public.apple_wallet_links from anon, authenticated;
grant all on public.apple_wallet_links to service_role;
