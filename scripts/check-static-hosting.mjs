// Validate the static deployment output before publishing to Cloudflare Pages.
// Intentionally requires no network, secrets, or Cloudflare account.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const required = [
  'index.html', 'admin.html', '_redirects',
  'mentions-legales.html', 'confidentialite.html', 'cgv.html',
  'support.js', 'LoyaltyCard.dc.html',
];
for (const f of required) {
  assert.ok(existsSync(join(dist, f)), 'Required output missing: ' + f);
}
const redirects = readFileSync(join(dist, '_redirects'), 'utf8');
const expected = new Map([
  ['/join/*', '/index.html'],
  ['/subscription/success', '/index.html'],
  ['/subscription/cancel', '/index.html'],
  ['/design/success', '/index.html'],
  ['/design/cancel', '/index.html'],
  ['/mentions-legales', '/mentions-legales.html'],
  ['/confidentialite', '/confidentialite.html'],
  ['/cgv', '/cgv.html'],
]);
for (const [from, to] of expected) {
  const line = from + ' ' + to + ' 200';
  assert.ok(redirects.split(/\r?\n/).some(s => s.trim() === line), 'Missing rewrite: ' + line);
}
const index = readFileSync(join(dist, 'index.html'), 'utf8');
assert.ok(index.includes('cards.digitalprojectagency.fr'), 'Public QR origin not updated');
assert.ok(!index.includes('dpa-cards.vercel.app'), 'Legacy Vercel hostname still in site output');
const admin = readFileSync(join(dist, 'admin.html'), 'utf8');
assert.ok(admin.includes('admin-auth'), 'Admin page appears invalid');
console.log('Static host checks passed: ' + required.length + ' assets, ' + expected.size + ' rewrites, canonical domain.');
