import { createClient } from '@supabase/supabase-js';
import { makeCardDesigner } from './card-designer.js';
import { makeSales } from './sales.js';
import { isSixDigitCode } from './admin-otp.js';
import { ADMIN_CALLBACK_URL, isNativeIOS, parseAdminAuthUrl, takePendingAdminAuth, listenForAdminDeepLinks } from './native-admin-link.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Only decides who may request a sign-in link (so no Auth user is created for other e-mails).
// Admin access itself is granted by admin_users alone, checked again by the Edge Function.
const ALLOWED = new Set([
  'kilyan.brs814@gmail.com',
  'mael.81400@icloud.com',
  'contact@digitalprojectagency.fr',
  'zakariabouras2020@gmail.com',
]);

// Own storage key: the merchant app (same origin) keeps its session under the default key, and
// its sign-in, sign-out and "Se souvenir de moi" (sessionStorage) must not replace or drop this one.
const sb = createClient(URL_, KEY, {
  auth: {
    storageKey: 'dpa-admin-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !isNativeIOS(),
  },
});

const root = document.getElementById('admin-auth-root');
const loading = document.getElementById('admin-auth-loading');
const form = document.getElementById('admin-auth-form');
const email = document.getElementById('admin-email');
const submit = document.getElementById('admin-submit');
const message = document.getElementById('admin-auth-message');
const help = document.getElementById('admin-auth-help');
const otpRow = document.getElementById('admin-otp-row');
const otpCode = document.getElementById('admin-otp-code');
const otpActions = document.getElementById('admin-otp-actions');
const otpResend = document.getElementById('admin-otp-resend');
const otpChange = document.getElementById('admin-otp-change');
const nativeAdmin = isNativeIOS();
let nativeOtpEmail = null;
const ERROR_COLOR = '#C62828';
const NORMAL_COLOR = '#5E636B';
// Surface failed authentication as a red, accessible error message.
function setAuthMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? ERROR_COLOR : NORMAL_COLOR;
  message.setAttribute('role', isError ? 'alert' : 'status');
  otpCode.style.borderColor = isError && nativeAdmin ? ERROR_COLOR : '#D4D1C9';
}
if (nativeAdmin) {
  otpCode.addEventListener('input', () => {
    // Paste from the e-mail may include invisible spaces, but never transform digits.
    const normalized = otpCode.value.replace(/[^0-9]/g, '').slice(0, 6);
    if (otpCode.value !== normalized) otpCode.value = normalized;
    if (message.getAttribute('role') === 'alert') setAuthMessage('');
  });
}
if (nativeAdmin) {
  help.textContent = 'Recevez un code à 6 chiffres par e-mail, puis saisissez-le ici pour ouvrir votre tableau de bord. Pas besoin de quitter l’application.';
  submit.textContent = 'Recevoir mon code';
}
function showCodeEntry(mail) {
  nativeOtpEmail = mail;
  email.value = mail;
  email.readOnly = true;
  otpRow.style.display = 'block';
  otpActions.style.display = 'flex';
  otpCode.required = true;
  otpCode.value = '';
  submit.textContent = 'Valider le code';
  help.textContent = 'Entrez le code à 6 chiffres reçu par e-mail. N’ouvrez pas le lien : copiez uniquement les chiffres.';
  setAuthMessage('Code envoyé. Vérifiez votre boîte de réception.');
  otpCode.focus();
}
function resetCodeEntry() {
  nativeOtpEmail = null;
  email.readOnly = false;
  otpRow.style.display = 'none';
  otpActions.style.display = 'none';
  otpCode.required = false;
  otpCode.value = '';
  submit.textContent = nativeAdmin ? 'Recevoir mon code' : 'Recevoir le lien de connexion';
  if (nativeAdmin) help.textContent = 'Recevez un code à 6 chiffres par e-mail, puis saisissez-le ici pour ouvrir votre tableau de bord. Pas besoin de quitter l’application.';
}
const denied = document.getElementById('admin-denied');
const signout = document.getElementById('admin-signout');
const app = document.getElementById('admin-app');

