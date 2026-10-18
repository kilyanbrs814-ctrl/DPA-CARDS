-- Apple Wallet campaigns call public.apple_wallet_queue_notice() via the
-- service-role Supabase client. That function calls this private trigger worker
-- through its invoker privileges; the original migration revoked EXECUTE from
-- service_role, so every real Apple campaign failed with permission denied.
-- Grant exactly this one internal function to service_role (not to browsers).
revoke all on function app_private.apple_wallet_kick() from public, anon, authenticated;
grant execute on function app_private.apple_wallet_kick() to service_role;
