-- Multi-commerce accounts. No identifiers, public slugs, Wallet rows or existing
-- subscription prices are rewritten. Apply and validate in staging first.
begin;

create table public.merchant_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  primary_merchant_id uuid not null references public.merchants(id) on delete cascade deferrable initially deferred,
  created_at timestamptz not null default now()
);
alter table public.merchants add column billing_account_id uuid references public.merchant_billing_accounts(id),
  add column creation_request_id uuid;
alter table public.merchants drop constraint merchants_one_per_creator;
alter table public.merchant_members drop constraint merchant_members_one_merchant_per_user;
create index merchant_members_user_idx on public.merchant_members(user_id);
create index merchants_billing_account_idx on public.merchants(billing_account_id);
create index merchants_creator_idx on public.merchants(created_by);
create unique index merchants_creation_request_once on public.merchants(billing_account_id,creation_request_id);

insert into public.merchant_billing_accounts(owner_id,primary_merchant_id)
select m.created_by,(array_agg(m.id order by m.created_at,m.id))[1] from public.merchants m group by m.created_by;
update public.merchants m set billing_account_id=a.id from public.merchant_billing_accounts a where a.owner_id=m.created_by;
set constraints all immediate;
alter table public.merchants alter column billing_account_id set not null;

-- Website-only rollout: existing iPhone builds issue unscoped merchant_members
-- SELECT ... maybeSingle() and do not attach a selected profile header.
-- Never return multiple memberships to those legacy clients. Their other table
-- RLS policies also depend on merchant_members, so they stay on the first shop.
-- Web browsers explicitly opt in to all their own memberships. This header is
-- only a view preference: it cannot grant an unrelated user's membership.
create function app_private.legacy_primary_merchant(p_user uuid) returns uuid
language sql stable security definer set search_path='' as $
  select coalesce(
    (select ba.primary_merchant_id from public.merchant_billing_accounts ba where ba.owner_id=p_user),
    (select mm.merchant_id from public.merchant_members mm
     where mm.user_id=p_user order by mm.created_at,mm.merchant_id limit 1)
  );
$;
revoke all on function app_private.legacy_primary_merchant(uuid) from public,anon,authenticated;
grant execute on function app_private.legacy_primary_merchant(uuid) to authenticated;

alter policy merchant_members_select on public.merchant_members
  using (
    user_id=(select auth.uid()) and (
      coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-dpa-web-profiles','')='1'
      or merchant_id=app_private.legacy_primary_merchant((select auth.uid()))
    )
  );


create table public.merchant_activations (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  account_id uuid not null references public.merchant_billing_accounts(id) on delete cascade,
  ordinal integer not null check(ordinal>0),
  amount_cents integer not null check(amount_cents>=0),
  source text not null check(source in ('legacy','stripe')),
  provider_payment_id text unique,
  confirmed_at timestamptz not null default now(),
  unique(account_id,ordinal)
);
-- Evidence of previous activation, never an unpaid onboarding draft. Legacy
-- amounts are historical only: no retroactive activation charge is generated.
insert into public.merchant_activations(merchant_id,account_id,ordinal,amount_cents,source)
select id,billing_account_id,row_number() over(partition by billing_account_id order by created_at,id),0,'legacy'
from public.merchants m where
 exists(select 1 from public.subscriptions s where s.merchant_id=m.id and (s.setup_paid_at is not null or s.status in ('trialing','active','past_due','unpaid','paused')))
 or exists(select 1 from public.prepaid_purchases p where p.merchant_id=m.id and p.paid_at is not null)
 or exists(select 1 from public.merchant_manual_access a where a.merchant_id=m.id and a.enabled)
 or exists(select 1 from public.customers c where c.merchant_id=m.id);

create table public.merchant_profile_operations (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.merchant_billing_accounts(id) on delete cascade,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 status text not null default 'quoted' check(status in ('quoted','accepted','paid','complete','cancelled','expired')),
 ordinal integer not null check(ordinal>0), activation_cents integer not null check(activation_cents>=0),
 quote jsonb not null, accepted_at timestamptz, confirmed_at timestamptz,
 stripe_session_id text unique, stripe_payment_id text unique,stripe_refund_id text unique,
 expires_at timestamptz not null default now()+interval '15 minutes',
 created_at timestamptz not null default now()
);
create unique index merchant_profile_operation_open on public.merchant_profile_operations(account_id)
 where status in ('quoted','accepted','paid');