function showLogin(msg = '') {
  loading.style.display = 'none';
  denied.style.display = 'none';
  form.style.display = 'flex';
  app.style.display = 'none';
  root.style.display = 'flex';
  setAuthMessage(msg, /invalide|expiré|erreur|impossible|refusé|indisponible/i.test(msg));
}

function showDenied() {
  loading.style.display = 'none';
  form.style.display = 'none';
  denied.style.display = 'block';
  app.style.display = 'none';
  root.style.display = 'flex';
}

// The dashboard loads its data once access is confirmed (and again after a new sign-in).
const accessListeners = [];
function showApp() {
  root.style.display = 'none';
  app.style.display = 'block';
  accessListeners.forEach(cb => { try { cb(); } catch (e) {} });
}

// Admin data: only through the wallet Edge Function, which re-checks admin_users on the server.
async function adminCall(route, body = {}) {
  const { data, error } = await sb.functions.invoke('wallet/' + route, { body });
  if (error) {
    let code = '', info = null;
    try { info = await error.context.json(); code = info.error || ''; } catch (e) {}
    // No JSON body: say why (blocked request / CORS, or the HTTP status) instead of a generic error.
    if (!code) code = error.name === 'FunctionsFetchError' ? 'network_or_cors' : (error.context && error.context.status ? 'http_' + error.context.status : (error.name || 'admin_unavailable'));
    throw Object.assign(new Error(code), { code, info, route });
  }
  return data;
}

