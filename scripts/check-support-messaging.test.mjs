import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { mergeMessages, makeSupportApi } from '../src/support-chat-api.js';
import { sampleCurve } from '../src/dashboard-motion.js';

const uuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
test('Support: tenant isolation, verified identities/MFA, admin replies, unread cursors, retries and limits', async () => {
  const db = new PGlite();
  const [owner, colleague, other, admin, unverified] = [1,2,3,4,5].map(uuid), [shop, shop2] = [101,102].map(uuid);
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema app_private;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table auth.mfa_factors(user_id uuid,status text);
      create table public.admin_users(email text primary key,role text);
      create table public.merchants(id uuid primary key,business_name text);
      create table public.merchant_members(user_id uuid,merchant_id uuid);
      create table public.sales_reps(id uuid,email text,active boolean);
      create table public.merchant_attributions(merchant_id uuid,sales_rep_id uuid);
      alter table public.merchants enable row level security;
      create policy shop_read on public.merchants for select to authenticated using(exists(select 1 from public.merchant_members mm where mm.user_id=auth.uid() and mm.merchant_id=id));
      grant usage on schema auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;
      grant select on public.merchants,public.merchant_members to authenticated;`);
    for (const [id,email,confirmed] of [[owner,'owner@test.invalid',true],[colleague,'colleague@test.invalid',true],[other,'other@test.invalid',true],[admin,'admin@test.invalid',true],[unverified,'unverified@test.invalid',false]]) {
      await db.query('insert into auth.users values($1,$2,$3)',[id,email,confirmed?new Date().toISOString():null]);
    }
    await db.query('insert into merchants values($1,$2),($3,$4)',[shop,'Commerce A',shop2,'Commerce B']);
    await db.query('insert into merchant_members values($1,$2),($3,$2),($4,$5),($6,$2)',[owner,shop,colleague,other,shop2,unverified]);
    await db.exec("insert into admin_users values('admin@test.invalid','director');");
    const migration = readFileSync(new URL('../supabase/migrations/20261119131308_support_messaging.sql', import.meta.url),'utf8');
    await db.exec(migration.split('\ndo $$ begin\n')[0]);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261119131650_support_admin_scope.sql',import.meta.url),'utf8'));
    const login = async (id,aal='aal1') => { await db.exec('reset role;set role authenticated;'); await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,aal,user_metadata:{role:'admin',email:'admin@test.invalid'}})]); };
    const inbox = async mid => (await db.query('select * from support_inbox($1)',[mid || null])).rows;
    const start = async (id=uuid(201),body='Bonjour, ma question.') => (await db.query('select support_start_conversation($1,$2,$3,$4) r',[shop,'Question de fidélité',body,id])).rows[0].r;
    const send = async (conv,body,id) => (await db.query('select support_send_message($1,$2,$3) r',[conv,body,id])).rows[0].r;
    await login(owner);
    const thread = await start(), conv = thread.conversation.id;
    assert.equal(thread.message.author_type,'merchant');assert.equal(thread.message.sender_id,owner);
    assert.equal(thread.conversation.merchant_name,'Commerce A');
    assert.equal((await start()).message.id,thread.message.id,'a retried initial request creates one conversation and one message');
    await assert.rejects(start(uuid(201),'Different payload'),/support_request_conflict/);
    assert.equal((await inbox())[0].unread,0);
    await assert.rejects(db.query('update support_messages set body=$1 where id=$2',['Edited',thread.message.id]),/permission denied/);
    await assert.rejects(db.query('insert into support_messages(conversation_id,body,client_id,sender_id,author_type) values($1,$2,$3,$4,$5)',[conv,'Spoof',uuid(202),admin,'admin']),/permission denied/);
    await db.exec('reset role');
    await db.query("insert into admin_users values('colleague@test.invalid','admin'),('other@test.invalid','admin')");
    await db.query('insert into sales_reps values($1,$2,true),($3,$4,false)',[uuid(901),'colleague@test.invalid',uuid(902),'other@test.invalid']);
    await db.query('insert into merchant_attributions values($1,$2),($1,$3)',[shop,uuid(901),uuid(902)]);
    await login(colleague);
    assert.equal((await inbox()).length,1,'an active sales admin sees their attributed commerce');
    assert.equal((await send(conv,'Réponse du commercial autorisé',uuid(950))).author_type,'admin');
    await login(other);
    assert.deepEqual(await inbox(),[],'spoofing user metadata cannot grant admin or other-tenant access');
    assert.equal((await db.query('select * from support_messages_page($1)',[conv])).rows.length,0);
    await assert.rejects(send(conv,'Intrusion',uuid(203)),/support_forbidden/);
    await assert.rejects(db.query('select support_mark_read($1,$2)',[conv,thread.message.id]),/support_forbidden/);
    await login(unverified);assert.deepEqual(await inbox(),[]);
    await login(admin);
    assert.equal((await inbox())[0].unread,2);
    const reply = await send(conv,'Bonjour, voici notre réponse.',uuid(204));
    assert.equal(reply.author_type,'admin');assert.equal(reply.sender_id,admin);
    await db.query('select support_mark_read($1,$2)',[conv,reply.id]);assert.equal((await inbox())[0].unread,0);
    await login(owner);assert.equal((await inbox())[0].unread,2);
    await db.query('select support_mark_read($1,$2)',[conv,reply.id]);assert.equal((await inbox())[0].unread,0);
    await db.query('select support_mark_read($1,$2)',[conv,thread.message.id]);assert.equal((await inbox())[0].unread,0,'an old cursor cannot move read state backward');
    await login(colleague);assert.equal((await inbox())[0].unread,2,'read receipts are per user, not shared by staff');
    await db.exec('reset role');await db.query("insert into auth.mfa_factors values($1,'verified')",[admin]);
    await login(admin);assert.deepEqual(await inbox(),[],'an enrolled administrator needs aal2');
    await login(admin,'aal2');assert.equal((await inbox()).length,1);
    await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from support_messages'),/permission denied/);
    await assert.rejects(db.query('select * from support_inbox(null)'),/permission denied/);
    await login(owner);
    await assert.rejects(send(conv,' '.repeat(20),uuid(205)),/invalid_support_message/);
    await assert.rejects(send(conv,'x'.repeat(5001),uuid(206)),/invalid_support_message/);
    for (let i=0;i<29;i++) await send(conv,'Message '+i,uuid(300+i));
    await assert.rejects(send(conv,'Too many',uuid(400)),/support_rate_limited/);
    assert.equal((await start()).message.id,thread.message.id,'a legitimate retry still succeeds at the rate limit');
    // Old history is paginated with a timestamp AND UUID cursor.
    await db.exec('reset role;alter table support_messages disable trigger support_prepare_message;');
    for (let i=0;i<95;i++) await db.query('insert into support_messages(conversation_id,sender_id,author_type,body,client_id,created_at) values($1,$2,$3,$4,$5,$6)',[conv,colleague,'merchant','Ancien '+i,uuid(500+i),new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()]);
    await db.exec('alter table support_messages enable trigger support_prepare_message;');await login(owner);
    const first = (await db.query('select * from support_messages_page($1)',[conv])).rows;
    assert.equal(first.length,80);
    const last=first.at(-1),next=(await db.query('select * from support_messages_page($1,$2,$3)',[conv,last.created_at,last.id])).rows;
    assert.equal(new Set([...first,...next].map(m=>m.id)).size,127);
  } finally { await db.close(); }
});

test('Realtime/pagination merges are idempotent and chart interpolation preserves endpoints', () => {
  const a={id:'a',created_at:'2026-01-01',body:'a'},b={id:'b',created_at:'2026-01-02',body:'b'};
  assert.deepEqual(mergeMessages([b,a],[b]),[a,b]);
  const curve=sampleCurve([{value:0},{value:10}],10);
  assert.equal(curve.length,61);assert.deepEqual(curve[0],[0,150]);assert.deepEqual(curve.at(-1),[600,0]);
});

test('Support client shares one Realtime subscription, resyncs on events, and rejects stale sessions', async () => {
  const previousDocument = globalThis.document;
  const document = new EventTarget(); document.visibilityState = 'visible'; globalThis.document = document;
  let user = 'owner', subscriptions = 0, removed = 0, notifications = 0, resolveRpc;
  const handlers = [];
  const channel = { on(event, filter, fn) { handlers.push({ event, filter, fn }); return this; }, subscribe(fn) { subscriptions++; fn('SUBSCRIBED'); return this; } };
  const sb = {
    auth: { getSession: async () => ({ data: { session: user ? { user: { id: user } } : null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => channel, removeChannel: () => { removed++; },
    rpc: async () => new Promise(resolve => { resolveRpc = resolve; }),
  };
  const api = makeSupportApi(sb), stop1 = api.watch(() => notifications++), stop2 = api.watch(() => {});
  try {
    assert.equal(subscriptions,1);
    assert.deepEqual(handlers.map(h => h.filter.table),['support_conversations','support_messages','support_reads']);
    handlers[1].fn(); await new Promise(resolve => setTimeout(resolve,90)); assert.equal(notifications,1);
    document.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setTimeout(resolve,90)); assert.equal(notifications,2);
    const pending = api.inbox(); await new Promise(resolve => setImmediate(resolve));
    user = 'another-user'; resolveRpc({ data: [], error: null }); await assert.rejects(pending,/session_changed/);
    user = null; await assert.rejects(api.inbox(),/not_authenticated/);
    stop1(); assert.equal(removed,0); stop2(); assert.equal(removed,1);
  } finally { stop1(); stop2(); globalThis.document = previousDocument; }
});
