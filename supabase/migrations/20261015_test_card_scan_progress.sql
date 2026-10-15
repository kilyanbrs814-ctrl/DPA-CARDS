-- Test passes are intentionally separate from cards, card_events and all real merchants.
-- A server-only atomic increment prevents repeated/two-device scans counting twice.
ALTER TABLE public.test_card_designs
  ADD COLUMN IF NOT EXISTS test_balance integer NOT NULL DEFAULT 0;

ALTER TABLE public.test_card_designs
  DROP CONSTRAINT IF EXISTS test_card_designs_test_balance_check;
ALTER TABLE public.test_card_designs
  ADD CONSTRAINT test_card_designs_test_balance_check CHECK (test_balance BETWEEN 0 AND 100000);

CREATE OR REPLACE FUNCTION public.wallet_test_increment(p_token uuid, p_expected integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE new_balance integer;
BEGIN
  IF p_expected IS NULL OR p_expected < 0 OR p_expected >= 100000 THEN RETURN NULL; END IF;
  UPDATE public.test_card_designs t
     SET test_balance = t.test_balance + 1, updated_at = now()
   WHERE t.qr_token = p_token
     AND t.test_balance = p_expected
     AND t.test_balance < greatest(1, least(1000, coalesce((t.config -> 'preview' ->> 'goal')::integer, 10)))
  RETURNING t.test_balance INTO new_balance;
  RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_test_increment(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_test_increment(uuid,integer) TO service_role;
