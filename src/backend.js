// Supabase access for the DPA Cards logic script.
//
// The <x-dc> document is compiled at runtime by dc-runtime and cannot import
// npm modules, so this module (bundled by Vite) builds the client and hands a
// small API to the page through the `window.dpaReady` promise declared in
// index.html. Only the project URL and the publishable key are used here.

import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { makeCropper } from './cropper.js';
import { makeCardDesigner, prepareDesign } from './card-designer.js';
import { LEGAL } from './legal-config.js';
import { scanDevice, canUseCamera, cameraPermission, decodeKeys, parseCode, qrPath, requestCamera, cameraErrorKind, makeCameraView } from './scanner.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REMEMBER = 'dpa.remember';

// Read the auth redirect before supabase-js consumes and clears the hash.
const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
const query = new URLSearchParams(window.location.search || '');
let recoveryPending = hash.get('type') === 'recovery';
const linkError = hash.get('error_description') || query.get('error_description') || null;
const linkErrorCode = hash.get('error_code') || query.get('error_code') || null;
if (linkError) {
  try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
}

function wantsRemember() {
  try { return localStorage.getItem(REMEMBER) !== '0'; } catch (e) { return true; }
}

// "Se souvenir de moi": the session lives in localStorage, otherwise only for
// this tab in sessionStorage.
const storage = {
  getItem(k) {
    try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; }
  },
  setItem(k, v) {
    try {
      if (wantsRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch (e) {}
  },
  removeItem(k) {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {}
  },
};

const configured = !!(URL_ && KEY);
const sb = configured
  ? createClient(URL_, KEY, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
  : null;

const redirectTo = () => window.location.origin + '/';

// ---------------------------------------------------------------- dates

const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------------------------------------------------------------- errors

function isNetwork(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  return (e && e.name === 'AuthRetryableFetchError')
    || /Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(m);
}

const DB_ERRORS = {
  reward_not_available: 'Le solde ne permet pas encore d’utiliser la récompense.',
  already_corrected: 'Cette opération a déjà été corrigée.',
  correction_invalid: 'Cette opération ne peut pas être corrigée.',
  balance_negative: 'Correction impossible : le solde deviendrait négatif.',
  card_not_found: 'Carte introuvable dans votre commerce.',
  card_not_joined: 'Cette carte n’est pas encore activée.',
  forbidden: 'Action non autorisée pour ce compte.',
  not_authenticated: 'Votre session a expiré. Reconnectez-vous.',
  consent_required: 'Le consentement du client est requis.',
  no_program: 'Créez d’abord votre programme de fidélité.',
  request_conflict: 'Requête en conflit. Réessayez.',
  wallet_not_configured: 'Google Wallet n’est pas encore configuré sur le serveur.',
  design_pending: 'Le design de votre carte est en cours de création par DPA Cards. L’ajout à Google Wallet sera disponible une fois le design validé.',
  design_locked: 'Le design de la carte est validé. Pour le modifier, contactez DPA Cards.',
  design_changed: 'Le design a été modifié pendant la validation. Vérifiez l’aperçu puis validez à nouveau.',
  invalid_code: 'Numéro de carte invalide.',
  design_status_forbidden: 'Cette action n’est pas autorisée pour ce design.',
  missing_logo: 'Ajoutez le logo de votre commerce : il est obligatoire pour Google Wallet.',
  invalid_logo: 'Le logo doit être une image PNG carrée d’au moins 660 px. Importez-le à nouveau.',
  missing_hero: 'L’image de couverture est introuvable. Importez-la à nouveau ou retirez-la.',
  invalid_hero: 'L’image de couverture ne respecte pas le format attendu. Importez-la à nouveau.',
  invalid_color: 'La couleur de fond doit être au format #RRGGBB.',
  invalid_image_path: 'Emplacement d’image non autorisé.',
  invalid_file_path: 'Emplacement de fichier non autorisé.',
  'exceeded the maximum allowed size': 'Fichier trop volumineux.',
  'mime type': 'Format de fichier non accepté.',
  wallet_unavailable: 'Google Wallet ne répond pas pour le moment. Réessayez dans quelques instants.',
  program_not_found: 'Programme de fidélité introuvable.',
  rate_limited: 'Trop d’inscriptions en ce moment. Réessayez dans quelques minutes.',
  invalid_first: 'Indiquez votre prénom (80 caractères maximum).',
  invalid_email: "Cette adresse e-mail n'est pas valide.",
  empty_title: 'Indiquez un titre.',
  empty_body: 'Rédigez le texte du message.',
  no_recipients: 'Aucun client ne correspond à ces critères.',
  forbidden_card: 'Un des clients sélectionnés n’appartient pas à votre commerce.',
  notification_not_found: 'Ce brouillon n’existe plus. Rechargez la page.',
  owner_only: 'Seul le propriétaire du commerce peut effectuer cette action.',
  confirmation_required: 'Saisissez SUPPRIMER pour confirmer.',
  account_delete_failed: 'La suppression du compte n’a pas pu être terminée. Réessayez ou contactez DPA Cards.',
  billing_not_configured: 'Le paiement n’est pas encore disponible. Réessayez plus tard.',
  billing_unavailable: 'Le service de paiement ne répond pas. Réessayez dans un instant.',
  already_subscribed: 'Votre abonnement est déjà actif.',
  payment_issue: 'Un paiement est en attente sur votre abonnement : régularisez-le depuis « Gérer mon abonnement ».',
  onboarding_incomplete: 'Terminez d’abord la configuration de votre programme.',
  invalid_plan: 'Offre inconnue.',
  invalid_session: 'Session de paiement invalide.',
  payment_method_missing: 'Le moyen de paiement n’a pas pu être enregistré. Réessayez.',
  subscription_required: 'Un abonnement actif est nécessaire pour utiliser cette fonction.',
  no_subscription: 'Aucun abonnement en cours.',
  no_merchant: 'Aucun commerce associé à ce compte.',
  design_request_not_found: 'Aucune demande de design en attente.',
  design_already_paid: 'Cette demande de design est déjà payée.',
  design_not_cancellable: 'Cette demande de design est déjà payée : elle ne peut plus être annulée.',
  program_unavailable: 'Les inscriptions à ce programme ne sont pas encore ouvertes.',
};

function errorMessage(e) {
  if (isNetwork(e)) return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
  const m = String((e && e.message) || '');
  for (const k in DB_ERRORS) if (m.includes(k)) return DB_ERRORS[k];
  if (e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT/i.test(m))) return DB_ERRORS.not_authenticated;
  if (e && e.code === '23514') return 'Certaines valeurs ne sont pas acceptées. Vérifiez le formulaire.';
  if (e && e.code === '42501') return DB_ERRORS.forbidden;
  return 'Une erreur est survenue. Réessayez.';
}

// Supabase Auth error → { field: message } for the existing form fields.
function authErrors(e, ctx) {
  const code = (e && e.code) || '';
  const m = String((e && e.message) || '');
  const field = { login: 'loginPwd', signup: 'suEmail', forgot: 'fpEmail', reset: 'pwdNew', security: 'pwdNew', profile: 'sdemail' }[ctx] || 'loginPwd';
  if (isNetwork(e)) return { [field]: 'Connexion impossible. Vérifiez votre réseau puis réessayez.' };
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(m))
    return ctx === 'security' ? { pwdCur: 'Mot de passe actuel incorrect.' } : { loginPwd: 'Adresse e-mail ou mot de passe incorrect.' };
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(m))
    return { loginEmail: 'Adresse e-mail non confirmée. Ouvrez le lien reçu par e-mail pour activer votre compte.' };
  if (code === 'user_already_exists' || /already registered/i.test(m))
    return { suEmail: 'Un compte existe déjà avec cette adresse.' };
  if (code === 'weak_password' || /password/i.test(m) && /weak|short|characters/i.test(m))
    return { [ctx === 'signup' ? 'suPwd' : 'pwdNew']: 'Mot de passe trop faible. Choisissez-en un plus long ou plus varié.' };
  if (code === 'same_password') return { pwdNew: 'Le nouveau mot de passe doit être différent de l’actuel.' };
  if (code === 'email_address_invalid' || code === 'validation_failed')
    return { [field === 'loginPwd' ? 'loginEmail' : field]: "Cette adresse e-mail n'est pas acceptée." };
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || (e && e.status === 429))
    return { [field]: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' };
  if (code === 'signup_disabled') return { suEmail: 'Les inscriptions sont fermées pour le moment.' };
  if (/sending.*email|email.*send/i.test(m))
    return { [field]: 'L’e-mail n’a pas pu être envoyé. Réessayez plus tard.' };
  return { [field]: 'Une erreur est survenue. Réessayez.' };
}

