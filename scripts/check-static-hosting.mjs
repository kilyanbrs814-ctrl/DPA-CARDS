// Validate the static deployment output before publishing to Cloudflare Pages.
// Intentionally requires no network, secrets, or Cloudflare account.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
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
]);
for (const [from, to] of expected) {
  const line = from + ' ' + to + ' 200';
  assert.ok(redirects.split(/\r?\n/).some(s => s.trim() === line), 'Missing rewrite: ' + line);
}
// Cloudflare Pages natively serves matching HTML pages at extensionless paths.
// Rewriting /cgv to /cgv.html risks conflicting with automatic HTML URL normalization.
for (const name of ['cgv', 'mentions-legales', 'confidentialite']) {
  const route = '/' + name;
  assert.ok(!redirects.split(/\r?\n/).some(line => line.trim().startsWith(route + ' ')),
    'Legal route must use Cloudflare clean URL handling: ' + route);
  const html = readFileSync(join(dist, name + '.html'), 'utf8');
  assert.ok(html.includes('<html') && html.includes('<main'), 'Invalid legal HTML page: ' + name);
}
const index = readFileSync(join(dist, 'index.html'), 'utf8');
assert.ok(index.includes('cards.digitalprojectagency.fr'), 'Public QR origin not updated');
assert.ok(!index.includes('dpa-cards.vercel.app'), 'Legacy Vercel hostname still in site output');
const admin = readFileSync(join(dist, 'admin.html'), 'utf8');
assert.ok(admin.includes('admin-auth'), 'Admin page appears invalid');
console.log('Static host checks passed: ' + required.length + ' assets, ' + expected.size + ' rewrites and 3 legal HTML pages, canonical domain.');
