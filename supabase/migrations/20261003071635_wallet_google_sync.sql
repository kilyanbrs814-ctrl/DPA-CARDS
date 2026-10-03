-- DPA Cards — Google Wallet passes and their balance sync.
--
-- wallet_classes: one Google loyalty class per DPA program (never shared
-- between merchants). wallet_passes: one Google loyalty object per card, with
-- a durable sync queue. The ledger stays the source of truth: a sync always
-- pushes the latest balance_after read from card_events, never an increment,
-- so retries cannot double count and an old attempt cannot overwrite a newer
-- balance (one lease holder per card, synced_seq only moves forward).
--
-- Clients can read their own rows (status) but never write them: the Edge
-- Function `wallet` writes with the service role after checking the caller.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table public.wallet_classes (
  program_id      uuid primary key,
  merchant_id     uuid not null,
  google_class_id text not null unique,
  created_at      timestamptz not null default now(),
  constraint wallet_classes_program_same_merchant foreign key (program_id, merchant_id)
    references public.programs (id, merchant_id) on delete cascade
);

create table public.wallet_passes (
  card_id          uuid primary key,
  merchant_id      uuid not null,
  google_object_id text not null unique,
  created_at       timestamptz not null default now(),
  synced_seq       integer not null default 0,
  synced_balance   integer,
  synced_at        timestamptz,
  pending          boolean not null default true,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text check (char_length(last_error) <= 300),
  constraint wallet_passes_card_same_merchant foreign key (card_id, merchant_id)
    references public.cards (id, merchant_id) on delete cascade
);
create index wallet_passes_due_idx on public.wallet_passes (next_attempt_at) where pending;
create index wallet_passes_merchant_idx on public.wallet_passes (merchant_id);
create index wallet_classes_merchant_idx on public.wallet_classes (merchant_id);

alter table public.wallet_classes enable row level security;
alter table public.wallet_passes  enable row level security;

create policy wallet_classes_select on public.wallet_classes for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));
create policy wallet_passes_select on public.wallet_passes for select to authenticated
  using (merchant_id in (select mm.merchant_id from public.merchant_members mm where mm.user_id = (select auth.uid())));

revoke all on public.wallet_classes, public.wallet_passes from public, anon, authenticated;
grant select on public.wallet_classes, public.wallet_passes to authenticated;

-- ---------------------------------------------------------------- worker RPC
-- Called by the Edge Function with the service role only.

-- Claim due cards under a lease and return the latest ledger state to push.
create function public.wallet_claim_sync(p_limit integer default 20, p_lease_seconds integer default 60)
returns table (card_id uuid, google_object_id text, lease timestamptz, seq integer, balance integer, mode text)
language plpgsql volatile security invoker set search_path = ''
as $$
#variable_conflict use_column
declare
  v_lease timestamptz := clock_timestamp() + make_interval(secs => p_lease_seconds);
begin
  return query
  with due as (
    select w.card_id from public.wallet_passes w
    where w.pending and w.next_attempt_at <= now()
      and (w.locked_until is null or w.locked_until < now())
    order by w.next_attempt_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), claimed as (
    update public.wallet_passes w
    set locked_until = v_lease, attempts = w.attempts + 1
    from due where w.card_id = due.card_id
    returning w.card_id, w.google_object_id, w.locked_until
  )
  select c.card_id, c.google_object_id, c.locked_until, e.seq, e.balance_after, p.mode
  from claimed c
  join public.cards k on k.id = c.card_id
  join public.programs p on p.id = k.program_id
  join lateral (
    select ce.seq, ce.balance_after from public.card_events ce
    where ce.card_id = c.card_id order by ce.seq desc limit 1
  ) e on true;
end;
$$;

