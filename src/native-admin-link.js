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
  if (url.protocol !== 'dpacards:' || url.hostname !== 'auth' || url.pathname !== '/admin') return null;
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
  return null;
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
  if (!isNativeIOS()) return;
  const capacitor = window.Capacitor;
  if (!capacitor || typeof capacitor.addListener !== 'function') {
    console.warn('DPA Cards: native Capacitor bridge unavailable');
    return;
  }
  const handle = data => {
    const raw = data && data.url;
    if (parseAdminAuthUrl(raw)) onUrl(raw);
  };
  capacitor.addListener('App', 'appUrlOpen', handle);
  if (typeof capacitor.nativePromise === 'function') {
    capacitor.nativePromise('App', 'getLaunchUrl', {}).then(handle).catch(() => {});
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
