// Static integration guardrails: validate links between Apple button, admin metrics,
// migrations and public signup. Does not claim to verify Apple signing or installs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const wallet = read('supabase/functions/wallet/index.ts');
const pass = read('supabase/functions/apple-pass/index.ts');
const api = read('src/admin-backend.js');
const designer = read('src/card-designer.js');
const admin = read('admin.html');
const client = read('src/backend.js');
const join = read('index.html');
const migration = read('supabase/migrations/20261015001700_apple_wallet_metrics_test_links.sql');
const expect = (s, phrase, name) => assert.ok(s.includes(phrase), name + ' missing: ' + phrase);
for (const [code, phrase, name] of [
  [wallet, 'admin-test-card-apple', 'wallet demo route'],
  [wallet, 'admin_apple_wallet_counts', 'wallet counters'],
  [wallet, 'apple_wallet_test_links', 'wallet test tokens'],
  [pass, 'createDemoPass', 'signed Apple test pass'],
  [pass, 'apple_wallet_downloads', 'real Apple metrics'],
  [pass, 'DPA_TEST:', 'test QR isolation'],
  [api, 'testApple:', 'admin Apple API'],
  [designer, "'data-test-apple': true", 'designer Apple button'],
  [admin, 'Passes Apple Wallet générés', 'admin KPI'],
  [admin, 'appleOnlyPct', 'admin breakdown'],
  [client, 'appleWalletLink(cardId)', 'merchant Apple API'],
  [join, 'openPublicApple', 'public Apple button'],
  [migration, 'revoke all on public.apple_wallet_downloads', 'metrics access control'],
  [migration, 'revoke all on public.apple_wallet_test_links', 'test tokens access control'],
]) expect(code, phrase, name);
assert.ok(!pass.includes('-----BEGIN PRIVATE KEY-----'), 'Apple secret must never be hardcoded');
console.log('Apple integration checks passed: 14 contracts, no private signing key.');
