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
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN a.enabled=false THEN false WHEN a.expires_at>now() THEN true ELSE NULL END
       FROM public.merchant_manual_access a WHERE a.merchant_id=p_merchant),
    EXISTS (
      SELECT 1 FROM public.subscriptions s WHERE s.merchant_id=p_merchant
      AND s.status IN ('trialing','active')
      AND (s.billing_mode='monthly' OR (s.current_period_start<=now() AND s.current_period_end>now()))
    )
  );
$$;

-- Atomic update + audit. Restrict execution to service_role; director identity rechecked in SQL.
CREATE OR REPLACE FUNCTION public.admin_manual_access_change(p_merchant uuid,p_enabled boolean,p_days integer,p_reason text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $
DECLARE row public.merchant_manual_access; expiration timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users u WHERE u.email=lower(btrim(p_actor)) AND u.role='director')
    THEN RAISE EXCEPTION 'not_director'; END IF;
  IF p_merchant IS NULL OR NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant)
    THEN RAISE EXCEPTION 'merchant_not_found'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 300 OR p_enabled IS NULL
    THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF p_enabled AND (p_days IS NULL OR p_days NOT IN (7,30,90,365))
    THEN RAISE EXCEPTION 'invalid_duration'; END IF;
  expiration:=CASE WHEN p_enabled THEN now()+(p_days||' days')::interval ELSE NULL END;
  INSERT INTO public.merchant_manual_access(merchant_id,enabled,expires_at,reason,updated_by,updated_at)
  VALUES(p_merchant,p_enabled,expiration,btrim(p_reason),lower(btrim(p_actor)),now())
  ON CONFLICT (merchant_id) DO UPDATE SET
    enabled=excluded.enabled,expires_at=excluded.expires_at,reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=now()
  RETURNING * INTO row;
  INSERT INTO public.merchant_manual_access_audit(merchant_id,enabled,expires_at,reason,actor)
  VALUES(p_merchant,p_enabled,expiration,btrim(p_reason),lower(btrim(p_actor)));
  RETURN jsonb_build_object('merchant_id',row.merchant_id,'enabled',row.enabled,'expires_at',row.expires_at,
    'reason',row.reason,'updated_by',row.updated_by,'updated_at',row.updated_at);
END;
$;
REVOKE ALL ON FUNCTION public.admin_manual_access_change(uuid,boolean,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_access_change(uuid,boolean,integer,text,text) TO service_role;

-- Kilyan's company address and personal login are both direction, never a shared salesperson account.
UPDATE public.admin_users SET role='director'
 WHERE email IN ('contact@digitalprojectagency.fr','kilyan.brs814@gmail.com');
