-- Manual access is a separate entitlement, not a fabricated Stripe subscription.
-- Only a director may grant or revoke it, via the server; billing rows are unchanged.
CREATE TABLE IF NOT EXISTS public.merchant_manual_access (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_access_expiry_required CHECK (NOT enabled OR expires_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.merchant_manual_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_manual_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_manual_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_manual_access,public.merchant_manual_access_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.merchant_manual_access TO service_role;
GRANT SELECT,INSERT ON TABLE public.merchant_manual_access_audit TO service_role;

-- Every existing merchant_has_access/RLS gating continues to use this one function.
-- enabled=false blocks merchant tools without cancelling recurring Stripe payments.
-- enabled=true allows access only until expiry and never changes billing/payment records.
CREATE OR REPLACE FUNCTION app_private.merchant_active(p_merchant uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $$
  SELECT COALESCE(
    (SELECT a.enabled AND (a.expires_at IS NULL OR a.expires_at > now())
       FROM public.merchant_manual_access a WHERE a.merchant_id=p_merchant),
    EXISTS (
      SELECT 1 FROM public.subscriptions s WHERE s.merchant_id=p_merchant
      AND s.status IN ('trialing','active')
      AND (s.billing_mode='monthly' OR (s.current_period_start<=now() AND s.current_period_end>now()))
    )
  );
$$;

-- Kilyan's company address and personal login are both direction, never a shared salesperson account.
UPDATE public.admin_users SET role='director'
 WHERE email IN ('contact@digitalprojectagency.fr','kilyan.brs814@gmail.com');