async function isAuthorized(user) {
  const mail = (user?.email || '').trim().toLowerCase();
  if (!mail) return false;

  const { data, error } = await sb
    .from('admin_users')
    .select('email')
    .eq('email', mail)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

// Avoid the initial (empty) session check racing with setSession after an iOS callback.
let completingNativeLogin = false;
async function refreshAccess(force = false) {
  if (completingNativeLogin && !force) return;
  const { data: { session } } = await sb.auth.getSession();
  if (completingNativeLogin && !force) return;
  if (!session?.user) {
    showLogin();
    return;
  }
  const authorized = await isAuthorized(session.user);
  if (completingNativeLogin && !force) return;
  if (authorized) showApp();
  else showDenied();
}

// On the public website, retain the existing magic-link login.
// On iOS, verify an e-mail OTP inside this same WebView: no Safari callback,
// URL scheme, or cross-page sessionStorage handoff is required.
async function sendAdminCode(mail) {
  const { error } = await sb.auth.signInWithOtp({
    email: mail,
    options: {
      emailRedirectTo: nativeAdmin ? ADMIN_CALLBACK_URL : window.location.origin + '/admin.html',
      shouldCreateUser: true,
    },
  });
  return error;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const mail = email.value.trim().toLowerCase();
  if (!ALLOWED.has(mail)) {
    setAuthMessage('Cette adresse n’est pas autorisée.', true);
    return;
  }
  if (nativeAdmin && nativeOtpEmail) {
    const token = otpCode.value.trim();
    if (!isSixDigitCode(token)) {
      setAuthMessage('Saisissez les 6 chiffres figurant dans votre e-mail.', true);
      otpCode.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Vérification…';
    completingNativeLogin = true;
    try {
      const { data, error } = await sb.auth.verifyOtp({ email: nativeOtpEmail, token, type: 'email' });
      if (error) {
        const expired = error.code === 'otp_expired';
        setAuthMessage(
          expired
            ? 'Code refusé par Supabase (OTP expiré ou invalide). Le code peut avoir été invalidé avant sa saisie. Demandez-en un nouveau et utilisez uniquement le dernier e-mail.'
            : 'Code incorrect ou expiré. Vérifiez les 6 chiffres du dernier e-mail reçu.',
          true,
        );
      } else if (!data?.session?.access_token) {
        setAuthMessage('Code reconnu, mais aucune session administrateur n’a été créée. Réessayez avec un nouveau code.', true);
      } else {
        // The admin client uses an isolated storageKey and all permissions are
        // still checked against admin_users before displaying the dashboard.
        await refreshAccess(true);
      }
    } catch {
      setAuthMessage('Impossible de vérifier le code. Vérifiez votre connexion et réessayez.', true);
    } finally {
      completingNativeLogin = false;
      submit.disabled = false;
      submit.textContent = 'Valider le code';
    }
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Envoi…';
  setAuthMessage('');
  try {
    const error = await sendAdminCode(mail);
    if (error) {
      setAuthMessage(linkErrorMessage(error), true);
    } else if (nativeAdmin) {
      showCodeEntry(mail);
    } else {
      setAuthMessage('Lien envoyé. Ouvrez l’e-mail reçu pour vous connecter.');
    }
  } catch {
    setAuthMessage('Service de connexion indisponible. Réessayez dans quelques instants.', true);
  } finally {
    submit.disabled = false;
    submit.textContent = nativeAdmin ? (nativeOtpEmail ? 'Valider le code' : 'Recevoir mon code') : 'Recevoir le lien de connexion';
  }
});

if (nativeAdmin) {
  otpChange.addEventListener('click', () => {
    resetCodeEntry();
    setAuthMessage('');
    email.focus();
  });
  otpResend.addEventListener('click', async () => {
    if (!nativeOtpEmail) return;
    otpResend.disabled = true;
    setAuthMessage('');
    try {
      const error = await sendAdminCode(nativeOtpEmail);
      if (error) setAuthMessage(linkErrorMessage(error), true);
      else {
        otpCode.value = '';
        setAuthMessage('Nouveau code envoyé. Utilisez le dernier e-mail reçu.');
        otpCode.focus();
      }
    } catch {
      setAuthMessage('Impossible de renvoyer le code. Réessayez plus tard.', true);
    } finally { otpResend.disabled = false; }
  });
}

// Supabase Auth errors on a sign-in link request, from its error code and status (never the raw message).
function linkErrorMessage(error) {
  const code = error.code || '', status = error.status || 0;
  const wait = /after (\d+) seconds?/i.exec(error.message || '');
  if (code === 'over_email_send_rate_limit' && wait) return `Un lien vient d’être envoyé à cette adresse. Patientez ${wait[1]} secondes avant d’en demander un autre.`;
  if (code === 'over_email_send_rate_limit') return 'Limite d’envoi d’e-mails atteinte. Utilisez le dernier lien reçu (vérifiez les spams) ou réessayez dans une heure.';
  if (status === 429 || code === 'over_request_rate_limit') return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (status >= 500) return 'Le service d’e-mail n’a pas pu envoyer le lien. Réessayez dans quelques minutes.';
  if (!status) return 'Service de connexion injoignable. Vérifiez votre connexion internet puis réessayez.';
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized') return 'Cette adresse ne peut pas recevoir de lien de connexion.';
  return 'Impossible d’envoyer le lien pour le moment.';
}

signout.addEventListener('click', async () => {
  await sb.auth.signOut({ scope: 'local' });
  showLogin();
});

sb.auth.onAuthStateChange(() => {
  setTimeout(refreshAccess, 0);
});

// Supabase returns to the iOS app using dpacards://auth/admin#access_token=….
// The merchant and admin sessions must stay separate (admin uses dpa-admin-auth).
// Handle both warm callbacks and cold starts, including the case where the app
// was showing the merchant screen when the mail link was clicked.
let lastAdminCallback = null;
async function handleNativeAdminLogin(url) {
  if (!isNativeIOS() || !url || url === lastAdminCallback) return;
  const callback = parseAdminAuthUrl(url);
  if (!callback) return;
  lastAdminCallback = url;
  if (callback.type === 'error') {
    showLogin('Lien de connexion invalide ou expiré. Demandez un nouveau lien.');
    return;
  }
  if (callback.type === 'missing_credentials') {
    showLogin('DPA Cards a bien reçu le lien, mais aucun jeton de connexion n’a été transmis. Vérifiez la configuration de l’e-mail Supabase et demandez un nouveau lien.');
    return;
  }
  completingNativeLogin = true;
  loading.style.display = 'block';
  form.style.display = 'none';
  app.style.display = 'none';
  root.style.display = 'flex';
  try {
    const result = callback.type === 'tokens'
      ? await sb.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken })
      : await sb.auth.exchangeCodeForSession(callback.code);
    if (result.error) throw result.error;
    // Server-side admin_users validation still decides whether this user is admin.
    await refreshAccess(true);
  } catch (e) {
    showLogin('DPA Cards a reçu le lien, mais n’a pas pu ouvrir la session administrateur. Demandez un nouveau lien et réessayez.');
  } finally {
    completingNativeLogin = false;
  }
}
if (isNativeIOS()) {
  const pending = takePendingAdminAuth();
  if (pending) handleNativeAdminLogin(pending);
  // If this page stays open while switching to Mail, process the callback here.
  if (!listenForAdminDeepLinks(handleNativeAdminLogin)) {
    // Do not silently leave the user on a working-looking but broken form.
    const previous = message.textContent;
    if (!previous) setAuthMessage('Réception des liens iPhone indisponible. Mettez DPA Cards à jour via TestFlight.', true);
  }
}

