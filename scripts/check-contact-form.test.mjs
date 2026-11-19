import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createContactHandler } from '../supabase/functions/public-contact/handler.js';

const origin = 'https://cards.digitalprojectagency.fr';
const payload = () => ({ name: 'Camille Martin', company: 'Boulangerie du Marché', email: 'camille@example.com', phone: '06 12 34 56 78', subject: 'Carte pour ma boulangerie', project: 'creation', message: 'Bonjour, je souhaite créer une carte de fidélité pour ma boulangerie.', website: '', requestId: randomUUID() });
const request = (body = payload(), headers = {}, method = 'POST') => new Request('https://example.com/functions/v1/public-contact', { method, headers: { origin, apikey: 'public-test', 'content-type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
function fixture(overrides = {}) {
  const sent = [], limited = [];
  const handler = createContactHandler({ apiKeys: new Set(['public-test']), configured: true, consumeRate: async (...args) => { limited.push(args); return true; }, sendEmail: async message => { sent.push(message); return { ok: true, status: 200 }; }, ...overrides });
  return { handler, sent, limited };
}

test('a public visitor sends a complete structured request with a reply address', async () => {
  const { handler, sent, limited } = fixture();
  const body = payload();
  const response = await handler(request(body));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sent.length, 1); assert.equal(limited.length, 1);
  assert.equal(sent[0].replyTo, body.email); assert.equal(sent[0].requestId, body.requestId);
  assert.equal(sent[0].subject, '[DPA Cards — Contact] ' + body.subject);
  for (const value of [body.name, body.company, body.email, body.phone, body.subject, 'Créer ma carte de fidélité', body.message]) assert.ok(sent[0].text.includes(value));
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing or invalid fields never reach the rate limiter or mail service', async () => {
  const { handler, sent, limited } = fixture();
  for (const patch of [{ name: '' }, { company: 'A' }, { email: 'a@example.com,b@example.com' }, { email: 'first,last@example.com' }, { email: 'label:visitor@example.com' }, { email: 'bad\r\nBcc: victim@example.com' }, { phone: 'not a phone' }, { subject: 'hello\r\nBcc: victim@example.com' }, { project: 'unknown' }, { message: 'short' }, { requestId: 'invalid' }]) {
    const response = await handler(request({ ...payload(), ...patch }));
    assert.equal(response.status, 422); assert.ok((await response.json()).fields.includes(Object.keys(patch)[0]));
  }
  assert.equal(sent.length, 0); assert.equal(limited.length, 0);
});

test('optional phone and accented names are accepted', async () => {
  const { handler, sent } = fixture();
  assert.equal((await handler(request({ ...payload(), name: 'Élodie D’Angelo', phone: '' }))).status, 200);
  assert.ok(sent[0].text.includes('Non renseigné'));
});

test('HTML from the message and company is escaped while plain text is preserved', async () => {
  const { handler, sent } = fixture();
  const message = 'Bonjour <script>alert("test")</script>\nMon projet & mes besoins.';
  assert.equal((await handler(request({ ...payload(), company: '<img src=x onerror=alert(1)>', message }))).status, 200);
  assert.ok(sent[0].text.includes(message));
  assert.ok(!sent[0].html.includes('<script>')); assert.ok(!sent[0].html.includes('<img'));
  assert.ok(sent[0].html.includes('&lt;script&gt;')); assert.ok(sent[0].html.includes('<br>Mon projet &amp;'));
});

test('CORS, methods, content type and project API key are checked before sending', async () => {
  const { handler, sent } = fixture();
  assert.equal((await handler(request(payload(), { origin: 'https://other.example' }))).status, 403);
  assert.equal((await handler(request(payload(), { origin: '' }))).status, 403);
  assert.equal((await handler(request(payload(), { apikey: 'wrong' }))).status, 401);
  assert.equal((await handler(request(undefined, {}, 'GET'))).status, 405);
  assert.equal((await handler(request(payload(), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handler(request(undefined, { apikey: '' }, 'OPTIONS'))).status, 204);
  assert.equal((await handler(request(payload(), { origin: 'capacitor://localhost' }))).status, 200);
  assert.equal(sent.length, 1);
});

test('malformed JSON and oversized bodies cannot produce an email', async () => {
  const { handler, sent } = fixture();
  const headers = { origin, apikey: 'public-test', 'content-type': 'application/json' };
  assert.equal((await handler(new Request('https://example.com', { method: 'POST', headers, body: '{broken' }))).status, 422);
  assert.equal((await handler(request({ ...payload(), message: 'x'.repeat(25000) }))).status, 413);
  assert.equal(sent.length, 0);
});

test('a filled honeypot drops the submission without sending or consuming the quota', async () => {
  const { handler, sent, limited } = fixture();
  assert.equal((await handler(request({ website: 'https://spam.example' }))).status, 200);
  assert.equal(sent.length, 0); assert.equal(limited.length, 0);
});

test('the durable quota refuses excess requests before the mail service', async () => {
  const { handler, sent } = fixture({ consumeRate: async () => false });
  const response = await handler(request());
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '600');
  assert.equal(sent.length, 0); assert.equal((await response.json()).error, 'contact_rate_limited');
});

test('quota failures and provider failures never report a successful send', async () => {
  assert.equal((await fixture({ configured: false }).handler(request())).status, 503);
  assert.equal((await fixture({ consumeRate: async () => { throw Error('database offline'); } }).handler(request())).status, 503);
  assert.equal((await fixture({ sendEmail: async () => ({ ok: false, status: 500 }) }).handler(request())).status, 502);
  assert.equal((await fixture({ sendEmail: async () => ({ ok: false, status: 429 }) }).handler(request())).status, 429);
});

test('a retried submission keeps the same provider idempotency key and email body', async () => {
  const { handler, sent } = fixture(); const body = payload();
  await handler(request(body)); await handler(request(body));
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
});

test('the real SQL migration enforces separate IP/email quotas, expiry and server-only permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec('create schema app_private; create role anon; create role authenticated; create role service_role bypassrls;');
    const source = readFileSync(new URL('../supabase/migrations/20261119100522_public_contact_rate_limit.sql', import.meta.url), 'utf8');
    // pg_cron is checked on the hosted database; PGlite runs the table and RPC.
    await db.exec(source.slice(0, source.indexOf('select cron.schedule')));
    await db.exec('set role service_role;');
    const take = async (ip, email) => (await db.query('select public.consume_public_contact_limit($1,$2) as allowed', [ip, email])).rows[0].allowed;
    const hash = number => number.toString(16).padStart(64, '0');
    for (let i = 0; i < 5; i++) assert.equal(await take(hash(1), hash(100 + i)), true);
    assert.equal(await take(hash(1), hash(200)), false);
    for (let i = 0; i < 3; i++) assert.equal(await take(hash(10 + i), hash(300)), true);
    assert.equal(await take(hash(20), hash(300)), false);
    await db.query("update app_private.public_contact_limits set expires_at=now()-interval '1 minute' where identity=$1", ['ip:' + hash(1)]);
    assert.equal(await take(hash(1), hash(500)), true);
    await assert.rejects(() => take('not-a-hash', hash(600)), /invalid_fingerprint/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('reset role; set role ' + role + ';');
      await assert.rejects(() => take(hash(700), hash(800)), /permission denied/);
      await assert.rejects(() => db.query('select * from app_private.public_contact_limits'), /permission denied/);
    }
  } finally { await db.close(); }
});
