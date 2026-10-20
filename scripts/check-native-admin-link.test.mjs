import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSixDigitCode } from '../src/admin-otp.js';
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

test('native administrator OTP only accepts exactly six digits', () => {
  for (const value of ['123456', '000001', '123456 ', ' 000000']) assert.equal(isSixDigitCode(value), true);
  for (const value of ['', '12345', '1234567', 'abcdef', '１２３４５６', '12345a', null]) assert.equal(isSixDigitCode(value), false);
});
test('iOS admin form has native OTP entry, code autofill and recovery actions', () => {
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  for (const field of ['admin-otp-row', 'admin-otp-code', 'autocomplete="one-time-code"', 'admin-otp-resend', 'admin-otp-change']) {
    assert.ok(html.includes(field), field);
  }
});
test('native uses verified Supabase email OTP; browser retains email magic link', () => {
  const js = readFileSync(new URL('../src/admin-backend.js', import.meta.url), 'utf8');
  assert.ok(js.includes('sb.auth.verifyOtp({ email: nativeOtpEmail, token, type: \'email\' })'));
  assert.ok(js.includes("window.location.origin + '/admin.html'"));
  assert.ok(js.includes('if (nativeAdmin && nativeOtpEmail)'));
  assert.ok(js.includes('await refreshAccess(true)'));
  assert.ok(js.includes('showCodeEntry(mail)'));
});

test('expired admin code errors are visible in red, without exposing the OTP', () => {
  const js = readFileSync(new URL('../src/admin-backend.js', import.meta.url), 'utf8');
  assert.match(js, /const ERROR_COLOR = '#C62828'/);
  assert.match(js, /message\.style\.color = isError \? ERROR_COLOR : NORMAL_COLOR/);
  assert.match(js, /message\.setAttribute\('role', isError \? 'alert' : 'status'\)/);
  assert.match(js, /error\.code === 'otp_expired'/);
  assert.match(js, /setAuthMessage\([\s\S]*?true,\s*\)/);
  assert.match(js, /otpCode\.value\.replace\(\/\[\^0-9\]\/g, ''\)/);
  assert.ok(!js.includes('console.log(token)'), 'never log a one-time code');
});
