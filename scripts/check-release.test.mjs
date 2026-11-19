import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRelease } from './check-release-bundle.mjs';
import { bundledPageHref } from '../src/native-navigation.js';

test('The release gate rejects an old commit, wrong version, or another iOS build', () => {
  const info = { releaseId:'2026.11.19.1', appVersion:'1.3', revision:'a'.repeat(40), iosBuild:'25' };
  assert.doesNotThrow(() => assertRelease(info, {revision:'a'.repeat(40),iosBuild:'25'}));
  assert.throws(() => assertRelease(info, {revision:'b'.repeat(40)}), /different commit/);
  assert.throws(() => assertRelease(info, {version:'1.4'}), /application version/);
  assert.throws(() => assertRelease(info, {iosBuild:'24'}), /build number/);
  assert.throws(() => assertRelease({...info,releaseId:'old'}), /Outdated/);
});

test('Native navigation resolves bundled pages and preserves query/fragment', () => {
  const native = {protocol:'capacitor:',host:'localhost',href:'capacitor://localhost/index.html'};
  for (const page of ['connexion','admin','mentions-legales','confidentialite','cgv']) {
    assert.equal(bundledPageHref('/'+page+'?mode=test#section',native), '/'+page+'.html?mode=test#section');
  }
  assert.equal(bundledPageHref('/',native),'/index.html');
  for (const href of ['#faq','/assets/logo.svg','https://cards.digitalprojectagency.fr/connexion','capacitor://other/confidentialite','javascript:alert(1)','/join/commerce']) {
    assert.equal(bundledPageHref(href,native),null,href);
  }
  assert.equal(bundledPageHref('/connexion',{protocol:'https:',host:'cards.digitalprojectagency.fr',href:'https://cards.digitalprojectagency.fr/'}),null);
});