// ---------------------------------------------------------------- mapping

function toMerchant(m, email) {
  return {
    id: m.id, first: m.first_name, last: m.last_name, email: email || '', phone: m.phone,
    business: m.business_name, activity: m.activity, address: m.address, slug: m.slug,
  };
}

let cardKitInstance = null;
const assetUrl = path => path
  ? `${URL_}/storage/v1/object/public/program-assets/${path.split('/').map(encodeURIComponent).join('/')}`
  : null;

function toProgram(p) {
  return {
    id: p.id, merchantId: p.merchant_id, name: p.name, mode: p.mode, goal: p.goal, reward: p.reward, bg: p.bg, accent: p.accent,
    pattern: p.pattern, logo: p.logo, conditions: p.conditions,
    designStatus: p.design_status || 'validated', designMode: p.design_mode || null,
    logoPath: p.logo_path || null, heroPath: p.hero_path || null, logoUrl: assetUrl(p.logo_path), heroUrl: assetUrl(p.hero_path),
    // Design validated in the admin card designer (layout, colours, images, stamps); null = classic card.
    cardDesign: p.card_design && typeof p.card_design === 'object' ? p.card_design : null,
  };
}
function toRequest(r) {
  return r && { id: r.id, status: r.status, createdAt: r.created_at, description: r.description, colors: r.colors,
    paymentStatus: r.payment_status || 'unpaid', paidAt: r.paid_at || null, deliveredAt: r.delivered_at || null,
    contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone, files: (r.reference_paths || []).length + (r.logo_path ? 1 : 0) };
}