create index merchant_profile_operations_merchant_idx on public.merchant_profile_operations(merchant_id);

alter table public.merchant_billing_accounts enable row level security;
alter table public.merchant_activations enable row level security;
alter table public.merchant_profile_operations enable row level security;
revoke all on public.merchant_billing_accounts,public.merchant_activations,public.merchant_profile_operations from public,anon,authenticated;
grant select on public.merchant_billing_accounts,public.merchant_activations to authenticated;
grant all on public.merchant_billing_accounts,public.merchant_activations,public.merchant_profile_operations to service_role;
create policy billing_accounts_read on public.merchant_billing_accounts for select to authenticated
 using(owner_id=(select auth.uid()) or app_private.is_member(primary_merchant_id));
create policy activations_read on public.merchant_activations for select to authenticated
 using(app_private.is_member(merchant_id));

create function app_private.attach_billing_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.merchant_billing_accounts(owner_id,primary_merchant_id) values(new.created_by,new.id)
 on conflict(owner_id) do nothing;
 select a.id into new.billing_account_id from public.merchant_billing_accounts a where a.owner_id=new.created_by;
 return new;
end; $$;
revoke all on function app_private.attach_billing_account() from public,anon,authenticated;
create trigger merchants_billing_account before insert on public.merchants for each row execute function app_private.attach_billing_account();

-- Explicit per-request context; owners on older native builds without the
-- header continue on their original merchant. Ambiguous unrelated memberships
-- remain rejected. New builds send the selected merchant explicitly.
create function app_private.selected_merchant(p_owner boolean default false) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare requested text; selected uuid; n integer;
begin
 requested:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-merchant-id';
 if requested is not null then
  select mm.merchant_id into selected from public.merchant_members mm
  where mm.user_id=(select auth.uid()) and mm.merchant_id=requested::uuid and (not p_owner or mm.role='owner');
 else
  select count(*),(array_agg(mm.merchant_id))[1] into n,selected from public.merchant_members mm
  where mm.user_id=(select auth.uid()) and (not p_owner or mm.role='owner');
  if n>1 then
   -- Legacy iOS builds do not send x-merchant-id. Retain their original
   -- commerce when this user owns the account; never select a new draft.
   -- Modern clients must still send the selected profile explicitly.
   select mm.merchant_id into selected
   from public.merchant_billing_accounts ba
   join public.merchant_members mm on mm.merchant_id=ba.primary_merchant_id
   where ba.owner_id=(select auth.uid()) and mm.user_id=(select auth.uid())
    and (not p_owner or mm.role='owner');
   if selected is null then raise exception 'profile_required' using errcode='42501'; end if;
  end if;
 end if;
 if selected is null then raise exception 'forbidden' using errcode='42501'; end if;
 return selected;
end; $$;
revoke all on function app_private.selected_merchant(boolean) from public,anon;
grant execute on function app_private.selected_merchant(boolean) to authenticated;

-- The paid gate is shared by RLS, loyalty writes, public enrollment and Wallet.
-- Manual access applies only to its original commerce, never to new drafts.
create or replace function app_private.merchant_active(p_merchant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select case when a.enabled=false then false when a.expires_at>now() then true else null end
   from public.merchant_manual_access a where a.merchant_id=p_merchant),
  exists(select 1 from public.merchant_activations x
   join public.merchant_billing_accounts a on a.id=x.account_id
   join public.subscriptions s on s.merchant_id=a.primary_merchant_id
   where x.merchant_id=p_merchant and s.status in ('trialing','active')
   and (s.billing_mode='monthly' or (s.current_period_start<=now() and s.current_period_end>now())))
 ); $$;
revoke all on function app_private.merchant_active(uuid) from public,anon;
grant execute on function app_private.merchant_active(uuid) to authenticated,service_role;

