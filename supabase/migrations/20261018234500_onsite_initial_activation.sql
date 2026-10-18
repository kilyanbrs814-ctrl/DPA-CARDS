-- A 50€ activation collected with an EXTERNAL contactless terminal is recorded
-- separately from the Stripe SetupIntent used to authorize recurring charges.
-- Only the director's verified admin endpoint may call this service-role function.
begin;
alter table public.merchant_activations drop constraint merchant_activations_source_check;
alter table public.merchant_activations add constraint merchant_activations_source_check
  check (source in ('legacy','stripe','onsite'));

create table public.merchant_onsite_activation_receipts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null unique references public.merchants(id) on delete restrict,
  account_id uuid not null references public.merchant_billing_accounts(id) on delete restrict,
  amount_cents integer not null check (amount_cents=5000),
  provider text not null check (provider='external_contactless'),
  receipt_ref text not null check (char_length(btrim(receipt_ref)) between 6 and 100),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (provider,receipt_ref)
);
alter table public.merchant_onsite_activation_receipts enable row level security;
revoke all on public.merchant_onsite_activation_receipts from public,anon,authenticated;
grant all on public.merchant_onsite_activation_receipts to service_role;

create function public.record_onsite_initial_activation(
  p_merchant uuid,p_receipt_ref text,p_actor uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_account uuid; v_count integer; v_receipt public.merchant_onsite_activation_receipts;
begin
  if p_actor is null or p_receipt_ref is null
     or char_length(btrim(p_receipt_ref)) not between 6 and 100 then
    raise exception 'invalid_receipt';
  end if;
  select billing_account_id into v_account from public.merchants where id=p_merchant;
  if v_account is null then raise exception 'merchant_not_found'; end if;
  perform 1 from public.merchant_billing_accounts where id=v_account for update;
  if not found then raise exception 'billing_account_not_found'; end if;
  if not exists(select 1 from public.admin_created_merchants where merchant_id=p_merchant) then
    raise exception 'not_admin_created';
  end if;
  if exists(select 1 from public.merchant_initial_checkouts where account_id=v_account and closed_at is null) then
    raise exception 'checkout_in_progress';
  end if;
  if exists(select 1 from public.merchant_profile_operations where account_id=v_account
    and status in ('quoted','accepted','paid')) then raise exception 'checkout_in_progress'; end if;
  if exists(select 1 from public.subscriptions where merchant_id=p_merchant
    and (stripe_checkout_session_id is not null or stripe_subscription_id is not null
     or status in ('active','trialing','past_due','unpaid','paused'))) then
    raise exception 'checkout_in_progress';
  end if;
  if exists(select 1 from public.merchant_activations where merchant_id=p_merchant) then
    raise exception 'already_activated';
  end if;
  select count(*) into v_count from public.merchant_activations where account_id=v_account;
  if v_count<>0 then raise exception 'first_activation_only'; end if;
  insert into public.merchant_onsite_activation_receipts(
    merchant_id,account_id,amount_cents,provider,receipt_ref,recorded_by)
    values(p_merchant,v_account,5000,'external_contactless',btrim(p_receipt_ref),p_actor)
    returning * into v_receipt;
  insert into public.merchant_activations(
    merchant_id,account_id,ordinal,amount_cents,source,provider_payment_id)
    values(p_merchant,v_account,1,5000,'onsite','onsite:'||v_receipt.id::text);
  return jsonb_build_object('merchant_id',p_merchant,'recorded',true,
    'amount_cents',5000,'receipt_id',v_receipt.id);
end; $$;
revoke all on function public.record_onsite_initial_activation(uuid,text,uuid)
 from public,anon,authenticated;
grant execute on function public.record_onsite_initial_activation(uuid,text,uuid) to service_role;
commit;