-- Record a successful push. Only the current lease holder may complete, and
-- synced_seq never goes backwards. pending stays true if newer events arrived.
create function public.wallet_complete_sync(p_card uuid, p_lease timestamptz, p_seq integer, p_balance integer)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
begin
  update public.wallet_passes w
  set synced_balance = case when p_seq >= w.synced_seq then p_balance else w.synced_balance end,
      synced_seq     = greatest(w.synced_seq, p_seq),
      synced_at      = now(),
      attempts       = 0,
      last_error     = null,
      locked_until   = null,
      next_attempt_at = now(),
      pending = exists (
        select 1 from public.card_events e
        where e.card_id = p_card and e.seq > greatest(w.synced_seq, p_seq)
      )
  where w.card_id = p_card and w.locked_until = p_lease;
  return found;
end;
$$;

-- Record a failed push: keep it pending, back off exponentially (30 s → 32 min).
create function public.wallet_fail_sync(p_card uuid, p_lease timestamptz, p_error text)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
begin
  update public.wallet_passes w
  set last_error = left(coalesce(p_error, 'erreur inconnue'), 300),
      locked_until = null,
      pending = true,
      next_attempt_at = now() + make_interval(secs => 30 * power(2, least(w.attempts - 1, 6))::integer)
  where w.card_id = p_card and w.locked_until = p_lease;
  return found;
end;
$$;

-- ---------------------------------------------------------------- kick + secret

-- Shared secret between pg_net/pg_cron and the Edge Function, generated here
-- and kept in Vault: nobody ever types or sees it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'wallet_worker_secret',
                           'pg_net -> Edge Function wallet/sync');

-- SECURITY DEFINER is required: Vault and pg_net are not reachable by the
-- roles that insert card events. Fixed search_path, no caller input, EXECUTE
-- revoked from every client role.
create function app_private.wallet_kick() returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'wallet_worker_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://fiuffxchvjcghcvfaout.supabase.co/functions/v1/wallet/sync',
    headers := jsonb_build_object('content-type', 'application/json', 'x-wallet-worker', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- The Edge Function checks the worker header against Vault through this RPC.
-- SECURITY DEFINER for the Vault read; executable by service_role only.
create function public.wallet_check_worker(p_secret text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return p_secret is not null and length(p_secret) = 64 and exists (
    select 1 from vault.decrypted_secrets ds where ds.name = 'wallet_worker_secret' and ds.decrypted_secret = p_secret
  );
end;
$$;

-- After a ledger event is committed in the same transaction, flag the card's
-- pass and ask the worker to run. pg_net only sends after commit, so a rolled
-- back event never triggers a sync. SECURITY DEFINER: clients cannot write
-- wallet_passes; the function only touches the row of the card just written.
create function app_private.wallet_on_card_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.wallet_passes
  set pending = true, next_attempt_at = now()
  where card_id = new.card_id;
  if found then
    perform app_private.wallet_kick();
  end if;
  return null;
end;
$$;

create trigger card_events_wallet_sync after insert on public.card_events
  for each row execute function app_private.wallet_on_card_event();

-- Safety net: retry due passes every minute even if a kick was lost.
create function app_private.wallet_kick_if_due() returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.wallet_passes w
    where w.pending and w.next_attempt_at <= now() and (w.locked_until is null or w.locked_until < now())
  ) then
    perform app_private.wallet_kick();
  end if;
end;
$$;

select cron.schedule('wallet-sync-retry', '* * * * *', $$select app_private.wallet_kick_if_due()$$);

revoke all on function app_private.wallet_kick() from public, anon, authenticated;
revoke all on function app_private.wallet_kick_if_due() from public, anon, authenticated;
revoke all on function app_private.wallet_on_card_event() from public, anon, authenticated;
revoke all on function public.wallet_check_worker(text) from public, anon, authenticated;
revoke all on function public.wallet_claim_sync(integer, integer) from public, anon, authenticated;
revoke all on function public.wallet_complete_sync(uuid, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.wallet_fail_sync(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.wallet_check_worker(text) to service_role;
grant execute on function public.wallet_claim_sync(integer, integer) to service_role;
grant execute on function public.wallet_complete_sync(uuid, timestamptz, integer, integer) to service_role;
grant execute on function public.wallet_fail_sync(uuid, timestamptz, text) to service_role;