create function app_private.create_profile(p_request uuid,p_business text,p_first text,p_last text,p_activity text,p_slug text,p_program jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); a public.merchant_billing_accounts; m public.merchants; p public.programs; mid uuid:=gen_random_uuid(); v_slug text;
begin
 if u is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,914));
 select * into a from public.merchant_billing_accounts where owner_id=u;
 if a.id is not null then
  if p_request is null then select * into m from public.merchants where id=a.primary_merchant_id;
  else select * into m from public.merchants where billing_account_id=a.id and creation_request_id=p_request; end if;
 end if;
 if m.id is null then
  -- A staff membership cannot be escalated into an account ownership.
  if a.id is null and exists(select 1 from public.merchant_members where user_id=u) then raise exception 'owner_only'; end if;
  v_slug:=left(coalesce(nullif(p_slug,''),'commerce'),24);
  if exists(select 1 from public.merchants where merchants.slug=v_slug) then v_slug:=left(v_slug,19)||'-'||substr(mid::text,1,8); end if;
  insert into public.merchants(id,created_by,business_name,first_name,last_name,activity,slug,creation_request_id)
  values(mid,u,btrim(p_business),btrim(p_first),btrim(coalesce(p_last,'')),coalesce(p_activity,''),v_slug,p_request) returning * into m;
  insert into public.merchant_members(merchant_id,user_id,role) values(m.id,u,'owner');
  insert into public.programs(merchant_id,name,mode,goal,reward,conditions,bg,accent,pattern,logo)
  values(m.id,p_program->>'name',coalesce(p_program->>'mode','passages'),(p_program->>'goal')::integer,p_program->>'reward',
   coalesce(p_program->>'conditions',''),coalesce(p_program->>'bg','#FFFFFF'),coalesce(p_program->>'accent','#EFEDE8'),
   coalesce(p_program->>'pattern','none'),upper(left(coalesce(p_program->>'logo',''),4)));
 end if;
 select * into p from public.programs where merchant_id=m.id and is_active;
 return jsonb_build_object('merchant',to_jsonb(m),'program',to_jsonb(p));
