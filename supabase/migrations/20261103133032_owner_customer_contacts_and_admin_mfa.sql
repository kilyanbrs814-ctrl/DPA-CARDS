begin;

-- Employee sessions still read the fields used at the till. Full customer
-- contact details are fetched by the owner-only export endpoint.
revoke select on table public.customers from public, anon, authenticated;
revoke select (email, consent_at) on table public.customers from public, anon, authenticated;
grant select (id, merchant_id, first_name, last_name, request_id, created_by, created_at)
  on table public.customers to authenticated;

-- Keep enrollment invoker-scoped and preserve the existing card/ledger flow.
-- In particular, the enrolled or retried customer response omits email.
CREATE OR REPLACE FUNCTION public.enroll_customer(p_request_id uuid, p_first text, p_last text, p_email text, p_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  v_mid  uuid;
  v_prog public.programs%rowtype;
  v_cust record;
  v_card public.cards%rowtype;
  v_ev   public.card_events%rowtype;
  i      integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  v_mid := app_private.selected_merchant(false);
  if v_mid is null or not app_private.is_member(v_mid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app_private.require_active(v_mid);
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'no_program' using errcode = 'P0002';
  end if;

  select c.id, c.first_name, c.last_name into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
  if not found then
    begin
      insert into public.customers (merchant_id, first_name, last_name, email, consent_at, request_id)
      values (v_mid, btrim(p_first), btrim(coalesce(p_last, '')), nullif(lower(btrim(coalesce(p_email, ''))), ''), now(), p_request_id)
      returning id, first_name, last_name into v_cust;
    exception when unique_violation then
      select c.id, c.first_name, c.last_name into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
      if not found then raise; end if;
    end;
  end if;

  select k.* into v_card from public.cards k where k.customer_id = v_cust.id and k.program_id = v_prog.id;
  if not found then
    for i in 1..5 loop
      begin
        insert into public.cards (merchant_id, program_id, customer_id)
        values (v_mid, v_prog.id, v_cust.id)
        returning * into v_card;
        exit;
      exception when unique_violation then
        -- Card number collision, or the same enrolment committed concurrently.
        select k.* into v_card from public.cards k where k.customer_id = v_cust.id and k.program_id = v_prog.id;
        exit when found;
        if i = 5 then raise; end if;
      end;
    end loop;
  end if;

  select e.* into v_ev from public.card_events e where e.card_id = v_card.id and e.type = 'join';
  if not found then
    v_ev := app_private.record_event(v_card.id, p_request_id, 'join');
  end if;

  return jsonb_build_object('customer', to_jsonb(v_cust), 'card', to_jsonb(v_card), 'event', to_jsonb(v_ev));
end;
$function$
;
commit;
