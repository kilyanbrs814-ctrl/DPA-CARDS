-- Count only signed Apple .pkpass responses for real customer cards.
-- Neither issuing a download link nor generating a test pass counts as a customer pass.
-- Apple does not confirm that a pass was added to a device until PassKit registration exists.
create table if not exists public.apple_wallet_downloads (
  card_id uuid primary key references public.cards(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  first_issued_at timestamptz not null default now()
);
create index if not exists apple_wallet_downloads_merchant_idx on public.apple_wallet_downloads (merchant_id);
alter table public.apple_wallet_downloads enable row level security;
revoke all on public.apple_wallet_downloads from anon, authenticated;
grant all on public.apple_wallet_downloads to service_role;

-- Opaque short-lived capabilities for real, standalone admin test cards.
-- They cannot be used for live customers or payments.
create table if not exists public.apple_wallet_test_links (
  test_card_id uuid primary key references public.test_card_designs(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists apple_wallet_test_links_expires_idx on public.apple_wallet_test_links (expires_at);
alter table public.apple_wallet_test_links enable row level security;
revoke all on public.apple_wallet_test_links from anon, authenticated;
grant all on public.apple_wallet_test_links to service_role;

-- Admin Edge Function (service_role only): distinguish Apple-only, Google-only,
-- both-platform and no-Wallet cards without double counting.
create or replace function public.admin_apple_wallet_counts()
returns table (merchant_id uuid, apple_count bigint, both_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select a.merchant_id,
         count(*)::bigint as apple_count,
         count(g.card_id)::bigint as both_count
  from public.apple_wallet_downloads a
  left join public.wallet_passes g on g.card_id = a.card_id
  group by a.merchant_id
$$;
revoke all on function public.admin_apple_wallet_counts() from public, anon, authenticated;
grant execute on function public.admin_apple_wallet_counts() to service_role;