end; $$;
revoke all on function app_private.create_profile(uuid,text,text,text,text,text,jsonb) from public,anon;
grant execute on function app_private.create_profile(uuid,text,text,text,text,text,jsonb) to authenticated;
create function public.create_profile(p_request_id uuid,p_business text,p_first text,p_last text,p_activity text,p_slug text,p_program jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select app_private.create_profile(p_request_id,p_business,p_first,p_last,p_activity,p_slug,p_program); $$;
revoke all on function public.create_profile(uuid,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_profile(uuid,text,text,text,text,text,jsonb) to authenticated;
create or replace function public.create_merchant(p_business text,p_first text,p_last text,p_activity text,p_slug text,p_program jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select app_private.create_profile(null,p_business,p_first,p_last,p_activity,p_slug,p_program); $$;
-- All creation must use the idempotent, owner-checked RPC. Account/rank/payment
-- fields never become client-writable via column grants.
revoke insert on public.merchants from authenticated;
revoke insert(id,business_name,first_name,last_name,activity,phone,address,slug) on public.merchants from authenticated;
revoke insert on public.merchant_members from authenticated;
revoke insert(merchant_id,user_id,role) on public.merchant_members from authenticated;

create function app_private.activation_fee(p_ordinal integer) returns integer
language sql immutable set search_path='' as $$ select case p_ordinal when 1 then 5000 when 2 then 3000 when 3 then 2500 when 4 then 2000 else 1500 end; $$;
revoke all on function app_private.activation_fee(integer) from public,anon,authenticated;

-- Account-level serialization covers both devices and all draft commerces.
create function public.profile_quote_begin(p_merchant uuid,p_owner uuid,p_quote jsonb) returns public.merchant_profile_operations
language plpgsql security invoker set search_path='' as $$
declare a public.merchant_billing_accounts; op public.merchant_profile_operations; n integer;
begin
 select a1.* into a from public.merchant_billing_accounts a1 join public.merchants m on m.billing_account_id=a1.id
 where m.id=p_merchant and a1.owner_id=p_owner for update of a1;
 if a.id is null then raise exception 'forbidden'; end if;
 if exists(select 1 from public.merchant_activations where merchant_id=p_merchant) then raise exception 'already_activated'; end if;
 update public.merchant_profile_operations set status='expired' where account_id=a.id and status='quoted' and expires_at<now();
 select * into op from public.merchant_profile_operations where account_id=a.id and status in ('quoted','accepted','paid');
 if op.id is not null then
  if op.merchant_id<>p_merchant then raise exception 'checkout_in_progress'; end if;
  return op;
 end if;
 select count(*) into n from public.merchant_activations where account_id=a.id;
 if (p_quote->>'current_count')::integer<>n or (p_quote->>'new_monthly_cents')::integer<>(n+1)*2000 then raise exception 'quote_changed'; end if;
 insert into public.merchant_profile_operations(account_id,merchant_id,ordinal,activation_cents,quote)
 values(a.id,p_merchant,n+1,app_private.activation_fee(n+1),p_quote) returning * into op;
 return op;
end; $$;

create function public.profile_complete(p_operation uuid,p_payment text) returns void
language plpgsql security invoker set search_path='' as $$
declare op public.merchant_profile_operations; n integer;
begin
 select * into op from public.merchant_profile_operations where id=p_operation for update;
 if op.status='complete' then return; end if;
 if op.status<>'paid' or op.stripe_payment_id is distinct from p_payment then raise exception 'payment_required'; end if;
 perform 1 from public.merchant_billing_accounts where id=op.account_id for update;
 select count(*) into n from public.merchant_activations where account_id=op.account_id;
 if n+1<>op.ordinal then raise exception 'activation_rank_conflict'; end if;
 insert into public.merchant_activations(merchant_id,account_id,ordinal,amount_cents,source,provider_payment_id)
 values(op.merchant_id,op.account_id,op.ordinal,op.activation_cents,'stripe',p_payment);
 update public.merchant_profile_operations set status='complete',confirmed_at=now() where id=op.id;
end; $$;

-- First activations use the existing Checkout/annual flow. Retries cannot charge
-- another activation and the initial commerce occupies rank one only once.
create function public.profile_confirm_initial(p_merchant uuid,p_payment text,p_amount integer) returns void
language plpgsql security invoker set search_path='' as $$
declare a uuid; n integer;
begin
 select billing_account_id into a from public.merchants where id=p_merchant;
 perform 1 from public.merchant_billing_accounts where id=a for update;
 if exists(select 1 from public.merchant_activations where merchant_id=p_merchant) then return; end if;
 select count(*) into n from public.merchant_activations where account_id=a;
 if n<>0 or p_amount<0 then raise exception 'amount_mismatch'; end if;
 insert into public.merchant_activations(merchant_id,account_id,ordinal,amount_cents,source,provider_payment_id)
 values(p_merchant,a,1,p_amount,'stripe',p_payment);
end; $$;
revoke all on function public.profile_quote_begin(uuid,uuid,jsonb),public.profile_complete(uuid,text),public.profile_confirm_initial(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.profile_quote_begin(uuid,uuid,jsonb),public.profile_complete(uuid,text),public.profile_confirm_initial(uuid,text,integer) to service_role;
grant execute on function app_private.activation_fee(integer) to service_role;

-- Scoped replacements for enrollment, lookup and design requests follow.
create table public.merchant_initial_checkouts(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.merchant_billing_accounts(id) on delete cascade,
 plan text not null,billing text not null,quantity integer not null,setup integer not null,
 stripe_session_id text unique,closed_at timestamptz,created_at timestamptz not null default now()
);
create unique index merchant_initial_checkout_open on public.merchant_initial_checkouts(account_id) where closed_at is null;
alter table public.merchant_initial_checkouts enable row level security;
revoke all on public.merchant_initial_checkouts from public,anon,authenticated;
grant all on public.merchant_initial_checkouts to service_role;
create function public.claim_initial_checkout(p_merchant uuid,p_plan text,p_billing text,p_quantity integer,p_setup integer)
returns public.merchant_initial_checkouts language plpgsql security invoker set search_path='' as $$
declare a uuid;c public.merchant_initial_checkouts;
begin
 select billing_account_id into a from public.merchants where id=p_merchant;
 perform 1 from public.merchant_billing_accounts where id=a for update;
 if exists(select 1 from public.merchant_profile_operations where account_id=a and status in ('quoted','accepted','paid')) then raise exception 'checkout_in_progress';end if;
 select * into c from public.merchant_initial_checkouts where account_id=a and closed_at is null;
 if c.id is not null then
  if (c.plan,c.billing,c.quantity,c.setup) is distinct from (p_plan,p_billing,p_quantity,p_setup) then raise exception 'checkout_in_progress';end if;
  return c;
 end if;
 insert into public.merchant_initial_checkouts(account_id,plan,billing,quantity,setup) values(a,p_plan,p_billing,p_quantity,p_setup) returning * into c;
 return c;
end; $$;
revoke all on function public.claim_initial_checkout(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_initial_checkout(uuid,text,text,integer,integer) to service_role;
CREATE OR REPLACE FUNCTION public.enroll_customer(p_request_id uuid, p_first text, p_last text, p_email text, p_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  v_mid  uuid;
  v_prog public.programs%rowtype;
  v_cust public.customers%rowtype;
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

  select c.* into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
  if not found then
    begin
      insert into public.customers (merchant_id, first_name, last_name, email, consent_at, request_id)
      values (v_mid, btrim(p_first), btrim(coalesce(p_last, '')), nullif(lower(btrim(coalesce(p_email, ''))), ''), now(), p_request_id)
      returning * into v_cust;
    exception when unique_violation then
      select c.* into v_cust from public.customers c where c.merchant_id = v_mid and c.request_id = p_request_id;
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
CREATE OR REPLACE FUNCTION public.lookup_card(p_code text)
 RETURNS TABLE(card_id uuid, matched_by text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  v_mid := app_private.selected_merchant(false);
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app_private.require_active(v_mid);
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
$function$
;
CREATE OR REPLACE FUNCTION public.submit_design_request(p_request_id uuid, p_logo_path text, p_reference_paths text[], p_colors text, p_description text, p_contact_name text, p_contact_email text, p_contact_phone text)
 RETURNS design_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := (select auth.uid());
  v_mid    uuid;
  v_prog   public.programs%rowtype;
  v_req    public.design_requests%rowtype;
  v_prefix text;
  v_path   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  v_mid := app_private.selected_merchant(true);
  if v_mid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.* into v_prog from public.programs p where p.merchant_id = v_mid and p.is_active;
  if not found then
    raise exception 'no_program' using errcode = 'P0002';
  end if;

  -- Retry of the same submission, or a paid request already open: return it.
  select r.* into v_req from public.design_requests r
  where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
  order by (r.request_id = p_request_id) desc limit 1;
  if found then
    return v_req;
  end if;
  -- Older unpaid orders stay as they are (the merchant cannot update requests); they are
  -- cancelled server side when one order of the program is paid (design_mark_paid).
  if v_prog.design_status <> 'draft' then
    raise exception 'design_locked' using errcode = '42501';
  end if;

  v_prefix := v_mid::text || '/' || p_request_id::text || '/';
  foreach v_path in array coalesce(p_reference_paths, '{}') || coalesce(array[p_logo_path], '{}') loop
    if v_path is not null and v_path not like v_prefix || '%' then
      raise exception 'invalid_file_path' using errcode = '22023';
    end if;
  end loop;

  begin
    insert into public.design_requests (merchant_id, program_id, request_id, logo_path, reference_paths, colors,
                                        description, contact_name, contact_email, contact_phone)
    values (v_mid, v_prog.id, p_request_id, p_logo_path, coalesce(p_reference_paths, '{}'), nullif(btrim(p_colors), ''),
            btrim(p_description), btrim(p_contact_name), nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_contact_phone), ''))
    returning * into v_req;
  exception when unique_violation then
    select r.* into v_req from public.design_requests r
    where r.merchant_id = v_mid and (r.request_id = p_request_id or (r.program_id = v_prog.id and r.status in ('submitted', 'in_progress')))
    limit 1;
    if not found then raise; end if;
    return v_req;
  end;

  -- Not an order yet: it becomes one (and the program moves to pending_dpa) only once
  -- Stripe confirms the payment, through public.design_mark_paid (service role).
  return v_req;
end;
$function$
;

create function app_private.profile_ledger_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user='authenticated' and new.merchant_id<>app_private.selected_merchant(false) then
  raise exception 'card_not_found' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function app_private.profile_ledger_guard() from public,anon;
grant execute on function app_private.profile_ledger_guard() to authenticated;
create trigger card_events_profile_guard before insert on public.card_events for each row execute function app_private.profile_ledger_guard();
commit;