function histEntry(e) {
  const label = e.type === 'visit' ? (e.delta === 1 ? 'Passage ajouté' : e.delta + ' points ajoutés')
    : e.type === 'reward' ? 'Récompense utilisée · ' + (e.reward_label || '')
    : e.type === 'correction' ? 'Correction · ' + e.motif
    : 'Inscription au programme';
  const h = { id: e.id, type: e.type, date: ymd(e.created_at), time: hm(e.created_at), delta: e.delta, label, seq: e.seq };
  if (e.note) h.note = e.note;
  return h;
}

function toClient(card, cust, evs) {
  const sorted = [...evs].sort((a, b) => b.seq - a.seq);
  const corrected = new Set(sorted.filter(e => e.corrects_event_id).map(e => e.corrects_event_id));
  const history = sorted.map(e => ({ ...histEntry(e), ...(corrected.has(e.id) ? { corrected: true } : {}) }));
  return {
    id: card.id, customerId: cust.id, first: cust.first_name, last: cust.last_name, card: card.card_number,
    joined: ymd(card.created_at), balance: sorted.length ? sorted[0].balance_after : 0, history, wallet: null,
    qrValue: card.qr_token ? 'DPA1:' + card.qr_token : null,
  };
}

// Fold a ledger row returned by an RPC into a client; replays are no-ops.
function applyEvent(c, e) {
  if (c.history.some(h => h.id === e.id)) return c;
  const history = c.history.map(h => (h.id === e.corrects_event_id ? { ...h, corrected: true } : h));
  return { ...c, balance: e.balance_after, history: [histEntry(e), ...history] };
}

// ---------------------------------------------------------------- data

async function fetchAll(table, columns, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order(order, { ascending: false }).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function loadAll(user) {
  const { data: mem, error } = await sb.from('merchant_members')
    .select('role, merchants(*)').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!mem || !mem.merchants) return { merchant: null };
  const merchant = toMerchant(mem.merchants, user.email);

  const { data: prog, error: pe } = await sb.from('programs').select('*')
    .eq('merchant_id', merchant.id).eq('is_active', true).maybeSingle();
  if (pe) throw pe;

  const [customers, cards, events, passes, notifications] = await Promise.all([
    fetchAll('customers', 'id, first_name, last_name', 'created_at'),
    fetchAll('cards', 'id, customer_id, program_id, card_number, qr_token, created_at', 'created_at'),
    fetchAll('card_events', 'id, card_id, seq, type, delta, balance_after, corrects_event_id, motif, note, reward_label, created_at', 'created_at'),
    fetchAll('wallet_passes', 'card_id, created_at', 'created_at'),
    loadNotifications(),
  ]);
  const google = new Set(passes.map(p => p.card_id));
  const byCust = new Map(customers.map(c => [c.id, c]));
  const byCard = new Map();
  for (const e of events) { if (!byCard.has(e.card_id)) byCard.set(e.card_id, []); byCard.get(e.card_id).push(e); }
  const clients = cards
    .filter(k => prog && k.program_id === prog.id && byCust.has(k.customer_id))
    .map(k => ({ ...toClient(k, byCust.get(k.customer_id), byCard.get(k.id) || []), wallet: google.has(k.id) ? 'google' : null }));
  const { data: req } = await sb.from('design_requests').select('*').eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { data: subscription, error: se } = await sb.from('subscriptions').select('*').eq('merchant_id', merchant.id).maybeSingle();
  if (se) throw se;
  return { merchant, program: prog ? toProgram(prog) : null, clients, role: mem.role, designRequest: toRequest(req), notifications, subscription: subscription || null };
}

