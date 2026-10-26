import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {walletUserHeaders} from '../supabase/functions/_shared/merchant-context.ts';
const read=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_merchant_profiles.sql'));
const u='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
test('migration preserves a legacy commerce; profiles, grants, RLS and serialized paid activation',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.test_uid',true),'')::uuid $$;
  grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`);
 await db.exec(read('20261002204418_loyalty_core.sql'));
 await db.exec(read('20261002221214_fix_member_insert_recursion.sql'));
 await db.exec(read('20261005093513_subscriptions.sql').split('-- ---------------------------------------------------------------- admin')[0]);
 // Only the existing columns/types consumed by this migration; external Wallet,
 // cron, storage and Stripe integrations are intentionally outside this DB test.
 await db.exec(`alter table public.programs add column design_status text default 'draft';
 create table public.prepaid_purchases(id uuid primary key,merchant_id uuid,paid_at timestamptz);
 create table public.merchant_manual_access(merchant_id uuid primary key,enabled boolean,expires_at timestamptz);
 create table public.design_requests(id uuid primary key default gen_random_uuid(),merchant_id uuid,program_id uuid,request_id uuid,status text default 'pending_payment',
 logo_path text,reference_paths text[],colors text,description text,contact_name text,contact_email text,contact_phone text);
 alter table public.subscriptions add column billing_mode text default 'monthly';
 create function app_private.require_active(p uuid) returns void language plpgsql as $$ begin if not app_private.merchant_active(p) then raise exception 'subscription_required';end if;end;$$;
 grant usage on schema app_private to service_role;
 insert into auth.users values('${u}'),('${other}');
 set request.test_uid='${u}';`);
 const data={name:'Club A',mode:'passages',goal:10,reward:'Café',logo:'A'};
 const initial=(await db.query(`select public.create_merchant('Commerce A','Alex','','Restaurant','commercea',$1::jsonb) as r`,[JSON.stringify(data)])).rows[0].r;
 const a=initial.merchant.id,program=initial.program.id;
 await db.query(`insert into public.subscriptions(merchant_id,plan_type,status,monthly_amount_cents,setup_paid_at) values($1,'no_commitment','active',2490,now())`,[a]);
 await db.exec('grant all on all tables in schema public to service_role;grant execute on all functions in schema app_private to service_role;');
 await db.exec(read(migration));
 assert.equal((await db.query('select id,slug from public.merchants')).rows[0].id,a);
 assert.equal((await db.query('select ordinal,source from public.merchant_activations')).rows[0].ordinal,1);
 assert.equal((await db.query('select monthly_amount_cents from public.subscriptions')).rows[0].monthly_amount_cents,2490);
 await db.exec(`set role authenticated;set request.test_uid='${u}';set request.headers='{}';`);
 const make=async request=>(await db.query(`select public.create_profile($1,'Commerce B','Alex','','Restaurant','commerceb',$2::jsonb) as r`,[request,JSON.stringify(data)])).rows[0].r;
 const request='20000000-0000-0000-0000-000000000001';
 const b=await make(request);assert.notEqual(b.merchant.id,a);assert.equal((await make(request)).merchant.id,b.merchant.id);
 const c=await make('20000000-0000-0000-0000-000000000002');
 assert.equal((await db.query('select count(*)::int n from public.merchant_activations')).rows[0].n,1);
 // Legacy iPhone only sees the primary membership and primary business data.
 assert.deepEqual((await db.query('select merchant_id from public.merchant_members order by created_at')).rows.map(x=>x.merchant_id),[a]);
 // Reproduce the Wallet Edge client's lost web-view header: selecting B alone
 // returns no program, even though it was created and is owned by this user.
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify({'x-merchant-id':b.merchant.id})]);
 assert.equal((await db.query('select id from programs where merchant_id=$1',[b.merchant.id])).rows.length,0);
 const edgeHeaders=walletUserHeaders(new Request('https://example.test/finalize-design',{headers:{authorization:'Bearer test-owner','x-merchant-id':b.merchant.id}}));
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify(edgeHeaders)]);
 assert.equal((await db.query('select id from programs where merchant_id=$1',[b.merchant.id])).rows.length,1,'Wallet can now find the selected draft under real RLS');
 assert.equal((await db.query('select id from merchants where id=$1',[b.merchant.id])).rows.length,1);
 await db.exec(`set request.test_uid='${other}';`);
 assert.equal((await db.query('select id from programs where merchant_id=$1',[b.merchant.id])).rows.length,0,'Forging profile headers grants no access');
 await db.exec(`set request.test_uid='${u}';`);
 const legacyHeaders=walletUserHeaders(new Request('https://example.test/finalize-design',{headers:{authorization:'Bearer test-owner'}}));
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify(legacyHeaders)]);
 assert.deepEqual((await db.query('select merchant_id from merchant_members')).rows.map(x=>x.merchant_id),[a],'Unselected old iPhone still sees only its primary commerce');
 assert.equal((await db.query(`select app_private.selected_merchant() id`)).rows[0].id,a);
 // A browser opts in to all *its own* memberships; the selected header scopes actions.
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify({'x-dpa-web-profiles':'1','x-merchant-id':b.merchant.id})]);
 assert.equal((await db.query('select merchant_id from public.merchant_members')).rows.length,3);
 assert.equal((await db.query('select app_private.selected_merchant() id')).rows[0].id,b.merchant.id);
 assert.equal((await db.query('select app_private.merchant_active($1) allowed',[b.merchant.id])).rows[0].allowed,false);
 await assert.rejects(db.query(`insert into public.merchant_activations(merchant_id,account_id,ordinal,amount_cents,source) values($1,$2,2,0,'stripe')`,[b.merchant.id,b.merchant.billing_account_id]),/permission denied/);
 await db.exec(`set request.test_uid='${other}';`);
 assert.equal((await db.query('select * from public.merchant_members')).rows.length,0);
 assert.equal((await db.query('select * from public.merchants')).rows.length,0);
 await assert.rejects(db.query('select app_private.selected_merchant()'),/forbidden/);
 await db.exec('reset role;set role service_role;');
 const quote={current_count:1,new_monthly_cents:4000};
 const op=(await db.query('select to_jsonb(public.profile_quote_begin($1,$2,$3::jsonb)) r',[b.merchant.id,u,JSON.stringify(quote)])).rows[0].r;
 assert.equal(op.ordinal,2);assert.equal(op.activation_cents,3000);
 await assert.rejects(db.query('select public.profile_quote_begin($1,$2,$3::jsonb)',[c.merchant.id,u,JSON.stringify(quote)]),/checkout_in_progress/);
 assert.equal((await db.query('select to_jsonb(public.profile_quote_begin($1,$2,$3::jsonb)) r',[b.merchant.id,u,JSON.stringify(quote)])).rows[0].r.id,op.id);
 await assert.rejects(db.query(`select public.profile_complete($1,'pi_unpaid')`,[op.id]),/payment_required/);
 await db.query(`update public.merchant_profile_operations set status='paid',stripe_payment_id='pi_profile_2' where id=$1`,[op.id]);
 await db.query(`select public.profile_complete($1,'pi_profile_2')`,[op.id]);
 await db.query(`select public.profile_complete($1,'pi_profile_2')`,[op.id]);
 assert.equal((await db.query('select count(*)::int n from public.merchant_activations')).rows[0].n,2);
 assert.equal((await db.query('select app_private.merchant_active($1) allowed',[b.merchant.id])).rows[0].allowed,true);
 assert.equal((await db.query('select app_private.merchant_active($1) allowed',[c.merchant.id])).rows[0].allowed,false);
 const third=(await db.query('select to_jsonb(public.profile_quote_begin($1,$2,$3::jsonb)) r',[c.merchant.id,u,JSON.stringify({current_count:2,new_monthly_cents:6000})])).rows[0].r;
 assert.equal(third.ordinal,3);assert.equal(third.activation_cents,2500);
 await db.exec(`reset role;set role authenticated;set request.test_uid='${u}';`);
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify({'x-dpa-web-profiles':'1','x-merchant-id':b.merchant.id})]);
 const enrolled=(await db.query(`select public.enroll_customer(gen_random_uuid(),'Client B','','',true) r`)).rows[0].r;
 assert.equal(enrolled.card.merchant_id,b.merchant.id);
 await db.query(`select set_config('request.headers',$1,false)`,[JSON.stringify({'x-dpa-web-profiles':'1','x-merchant-id':a})]);
 assert.equal((await db.query('select * from public.lookup_card($1)',['DPA1:'+enrolled.card.qr_token])).rows.length,0);
 await assert.rejects(db.query(`select public.add_visit($1,gen_random_uuid())`,[enrolled.card.id]),/card_not_found/);
 assert.equal((await db.query('select id from public.programs where id=$1',[program])).rows.length,1);
 }finally{await db.close();}
});
