-- Card lookup for the scanner (USB QR reader, phone camera, keyboard).
--
-- Accepts what a DPA Cards QR contains — "DPA1:<qr_token>" (or the bare token) —
-- or a card number: the 8 digits, or at least its last 4. Runs as the caller:
-- RLS only exposes the caller's merchant, and the merchant is also filtered
-- explicitly, so a token or number from another business returns nothing.
-- Returns at most 6 rows so the client can tell "unique", "several" and "none".

create function public.lookup_card(p_code text)
returns table (card_id uuid, matched_by text)
language plpgsql stable security invoker set search_path = ''
as $$
#variable_conflict use_column
declare
  v_mid    uuid;
  v_code   text := btrim(coalesce(p_code, ''));
  v_token  text;
  v_digits text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select mm.merchant_id into v_mid from public.merchant_members mm where mm.user_id = (select auth.uid());
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_code) > 120 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  v_token := substring(lower(v_code) from '^(?:dpa1:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
  if v_token is not null then
    return query
      select k.id, 'qr'::text from public.cards k
      where k.qr_token = v_token::uuid and k.merchant_id = v_mid;
    return;
  end if;

  v_digits := regexp_replace(v_code, '[^0-9]', '', 'g');
  if v_code !~* '^(dpa)?[0-9 .-]+$' or char_length(v_digits) < 4 or char_length(v_digits) > 8 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if char_length(v_digits) = 8 then
    return query
      select k.id, 'number'::text from public.cards k
      where k.card_number = 'DPA ' || left(v_digits, 4) || ' ' || right(v_digits, 4) and k.merchant_id = v_mid;
    return;
  end if;
  return query
    select k.id, 'suffix'::text from public.cards k
    where k.merchant_id = v_mid and replace(k.card_number, ' ', '') like '%' || v_digits
    order by k.created_at desc
    limit 6;
end;
$$;

revoke all on function public.lookup_card(text) from public, anon;
grant execute on function public.lookup_card(text) to authenticated;