// Card designer: built on first use, once dc-runtime has loaded React.
const designerApi = {
  load: target => adminCall('admin-card-designer', target),
  // Images go straight to Storage through a signed upload URL issued after the admin check.
  async upload(programId, kind, blob) {
    const r = await adminCall('admin-card-upload', { program_id: programId, kind, type: blob.type });
    const { error } = await sb.storage.from('program-assets').uploadToSignedUrl(r.path, r.token, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (error) throw Object.assign(new Error('upload_failed'), { code: 'upload_failed' });
    return { path: r.path, url: r.url };
  },
  save: (programId, requestId, config) => adminCall('admin-card-save', { program_id: programId, design_request_id: requestId, config }),
  validate: (programId, requestId, config) => adminCall('admin-card-validate', { program_id: programId, design_request_id: requestId, config }),
  googleSync: programId => adminCall('admin-card-google-sync', { program_id: programId }),
  // "Ajouter un client": the server creates the login (no password), the shop and its program.
  createMerchant: payload => adminCall('admin-merchant-create', payload),
  sendAccess: merchantId => adminCall('admin-merchant-access', { merchant_id: merchantId }),
  // Test cards: same designer, no merchant (test_card_designs, images under program-assets/tests/<id>/).
  testList: () => adminCall('admin-test-cards'),
  testGet: id => adminCall('admin-test-card-get', { id }),
  testSave: (id, name, config) => adminCall('admin-test-card-save', { id: id || undefined, name, config }),
  async testUpload(id, kind, blob) {
    const r = await adminCall('admin-test-card-upload', { id, kind, type: blob.type });
    const { error } = await sb.storage.from('program-assets').uploadToSignedUrl(r.path, r.token, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (error) throw Object.assign(new Error('upload_failed'), { code: 'upload_failed' });
    return { path: r.path, url: r.url };
  },
  testDuplicate: id => adminCall('admin-test-card-duplicate', { id }),
  testDelete: id => adminCall('admin-test-card-delete', { id }),
  testNewQr: id => adminCall('admin-test-card-new-qr', { id }),
  testWallet: id => adminCall('admin-test-card-wallet', { id }),
  testApple: id => adminCall('admin-test-card-apple', { id }),
};
let designer = null;
// Sales tracking (director only: every route re-checks admin_users.role = 'director' on the server).
const salesApi = {
  sales: range => adminCall('admin-sales', range || {}),
  attribute: (merchantId, repId, reason) => adminCall('admin-sales-attribute', { merchant_id: merchantId, sales_rep_id: repId, reason }),
  rule: rule => adminCall('admin-sales-rule', rule),
  validate: ids => adminCall('admin-sales-validate', { ids }),
  cancel: (id, reason) => adminCall('admin-sales-cancel', { id, reason }),
  payout: payload => adminCall('admin-sales-payout', payload),
};
let sales = null;

refreshAccess();
window.__dpaAdminResolve({
  designer: () => designer || (designer = makeCardDesigner(window.React, designerApi)),
  sales: () => sales || (sales = makeSales(window.React, salesApi)),
  supabase: sb,
  onAccess(cb) { accessListeners.push(cb); if (app.style.display === 'block') cb(); },
  overview: () => adminCall('admin-overview'),
  merchant: id => adminCall('admin-merchant', { merchant_id: id }),
  manualAccess: (merchantId,enabled,days,reason) => adminCall('admin-manual-access', { merchant_id: merchantId, enabled, days, reason }),
  designs: () => adminCall('admin-designs'),
  setDesignStatus: (id, status) => adminCall('admin-design-status', { id, status }),
});
