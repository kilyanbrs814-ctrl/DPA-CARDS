import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_CALLBACK_URL, parseAdminAuthUrl, isNativeIOS, listenForAdminDeepLinks, forwardAdminAuthToPage, takePendingAdminAuth } from '../src/native-admin-link.js';

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

    'not a URL',
    'dpacards://auth/admin#access_token=' + 'a'.repeat(16001),
  ]) assert.equal(parseAdminAuthUrl(value), null, value.slice(0, 100));
});
test('module can import in normal web tests without a window global', () => {
  assert.equal(isNativeIOS(), false);
});

test('admin callback with no credentials is reported, not discarded', () => {
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin'), { type: 'missing_credentials' });
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin/'), { type: 'missing_credentials' });
  assert.deepEqual(parseAdminAuthUrl('dpacards://auth/admin#access_token=abc'), { type: 'missing_credentials' });
});
test('Capacitor App plugin receives warm links and cold-launch URLs', async () => {
  const before = globalThis.window;
  const warmCallbacks = [];
  const incoming = [];
  globalThis.window = {
    location: { protocol: 'capacitor:' },
    Capacitor: { Plugins: { App: {
      addListener(event, callback) {
        assert.equal(event, 'appUrlOpen');
        warmCallbacks.push(callback);
        return Promise.resolve({ remove() {} });
      },
      getLaunchUrl: async () => ({ url: 'dpacards://auth/admin#access_token=cold&refresh_token=boot' }),
    } } },
  };
  try {
    assert.equal(listenForAdminDeepLinks(url => incoming.push(url)), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(incoming, ['dpacards://auth/admin#access_token=cold&refresh_token=boot']);
    warmCallbacks[0]({ url: 'https://example.com/not-admin' });
    warmCallbacks[0]({ url: 'dpacards://auth/admin#access_token=warm&refresh_token=return' });
    assert.equal(incoming.length, 2);
    assert.equal(parseAdminAuthUrl(incoming[1]).accessToken, 'warm');
  } finally { globalThis.window = before; }
});
test('native callback is preserved and forwarded to the packaged admin page', () => {
  const before = globalThis.window;
  const storage = new Map();
  let destination;
  globalThis.window = {
    location: { protocol: 'capacitor:', replace: path => { destination = path; } },
  };
  const beforeStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    setItem: (key, value) => storage.set(key, value),
    getItem: key => storage.get(key) ?? null,
    removeItem: key => storage.delete(key),
  };
  try {
    const original = 'dpacards://auth/admin#access_token=sample&refresh_token=sample2';
    forwardAdminAuthToPage(original);
    assert.equal(destination, '/admin.html');
    assert.equal(takePendingAdminAuth(), original);
    assert.equal(takePendingAdminAuth(), null);
  } finally {
    globalThis.window = before;
    globalThis.sessionStorage = beforeStorage;
  }
});