// ---------------------------------------------------------------- notifications (Google Wallet)

const SEGMENTS = ['reward', 'near', 'inactive'];
// Row of public.notifications → the shape the Notifications screen already uses.
function toNotif(r) {
  const at = r.sent_at || r.created_at;
  return {
    id: r.id, status: r.status, type: r.kind, title: r.title, body: r.body,
    audience: SEGMENTS.includes(r.audience) ? 'segment' : r.audience, segment: SEGMENTS.includes(r.audience) ? r.audience : 'reward',
    ids: r.card_ids || [], platform: 'google', gNotify: r.notify, date: ymd(at), time: hm(at), error: r.error || null,
    apple: 0, google: r.sent_count, gIds: [],
    live: { targeted: r.targeted, sent: r.sent_count, failed: r.failed_count, quota: r.quota_count, noWallet: r.no_wallet_count },
  };
}
async function loadNotifications() {
  const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data || []).map(toNotif);
}
const notifRow = nf => ({
  title: nf.title.trim(), body: (nf.body || '').trim(), kind: nf.type,
  audience: nf.audience === 'segment' ? nf.segment : nf.audience,
  card_ids: nf.audience === 'selected' ? nf.ids : [], notify: nf.gNotify !== false,
});

// Edge Function call; the server's error code becomes the Error message (mapped by errorMessage).
async function invokeFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let info = {};
    try { info = (await error.context.json()) || {}; } catch (e) {}
    const code = info.error || '';
    throw Object.assign(new Error(code || error.message || 'wallet_unavailable'), { code, info });
  }
  return data;
}

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

