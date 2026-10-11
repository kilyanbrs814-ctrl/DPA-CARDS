-- sales_payout: "selection_changed" / "total_changed" were raised as SQLSTATE 40001 (serialization
-- failure), which PostgREST retries as a transient error before giving up. Plain application errors now.
create or replace function public.sales_payout(p_actor text, p_rep uuid, p_period date, p_ids uuid[], p_expected integer,
                                    p_paid_on date, p_reference text, p_note text, p_key uuid)
returns public.commission_payouts
language plpgsql set search_path = ''
as $$
declare
  v       public.commission_payouts;
  v_count integer;
  v_total integer;
begin
  perform app_private.sales_require_director(p_actor);
  select * into v from public.commission_payouts where idempotency_key = p_key;
  if found then return v; end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Europe/Paris')::date then raise exception 'invalid_paid_on' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_to_pay' using errcode = '22023'; end if;
  perform 1 from public.commissions where id = any (p_ids) for update;
  select count(*), coalesce(sum(amount_cents), 0) into v_count, v_total from public.commissions
   where id = any (p_ids) and status = 'to_pay' and sales_rep_id = p_rep and period = p_period;
  if v_count <> array_length(p_ids, 1) or v_count <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'selection_changed'; end if;
  if v_total <> p_expected then raise exception 'total_changed'; end if;
  insert into public.commission_payouts (sales_rep_id, period, amount_cents, commission_count, paid_on, reference, note, idempotency_key, created_by)
  values (p_rep, p_period, v_total, v_count, p_paid_on, left(btrim(coalesce(p_reference, '')), 120), left(btrim(coalesce(p_note, '')), 500), p_key, lower(btrim(p_actor)))
  returning * into v;
  update public.commissions set status = 'paid', payout_id = v.id, paid_at = p_paid_on where id = any (p_ids);
  insert into public.sales_audit (actor, action, details)
  values (lower(btrim(p_actor)), 'payout_recorded', jsonb_build_object('payout_id', v.id, 'sales_rep_id', p_rep, 'period', p_period, 'amount_cents', v_total, 'count', v_count));
  return v;
end;
$$;
