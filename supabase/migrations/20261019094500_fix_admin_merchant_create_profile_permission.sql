-- The admin Edge Function creates a merchant via public.admin_create_merchant
-- running as service_role. That routine calls public.create_merchant,
-- whose implementation invokes app_private.create_profile (SECURITY DEFINER).
-- The private function was executable by authenticated but not service_role,
-- so on-site admin creation returned PostgreSQL 42501 / wallet_unavailable.
-- Grant only to the backend service role; keep anon blocked.
grant execute on function app_private.create_profile(uuid, text, text, text, text, text, jsonb) to service_role;