const api = {
  configured,
  get recoveryPending() { return recoveryPending; },
  clearRecovery() { recoveryPending = false; },
  linkError: linkError ? { message: linkError, code: linkErrorCode } : null,
  uuid: () => crypto.randomUUID(),
  isNetwork, errorMessage, authErrors, toClient, applyEvent, toMerchant, toProgram, toRequest, assetUrl,

  setRemember(on) { try { localStorage.setItem(REMEMBER, on ? '1' : '0'); } catch (e) {} },
  remember: wantsRemember,

  onAuth(cb) { return sb.auth.onAuthStateChange(cb).data.subscription; },
  async session() { const { data } = await sb.auth.getSession(); return data.session; },
  signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
  signUp({ email, password, first, last, business }) {
    return sb.auth.signUp({
      email, password,
      // Only used to prefill onboarding. Never read for permissions.
      options: { emailRedirectTo: redirectTo(), data: { first_name: first, last_name: last, business_name: business } },
    });
  },
  resendSignup(email) { return sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } }); },
  forgot(email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() }); },
  updatePassword(password) { return sb.auth.updateUser({ password }); },
  updateEmail(email) { return sb.auth.updateUser({ email }, { emailRedirectTo: redirectTo() }); },
  signOut() { return sb.auth.signOut({ scope: 'local' }); },

  loadAll,
  async createMerchant({ business, first, last, activity, slug, program }) {
    const r = await rpc('create_merchant', {
      p_business: business, p_first: first, p_last: last, p_activity: activity, p_slug: slug, p_program: program,
    });
    return { merchant: r.merchant, program: toProgram(r.program) };
  },
  // ---- card design (initial creation only; the server locks it once validated)
  Cropper: makeCropper(window.React),
  // Cards drawn from programs.card_design (Apple / Google layouts). Customer data is passed per card.
  cardKit() { return cardKitInstance || (cardKitInstance = makeCardDesigner(window.React, null)); },
  prepareCardDesign(program, business, activity) {
    return program && program.cardDesign ? prepareDesign(program.cardDesign, { bg: program.bg, accent: program.accent, mode: program.mode, goal: program.goal, reward: program.reward,
      logo_path: program.logoPath, hero_path: program.heroPath }, { business_name: business, activity }, assetUrl) : null;
  },
  async saveRules(programId, { mode, goal, reward }) {
    const { data, error } = await sb.from('programs').update({ mode, goal: +goal, reward: reward.trim() }).eq('id', programId).select().single();
    if (error) throw error;
    return toProgram(data);
  },
  async saveDraft(programId, patch) {
    const row = {};
    if ('name' in patch) row.name = patch.name;
    if ('bg' in patch) row.bg = patch.bg;
    const { data, error } = await sb.from('programs').update(row).eq('id', programId).select().single();
    if (error) throw error;
    return toProgram(data);
  },
  // Upload a cropped image, point the draft at it, then delete the file it replaces.
  async setDesignImage(program, kind, blob) {
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${program.merchantId}/${program.id}/${kind}-${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from('program-assets').upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
    if (up.error) throw up.error;
    const col = kind === 'logo' ? 'logo_path' : 'hero_path';
    const old = kind === 'logo' ? program.logoPath : program.heroPath;
    const { data, error } = await sb.from('programs').update({ [col]: path }).eq('id', program.id).select().single();
    if (error) { await sb.storage.from('program-assets').remove([path]); throw error; }
    if (old) await sb.storage.from('program-assets').remove([old]);
    return toProgram(data);
  },
  async removeDesignImage(program, kind) {
    const col = kind === 'logo' ? 'logo_path' : 'hero_path';
    const old = kind === 'logo' ? program.logoPath : program.heroPath;
    const { data, error } = await sb.from('programs').update({ [col]: null }).eq('id', program.id).select().single();
    if (error) throw error;
    if (old) await sb.storage.from('program-assets').remove([old]);
    return toProgram(data);
  },
  async finalizeDesign() {
    const { data, error } = await sb.functions.invoke('wallet/finalize-design', { body: {} });
    if (error) {
      let code = '';
      try { code = (await error.context.json()).error || ''; } catch (e) {}
      throw Object.assign(new Error(code || error.message || 'wallet_unavailable'), { code });
    }
    return data;
  },
  // Files first (same names on retry: an "already exists" answer is fine), then one RPC call.
  async submitDesignRequest(merchantId, requestId, { logo, refs, colors, description, contactName, contactEmail, contactPhone }) {
    const put = async (file, name) => {
      const ext = (file.name.match(/\.(png|jpe?g|webp|pdf)$/i) || ['', file.type === 'application/pdf' ? 'pdf' : 'png'])[1].toLowerCase();
      const path = `${merchantId}/${requestId}/${name}.${ext}`;
      const r = await sb.storage.from('design-requests').upload(path, file, { contentType: file.type, upsert: false });
      if (r.error && !/exists|Duplicate/i.test(r.error.message)) throw r.error;
      return path;
    };
    const logoPath = logo ? await put(logo, 'logo') : null;
    const refPaths = [];
    for (let i = 0; i < refs.length; i++) refPaths.push(await put(refs[i], 'reference-' + (i + 1)));
    const r = await rpc('submit_design_request', {
      p_request_id: requestId, p_logo_path: logoPath, p_reference_paths: refPaths, p_colors: colors || null,
      p_description: description, p_contact_name: contactName, p_contact_email: contactEmail || null, p_contact_phone: contactPhone || null,
    });
    return toRequest(r);
  },
  // ---- scanner: QR (USB reader or camera) and keyboard share one server lookup.
  scanner: { device: scanDevice(), canUseCamera, cameraPermission, decodeKeys, parseCode, qrPath, requestCamera, cameraErrorKind, CameraView: makeCameraView(window.React) },
  // RLS + explicit merchant filter on the server: another business's card is simply not found.
  async lookupCard(code) {
    const data = await rpc('lookup_card', { p_code: code });
    return (data || []).map(r => r.card_id);
  },
  // One card with its customer and history (a card enrolled on another device since the last load).
  async loadClient(cardId) {
    const { data: k, error } = await sb.from('cards')
      .select('id, customer_id, program_id, card_number, qr_token, created_at, customers(id, first_name, last_name)').eq('id', cardId).maybeSingle();
    if (error) throw error;
    if (!k) return null;
    const { data: evs, error: e2 } = await sb.from('card_events')
      .select('id, card_id, seq, type, delta, balance_after, corrects_event_id, motif, note, reward_label, created_at').eq('card_id', cardId);
    if (e2) throw e2;
    return toClient(k, k.customers, evs || []);
  },
  async enroll(requestId, first, email) {
    const r = await rpc('enroll_customer', {
      p_request_id: requestId, p_first: first, p_last: '', p_email: email || null, p_consent: true,
    });
    return toClient(r.card, r.customer, [r.event]);
  },
  addVisit: (cardId, requestId) => rpc('add_visit', { p_card_id: cardId, p_request_id: requestId }),
  redeem: (cardId, requestId) => rpc('redeem_reward', { p_card_id: cardId, p_request_id: requestId }),
  correct: (eventId, motif, note, requestId) =>
    rpc('correct_event', { p_event_id: eventId, p_motif: motif, p_note: note || null, p_request_id: requestId }),
  async saveProgram(id, p) {
    const { data, error } = await sb.from('programs').update({
      name: p.name.trim(), mode: p.mode, goal: +p.goal, reward: p.reward.trim(), conditions: (p.conditions || '').trim(),
      bg: p.bg, accent: p.accent, pattern: p.pattern, logo: (p.logo || '').slice(0, 4).toUpperCase(),
    }).eq('id', id).select().single();
    if (error) throw error;
    return toProgram(data);
  },
  // Signed « Ajouter à Google Wallet » link for one card. The server derives the
  // merchant, balance and Google ids itself; only the card id is sent.
  async walletLink(cardId) {
    const { data, error } = await sb.functions.invoke('wallet/save-link', { body: { card_id: cardId } });
    if (error) {
      let code = '';
      try { code = (await error.context.json()).error || ''; } catch (e) {}
      throw Object.assign(new Error(code || error.message || 'wallet_unavailable'), { code });
    }
    const qr = await QRCode.toDataURL(data.url, { margin: 1, width: 232, errorCorrectionLevel: 'L' });
    return { url: data.url, qr, sync: data.sync };
  },
  // ---- public sign-up page /join/<slug> (no session). Only the slug is sent; the
  // Edge Function resolves merchant and program and returns public fields only.
  async publicProgram(slug) {
    const { data, error } = await sb.functions.invoke('wallet/public-program', { body: { slug } });
    if (error) {
      if (error.context && error.context.status === 404) return null;
      // The shop exists but has no valid subscription: sign-ups are closed for now.
      if (error.context && error.context.status === 403) return { unavailable: true };
      throw Object.assign(new Error(error.message || 'wallet_unavailable'), { name: error.name });
    }
    return { slug: data.slug, business: data.business, program: toProgram({ ...data.program, id: null, merchant_id: null }) };
  },
  async publicJoin(slug, requestId, first, email) {
    const { data, error } = await sb.functions.invoke('wallet/join', {
      body: { slug, request_id: requestId, first, email: email || '', consent: true },
    });
    if (error) {
      let code = '';
      try { code = (await error.context.json()).error || ''; } catch (e) {}
      throw Object.assign(new Error(code || error.message || 'wallet_unavailable'), { code, name: code ? 'Error' : error.name });
    }
    return { first: data.first, cardNumber: data.card_number, qrValue: data.qr_value, wallet: data.wallet || {} };
  },
  // ---- personal data. Deletions go through the Edge Function (owner session, merchant and
  // customer derived on the server); the export reads with the merchant's own session (RLS).
  async deleteCustomer(cardId) { return invokeFn('wallet/delete-customer', { card_id: cardId }); },
  async deleteAccount(confirm) { return invokeFn('wallet/delete-account', { confirm }); },
  async exportData() {
    const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
    const [{ data: merchant, error: me }, { data: programs, error: pe }] = await Promise.all([
      sb.from('merchants').select('business_name, first_name, last_name, activity, phone, address, slug, created_at').maybeSingle(),
      sb.from('programs').select('name, mode, goal, reward, conditions, bg, accent, pattern, logo, design_status, is_active, created_at'),
    ]);
    if (me) throw me; if (pe) throw pe;
    const [customers, cards, events, notifications] = await Promise.all([
      fetchAll('customers', 'id, first_name, last_name, email, consent_at, created_at', 'created_at'),
      fetchAll('cards', 'id, customer_id, card_number, created_at', 'created_at'),
      fetchAll('card_events', 'card_id, seq, type, delta, balance_after, motif, note, reward_label, created_at', 'created_at'),
      fetchAll('notifications', 'title, body, audience, notify, status, targeted, sent_count, failed_count, quota_count, no_wallet_count, created_at, sent_at', 'created_at'),
    ]);
    const evByCard = new Map();
    for (const e of events) { if (!evByCard.has(e.card_id)) evByCard.set(e.card_id, []); evByCard.get(e.card_id).push(e); }
    const cardsByCust = new Map();
    for (const k of cards) { if (!cardsByCust.has(k.customer_id)) cardsByCust.set(k.customer_id, []); cardsByCust.get(k.customer_id).push(k); }
    return {
      format: 'dpa-cards-export-v1', exported_at: new Date().toISOString(),
      merchant, programs: programs || [],
      customers: customers.map(c => ({
        ...pick(c, ['first_name', 'last_name', 'email', 'consent_at', 'created_at']),
        cards: (cardsByCust.get(c.id) || []).map(k => {
          const hist = (evByCard.get(k.id) || []).sort((a, b) => a.seq - b.seq);
          return { card_number: k.card_number, created_at: k.created_at, balance: hist.length ? hist[hist.length - 1].balance_after : 0,
            history: hist.map(e => pick(e, ['type', 'delta', 'balance_after', 'motif', 'note', 'reward_label', 'created_at'])) };
        }),
      })),
      notifications,
    };
  },
  // ---- subscription (Stripe). The browser only names a plan; prices, trial and billing
  // dates are decided by the billing Edge Function, and Stripe stays the source of truth.
  billing: {
    checkout: plan => invokeFn('billing/checkout', { plan }),
    verify: sessionId => invokeFn('billing/verify', { session_id: sessionId }),
    summary: () => invokeFn('billing/summary', {}),
    portal: () => invokeFn('billing/portal', {}),
    cancel: () => invokeFn('billing/cancel', {}),
    // Custom design (29,90 € one-time): the server picks the price and the merchant's request.
    designCheckout: requestId => invokeFn('billing/design-checkout', requestId ? { design_request_id: requestId } : {}),
    designVerify: sessionId => invokeFn('billing/design-verify', { session_id: sessionId }),
    // Change of mind before paying: cancels the unpaid request only (refused once paid).
    designCancel: requestId => invokeFn('billing/design-cancel', { design_request_id: requestId }),
    async refresh(merchantId) {
      const { data, error } = await sb.from('subscriptions').select('*').eq('merchant_id', merchantId).maybeSingle();
      if (error) throw error;
      return data || null;
    },
  },
  cgvUrl: LEGAL.CGV_URL || null,
  // PNG of the shop's sign-up QR code, for printing.
  qrPng: text => QRCode.toDataURL(text, { margin: 2, width: 1024, errorCorrectionLevel: 'M' }),
  // ---- notifications: drafts are written with the merchant's session (RLS, drafts only);
  // sending goes through the Edge Function, which resolves the cards and Google objects itself.
  loadNotifications,
  async saveNotifDraft(merchantId, nf) {
    const row = notifRow(nf);
    const q = nf.id ? sb.from('notifications').update(row).eq('id', nf.id).eq('status', 'draft')
      : sb.from('notifications').insert({ ...row, merchant_id: merchantId });
    const { data, error } = await q.select().single();
    if (error) throw error;
    return toNotif(data);
  },
  async deleteNotification(id) {
    const { error } = await sb.from('notifications').delete().eq('id', id);
    if (error) throw error;
  },
  async sendNotification(nf, draftId) {
    const { data, error } = await sb.functions.invoke('wallet/notify', { body: { ...notifRow(nf), draft_id: draftId || undefined } });
    if (error) {
      let code = '';
      try { code = (await error.context.json()).error || ''; } catch (e) {}
      throw Object.assign(new Error(code || error.message || 'wallet_unavailable'), { code });
    }
    return data;
  },
  async saveMerchant(id, patch) {
    const { data, error } = await sb.from('merchants').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};

window.__dpaResolve(api);
