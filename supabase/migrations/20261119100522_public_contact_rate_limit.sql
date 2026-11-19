-- No contact message or readable address is stored here. These keyed hashes
-- only bound anonymous requests before the Edge Function sends an email.
create table app_private.public_contact_limits (
  identity text primary key check (identity ~ '^(ip|email):[0-9a-f]{64}$'),
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
create index public_contact_limits_expiration on app_private.public_contact_limits (expires_at);
alter table app_private.public_contact_limits enable row level security;
revoke all on app_private.public_contact_limits from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant select, insert, update, delete on app_private.public_contact_limits to service_role;

create or replace function public.consume_public_contact_limit(p_ip_hash text, p_email_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_identity text;
  v_duration interval;
  v_max integer;
  v_count integer;
  i integer;
begin
  if current_user <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ip_hash is null or p_email_hash is null or
     p_ip_hash !~ '^[0-9a-f]{64}$' or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_fingerprint' using errcode = '22023';
  end if;

  for i in 1..2 loop
    if i = 1 then
      v_identity := 'ip:' || p_ip_hash;
      v_duration := interval '10 minutes';
      v_max := 5;
    else
      v_identity := 'email:' || p_email_hash;
      v_duration := interval '1 hour';
      v_max := 3;
    end if;
    insert into app_private.public_contact_limits as limits (identity, attempts, expires_at)
      values (v_identity, 1, v_now + v_duration)
    on conflict (identity) do update set
      attempts = case when limits.expires_at <= v_now then 1 else least(limits.attempts + 1, 10000) end,
      expires_at = case when limits.expires_at <= v_now then excluded.expires_at else limits.expires_at end
    returning attempts into v_count;
    if v_count > v_max then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.consume_public_contact_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_public_contact_limit(text, text) to service_role;

select cron.schedule('dpa-public-contact-limits-cleanup', '12 * * * *',
  $job$delete from app_private.public_contact_limits where expires_at < now();$job$);
notify pgrst, 'reload schema';
