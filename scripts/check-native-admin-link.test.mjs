import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_CALLBACK_URL, parseAdminAuthUrl, isNativeIOS } from '../src/native-admin-link.js';

test('iOS admin URL is an exact registered deep link', () => {
  assert.equal(ADMIN_CALLBACK_URL, 'dpacards://auth/admin');
});
test('valid admin session tokens can be recovered from URL fragment', () => {
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin#access_token=abc&refresh_token=xyz&type=magiclink'), {
    type: 'tokens', accessToken: 'abc', refreshToken: 'xyz',
  });
});
test('PKCE code is accepted as fallback', () => {
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin?code=some-code'), { type: 'code', code: 'some-code' });
});
test('Supabase errors are normalized, not shown verbatim', () => {
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin#error=access_denied&error_description=do-not-render'), { type: 'error', code: 'access_denied' });
});
test('unrecognized paths and protocols cannot inject a session', () => {
  for (const value of [
    'https://cards.digitalprojectagency.fr/admin.html#access_token=abc&refresh_token=xyz',
    'dpacards://other/admin#access_token=abc&refresh_token=xyz',
    'dpacards://auth/merchant#access_token=abc&refresh_token=xyz',
    'dpacards://auth/admin',
    'dpacards://auth/admin#access_token=abc',
    'not a URL',
    'dpacards://auth/admin#access_token=' + 'a'.repeat(16001),
  ]) assert.equal(parseAdminAuthUrl(value), null, value.slice(0, 100));
});
test('module can import in normal web tests without a window global', () => {
  assert.equal(isNativeIOS(), false);
});
