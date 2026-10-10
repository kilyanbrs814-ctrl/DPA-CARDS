import { createClient } from '@supabase/supabase-js';
import { makeCardDesigner } from './card-designer.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Only decides who may request a sign-in link (so no Auth user is created for other e-mails).
// Admin access itself is granted by admin_users alone, checked again by the Edge Function.
const ALLOWED = new Set([
  'kilyan.brs814@gmail.com',
  'mael.81400@icloud.com',
  'contact@digitalprojectagency.fr',
]);

// Own storage key: the merchant app (same origin) keeps its session under the default key, and
// its sign-in, sign-out and "Se souvenir de moi" (sessionStorage) must not replace or drop this one.
const sb = createClient(URL_, KEY, {
  auth: {
    storageKey: 'dpa-admin-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const root = document.getElementById('admin-auth-root');
const loading = document.getElementById('admin-auth-loading');
const form = document.getElementById('admin-auth-form');
const email = document.getElementById('admin-email');
const submit = document.getElementById('admin-submit');
const message = document.getElementById('admin-auth-message');
const denied = document.getElementById('admin-denied');
const signout = document.getElementById('admin-signout');
const app = document.getElementById('admin-app');

function showLogin(msg = '') {
  loading.style.display = 'none';
  denied.style.display = 'none';
  form.style.display = 'flex';
  app.style.display = 'none';
  root.style.display = 'flex';
  message.textContent = msg;
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

async function refreshAccess() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    showLogin();
    return;
  }

  if (await isAuthorized(session.user)) showApp();
  else showDenied();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mail = email.value.trim().toLowerCase();

  if (!ALLOWED.has(mail)) {
    message.textContent = 'Cette adresse n’est pas autorisée.';
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Envoi…';
  message.textContent = '';

  const { error } = await sb.auth.signInWithOtp({
    email: mail,
    options: {
      emailRedirectTo: window.location.origin + '/admin.html',
      shouldCreateUser: true,
    },
  });

  submit.disabled = false;
  submit.textContent = 'Recevoir le lien de connexion';

  message.textContent = error
    ? linkErrorMessage(error)
    : 'Lien envoyé. Ouvrez l’e-mail reçu pour vous connecter.';
});

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
};
let designer = null;

refreshAccess();
window.__dpaAdminResolve({
  designer: () => designer || (designer = makeCardDesigner(window.React, designerApi)),
  supabase: sb,
  onAccess(cb) { accessListeners.push(cb); if (app.style.display === 'block') cb(); },
  overview: () => adminCall('admin-overview'),
  merchant: id => adminCall('admin-merchant', { merchant_id: id }),
  designs: () => adminCall('admin-designs'),
  setDesignStatus: (id, status) => adminCall('admin-design-status', { id, status }),
});
