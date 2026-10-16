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
  'assets/wallet-badge-apple.png', 'assets/wallet-badge-google.png',
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
// The two original 580x180 user-supplied badges are served locally, without
// a third-party runtime dependency. Native click handlers must remain attached.
for (const [platform,action,expectedLength] of [
  ['apple','openApple',16402],['google','openGoogle',32925],
]) {
  const file='assets/wallet-badge-'+platform+'.png';
  const badge=readFileSync(join(dist,file));
  assert.equal(badge.length,expectedLength,'Unexpected modification to '+file);
  assert.equal(badge.toString('hex',0,8),'89504e470d0a1a0a','Not a PNG: '+file);
  assert.equal(badge.readUInt32BE(16),580,'Unexpected badge width: '+file);
  assert.equal(badge.readUInt32BE(20),180,'Unexpected badge height: '+file);
  assert.ok(index.includes('onClick="{{ '+action+' }}" aria-label="Ajouter à '+
    (platform==='apple'?'Apple':'Google')+' Wallet"'),'Original join action changed: '+action);
  assert.ok(index.includes('src="/'+file+'"'),'Wallet badge missing from join page: '+file);
}
assert.ok(index.includes('href="{{ gw.url }}"'),'Google Wallet handoff link missing');

console.log('Static host checks passed: ' + required.length + ' assets, ' + expected.size + ' rewrites and 3 legal HTML pages, canonical domain.');
