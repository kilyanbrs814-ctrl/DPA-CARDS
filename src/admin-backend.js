import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ALLOWED = new Set([
  'kilyan.brs814@gmail.com',
  'mael.81400@icloud.com',
]);

const sb = createClient(URL_, KEY, {
  auth: {
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
    let code = '';
    try { code = (await error.context.json()).error || ''; } catch (e) {}
    throw Object.assign(new Error(code || 'admin_unavailable'), { code });
  }
  return data;
}

async function isAuthorized(user) {
  const mail = (user?.email || '').trim().toLowerCase();
  if (!mail || !ALLOWED.has(mail)) return false;

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
    ? 'Impossible d’envoyer le lien pour le moment.'
    : 'Lien envoyé. Ouvrez l’e-mail reçu pour vous connecter.';
});

signout.addEventListener('click', async () => {
  await sb.auth.signOut({ scope: 'local' });
  showLogin();
});

sb.auth.onAuthStateChange(() => {
  setTimeout(refreshAccess, 0);
});

refreshAccess();
window.__dpaAdminResolve({
  supabase: sb,
  onAccess(cb) { accessListeners.push(cb); if (app.style.display === 'block') cb(); },
  overview: () => adminCall('admin-overview'),
  merchant: id => adminCall('admin-merchant', { merchant_id: id }),
  designs: () => adminCall('admin-designs'),
  setDesignStatus: (id, status) => adminCall('admin-design-status', { id, status }),
});
