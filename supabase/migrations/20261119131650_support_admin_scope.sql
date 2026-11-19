-- Match the existing admin dashboard: directors see all shops; an active sales
-- admin only sees conversations belonging to their server-side attributions.
create or replace function app_private.support_actor(p_merchant uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists(select 1 from public.admin_users a where lower(a.email)=lower(u.email)
      and (a.role='director' or exists(
        select 1 from public.sales_reps r join public.merchant_attributions ma on ma.sales_rep_id=r.id
        where r.email=lower(u.email) and r.active=true and ma.merchant_id=p_merchant))) then 'admin'
    when exists(select 1 from public.merchant_members m where m.user_id=u.id and m.merchant_id=p_merchant) then 'merchant'
    else null end
  from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null
    and ((select auth.jwt())->>'aal'='aal2' or not exists(
      select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'));
$$;
revoke all on function app_private.support_actor(uuid) from public,anon;
grant execute on function app_private.support_actor(uuid) to authenticated;
notify pgrst,'reload schema';
