import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(readFileSync(resolve(root, 'release.json'), 'utf8'));
export function assertRelease(info, expected = {}) {
  assert.equal(info.releaseId, source.releaseId, 'Outdated release identifier');
  assert.equal(info.appVersion, expected.version || source.appVersion, 'Wrong application version');
  if (expected.revision) assert.equal(info.revision, expected.revision, 'The build embeds a different commit');
  if (expected.iosBuild) assert.equal(info.iosBuild, String(expected.iosBuild), 'Wrong iOS build number');
}

export function checkReleaseBundle(directory, { native = false, iosDirectory, expected = {} } = {}) {
  const read = path => readFileSync(resolve(directory, path), 'utf8');
  const info = JSON.parse(read('release.json'));
  assertRelease(info, expected);
  for (const page of ['index.html', 'connexion.html', 'landing.html', 'admin.html']) {
    assert.ok(read(page).includes('dpa-build-info'), page + ' omits the visible update identifier');
  }
  for (const path of ['assets/landing/telephone-apple.webp', 'assets/landing/telephone-android.webp', 'assets/dpa-cards-light.svg', 'assets/dpa-cards-dark.svg']) {
    assert.ok(readFileSync(resolve(directory, path)).length > 0, 'Missing asset: ' + path);
  }
  const files = readdirSync(resolve(directory, 'assets')).filter(file => /\.(js|css)$/.test(file));
  const bundled = files.map(file => read('assets/' + file)).join('\n');
  for (const feature of ['dpa-support-composer', 'dpa-experience-search', 'data-dpa-demo-mode', 'dpa-brand-dark', source.releaseId]) {
    assert.ok(bundled.includes(feature), 'Missing current feature: ' + feature);
  }
  if (native) {
    assert.ok(read('index.html').includes('dpa-native-landing'), 'Native entry point was not prepared');
    assert.ok(read('index.html').includes('window.dpaReady'), 'iPhone must boot the merchant shell');
    assert.ok(info.iosBuild, 'The native build number is missing');
  }
  if (iosDirectory) {
    for (const path of ['index.html', 'connexion.html', 'landing.html', 'admin.html', 'release.json', ...files.map(file => 'assets/' + file)]) {
      assert.ok(readFileSync(resolve(directory, path)).equals(readFileSync(resolve(iosDirectory, path))), 'Capacitor contains a stale file: ' + path);
    }
  }
  return info;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const iosArg = process.argv.indexOf('--ios-dir');
  const info = checkReleaseBundle(resolve(root, 'dist'), {
    native: process.argv.includes('--native'), iosDirectory: iosArg >= 0 ? resolve(process.argv[iosArg + 1]) : undefined,
    expected: { revision: process.env.GITHUB_SHA, version: process.env.DPA_MARKETING_VERSION, iosBuild: process.env.DPA_IOS_BUILD_NUMBER },
  });
  console.log('Verified release ' + info.releaseId + ' · ' + info.appVersion + (info.iosBuild ? ' (' + info.iosBuild + ')' : '') + ' · ' + info.revision.slice(0, 8));
}
