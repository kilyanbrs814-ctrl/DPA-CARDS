begin;

-- The authenticated role cannot read auth.users or auth.mfa_factors.
-- This private function returns only a decision for the caller's own session.
create function app_private.can_access_customer_data() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  )
  and (
    coalesce((select auth.jwt())->>'aal', '') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  );
$$;
revoke all on function app_private.can_access_customer_data() from public, anon, authenticated;
grant execute on function app_private.can_access_customer_data() to authenticated;

-- Restrictive policies are ANDed with the existing commerce/employee rules.
-- Signed public Wallet flows continue to use their server-side authorization.
create policy customers_verified_session on public.customers
  as restrictive for all to authenticated
  using ((select app_private.can_access_customer_data()))
  with check ((select app_private.can_access_customer_data()));

create policy cards_verified_session on public.cards
  as restrictive for all to authenticated
  using ((select app_private.can_access_customer_data()))
  with check ((select app_private.can_access_customer_data()));

create policy card_events_verified_session on public.card_events
  as restrictive for all to authenticated
  using ((select app_private.can_access_customer_data()))
  with check ((select app_private.can_access_customer_data()));

create policy wallet_passes_verified_session on public.wallet_passes
  as restrictive for all to authenticated
  using ((select app_private.can_access_customer_data()))
  with check ((select app_private.can_access_customer_data()));

commit;
