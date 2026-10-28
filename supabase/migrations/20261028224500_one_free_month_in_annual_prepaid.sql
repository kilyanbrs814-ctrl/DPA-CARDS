-- New prepaid 12-month contracts include one free month; old purchases unchanged.
CREATE OR REPLACE FUNCTION public.prepaid_begin(p_merchant uuid, p_user uuid, p_months integer, p_monthly integer, p_setup integer)
 RETURNS prepaid_purchases
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_sub public.subscriptions;
  v     public.prepaid_purchases;
begin
  perform public.prepaid_expire(p_merchant);
  select * into v_sub from public.subscriptions where merchant_id = p_merchant for update;
  if found then
    if app_private.merchant_active(p_merchant) then raise exception 'already_subscribed' using errcode = 'P0001'; end if;
    if v_sub.stripe_subscription_id is not null and v_sub.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused') then
      raise exception 'payment_issue' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.prepaid_purchases where merchant_id = p_merchant and status in ('pending', 'processing')) then
    raise exception 'checkout_in_progress' using errcode = 'P0001';
  end if;
  insert into public.prepaid_purchases (merchant_id, created_by, months, monthly_cents, base_cents, setup_cents, total_cents)
  values (p_merchant, p_user, p_months, p_monthly, p_monthly * greatest(p_months - 1, 0), p_setup, p_monthly * greatest(p_months - 1, 0) + p_setup)
  returning * into v;
  return v;
end;
$function$
;
