// iOS deep link transport for the admin magic-link flow.
// The native App plugin is installed by the iOS build workflow. We call the
// bundled Capacitor bridge only in iOS, so normal web builds stay dependency-free.
export const ADMIN_CALLBACK_URL = 'dpacards://auth/admin';
const PENDING_KEY = 'dpa.cards.pending.admin.callback';

export function isNativeIOS() {
  return typeof window !== 'undefined' && window.location.protocol === 'capacitor:';
}

export function parseAdminAuthUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 16000) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  // Do not permit arbitrary web links or other paths to initiate a login.
  if (url.protocol !== 'dpacards:' || url.hostname !== 'auth' || !/^\/admin\/?$/.test(url.pathname)) return null;
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const p = key => hash.get(key) || query.get(key);
  const accessToken = p('access_token');
  const refreshToken = p('refresh_token');
  const code = p('code');
  const error = p('error_code') || p('error');
  if (accessToken && refreshToken) return { type: 'tokens', accessToken, refreshToken };
  if (code) return { type: 'code', code };
  if (error) return { type: 'error', code: error };
  // The scheme was opened, but the provider supplied no usable credentials.
  // Report this explicitly instead of silently returning to the login form.
  return { type: 'missing_credentials' };
}

export function takePendingAdminAuth() {
  if (!isNativeIOS()) return null;
  let raw;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch { return null; }
  return raw && parseAdminAuthUrl(raw) ? raw : null;
}

// Callback can arrive while the app is running or when it is cold-launched
// from Mail/Safari. In either case, only the exact approved scheme is handled.
export function listenForAdminDeepLinks(onUrl) {
  if (!isNativeIOS()) return false;
  const cap = window.Capacitor;
  const app = cap?.Plugins?.App;
  if (!app?.addListener && typeof cap?.addListener !== 'function') {
    console.warn('DPA Cards: native App URL listener unavailable');
    return false;
  }
  const handle = data => {
    const raw = data?.url;
    // Never log magic-link URLs: they can contain active session tokens.
    if (parseAdminAuthUrl(raw)) onUrl(raw);
  };
  try {
    // Capacitor's official App plugin is responsible for custom scheme URLs.
    // The native bridge API is retained as a fallback for generated projects.
    const subscription = app?.addListener
      ? app.addListener('appUrlOpen', handle)
      : cap.addListener('App', 'appUrlOpen', handle);
    Promise.resolve(subscription).catch(() => {
      console.warn('DPA Cards: could not register native URL listener');
    });
    // appUrlOpen may fire before JavaScript initializes after a cold start.
    // getLaunchUrl recovers that initial callback; duplicates are harmless.
    const launch = app?.getLaunchUrl
      ? app.getLaunchUrl()
      : cap.nativePromise?.('App', 'getLaunchUrl', {});
    if (launch) Promise.resolve(launch).then(handle).catch(() => {});
    return true;
  } catch {
    console.warn('DPA Cards: native URL listener registration failed');
    return false;
  }
}

export function forwardAdminAuthToPage(url) {
  if (!parseAdminAuthUrl(url) || !isNativeIOS()) return;
  try {
    sessionStorage.setItem(PENDING_KEY, url);
    // The entire admin login remains within capacitor://localhost.
    window.location.replace('/admin.html');
  } catch {
    // Never write access/refresh tokens into a query string or a URL fragment.
    console.error('DPA Cards: unable to reopen the native admin screen');
  }
}
