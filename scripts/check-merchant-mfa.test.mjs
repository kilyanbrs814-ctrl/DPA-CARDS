import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {merchantMfa} from '../src/merchant-mfa.js';
import {merchantSessionError} from '../supabase/functions/_shared/merchant-session.js';

test('a password-only session is challenged before a verified factor can be used', async () => {
  const ok = data => ({data, error: null});
  const factor = {id: 'phone'};
  let level = {currentLevel: 'aal1', nextLevel: 'aal1'};
  let verified;
  const auth = {mfa: {
    getAuthenticatorAssuranceLevel: async () => ok(level),
    listFactors: async () => ok({totp: [factor]}),
    enroll: async () => ok({...factor, totp: {uri: 'otpauth://totp/example', secret: 'dummy'}}),
    challengeAndVerify: async params => { verified = params; return ok({}); },
  }};
  const mfa = merchantMfa(auth, async () => 'data:image/png;base64,fixture');
  assert.deepEqual(await mfa.status(), {active: false});
  assert.equal((await mfa.enroll()).id, 'phone');
  level = {currentLevel: 'aal1', nextLevel: 'aal2'};
  assert.deepEqual(await mfa.status(), {required: true, factors: [factor]});
  await mfa.verify('phone', '012345');
  assert.deepEqual(verified, {factorId: 'phone', code: '012345'});
  level = {currentLevel: 'aal2', nextLevel: 'aal2'};
  assert.deepEqual(await mfa.status(), {active: true});
});

test('privileged merchant routes reject an unconfirmed email or a missing second factor', () => {
  const token = aal => 'header.' + Buffer.from(JSON.stringify({aal})).toString('base64url') + '.signature';
  const user = {email_confirmed_at: '2026-11-03'};
  assert.equal(merchantSessionError({}, token('aal2')), 'email_unconfirmed');
  assert.equal(merchantSessionError(user, token('aal1')), null);
  const enrolled = {...user, factors: [{status: 'verified'}]};
  assert.equal(merchantSessionError(enrolled, token('aal1')), 'mfa_required');
  assert.equal(merchantSessionError(enrolled, 'broken'), 'mfa_required');
  assert.equal(merchantSessionError(enrolled, token('aal2')), null);
});

test('customer contacts are returned only for the verified owner’s selected commerce', async () => {
  const wallet = readFileSync(new URL('../supabase/functions/wallet/index.ts', import.meta.url), 'utf8');
  const source = wallet.slice(wallet.indexOf('async function exportCustomerContacts('), wallet.indexOf('async function deleteCustomer('));
  let role = 'staff';
  const filters = [];
  const endpoint = runInNewContext(stripTypeScriptTypes(source) + '\nexportCustomerContacts', {
    ownerOf: async () => ({member: {role, merchant_id: 'owned-shop'}}),
    HttpError: Error,
    admin: {from(table) {
      assert.equal(table, 'customers');
      return {
        select() { return this; },
        eq(field, value) { filters.push([field, value]); return this; },
        order() { return this; },
        limit() { return {data: [{email: 'fixture@example.test'}]}; },
      };
    }},
    json: (_request, status, data) => Response.json(data, {status}),
  });
  const request = {json: async () => ({merchant_id: 'another-shop'})};
  await assert.rejects(endpoint(request));
  assert.deepEqual(filters, []);
  role = 'owner';
  const response = await endpoint(request);
  assert.equal((await response.json()).customers[0].email, 'fixture@example.test');
  assert.deepEqual(filters, [['merchant_id', 'owned-shop']]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('admin endpoints require AAL2 after activation and accept authorized accounts without a verified factor', async () => {
  const wallet = readFileSync(new URL('../supabase/functions/wallet/index.ts', import.meta.url), 'utf8');
  const source = wallet.slice(wallet.indexOf('async function requireAdmin('), wallet.indexOf('// Sales tracking, commission'));
  let level = 'aal1';
  let factors = [];
  const requireAdmin = runInNewContext(stripTypeScriptTypes(source) + '\nrequireAdmin', {
    authUser: async () => ({
      user: {email: 'admin@example.test', email_confirmed_at: '2026-11-03', factors},
      token: 'header.' + Buffer.from(JSON.stringify({aal: level})).toString('base64url') + '.signature',
    }),
    admin: {from: () => ({select: () => ({eq: () => ({maybeSingle: async () => ({data: {role: 'admin'}})})})})},
    HttpError: class extends Error {constructor(status, code) {super(code); this.status = status;}},
    merchantSessionError,
  });
  assert.equal((await requireAdmin({})).dpaRole, 'admin');
  factors = [{status: 'unverified'}];
  assert.equal((await requireAdmin({})).dpaRole, 'admin');
  factors = [{status: 'verified'}];
  await assert.rejects(requireAdmin({}), {message: 'mfa_required', status: 403});
  level = 'aal2';
  assert.equal((await requireAdmin({})).dpaRole, 'admin');
});

test('database denies password-only read and write after enrollment and keeps commerce isolation', async () => {
  const db = new PGlite();
  const tables = ['customers', 'cards', 'card_events', 'wallet_passes'];
  const first = '10000000-0000-0000-0000-000000000001';
  const second = '10000000-0000-0000-0000-000000000002';
  const unconfirmed = '10000000-0000-0000-0000-000000000003';
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const migration = readdirSync(migrations).find(name => name.endsWith('_merchant_customer_data_mfa.sql'));
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema app_private;
      grant usage on schema app_private, auth to authenticated;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table auth.mfa_factors(user_id uuid references auth.users, status text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.test_uid', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select jsonb_build_object('aal', current_setting('request.test_aal', true)) $$;
      insert into auth.users values ('${first}', now()), ('${second}', now()), ('${unconfirmed}', null);
      insert into auth.mfa_factors values ('${first}', 'verified'), ('${second}', 'unverified');
      ${tables.map(table => `
        create table public.${table}(owner_id uuid not null, value text);
        alter table public.${table} enable row level security;
        grant select, insert, update, delete on public.${table} to authenticated, service_role;
        create policy tenant on public.${table} for all to authenticated
          using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
        insert into public.${table} values ('${first}', 'commerce 1'), ('${second}', 'commerce 2'), ('${unconfirmed}', 'non confirmé');
      `).join('')}
    `);
    await db.exec(readFileSync(new URL(migration, migrations), 'utf8'));
    await db.exec('set role authenticated');
    const identity = (id, level) => db.query(
      "select set_config('request.test_uid', $1, false), set_config('request.test_aal', $2, false)",
      [id, level],
    );
    const values = async table => (await db.query(`select value from public.${table} order by value`)).rows.map(row => row.value);
    await identity(first, 'aal1');
    for (const table of tables) {
      assert.deepEqual(await values(table), []);
      await assert.rejects(db.query(`insert into public.${table} values ($1, 'bloqué')`, [first]), /row-level security/);
      assert.equal((await db.query(`delete from public.${table}`)).affectedRows, 0);
    }
    await identity(first, 'aal2');
    for (const table of tables) assert.deepEqual(await values(table), ['commerce 1']);
    await identity(second, 'aal1');
    for (const table of tables) assert.deepEqual(await values(table), ['commerce 2']);
    await identity(unconfirmed, 'aal1');
    for (const table of tables) assert.deepEqual(await values(table), []);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.customers'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.deepEqual(await values('customers'), ['commerce 1', 'commerce 2', 'non confirmé']);
  } finally { await db.close(); }
});
