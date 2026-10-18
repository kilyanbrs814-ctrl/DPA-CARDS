import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261018234500_onsite_initial_activation.sql',import.meta.url),'utf8');
const u='10000000-0000-0000-0000-000000000001',v='10000000-0000-0000-0000-000000000002';
const a='20000000-0000-0000-0000-000000000001',b='20000000-0000-0000-0000-000000000002';
const one='30000000-0000-0000-0000-000000000001',two='30000000-0000-0000-0000-000000000002';
const actor='40000000-0000-0000-0000-000000000001';

test('onsite activation migration: isolated receipt, authorization, duplicate protection and first fee only',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users(id) values ('${u}'),('${v}'),('${actor}');
    create table public.merchant_billing_accounts(id uuid primary key,owner_id uuid not null references auth.users(id));
    create table public.merchants(id uuid primary key,billing_account_id uuid not null references public.merchant_billing_accounts(id));
    create table public.admin_created_merchants(merchant_id uuid primary key references public.merchants(id));
    create table public.merchant_initial_checkouts(account_id uuid not null,closed_at timestamptz);
    create table public.merchant_profile_operations(account_id uuid not null,status text not null);
    create table public.subscriptions(merchant_id uuid not null,stripe_checkout_session_id text,stripe_subscription_id text,status text);
    create table public.merchant_activations(
      merchant_id uuid primary key references public.merchants(id),
      account_id uuid not null references public.merchant_billing_accounts(id),
      ordinal integer not null,amount_cents integer not null,
      source text not null check(source in ('legacy','stripe')),
      provider_payment_id text unique,unique(account_id,ordinal));
    insert into public.merchant_billing_accounts values('${a}','${u}'),('${b}','${v}');
    insert into public.merchants values('${one}','${a}'),('${two}','${b}');
    insert into public.admin_created_merchants values('${one}'),('${two}');
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;`);
  await db.exec(migration);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.record_onsite_initial_activation($1,$2,$3)',[one,'RECU-ONE',actor]),/permission denied/);
  await db.exec('reset role; set role service_role');
  const receipt=(await db.query('select public.record_onsite_initial_activation($1,$2,$3) r',[one,'RECU-ONE',actor])).rows[0].r;
  assert.equal(receipt.recorded,true);
  assert.equal(receipt.amount_cents,5000);
  assert.equal((await db.query('select source,amount_cents from public.merchant_activations')).rows[0].source,'onsite');
  assert.equal((await db.query('select amount_cents from public.merchant_activations')).rows[0].amount_cents,5000);
  await assert.rejects(db.query('select public.record_onsite_initial_activation($1,$2,$3)',[one,'RECU-ONE',actor]),/already_activated/);
  await assert.rejects(db.query('select public.record_onsite_initial_activation($1,$2,$3)',[two,'RECU-ONE',actor]),/duplicate key/);
  assert.equal((await db.query('select count(*)::int n from public.merchant_activations')).rows[0].n,1);
  await db.query('insert into public.merchant_initial_checkouts(account_id) values($1)',[b]);
  await assert.rejects(db.query('select public.record_onsite_initial_activation($1,$2,$3)',[two,'RECU-TWO',actor]),/checkout_in_progress/);
 }finally{await db.close()}
});
