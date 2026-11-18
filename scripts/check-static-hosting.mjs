// Validate the static deployment output before publishing to Cloudflare Pages.
// Intentionally requires no network, secrets, or Cloudflare account.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const required = [
  'index.html', 'connexion.html', 'admin.html', 'activation-result.html', '_redirects',
  'mentions-legales.html', 'confidentialite.html', 'cgv.html',
  'support.js', 'theme.js', 'LoyaltyCard.dc.html',
  'assets/wallet-badge-apple.png', 'assets/wallet-badge-google.png',
  'manifest.webmanifest', 'install-app.js', 'install-app.css', 'landing-start.js',
];
for (const f of required) {
  assert.ok(existsSync(join(dist, f)), 'Required output missing: ' + f);
}
for (const name of ['index', 'connexion', 'admin', 'mentions-legales', 'confidentialite', 'cgv']) {
  const page = readFileSync(join(dist, name + '.html'), 'utf8');
  const theme = page.indexOf('<script src="/theme.js"></script>');
  assert.ok(theme > -1 && theme < page.indexOf('</head>'), 'Early theme initialization missing: ' + name);
}
const redirects = readFileSync(join(dist, '_redirects'), 'utf8');
const expected = new Map([
  ['/join/*', '/connexion.html'],
  ['/subscription/success', '/connexion.html'],
  ['/subscription/cancel', '/connexion.html'],
  ['/design/success', '/connexion.html'],
  ['/design/cancel', '/connexion.html'],
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
const index = readFileSync(join(dist, 'connexion.html'), 'utf8');
assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, '/connexion');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');
const landingStart = readFileSync(join(dist, 'landing-start.js'), 'utf8');
function landingDestination(url) {
  let destination = null;
  const location = new URL(url, 'https://cards.digitalprojectagency.fr');
  location.replace = path => destination = path;
  runInNewContext(landingStart, { URLSearchParams, location });
  return destination;
}
assert.equal(landingDestination('/?utm_source=caisse#fonctionnalites'), null);
assert.equal(landingDestination('/?profile_payment=return'), '/connexion?profile_payment=return');
assert.equal(landingDestination('/?error_code=otp_expired'), '/connexion?error_code=otp_expired');
assert.equal(landingDestination('/?utm_source=email#type=recovery&access_token=example'), '/connexion?utm_source=email#type=recovery&access_token=example');
for (const size of [192, 512]) {
  const icon = manifest.icons.find(value => value.sizes === `${size}x${size}`);
  assert.ok(icon);
  const png = readFileSync(join(dist, icon.src.slice(1)));
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
if (existsSync(join(dist, 'landing.html'))) {
  const landing = readFileSync(join(dist, 'landing.html'), 'utf8');
  assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), landing);
  assert.match(landing, /\/landing-start\.js/);
  assert.match(landing, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(landing, /<a\b[^>]+href=["']\/connexion["']/);
  assert.match(landing, /<a\b[^>]+href=["']\/connexion\?mode=inscription["']/);
  assert.match(landing, /<dpa-install-app\b/);
  assert.doesNotMatch(landing, /<x-dc>/);
}
assert.ok(index.includes('cards.digitalprojectagency.fr'), 'Public QR origin not updated');
for (const [kind,pixels] of [
  ['merchant-logo','660 × 660 px'],
  ['brief-logo','660 × 660 px'],
  ['brief-references','1032 × 812 px'],
]) {
  assert.ok(index.includes('data-recommended-size="'+kind+'"'),'Image-upload guidance missing: '+kind);
  assert.ok(index.includes(pixels),'Recommended size missing from card creation: '+kind);
}
assert.ok(!index.includes('data-recommended-size="merchant-hero"'), 'Self-service uses the stamp catalogue instead of a hero upload');
assert.ok(index.includes('onChange="{{ obPickLogo }}"'), 'The real merchant logo upload must remain available');
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
