import { decodePng } from '../_shared/png.js';
import { libraryStampId, loadLibraryStamp } from '../_shared/stamp-library.js';
import { loadRewardStar } from '../_shared/reward-star.js';
// DPA Cards — Google Wallet Edge Function.
//
//   POST /wallet/save-link  merchant session → signed "Add to Google Wallet" link for one card
//   POST /wallet/finalize-design  owner session → checks the draft's images, locks the design,
//                                 creates the program's Wallet class from it
//   POST /wallet/sync       x-wallet-worker secret (pg_net / pg_cron) → push pending balances
//   GET  /wallet/logo.png   public program logo used by Google Wallet classes
//   POST /wallet/public-program  no session → public fields of the program behind /join/<slug>
//   POST /wallet/join       no session → public sign-up on /join/<slug>, then the card's save link
//   POST /wallet/notify     merchant session → Google Wallet message (addMessage) to the merchant's cards
//   POST /wallet/delete-customer  owner session → deletes one customer of the caller's merchant
//   POST /wallet/delete-account   owner session + "SUPPRIMER" → deletes the whole merchant and the login
//   POST /wallet/admin-overview   admin session → platform KPIs and the merchant list
//   POST /wallet/admin-merchant   admin session → one merchant's details
//   POST /wallet/admin-designs    admin session → paid custom design requests (signed file links)
//   POST /wallet/admin-design-status  admin session, { id, status } → in_progress / delivered
//   POST /wallet/admin-card-designer  admin session, { merchant_id | design_request_id } → design project
//   POST /wallet/admin-card-upload    admin session → signed upload URL for a designer image
//   POST /wallet/admin-card-save      admin session → saves the design draft (program untouched)
//   POST /wallet/admin-card-validate  admin session → applies the design to the program, then updates its Google Wallet class
//   POST /wallet/admin-card-google-sync  admin session → retries that Google Wallet class update
//   POST /wallet/admin-merchant-create  admin session → "Ajouter un client": login (no password), shop, program
//   POST /wallet/admin-merchant-access  admin session → sends that shop's owner the "choose your password" link
//   POST /wallet/admin-test-cards, -get, -save, -upload, -duplicate, -delete, -new-qr, -wallet
//   POST /wallet/admin-sales            director session, { from, to } → reps, payments, commissions, payouts, rules
//   POST /wallet/admin-sales-attribute  director session, { merchant_id, sales_rep_id | null, reason } → manual attribution
//   POST /wallet/admin-sales-rule       director session → creates a commission rule, or { disable: id }
//   POST /wallet/admin-sales-validate   director session, { ids } → à valider → à payer
//   POST /wallet/admin-sales-cancel     director session, { id, reason } → cancels an unpaid commission
//   POST /wallet/admin-sales-payout     director session → records a transfer already made ("Marquer comme payé")
//                                admin session → test cards (no merchant), QR DPA_TEST:, demo Google Wallet pass
//
// verify_jwt is off: the platform check does not understand every key type, so
// each route authorises itself. The browser only sends a card id; merchant,
// balance and Google ids are always derived on the server from Supabase.
// Secrets (service-account key) come from Edge Function secrets and are never logged.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { LOGO_PNG_BASE64 } from './logo.ts';
import { sendEmail, simpleMail } from '../_shared/email.ts';
import { decodePanelArt } from '../apple-pass/real-strip.js';
import { makeGoogleStampHero } from './google-strip.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ISSUER_ID = Deno.env.get('GOOGLE_WALLET_ISSUER_ID') ?? '';
const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const LOGO_URL = `${SUPABASE_URL}/functions/v1/wallet/logo.png`;
// Allow origins explicitly; keep this set in sync with the final custom domain.
const ALLOWED_ORIGINS = (Deno.env.get('WALLET_ALLOWED_ORIGINS') ?? 'https://cards.digitalprojectagency.fr,http://localhost:5173,http://localhost:5174')
  .split(',').map(s => s.trim()).filter(Boolean);
// Allow the new custom domain even if the production secret still contains an older origin.
if (!ALLOWED_ORIGINS.includes('https://cards.digitalprojectagency.fr')) ALLOWED_ORIGINS.push('https://cards.digitalprojectagency.fr');
// Capacitor iOS serves packaged resources with this non-HTTP origin.
// Server-side JWT checks and merchant RLS still apply to every wallet operation.
if (!ALLOWED_ORIGINS.includes('capacitor://localhost')) ALLOWED_ORIGINS.push('capacitor://localhost');

function envKey(jsonVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonVar) ?? '{}');
    if (keys.default) return keys.default;
  } catch { /* fall back to the legacy variable */ }
  return Deno.env.get(legacyVar) ?? '';
}
const PUBLISHABLE_KEY = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SECRET_KEY = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------- http helpers

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return ALLOWED_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' }
    : {};
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(req) } });

class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

// ---------------------------------------------------------------- Google auth

type ServiceAccount = { client_email: string; private_key: string };
let serviceAccount: ServiceAccount | null = null;
function sa(): ServiceAccount {
  if (!serviceAccount) {
    const raw = Deno.env.get('GOOGLE_WALLET_SA_B64');
    if (!raw || !ISSUER_ID) throw new HttpError(503, 'wallet_not_configured');
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0))));
    serviceAccount = { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  return serviceAccount;
}

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let signingKey: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  if (!signingKey) {
    const pem = sa().private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  return signingKey;
}
async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key(), new TextEncoder().encode(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}

let accessToken: { value: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && accessToken.exp - 120 > now) return accessToken.value;
  const assertion = await signJwt({
    iss: sa().client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google_auth_${r.status}`);
  accessToken = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return accessToken.value;
}

async function google(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  if (Deno.env.get('WALLET_SIMULATE_GOOGLE_OUTAGE') === '1') throw new Error('google_unavailable_simulated');
  const r = await fetch(WALLET_API + path, {
    method, headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: r.status, data };
}
const gErr = (what: string, r: { status: number; data: any }) =>
  new Error(`${what}_${r.status}${r.data?.error?.status ? '_' + r.data.error.status : ''}`);

// ---------------------------------------------------------------- Wallet model

const classIdFor = (programId: string) => `${ISSUER_ID}.dpa-prog-${programId}`;
const objectIdFor = (cardId: string) => `${ISSUER_ID}.dpa-card-${cardId}`;
const unitLabel = (mode: string) => (mode === 'points' ? 'Points' : 'Passages');

// Public HTTPS URL of a program image (bucket program-assets is public, write-protected per merchant).
const assetUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/program-assets/${path.split('/').map(encodeURIComponent).join('/')}`;

// HMAC-signed, read-only image URLs consumed by Google Wallet. No customer
// identities, QR tokens, private keys or URLs chosen by the browser are exposed.
let stampKeyPromise: Promise<CryptoKey> | null = null;
async function stampKey() {
  if (!stampKeyPromise) stampKeyPromise = crypto.subtle.importKey(
    'raw',new TextEncoder().encode(SECRET_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return stampKeyPromise;
}
async function stampSignature(id: string) {
  const raw = new Uint8Array(await crypto.subtle.sign('HMAC',await stampKey(),new TextEncoder().encode('dpa-wallet-stamp:'+id)));
  return Array.from(raw.slice(0,12), b=>b.toString(16).padStart(2,'0')).join('');
}
// Visible card number matches the administrator's digits-only preview.
// The QR payload and database identifier remain untouched.
const walletCardDigits = (value: unknown) =>
  String(value ?? '').replace(/\D/g, '') || String(value ?? '');
const walletCounter = (done: number, goal: number, mode: string) => {
  const current=Math.max(0,Math.floor(Number(done)||0));
  const left=Math.max(0,Math.floor(Number(goal)||0)-current);
  const isPoints=mode==='points';
  return {
    loyaltyPoints:{label:isPoints?'Points gagnés':'Passages effectués',balance:{int:current}},
    secondaryLoyaltyPoints:{label:isPoints?'Points restants':'Passages restants',balance:{int:left}}
  };
};
const hasSavedStampArt = (design: any) => !!(design?.stamps && typeof design.stamps === 'object');
// Retain the existing Google Wallet layout and signed stamp-board route.
const hasStampEmoji = (program: any) => program?.mode !== 'points' && hasSavedStampArt(program?.card_design);
async function stampBoardUrl(id: string, revision = 0, test = false) {
  const tag=(test?'test-':'')+id;
  return SUPABASE_URL+'/functions/v1/wallet/stamp-board/'+
    tag+'/'+await stampSignature(tag)+'.png?render=google-v2&v='+Number(revision || 0);
}
function googleEmojiText(emoji: string, progress: number, goal: number) {
  const count=Math.max(1,Math.min(20,Number(goal)||10)), done=Math.max(0,Math.min(count,Number(progress)||0));
  return Array(done).fill(emoji).join(' ') +
    (done<count?' · '+(count-done)+' restant(s)':'');
}
async function publicStampBoard(req: Request, path: string) {
  const match=path.match(/\/stamp-board\/(test-)?([0-9a-f-]{36})\/([0-9a-f]{24})\.png$/i);
  if(!match) return new Response('Not found',{status:404});
  const isTest=!!match[1],id=match[2],provided=match[3].toLowerCase();
  const expected=await stampSignature((isTest?'test-':'')+id);
  if(provided!==expected)return new Response('Not found',{status:404});
  let design: any=null, progress=0, goal=10, mode='passages', owner='';
  if(isTest){
    const {data,error}=await admin.from('test_card_designs').select('config,test_balance').eq('id',id).maybeSingle();
    if(error||!data||!data.config)return new Response('Not found',{status:404});
    design=data.config;progress=Number(data.test_balance)||0;
    goal=Number(design.preview?.goal)||10;mode=design.preview?.mode||'passages';
  }else{
    const {data,error}=await admin.from('cards')
      .select('id,merchant_id,program_id,programs(goal,mode,card_design)').eq('id',id).maybeSingle();
    if(error||!data)return new Response('Not found',{status:404});
    const prog=(data as any).programs;
    if(!prog||!hasStampEmoji(prog))return new Response('Not found',{status:404});
    design=prog.card_design;goal=prog.goal;mode=prog.mode;
    owner=(data as any).merchant_id+'/'+(data as any).program_id+'/designer';
    const now=await latest(id);
    progress=now.balance;
  }
  if(!hasSavedStampArt(design))return new Response('Not found',{status:404});
  const selectedLibrary=design.stamps?.icon==='library'?libraryStampId(design.stamps.libraryId):'';
  let icon=selectedLibrary?await loadLibraryStamp(selectedLibrary):null;
  if(selectedLibrary && !icon)return new Response('Image unavailable',{status:503});
  if(!icon && design.stamps?.icon==='custom'){
    const path=design.assets?.stamp?.path;
    const prefix=isTest?'tests/'+id+'/designer/':owner+'/';
    if(typeof path==='string'&&path.startsWith(prefix)&&/\/stamp-[0-9a-f-]{36}\.png$/i.test(path)){
      const {data}=await admin.storage.from('program-assets').download(path);
      if(data && data.size<=2097152)icon=await decodePng(new Uint8Array(await data.arrayBuffer()));
    }
  }
  const finalStar=await loadRewardStar();
  let panelArt=null;
  const artwork=design.assets?.googleStrip || (design.google?.reuseAppleStrip!==false ? design.assets?.appleStrip : null);
  const artPath=artwork?.path;
  const folder=isTest?'tests/'+id:owner.replace(/\/designer$/, '');
  // Resolve only images owned by this card's program/test; never arbitrary URLs.
  if(typeof artPath==='string' && designerPath(folder).test(artPath) && /\/(googleStrip|appleStrip)-[0-9a-f-]{36}\.(png|jpg)$/i.test(artPath)){
    const {data,error}=await admin.storage.from('program-assets').download(artPath);
    if(error || !data)return new Response('Image unavailable',{status:503});
    try { panelArt=await decodePanelArt(new Uint8Array(await data.arrayBuffer()), { maxBytes: 15728640 }); }
    catch { return new Response('Image unavailable',{status:503}); }
  }
  const png=await makeGoogleStampHero(design,progress,goal,mode,icon,finalStar,panelArt);
  return new Response(new Uint8Array(png),{
    status:200,headers:{'content-type':'image/png','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}
  });
}

// Branding of the program's class. Google Wallet has a fixed layout: only what its API supports is
// mapped — issuer and program names, logo, hero image, background colour and field labels. Stamps,
// free layout and the Apple version stay in the DPA Cards previews. Customer data (name, balance,
// card number, QR) lives on each card's object and is never touched here.
// Images: programs.logo_path / hero_path, which the designer only replaces with images that meet the
// Google rules (IMAGE_RULES); otherwise the previous image, or the generic DPA Cards logo, is kept.
function classBranding(program: any, businessName: string) {
  const text = (value: string) => ({ defaultValue: { language: 'fr-FR', value } });
  const d = program.card_design && typeof program.card_design === 'object' ? program.card_design : null;
  const colors = { ...(d?.colors ?? {}), ...(d?.google?.colors ?? {}) };
  const issuer = String(d?.identity?.name || businessName || program.name).slice(0, 40);
  const showHero = d ? d.google?.showHero !== false : true;
  return {
    issuerName: issuer,
    programName: program.name,
    // Programs created before the design flow have no uploaded logo: they keep the generic one.
    programLogo: { sourceUri: { uri: program.logo_path ? assetUrl(program.logo_path) : LOGO_URL }, contentDescription: text(issuer) },
    ...(showHero && program.hero_path ? { heroImage: { sourceUri: { uri: assetUrl(program.hero_path) }, contentDescription: text(program.name) } } : {}),
    hexBackgroundColor: HEX_RE.test(colors.primary ?? '') ? colors.primary : program.bg,
    ...(d ? { accountNameLabel: 'Client', accountIdLabel: 'N° de carte' } : {}),
  };
}

async function ensureClass(program: any, businessName: string): Promise<string> {
  if (program.design_status !== 'validated') throw new HttpError(409, 'design_pending');
  const { data: row } = await admin.from('wallet_classes').select('google_class_id').eq('program_id', program.id).maybeSingle();
  const classId = row?.google_class_id ?? classIdFor(program.id);
  const got = await google('GET', `/loyaltyClass/${encodeURIComponent(classId)}`);
  if (got.status === 404) {
    const ins = await google('POST', '/loyaltyClass', {
      id: classId,
      ...classBranding(program, businessName),
      reviewStatus: 'UNDER_REVIEW',
      countryCode: 'FR',
    });
    if (ins.status !== 200 && ins.status !== 409) throw gErr('class_insert', ins);
  } else if (got.status !== 200) {
    throw gErr('class_get', got);
  }
  if (!row) {
    const { error } = await admin.from('wallet_classes')
      .upsert({ program_id: program.id, merchant_id: program.merchant_id, google_class_id: classId }, { onConflict: 'program_id', ignoreDuplicates: true });
    if (error) throw new Error('db_wallet_classes');
  }
  return classId;
}

async function latest(cardId: string): Promise<{ seq: number; balance: number }> {
  const { data, error } = await admin.from('card_events').select('seq, balance_after')
    .eq('card_id', cardId).order('seq', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('db_card_events');
  return { seq: data?.seq ?? 0, balance: data?.balance_after ?? 0 };
}

async function ensureObject(card: any, classId: string): Promise<string> {
  const objectId = objectIdFor(card.id);
  // Durable record first, so the sync queue knows the pass even if Google fails below.
  const { error } = await admin.from('wallet_passes')
    .upsert({ card_id: card.id, merchant_id: card.merchant_id, google_object_id: objectId }, { onConflict: 'card_id', ignoreDuplicates: true });
  if (error) throw new Error('db_wallet_passes');

  const got = await google('GET', `/loyaltyObject/${encodeURIComponent(objectId)}`);
  if (got.status === 404) {
    const now = await latest(card.id);
    const program = card.programs;
    const ins = await google('POST', '/loyaltyObject', {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountId: hasStampEmoji(program) ? walletCardDigits(card.card_number) : card.card_number,
      ...(hasStampEmoji(program) ? {} : {
        accountName:[card.customers.first_name,card.customers.last_name].filter(Boolean).join(' '),
      }),
      ...(hasStampEmoji(program) ? walletCounter(now.balance,program.goal,program.mode)
        : {loyaltyPoints:{label:unitLabel(program.mode),balance:{int:now.balance}}}),
      // Identifies the card at the counter. It authorises nothing on its own.
      barcode: { type: 'QR_CODE', value: `DPA1:${card.qr_token}`, alternateText: hasStampEmoji(program) ? walletCardDigits(card.card_number) : card.card_number },
      ...(hasStampEmoji(program) ? {
        heroImage: { sourceUri: { uri: await stampBoardUrl(card.id,now.seq) } },
      } : {}),
      ...(hasStampEmoji(program) ? { textModulesData: [] } : {
        textModulesData:[{id:'reward',header:'Récompense',
          body:`${program.goal} ${program.mode === 'points'?'points':'passages'} = ${program.reward}`}]
      }),
    });
    if (ins.status !== 200 && ins.status !== 409) throw gErr('object_insert', ins);
  } else if (got.status !== 200) {
    throw gErr('object_get', got);
  }
  // Whatever happened before, make sure the latest balance gets pushed.
  await admin.from('wallet_passes').update({ pending: true, next_attempt_at: new Date().toISOString() }).eq('card_id', card.id);
  return objectId;
}

// ---------------------------------------------------------------- sync worker

async function runSync(limit = 20): Promise<{ synced: number; failed: number }> {
  const { data: rows, error } = await admin.rpc('wallet_claim_sync', { p_limit: limit, p_lease_seconds: 60 });
  if (error) throw new Error('db_claim');
  let synced = 0, failed = 0;
  for (const r of rows ?? []) {
    try {
      const update: any = { loyaltyPoints: { label: unitLabel(r.mode), balance: { int: r.balance } } };
      // Keep the Google stamp image and native emoji fallback current when points change.
      // A failed auxiliary lookup must not block the existing balance synchronization.
      try {
        const {data:row}=await admin.from('cards').select('id,card_number,programs(mode,goal,reward,card_design)').eq('id',r.card_id).maybeSingle();
        const prog=(row as any)?.programs;
        if(row && hasStampEmoji(prog)){
          update.heroImage={sourceUri:{uri:await stampBoardUrl(r.card_id,r.seq)}};
          Object.assign(update,walletCounter(r.balance,prog.goal,prog.mode));
          update.accountId=walletCardDigits((row as any).card_number);
          update.textModulesData=[];
        }
      } catch { console.error('wallet stamp sync auxiliary error'); }
      const res = await google('PATCH', `/loyaltyObject/${encodeURIComponent(r.google_object_id)}`, update);
      if (res.status !== 200) throw gErr('object_patch', res);
      await admin.rpc('wallet_complete_sync', { p_card: r.card_id, p_lease: r.lease, p_seq: r.seq, p_balance: r.balance });
      synced++;
    } catch (e) {
      await admin.rpc('wallet_fail_sync', { p_card: r.card_id, p_lease: r.lease, p_error: String((e as Error).message) });
      failed++;
    }
  }
  return { synced, failed };
}

// ---------------------------------------------------------------- routes

async function authUser(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) throw new HttpError(401, 'not_authenticated');
  const userClient: SupabaseClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userClient.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (!user) throw new HttpError(401, 'not_authenticated');
  return { user, userClient };
}

// Real format and dimensions, read from the file bytes (never from the client).
function imageInfo(b: Uint8Array): { type: 'png' | 'jpeg'; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

// Google Wallet guidelines: logo PNG, square, at least 660 px; hero ≈ 1032×812 (5:4), full width.
const IMAGE_RULES = {
  logo: { types: ['png'], maxBytes: 2_097_152, ok: (w: number, h: number) => w === h && w >= 660 && w <= 2000 },
  hero: { types: ['png', 'jpeg'], maxBytes: 2_097_152, ok: (w: number, h: number) => w >= 1032 && w <= 3000 && Math.abs(w / h - 1032 / 812) < 0.02 },
} as const;

async function checkImage(path: string, kind: 'logo' | 'hero', merchantId: string, programId: string) {
  if (!path.startsWith(`${merchantId}/${programId}/`)) throw new HttpError(422, `invalid_${kind}`);
  const { data, error } = await admin.storage.from('program-assets').download(path);
  if (error || !data) throw new HttpError(422, `missing_${kind}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const info = imageInfo(bytes), rule = IMAGE_RULES[kind];
  if (!info || !(rule.types as readonly string[]).includes(info.type) || bytes.length > rule.maxBytes || !rule.ok(info.w, info.h)) {
    throw new HttpError(422, `invalid_${kind}`);
  }
}

// Validate a draft design once, lock it, then create the program's Wallet class from it.
async function finalizeDesign(req: Request): Promise<Response> {
  const { user, userClient } = await authUser(req);
  const { data: member } = await admin.from('merchant_members').select('merchant_id, role').eq('user_id', user.id).maybeSingle();
  if (!member || member.role !== 'owner') throw new HttpError(403, 'forbidden');
  // Read through the caller's session (RLS) — the browser sends no ids at all.
  const { data: found } = await userClient.from('programs').select('*').eq('merchant_id', member.merchant_id).eq('is_active', true).maybeSingle();
  if (!found) throw new HttpError(404, 'no_program');
  const { data: merchant } = await userClient.from('merchants').select('business_name').eq('id', member.merchant_id).single();
  let program = found;
  if (program.design_status === 'pending_dpa') throw new HttpError(409, 'design_pending');

  if (program.design_status === 'draft') {
    if (!/^#[0-9A-Fa-f]{6}$/.test(program.bg)) throw new HttpError(422, 'invalid_color');
    if (!program.logo_path) throw new HttpError(422, 'missing_logo');
    await checkImage(program.logo_path, 'logo', program.merchant_id, program.id);
    if (program.hero_path) await checkImage(program.hero_path, 'hero', program.merchant_id, program.id);
    // Lock only the exact images that were checked (a concurrent change makes this a no-op).
    let q = admin.from('programs').update({ design_mode: 'custom', design_status: 'validated', design_validated_at: new Date().toISOString() })
      .eq('id', program.id).eq('design_status', 'draft').eq('logo_path', program.logo_path);
    q = program.hero_path ? q.eq('hero_path', program.hero_path) : q.is('hero_path', null);
    const { data: locked } = await q.select().maybeSingle();
    if (!locked) {
      const { data: again } = await admin.from('programs').select('*').eq('id', program.id).single();
      if (again?.design_status !== 'validated') throw new HttpError(409, 'design_changed');
      program = again;
    } else {
      program = locked;
    }
  }
  try {
    const classId = await ensureClass(program, merchant?.business_name ?? '');
    return json(req, 200, { status: 'validated', wallet: 'ready', class_id: classId });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error('wallet error', 'finalize-design', (e as Error).message);
    // The design is locked; the class will be created on the next Wallet request.
    return json(req, 200, { status: 'validated', wallet: 'retry' });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_SELECT = 'id, merchant_id, card_number, qr_token, customers(first_name, last_name), programs(id, merchant_id, name, mode, goal, reward, bg, logo_path, hero_path, design_status, card_design), merchants(business_name)';

// Class + object for one card already authorised by the caller, then the signed save link.
async function signedSaveUrl(req: Request, card: any): Promise<string> {
  const classId = await ensureClass(card.programs, (card.merchants as any).business_name);
  const objectId = await ensureObject(card, classId);
  await runSync(5).catch(() => undefined); // the queue retries anyway

  const origin = req.headers.get('origin');
  const jwt = await signJwt({
    iss: sa().client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000),
    origins: origin && ALLOWED_ORIGINS.includes(origin) ? [origin] : [],
    payload: { loyaltyObjects: [{ id: objectId }] },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

async function saveLink(req: Request): Promise<Response> {
  const { user, userClient } = await authUser(req);

  const body = await req.json().catch(() => ({}));
  const cardId = String(body?.card_id ?? '');
  if (!UUID_RE.test(cardId)) throw new HttpError(400, 'invalid_card');

  // Read through the caller's own session: RLS only returns cards of their merchant.
  const { data: card } = await userClient.from('cards').select(CARD_SELECT).eq('id', cardId).maybeSingle();
  if (!card) throw new HttpError(404, 'card_not_found');
  // Explicit membership check on top of RLS.
  const { data: member } = await admin.from('merchant_members').select('role')
    .eq('merchant_id', card.merchant_id).eq('user_id', user.id).maybeSingle();
  if (!member) throw new HttpError(403, 'forbidden');
  await requireAccess(card.merchant_id);

  const url = await signedSaveUrl(req, card);
  const { data: pass } = await admin.from('wallet_passes').select('pending, synced_balance, last_error').eq('card_id', cardId).single();
  return json(req, 200, { url, sync: pass });
}

// An Apple installation link is a short-lived, unguessable bearer capability.
// Only authorized enrollment and merchant operations can issue one. The opaque
// token (not the QR code or card id) is the only value sent to the Apple endpoint.
async function appleDownloadLink(cardId: string): Promise<string> {
  if (!Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM') || !Deno.env.get('APPLE_PASS_CERT_PEM')) {
    throw new HttpError(503, 'apple_wallet_not_configured');
  }
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const tokenHash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const { error } = await admin.from('apple_wallet_links').upsert({
    card_id: cardId, token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }, { onConflict: 'card_id' });
  if (error) throw new Error('db_apple_link');
  return SUPABASE_URL + '/functions/v1/apple-pass?token=' + encodeURIComponent(token);
}

async function appleLink(req: Request): Promise<Response> {
  const { user, userClient } = await authUser(req);
  const body = await req.json().catch(() => ({}));
  const cardId = String(body?.card_id ?? '');
  if (!UUID_RE.test(cardId)) throw new HttpError(400, 'invalid_card');
  const { data: card } = await userClient.from('cards').select('id, merchant_id').eq('id', cardId).maybeSingle();
  if (!card) throw new HttpError(404, 'card_not_found');
  const { data: member } = await admin.from('merchant_members').select('role')
    .eq('merchant_id', card.merchant_id).eq('user_id', user.id).maybeSingle();
  if (!member) throw new HttpError(403, 'forbidden');
  await requireAccess(card.merchant_id);
  return json(req, 200, { url: await appleDownloadLink(card.id) });
}

// ---------------------------------------------------------------- public sign-up (/join/<slug>)
// No session. The slug is the only thing the browser names; merchant and program are
// resolved here, and only fields already shown on the public page are returned.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function publicProgramBySlug(raw: unknown) {
  const slug = String(raw ?? '').trim().toLowerCase();
  if (!slug || slug.length > 40 || !SLUG_RE.test(slug)) throw new HttpError(404, 'program_not_found');
  const { data: m, error } = await admin.from('merchants').select('id, business_name').eq('slug', slug).maybeSingle();
  if (error) throw new Error('db_merchants');
  if (!m) throw new HttpError(404, 'program_not_found');
  const { data: p, error: pe } = await admin.from('programs')
    .select('name, mode, goal, reward, conditions, bg, accent, pattern, logo, logo_path, hero_path, design_status, card_design, registration_page')
    .eq('merchant_id', m.id).eq('is_active', true).maybeSingle();
  if (pe) throw new Error('db_programs');
  if (!p) throw new HttpError(404, 'program_not_found');
  // Paid feature: no public sign-up while the shop has no valid subscription.
  const { data: active } = await admin.rpc('merchant_has_access', { p_merchant: m.id });
  if (active !== true) throw new HttpError(403, 'program_unavailable');
  return { slug, business: m.business_name, program: p };
}

async function publicProgram(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  return json(req, 200, await publicProgramBySlug(body?.slug));
}

async function publicJoin(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { slug } = await publicProgramBySlug(body?.slug);
  const requestId = String(body?.request_id ?? '');
  const first = String(body?.first ?? '').trim();
  const email = String(body?.email ?? '').trim();
  if (!UUID_RE.test(requestId)) throw new HttpError(400, 'invalid_request');
  if (body?.consent !== true) throw new HttpError(422, 'consent_required');
  if (!first || first.length > 80) throw new HttpError(422, 'invalid_first');
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) throw new HttpError(422, 'invalid_email');

  const { data, error } = await admin.rpc('public_enroll', {
    p_slug: slug, p_request_id: requestId, p_first: first, p_email: email || null, p_consent: true,
  });
  if (error) {
    const m = String(error.message ?? '');
    if (m.includes('program_not_found')) throw new HttpError(404, 'program_not_found');
    if (m.includes('rate_limited')) throw new HttpError(429, 'rate_limited');
    if (error.code === '23514') throw new HttpError(422, 'invalid_first');
    throw new Error('db_public_enroll');
  }

  // The card exists from here on. Google Wallet is best effort: the page can ask again
  // with the same request id, which returns the same card.
  let wallet: { url?: string; error?: string };
  try {
    const { data: card } = await admin.from('cards').select(CARD_SELECT).eq('id', data.card.id).single();
    wallet = { url: await signedSaveUrl(req, card) };
  } catch (e) {
    if (!(e instanceof HttpError)) console.error('wallet error', 'join', (e as Error).message);
    wallet = { error: e instanceof HttpError ? e.code : 'wallet_unavailable' };
  }
  let apple: { url?: string; error?: string };
  try { apple = { url: await appleDownloadLink(data.card.id) }; }
  catch (e) { apple = { error: e instanceof HttpError ? e.code : 'apple_wallet_unavailable' }; }
  return json(req, 200, {
    first: data.customer.first_name, card_number: data.card.card_number, qr_value: `DPA1:${data.card.qr_token}`,
    joined: data.card.created_at, wallet, apple,
  });
}

// ---------------------------------------------------------------- notifications
// The browser sends a title, a text and an audience (or card ids it picked). The merchant
// comes from the session, cards are checked against it, and Google object ids are only
// ever read from wallet_passes — never taken from the request.

const AUDIENCES = ['all', 'reward', 'near', 'inactive', 'selected'];
const KINDS = ['points', 'reward', 'message'];
// Printable text only: control characters (except line breaks in the body) are dropped.
const cleanText = (v: unknown, max: number, multiline: boolean) =>
  String(v ?? '').normalize('NFC').replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);

type Delivery = { card_id: string; status: 'sent' | 'failed' | 'quota_exceeded' | 'no_wallet'; error: string | null };

// Google answer to addMessage → delivery status. More than 3 TEXT_AND_NOTIFY messages on one
// saved pass within 24 h yields a QuotaExceededException (HTTP 429 / RESOURCE_EXHAUSTED).
function classifyAddMessage(status: number, data: any) {
  if (status === 200) return { status: 'sent', error: null };
  const detail = JSON.stringify(data ?? '');
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(detail)) return { status: 'quota_exceeded', error: 'google_quota_exceeded' };
  return { status: 'failed', error: ('google_' + status + (data?.error?.status ? '_' + data.error.status : '')).slice(0, 300) };
}

async function addMessage(objectId: string, message: Record<string, unknown>): Promise<Pick<Delivery, 'status' | 'error'>> {
  try {
    const r = await google('POST', `/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`, { message });
    return classifyAddMessage(r.status, r.data) as Pick<Delivery, 'status' | 'error'>;
  } catch (e) {
    return { status: 'failed', error: String((e as Error).message || 'google_unavailable').slice(0, 300) };
  }
}

async function notify(req: Request): Promise<Response> {
  const { user } = await authUser(req);
  const { data: member } = await admin.from('merchant_members').select('merchant_id').eq('user_id', user.id).maybeSingle();
  if (!member) throw new HttpError(403, 'forbidden');
  const merchantId: string = member.merchant_id;
  await requireAccess(merchantId);

  const body = await req.json().catch(() => ({}));
  const title = cleanText(body?.title, 60, false);
  const text = cleanText(body?.body, 200, true);
  if (!title) throw new HttpError(422, 'empty_title');
  if (!text) throw new HttpError(422, 'empty_body');
  const audience = String(body?.audience ?? '');
  if (!AUDIENCES.includes(audience)) throw new HttpError(422, 'invalid_audience');
  const kind = KINDS.includes(String(body?.kind)) ? String(body.kind) : 'message';
  const withNotification = body?.notify !== false;
  const draftId = body?.draft_id ? String(body.draft_id) : null;
  if (draftId && !UUID_RE.test(draftId)) throw new HttpError(400, 'invalid_request');

  let cardIds: string[] = [];
  if (audience === 'selected') {
    if (!Array.isArray(body?.card_ids)) throw new HttpError(422, 'no_recipients');
    cardIds = [...new Set(body.card_ids.map((x: unknown) => String(x).toLowerCase()))] as string[];
    if (!cardIds.length) throw new HttpError(422, 'no_recipients');
    if (cardIds.length > 2000 || cardIds.some(id => !UUID_RE.test(id))) throw new HttpError(400, 'invalid_card');
    // Every picked card must belong to the caller's merchant; one foreign card refuses the whole send.
    let owned = 0;
    for (let i = 0; i < cardIds.length; i += 200) {
      const { count, error } = await admin.from('cards').select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId).in('id', cardIds.slice(i, i + 200));
      if (error) throw new Error('db_cards');
      owned += count ?? 0;
    }
    if (owned !== cardIds.length) throw new HttpError(403, 'forbidden_card');
  }

  // The campaign row first, so the history shows it even if the function dies mid-way.
  const row = { title, body: text, kind, audience, card_ids: cardIds, notify: withNotification, platform: 'google', status: 'sending', error: null };
  let notificationId: string;
  if (draftId) {
    const { data, error } = await admin.from('notifications').update(row)
      .eq('id', draftId).eq('merchant_id', merchantId).eq('status', 'draft').select('id').maybeSingle();
    if (error) throw new Error('db_notifications');
    if (!data) throw new HttpError(404, 'notification_not_found');
    notificationId = data.id;
  } else {
    const { data, error } = await admin.from('notifications').insert({ ...row, merchant_id: merchantId, created_by: user.id }).select('id').single();
    if (error) throw new Error('db_notifications');
    notificationId = data.id;
  }

  const finish = async (patch: Record<string, unknown>) => {
    await admin.from('notifications').update({ ...patch, sent_at: new Date().toISOString() }).eq('id', notificationId);
  };
  try {
    const { data: targets, error: te } = await admin.rpc('notification_targets', { p_merchant: merchantId, p_audience: audience, p_card_ids: cardIds });
    if (te) throw new Error('db_targets');
    const list = (targets ?? []) as { card_id: string; google_object_id: string | null }[];

    const message = { header: title, body: text, id: notificationId, messageType: withNotification ? 'TEXT_AND_NOTIFY' : 'TEXT' };
    const deliveries: Delivery[] = list.filter(t => !t.google_object_id).map(t => ({ card_id: t.card_id, status: 'no_wallet', error: null }));
    const queue = list.filter(t => t.google_object_id);
    if (queue.length) sa(); // 503 wallet_not_configured before any attempt
    // A few calls in parallel; one card failing never stops the others.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (next < queue.length) {
        const t = queue[next++];
        deliveries.push({ card_id: t.card_id, ...(await addMessage(t.google_object_id!, message)) });
      }
    }));

    for (let i = 0; i < deliveries.length; i += 500) {
      const { error } = await admin.from('notification_deliveries').insert(deliveries.slice(i, i + 500).map(d => ({
        notification_id: notificationId, card_id: d.card_id, merchant_id: merchantId, platform: 'google', status: d.status, error: d.error,
      })));
      if (error) console.error('wallet error', 'notify deliveries', error.message);
    }
    const n = (s: Delivery['status']) => deliveries.filter(d => d.status === s).length;
    const result = { targeted: list.length, sent: n('sent'), failed: n('failed'), quotaExceeded: n('quota_exceeded'), noWallet: n('no_wallet') };
    const status = result.sent === 0 ? 'failed' : (result.failed + result.quotaExceeded > 0 ? 'partial' : 'sent');
    const error = status === 'sent' ? null
      : !list.length ? 'no_recipients'
      : !queue.length ? 'no_wallet'
      : (deliveries.find(d => d.status === 'failed')?.error ?? (result.quotaExceeded ? 'google_quota_exceeded' : null));
    await finish({ status, targeted: result.targeted, sent_count: result.sent, failed_count: result.failed,
      quota_count: result.quotaExceeded, no_wallet_count: result.noWallet, error });
    return json(req, 200, { notification_id: notificationId, status, ...result });
  } catch (e) {
    await finish({ status: 'failed', error: e instanceof HttpError ? e.code : 'wallet_unavailable' });
    throw e;
  }
}

// ---------------------------------------------------------------- data deletion
// The database is the reference: rows are deleted first (the foreign keys cascade from
// merchants / customers to cards, ledger, wallet passes, notifications and deliveries).
// Google objects are then switched to INACTIVE on a best-effort basis: a Google outage
// never blocks or rolls back a deletion, it is only logged (error codes, no ids).

async function deactivateObjects(objectIds: string[], budgetMs = 20000): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0, next = 0;
  const until = Date.now() + budgetMs;
  if (!objectIds.length) return { done, failed };
  try { sa(); } catch { console.error('wallet error', 'deactivate', 'wallet_not_configured'); return { done, failed: objectIds.length }; }
  await Promise.all(Array.from({ length: Math.min(6, objectIds.length) }, async () => {
    while (next < objectIds.length && Date.now() < until) {
      const id = objectIds[next++];
      try {
        const r = await google('PATCH', `/loyaltyObject/${encodeURIComponent(id)}`, { state: 'INACTIVE' });
        if (r.status === 200 || r.status === 404) done++; else { failed++; console.error('wallet error', 'deactivate', `google_${r.status}`); }
      } catch (e) { failed++; console.error('wallet error', 'deactivate', (e as Error).message); }
    }
  }));
  failed += objectIds.length - done - failed; // left over when the time budget ran out
  return { done, failed };
}

// Dashboard actions need a valid subscription (trialing or active), checked on the server.
// The merchant dashboard gets its entitlement from the same DB function that RLS
// and server-side paid features use. The caller cannot choose another merchant.
async function merchantAccess(req: Request): Promise<Response> {
  const {member}=await ownerOf(req);
  if(!member)throw new HttpError(403,'no_merchant');
  const {data:allowed,error}=await admin.rpc('merchant_has_access',{p_merchant:member.merchant_id});
  if(error)throw new Error('db_access');
  const {data:manual,error:me}=await admin.from('merchant_manual_access')
    .select('enabled,expires_at').eq('merchant_id',member.merchant_id).maybeSingle();
  if(me)throw new Error('db_manual_access');
  const manualActive=manual?.enabled===true && !!manual.expires_at && new Date(manual.expires_at)>new Date();
  return json(req,200,{has_access:allowed===true,source:allowed===true&&manualActive?'manual':allowed===true?'stripe':'none',manual_expires_at:manualActive?manual.expires_at:null});
}

async function requireAccess(merchantId: string) {
  const { data, error } = await admin.rpc('merchant_has_access', { p_merchant: merchantId });
  if (error) throw new Error('db_access');
  if (data !== true) throw new HttpError(402, 'subscription_required');
}

async function ownerOf(req: Request) {
  const { user } = await authUser(req);
  const { data: member } = await admin.from('merchant_members').select('merchant_id, role').eq('user_id', user.id).maybeSingle();
  return { user, member: member as { merchant_id: string; role: string } | null };
}

async function deleteCustomer(req: Request): Promise<Response> {
  const { member } = await ownerOf(req);
  if (!member) throw new HttpError(403, 'forbidden');
  if (member.role !== 'owner') throw new HttpError(403, 'owner_only');
  const body = await req.json().catch(() => ({}));
  const cardId = String(body?.card_id ?? '');
  if (!UUID_RE.test(cardId)) throw new HttpError(400, 'invalid_card');

  // The card must belong to the caller's merchant; its customer is derived from it.
  const { data: card, error } = await admin.from('cards').select('id, customer_id, merchant_id')
    .eq('id', cardId).eq('merchant_id', member.merchant_id).maybeSingle();
  if (error) throw new Error('db_cards');
  if (!card) throw new HttpError(404, 'card_not_found');
  // All cards of that customer (one per program) and their Google objects.
  const { data: cards } = await admin.from('cards').select('id').eq('customer_id', card.customer_id).eq('merchant_id', member.merchant_id);
  const { data: passes } = await admin.from('wallet_passes').select('google_object_id')
    .eq('merchant_id', member.merchant_id).in('card_id', (cards ?? []).map(c => c.id));

  const { error: de } = await admin.from('customers').delete().eq('id', card.customer_id).eq('merchant_id', member.merchant_id);
  if (de) throw new Error('db_delete_customer');
  const wallet = await deactivateObjects((passes ?? []).map(p => p.google_object_id), 8000);
  return json(req, 200, { deleted: true, wallet });
}

// Every file under <merchant_id>/ in a bucket (two folder levels: program or request, then file).
async function listMerchantFiles(bucket: string, merchantId: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (prefix: string, depth: number) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error('storage_list');
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`;
        if (item.id) out.push(path); else if (depth < 3) await walk(path, depth + 1);
      }
      if ((data ?? []).length < 1000) return;
    }
  };
  await walk(merchantId, 1);
  return out;
}

async function deleteAccount(req: Request): Promise<Response> {
  const { user, member } = await ownerOf(req);
  const body = await req.json().catch(() => ({}));
  if (String(body?.confirm ?? '') !== 'SUPPRIMER') throw new HttpError(422, 'confirmation_required');
  if (member && member.role !== 'owner') throw new HttpError(403, 'owner_only');

  let wallet = { done: 0, failed: 0 }, files = 0;
  if (member) {
    const merchantId = member.merchant_id;
    // Collected before the rows disappear.
    const objectIds: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('wallet_passes').select('google_object_id').eq('merchant_id', merchantId).range(from, from + 999);
      if (error) throw new Error('db_wallet_passes');
      objectIds.push(...(data ?? []).map(p => p.google_object_id));
      if ((data ?? []).length < 1000) break;
    }
    // Stop billing first: the Stripe subscription is cancelled immediately (best effort, logged).
    const { data: sub } = await admin.from('subscriptions').select('stripe_subscription_id, status').eq('merchant_id', merchantId).maybeSingle();
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (sub?.stripe_subscription_id && stripeKey && !['canceled', 'incomplete_expired'].includes(sub.status)) {
      try {
        const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${stripeKey}` } });
        if (!r.ok && r.status !== 404) console.error('wallet error', 'delete-account stripe', `stripe_${r.status}`);
      } catch (e) { console.error('wallet error', 'delete-account stripe', (e as Error).message); }
    }
    const paths: Record<string, string[]> = {};
    for (const bucket of ['program-assets', 'design-requests']) {
      try { paths[bucket] = await listMerchantFiles(bucket, merchantId); }
      catch (e) { paths[bucket] = []; console.error('wallet error', 'delete-account list', bucket, (e as Error).message); }
    }

    // One statement: the merchant row and, through ON DELETE CASCADE, everything attached to it.
    const { error } = await admin.from('merchants').delete().eq('id', merchantId);
    if (error) throw new Error('db_delete_merchant');

    for (const [bucket, list] of Object.entries(paths)) {
      for (let i = 0; i < list.length; i += 100) {
        const { error: se } = await admin.storage.from(bucket).remove(list.slice(i, i + 100));
        if (se) console.error('wallet error', 'delete-account files', bucket, se.message); else files += Math.min(100, list.length - i);
      }
    }
    wallet = await deactivateObjects(objectIds);
  }

  // Finally the login itself. Staff members of the deleted merchant keep their own login
  // (their membership went with the merchant); only the owner's account is removed here.
  const { error: ue } = await admin.auth.admin.deleteUser(user.id);
  // A repeated request finds the login already gone: that is the expected end state.
  if (ue && !/not.?found/i.test(ue.message)) { console.error('wallet error', 'delete-account user', ue.message); throw new HttpError(500, 'account_delete_failed'); }
  return json(req, 200, { deleted: true, files, wallet });
}

// ---------------------------------------------------------------- admin dashboard (read-only)
// Access: a session whose confirmed e-mail is listed in admin_users, checked here on every call.

async function requireAdmin(req: Request) {
  const { user } = await authUser(req);
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email || !user.email_confirmed_at) throw new HttpError(403, 'not_admin');
  const { data, error } = await admin.from('admin_users').select('email, role').eq('email', email).maybeSingle();
  if (error) throw new Error('db_admin_users');
  if (!data) throw new HttpError(403, 'not_admin');
  return Object.assign(user, { dpaEmail: email, dpaRole: data.role as 'admin' | 'director' });
}

// Sales tracking, commission rules, manual attribution and payouts: the director account only
// (admin_users.role = 'director'). The database functions check the role again from this e-mail.
async function requireDirector(req: Request) {
  const user = await requireAdmin(req);
  if (user.dpaRole !== 'director') throw new HttpError(403, 'not_director');
  return user;
}

// Rep of each shop (who brought it), shown to every admin; amounts stay director-only.
// For non-directors, business data is strictly partitioned by the saved sales attribution.
// No browser-supplied rep id or local storage is trusted.
async function adminAllowedMerchantIds(user: any): Promise<Set<string> | null> {
  if (user.dpaRole === 'director') return null;
  const {data: rep,error: re}=await admin.from('sales_reps').select('id').eq('email',user.dpaEmail).eq('active',true).maybeSingle();
  if(re) throw new Error('db_sales_rep');
  if(!rep) return new Set();
  const {data,error}=await admin.from('merchant_attributions').select('merchant_id').eq('sales_rep_id',rep.id);
  if(error) throw new Error('db_attributions');
  return new Set((data??[]).map((r:any)=>r.merchant_id));
}
async function assertAdminMerchant(user: any,id: string) {
  const ids=await adminAllowedMerchantIds(user);
  if(ids!==null && !ids.has(id)) throw new HttpError(403,'merchant_forbidden');
}
async function attributions(ids?: string[]) {
  let q = admin.from('merchant_attributions').select('merchant_id, source, attributed_at, sales_reps(id, display_name)');
  if (ids) q = q.in('merchant_id', ids);
  const { data, error } = await q;
  if (error) throw new Error('db_attributions');
  return Object.fromEntries((data ?? []).map((a: any) => [a.merchant_id, { id: a.sales_reps?.id ?? null, name: a.sales_reps?.display_name ?? null, source: a.source, at: a.attributed_at }]));
}

// Owner e-mails come from Auth (not readable through the database API).
async function ownerEmails(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all([...new Set(ids.filter(Boolean))].map(async id => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) out[id] = data.user.email;
  }));
  return out;
}

async function adminOverview(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const { data, error } = await admin.rpc('admin_overview');
  if (error) throw new Error('db_admin_overview');
  const allowed=await adminAllowedMerchantIds(user);
  const visible=(data.merchants as any[]).filter((m:any)=>allowed===null||allowed.has(m.id));
  const [emails, reps, { data: modes }, { data: appleRows, error: appleError }, {data: overrides}] = await Promise.all([
    ownerEmails(visible.map((m:any)=>m.owner_id)), attributions(visible.map((m:any)=>m.id)),
    admin.from('subscriptions').select('merchant_id, billing_mode'),
    admin.rpc('admin_apple_wallet_counts'),
    admin.from('merchant_manual_access').select('merchant_id, enabled, expires_at, reason, updated_at')]);
  if (appleError) throw new Error('db_admin_apple_wallet_counts');
  const appleByMerchant = Object.fromEntries((appleRows ?? []).map((x: any) => [x.merchant_id, Number(x.apple_count) || 0]));
  const appleTotal = (appleRows ?? []).reduce((n: number, x: any) => n + (Number(x.apple_count) || 0), 0);
  const bothTotal = (appleRows ?? []).reduce((n: number, x: any) => n + (Number(x.both_count) || 0), 0);
  // Monthly or paid in one go (commitment offer), next to the subscription the dashboard already shows.
  const mode: Record<string, string> = Object.fromEntries((modes ?? []).map(x => [x.merchant_id, x.billing_mode]));
  const overrideById=Object.fromEntries((overrides??[]).map((o:any)=>[o.merchant_id,o]));
  const merchants = visible.map(({ owner_id, ...m }:any) => ({ ...m, owner_email: emails[owner_id] ?? null, sales_rep: reps[m.id] ?? null,
    apple_wallet_downloads: appleByMerchant[m.id] ?? 0, manual_access: overrideById[m.id]??null,
    subscription: m.subscription ? { ...m.subscription, billing_mode: mode[m.id] ?? 'monthly' } : null }));
  const extra=await (async()=>{
    if(allowed===null)return {notifications_sent:0,designs_to_process:0};
    const ids=visible.map((m:any)=>m.id);
    if(!ids.length)return {notifications_sent:0,designs_to_process:0};
    const [{count:notifications,error:ne},{count:designs,error:de}]=await Promise.all([
      admin.from('notifications').select('id',{count:'exact',head:true}).in('merchant_id',ids).in('status',['sent','partial']),
      admin.from('design_requests').select('id',{count:'exact',head:true}).in('merchant_id',ids).in('status',['submitted','in_progress']).eq('payment_status','paid')
    ]);
    if(ne||de)throw new Error('db_admin_scoped_counts');
    return {notifications_sent:notifications??0,designs_to_process:designs??0};
  })();
  const kpis=allowed===null?{ ...data.kpis, apple_wallet_downloads: appleTotal, wallet_both: bothTotal }
    :{merchants:merchants.length,programs:merchants.filter((m:any)=>m.program).length,
      customers:merchants.reduce((n:number,m:any)=>n+Number(m.customers||0),0),
      cards:merchants.reduce((n:number,m:any)=>n+Number(m.cards||0),0),
      events:merchants.reduce((n:number,m:any)=>n+Number(m.events||0),0),
      wallet_passes:merchants.reduce((n:number,m:any)=>n+Number(m.wallet_passes||0),0),
      apple_wallet_downloads:merchants.reduce((n:number,m:any)=>n+Number(m.apple_wallet_downloads||0),0),
      wallet_both:(appleRows??[]).filter((x:any)=>allowed.has(x.merchant_id)).reduce((n:number,x:any)=>n+Number(x.both_count||0),0),subscriptions_valid:merchants.filter((m:any)=>m.manual_access?.enabled&&new Date(m.manual_access.expires_at)>new Date()||['trialing','active'].includes(m.subscription?.status)&&m.manual_access?.enabled!==false).length,
      ...extra};
  return json(req,200,{kpis,merchants,me:{email:user.dpaEmail,role:user.dpaRole}});
}

async function adminMerchant(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.merchant_id ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'invalid_request');
  await assertAdminMerchant(user,id);
  const { data, error } = await admin.rpc('admin_merchant_detail', { p_merchant: id });
  if (error) throw new Error('db_admin_merchant');
  if (!data) throw new HttpError(404, 'merchant_not_found');
  const { owner_id, ...merchant } = data.merchant;
  const [emails, reps, { data: sub }, { data: prepaid }, { count: appleCount, error: appleError }, {data: manualAccess}] = await Promise.all([ownerEmails([owner_id]), attributions([id]),
    admin.from('subscriptions').select('billing_mode').eq('merchant_id', id).maybeSingle(),
    // Commitment paid in one go: what was collected, the period it covers, refunds (pending attempts left out).
    admin.from('prepaid_purchases').select('id, months, monthly_cents, setup_cents, total_cents, status, conflict, dispute_status, access_start, access_end, paid_at, refunded_cents, refunded_at, access_revoked_at')
      .eq('merchant_id', id).in('status', ['paid', 'refunded', 'partially_refunded']).order('paid_at', { ascending: false }),
    admin.from('apple_wallet_downloads').select('card_id', { count: 'exact', head: true }).eq('merchant_id', id),
    admin.from('merchant_manual_access').select('enabled,expires_at,reason,updated_at,updated_by').eq('merchant_id',id).maybeSingle()]);
  if (appleError) throw new Error('db_admin_apple_wallet_count');
  if (data.subscription) data.subscription.billing_mode = sub?.billing_mode ?? 'monthly';
  // Payments, commissions and attribution history: director only.
  let sales = null;
  if (user.dpaRole === 'director') {
    const [{ data: s, error: se }, { data: reps, error: re }] = await Promise.all([
      admin.rpc('sales_merchant', { p_merchant: id }),
      admin.from('sales_reps').select('id, display_name, active').order('created_at'),
    ]);
    if (se || re) throw new Error('db_sales_merchant');
    sales = { ...s, reps };
  }
  return json(req, 200, { ...data, counts: { ...(data.counts ?? {}), apple_wallet_downloads: appleCount ?? 0 },
    merchant: { ...merchant, owner_email: emails[owner_id] ?? null }, sales_rep: reps[id] ?? null, manual_access:manualAccess??null, prepaid: prepaid ?? [], sales });
}

// Direction only: temporary entitlement grant/revoke. Never edits Stripe billing or payments.
async function adminManualAccess(req: Request): Promise<Response> {
  const user=await requireDirector(req);
  const body=await req.json().catch(()=>({}));
  const id=String(body?.merchant_id??'');
  const reason=str(body?.reason,300);
  if(!UUID_RE.test(id)||typeof body?.enabled!=='boolean'||reason.length<3) throw new HttpError(422,'invalid_request');
  const {data: merchant}=await admin.from('merchants').select('id').eq('id',id).maybeSingle();
  if(!merchant) throw new HttpError(404,'merchant_not_found');
  const days=Number(body.days);
  if(body.enabled && ![7,30,90,365].includes(days)) throw new HttpError(422,'invalid_duration');
  const {data,error}=await admin.rpc('admin_manual_access_change',{
    p_merchant:id,p_enabled:body.enabled,p_days:body.enabled?days:null,p_reason:reason,p_actor:user.dpaEmail
  });
  if(error){ if(/not_director/.test(error.message))throw new HttpError(403,'not_director'); throw new Error('db_manual_access'); }
  return json(req,200,{manual_access:data});
}

// ---------------------------------------------------------------- sales tracking (director only)

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthStart = (v: unknown) => (typeof v === 'string' && MONTH_RE.test(v) ? `${v}-01` : null);
// Database errors raised on purpose by the sales functions → HTTP codes the dashboard can explain.
function salesError(error: { message?: string; code?: string }, where: string): never {
  const msg = error.message ?? '';
  for (const code of ['not_director', 'merchant_not_found', 'rep_not_found', 'rule_not_found', 'not_cancellable', 'reason_required',
    'nothing_to_pay', 'selection_changed', 'total_changed', 'invalid_paid_on']) {
    if (msg.includes(code)) throw new HttpError(code === 'not_director' ? 403 : code.endsWith('not_found') ? 404 : 409, code);
  }
  if (error.code === '23514' || error.code === '22023' || error.code === '22P02') throw new HttpError(422, 'invalid_request');
  console.error('wallet error', where, error.code);
  throw new Error('db_' + where);
}

async function adminSales(req: Request): Promise<Response> {
  await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  const from = monthStart(b?.from), to = monthStart(b?.to);
  const { data, error } = await admin.rpc('sales_dashboard', { p_from: from, p_to: to });
  if (error) salesError(error, 'sales_dashboard');
  return json(req, 200, data);
}

async function adminSalesAttribute(req: Request): Promise<Response> {
  const user = await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  const merchant = String(b?.merchant_id ?? ''), rep = b?.sales_rep_id == null || b.sales_rep_id === '' ? null : String(b.sales_rep_id);
  if (!UUID_RE.test(merchant) || (rep !== null && !UUID_RE.test(rep))) throw new HttpError(400, 'invalid_request');
  const { data, error } = await admin.rpc('sales_attribute', { p_merchant: merchant, p_rep: rep, p_actor: user.dpaEmail, p_source: 'manual', p_reason: str(b?.reason, 300) });
  if (error) salesError(error, 'sales_attribute');
  return json(req, 200, data);
}

async function adminSalesRule(req: Request): Promise<Response> {
  const user = await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  if (b?.disable) {
    if (!UUID_RE.test(String(b.disable))) throw new HttpError(400, 'invalid_request');
    const { data, error } = await admin.rpc('sales_rule_disable', { p_actor: user.dpaEmail, p_rule: String(b.disable) });
    if (error) salesError(error, 'sales_rule_disable');
    return json(req, 200, { rule: data });
  }
  const kind = b?.kind === 'recurring' ? 'recurring' : b?.kind === 'initial' ? 'initial' : null;
  const calc = b?.calc === 'percent' ? 'percent' : b?.calc === 'fixed' ? 'fixed' : null;
  const value = Number(b?.value);
  if (!kind || !calc || !Number.isFinite(value) || value <= 0 || (calc === 'percent' && value > 100) || (calc === 'fixed' && value > 100000)) throw new HttpError(422, 'invalid_rule');
  const duration = b?.duration_months == null || b.duration_months === '' ? null : Math.round(Number(b.duration_months));
  if (duration !== null && (kind !== 'recurring' || !(duration >= 1 && duration <= 120))) throw new HttpError(422, 'invalid_rule');
  const rep = b?.sales_rep_id ? String(b.sales_rep_id) : null, plan = b?.plan_type ? String(b.plan_type) : null;
  if ((rep && !UUID_RE.test(rep)) || (plan && !['no_commitment', 'commitment'].includes(plan))) throw new HttpError(422, 'invalid_rule');
  const validFrom = typeof b?.valid_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.valid_from) ? b.valid_from : null;
  const rule = { kind, calc, amount_cents: calc === 'fixed' ? Math.round(value * 100) : null, percent: calc === 'percent' ? Math.round(value * 100) / 100 : null,
    sales_rep_id: rep, plan_type: plan, duration_months: duration, valid_from: validFrom };
  const { data, error } = await admin.rpc('sales_rule_create', { p_actor: user.dpaEmail, p_rule: rule });
  if (error) salesError(error, 'sales_rule_create');
  return json(req, 200, { rule: data });
}

const uuidList = (v: unknown) => (Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every(x => typeof x === 'string' && UUID_RE.test(x)) ? v as string[] : null);

async function adminSalesValidate(req: Request): Promise<Response> {
  const user = await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  const ids = uuidList(b?.ids);
  if (!ids) throw new HttpError(400, 'invalid_request');
  const { data, error } = await admin.rpc('sales_validate', { p_actor: user.dpaEmail, p_ids: ids });
  if (error) salesError(error, 'sales_validate');
  return json(req, 200, { validated: data });
}

async function adminSalesCancel(req: Request): Promise<Response> {
  const user = await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  const id = String(b?.id ?? ''), reason = str(b?.reason, 300);
  if (!UUID_RE.test(id)) throw new HttpError(400, 'invalid_request');
  if (!reason) throw new HttpError(422, 'reason_required');
  const { data, error } = await admin.rpc('sales_cancel', { p_actor: user.dpaEmail, p_id: id, p_reason: reason });
  if (error) salesError(error, 'sales_cancel');
  return json(req, 200, { commission: data });
}

// Records a transfer the director has already made. Never triggers any payment.
async function adminSalesPayout(req: Request): Promise<Response> {
  const user = await requireDirector(req);
  const b = await req.json().catch(() => ({}));
  const ids = uuidList(b?.ids), rep = String(b?.sales_rep_id ?? ''), period = monthStart(b?.period), key = String(b?.idempotency_key ?? '');
  const expected = Number(b?.expected_total_cents), paidOn = typeof b?.paid_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on) ? b.paid_on : null;
  if (!ids || !UUID_RE.test(rep) || !period || !UUID_RE.test(key) || !Number.isInteger(expected) || !paidOn) throw new HttpError(400, 'invalid_request');
  const { data, error } = await admin.rpc('sales_payout', { p_actor: user.dpaEmail, p_rep: rep, p_period: period, p_ids: ids, p_expected: expected,
    p_paid_on: paidOn, p_reference: str(b?.reference, 120), p_note: str(b?.note, 500), p_key: key });
  if (error) salesError(error, 'sales_payout');
  return json(req, 200, { payout: data });
}

async function adminDesigns(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const allowed=await adminAllowedMerchantIds(user);
  const { data, error } = await admin.rpc('admin_design_requests');
  if (error) throw new Error('db_admin_designs');
  const rows = (data as any[]).filter((r:any)=>allowed===null||allowed.has(r.merchant_id));
  const emails = await ownerEmails(rows.map(r => r.owner_id));
  const sign = async (p: string | null) => p ? (await admin.storage.from('design-requests').createSignedUrl(p, 3600)).data?.signedUrl ?? null : null;
  const out = await Promise.all(rows.map(async ({ owner_id, logo_path, reference_paths, ...r }) => ({
    ...r, owner_email: emails[owner_id] ?? null,
    logo_url: await sign(logo_path),
    reference_urls: (await Promise.all((reference_paths ?? []).map(sign))).filter(Boolean),
  })));
  return json(req, 200, { requests: out });
}

async function adminDesignStatus(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? ''), status = String(body?.status ?? '');
  if (!UUID_RE.test(id) || !['in_progress', 'delivered'].includes(status)) throw new HttpError(400, 'invalid_request');
  const {data: ref}=await admin.from('design_requests').select('merchant_id').eq('id',id).maybeSingle();
  if(!ref) throw new HttpError(404,'design_request_not_found');
  await assertAdminMerchant(user,ref.merchant_id);
  const { data: row, error } = await admin.rpc('design_set_status', { p_request: id, p_status: status });
  if (error) throw new HttpError(409, /invalid_transition/.test(error.message) ? 'invalid_transition' : 'design_update_failed');
  let email: { sent: boolean; error?: string } | null = null;
  if (status === 'delivered') {
    // The merchant sees "Votre design est prêt." in the dashboard; an e-mail is sent when configured.
    const { data: m } = await admin.from('merchants').select('business_name, created_by').eq('id', row.merchant_id).single();
    const to = row.contact_email || (m ? (await admin.auth.admin.getUserById(m.created_by)).data.user?.email : null);
    if (to) {
      const { text, html } = simpleMail('Votre carte DPA Cards est prête.', [
        ['Commerce', m?.business_name],
        ['Message', 'Votre carte de fidélité créée par DPA Cards est prête. Connectez-vous à votre espace pour la découvrir.'],
      ], [['Ouvrir DPA Cards', PUBLIC_SITE + '/']]);
      email = await sendEmail({ to, subject: 'Votre carte DPA Cards est prête', text, html });
      if (email.sent) await admin.from('design_requests').update({ merchant_notified_at: new Date().toISOString() }).eq('id', id);
    }
  }
  return json(req, 200, { request: { id: row.id, status: row.status, in_progress_at: row.in_progress_at, delivered_at: row.delivered_at }, email });
}

// ---------------------------------------------------------------- card designer (admin)
// One design project per program, shared by the Apple and Google layouts (card_designs).
// The design only describes the look: layout, colours, images, stamp style, typography.
// Customer name, balance, rewards and QR code are never part of it: they are rendered live.

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DESIGN_FONTS = ['hanken', 'space', 'playfair'];
const STAMP_SHAPES = ['circle', 'rounded', 'square'];
const STAMP_STYLES = ['outline', 'soft'];
const STAMP_ICONS = ['library', 'emoji', 'none', 'check', 'star', 'favorite', 'local_cafe', 'local_pizza', 'content_cut', 'restaurant', 'cake', 'spa', 'local_bar', 'icecream', 'bakery_dining', 'custom'];
const savedEmoji = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const emoji = value.trim();
  return [...emoji].length <= 16 && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : '';
};

const ASSET_KINDS = ['logo', 'hero', 'background', 'stamp', 'googleStrip', 'appleStrip', 'appleHeader', 'rewardLabel', 'businessFont', 'businessNameImage'] as const;
type AssetKind = typeof ASSET_KINDS[number];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const hex = (v: unknown, dflt: string) => (typeof v === 'string' && HEX_RE.test(v) ? v.toUpperCase() : dflt);
const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? v as T : dflt);
const int = (v: unknown, min: number, max: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
// Images of the program's own folder: the designer's uploads, or the logo / cover the program already uses.
// `folder` = "<merchant>/<program>" for a real program, "tests/<test id>" for a test card (designer/ only).
const designerPath = (folder: string) => new RegExp(`^${folder}/(designer/)?(logo|hero|background|stamp|googleStrip|appleStrip|appleHeader|rewardLabel|businessNameImage)-[0-9a-f-]{36}\\.(png|jpg)$`);

// Whitelist of the design document; anything else is dropped. Colours of a platform are optional overrides.
function cleanDesign(raw: any, folder: string) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const re = designerPath(folder);
  const fontRe=new RegExp('^'+folder+'/designer/businessFont-[0-9a-f-]{36}\\.(?:ttf|otf|woff2)$');
  const asset = (a: any, kind: AssetKind) => (a && typeof a.path === 'string' && (kind==='businessFont'?fontRe.test(a.path):(re.test(a.path)&&(kind!=='businessNameImage'||a.path.endsWith('.png')))) && a.path.split('/').pop()!.startsWith(`${kind}-`) ? { path: a.path } : null);
  const colors = (c: any, base: Record<string, string> | null) => {
    const o = c && typeof c === 'object' ? c : {};
    if (!base) return Object.fromEntries(['primary', 'secondary', 'text', 'accent'].filter(k => HEX_RE.test(o[k] ?? '')).map(k => [k, String(o[k]).toUpperCase()]));
    return { primary: hex(o.primary, base.primary), secondary: hex(o.secondary, base.secondary), text: hex(o.text, base.text), accent: hex(o.accent, base.accent) };
  };
  const platform = (p: any) => {
    const o = p && typeof p === 'object' ? p : {};
    return { colors: colors(o.colors, null), showHero: o.showHero !== false, showSubtitle: o.showSubtitle !== false, useBackground: o.useBackground === true,
      heroFocus: int(o.heroFocus, 0, 100, 50), label: str(o.label, 16) };
  };
  const s = r.stamps && typeof r.stamps === 'object' ? r.stamps : {};
  const pv = r.preview && typeof r.preview === 'object' ? r.preview : {};
  const assets = r.assets && typeof r.assets === 'object' ? r.assets : {};
  return {
    v: 1,
    identity: { name: str(r.identity?.name, 40), subtitle: str(r.identity?.subtitle, 40) },
    colors: colors(r.colors, { primary: '#1C1F24', secondary: '#2448F0', text: '#FFFFFF', accent: '#F2C94C' }),
    font: pick(r.font, DESIGN_FONTS, 'hanken'),
    label: str(r.label, 16),
    assets: Object.fromEntries(ASSET_KINDS.map(k => [k, asset(assets[k], k)])),
    stamps: { shape: pick(s.shape, STAMP_SHAPES, 'circle'), icon: pick(s.icon, STAMP_ICONS, savedEmoji(s.emoji) ? 'emoji' : 'library'), libraryId: libraryStampId(s.libraryId), emoji: s.icon==='library' ? '' : savedEmoji(s.emoji), style: pick(s.style, STAMP_STYLES, 'outline'),
      filled: hex(s.filled, '#F2C94C'), empty: hex(s.empty, '#FFFFFF'), size: int(s.size, 50, 120, 100), spacing: int(s.spacing, 50, 120, 100), inactiveOpacity: int(s.inactiveOpacity, 0, 100, 22) },
    apple: { ...platform(r.apple), showBusinessName: r.apple?.showBusinessName === true, showStampPanel: r.apple?.showStampPanel !== false, showStamps: r.apple?.showStamps !== false, headerMode: r.apple?.headerMode==='custom'?'custom':'classic', headerArtworkVersion: int(r.apple?.headerArtworkVersion,0,4,0), showReward: r.apple?.showReward === true, rewardText: str(r.apple?.rewardText,64),
      rewardTextColor: HEX_RE.test(r.apple?.rewardTextColor??'')?String(r.apple.rewardTextColor).toUpperCase():'',
      businessNameFont: pick(r.apple?.businessNameFont,['system','hanken','space','playfair','custom'] as const,'system') },
    google: { ...platform(r.google), showStamps:r.google?.showStamps!==false, reuseAppleStrip:r.google?.reuseAppleStrip!==false },
    // Editor only (demo customer, demo progress): never copied to the program.
    preview: { mode: pick(pv.mode, ['passages', 'points'] as const, 'passages'), goal: int(pv.goal, 1, 1000, 10), progress: int(pv.progress, 0, 100000, 3),
      reward: str(pv.reward, 80), available: int(pv.available, 0, 99, 1), client: str(pv.client, 60) },
  };
}

const DRAFT_SELECT = 'config, status, design_request_id, validated_at, updated_at, google_sync_status, google_sync_error, google_synced_at';
const PROGRAM_SELECT = 'id, merchant_id, name, mode, goal, reward, bg, accent, logo, logo_path, hero_path, design_status, design_mode, card_design, card_design_validated_at';
const programView = (p: any) => ({ ...p, logo_url: p.logo_path ? assetUrl(p.logo_path) : null, hero_url: p.hero_path ? assetUrl(p.hero_path) : null });
const withUrls = (c: any) => c && ({ ...c, assets: Object.fromEntries(Object.entries(c.assets ?? {}).map(([k, a]: [string, any]) => [k, a ? { ...a, url: assetUrl(a.path) } : null])) });

async function designProgram(programId: unknown) {
  const id = String(programId ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'invalid_request');
  const { data, error } = await admin.from('programs').select(PROGRAM_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error('db_programs');
  if (!data) throw new HttpError(404, 'program_not_found');
  return data;
}
// Only a paid request of this program can be linked to its design.
async function linkedRequest(id: unknown, program: any) {
  if (id == null || id === '') return null;
  const rid = String(id);
  if (!UUID_RE.test(rid)) throw new HttpError(400, 'invalid_request');
  const { data } = await admin.from('design_requests').select('id, program_id, payment_status').eq('id', rid).maybeSingle();
  if (!data || data.program_id !== program.id || data.payment_status !== 'paid') throw new HttpError(422, 'invalid_design_request');
  return data.id as string;
}

async function adminCardDesigner(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  let merchantId = String(body?.merchant_id ?? ''), programId: string | null = null, requestId: string | null = null;
  if (body?.design_request_id) {
    const rid = String(body.design_request_id);
    if (!UUID_RE.test(rid)) throw new HttpError(400, 'invalid_request');
    const { data: r } = await admin.from('design_requests').select('id, merchant_id, program_id, payment_status').eq('id', rid).maybeSingle();
    if (!r || r.payment_status !== 'paid') throw new HttpError(404, 'design_request_not_found');
    merchantId = r.merchant_id; programId = r.program_id; requestId = r.id;
  }
  if (!UUID_RE.test(merchantId)) throw new HttpError(400, 'invalid_request');
  await assertAdminMerchant(user,merchantId);
  const { data: m0 } = await admin.from('merchants').select('id, business_name, activity, first_name, last_name, phone, address, slug, created_by').eq('id', merchantId).maybeSingle();
  if (!m0) throw new HttpError(404, 'merchant_not_found');
  const { created_by, ...merchant } = m0;
  // Account summary for the designer (owner, public link, subscription, admin-prepared shop and its access link).
  const [{ data: sub }, { data: prepared }, emails] = await Promise.all([
    admin.from('subscriptions').select('status').eq('merchant_id', merchantId).maybeSingle(),
    admin.from('admin_created_merchants').select('created_at, access_sent_at, access_sent_count, access_last_error').eq('merchant_id', merchantId).maybeSingle(),
    ownerEmails([created_by]),
  ]);
  const account = { owner_email: emails[created_by] ?? null, public_url: `${PUBLIC_SITE}/join/${merchant.slug}`, subscription_status: sub?.status ?? null, admin_created: prepared ?? null };
  let q = admin.from('programs').select(PROGRAM_SELECT).eq('merchant_id', merchantId);
  q = programId ? q.eq('id', programId) : q.eq('is_active', true);
  const { data: program } = await q.maybeSingle();
  if (!program) return json(req, 200, { merchant, account, program: null, draft: null, request: null, requests: [] });
  const { data: draft } = await admin.from('card_designs').select(DRAFT_SELECT).eq('program_id', program.id).maybeSingle();
  const sign = async (p: string | null) => p ? (await admin.storage.from('design-requests').createSignedUrl(p, 3600)).data?.signedUrl ?? null : null;
  const { data: reqs } = await admin.from('design_requests')
    .select('id, status, paid_at, colors, description, contact_name, contact_email, contact_phone, logo_path, reference_paths')
    .eq('program_id', program.id).eq('payment_status', 'paid').order('paid_at', { ascending: false });
  const requests = await Promise.all((reqs ?? []).map(async ({ logo_path, reference_paths, ...r }) => ({
    ...r, logo_url: await sign(logo_path), reference_urls: (await Promise.all((reference_paths ?? []).map(sign))).filter(Boolean),
  })));
  const current = requestId ?? draft?.design_request_id ?? requests.find(r => r.status === 'submitted' || r.status === 'in_progress')?.id ?? null;
  return json(req, 200, {
    merchant, account, program: { ...programView(program), card_design: withUrls(program.card_design) },
    draft: draft ? { ...draft, config: withUrls(draft.config) } : null,
    request: requests.find(r => r.id === current) ?? null, requests,
  });
}

// Signed upload to program-assets/<merchant>/<program>/designer/<kind>-<uuid>.<ext> (PNG or JPEG, 2 MB, bucket rules).
async function adminCardUpload(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const program = await designProgram(body?.program_id);
  await assertAdminMerchant(user,program.merchant_id);
  const kind = String(body?.kind ?? '') as AssetKind, type = String(body?.type ?? '');
  const extension=kind==='businessFont'?({'font/ttf':'ttf','font/otf':'otf','font/woff2':'woff2'} as Record<string,string>)[type]:null;
  if(!ASSET_KINDS.includes(kind)||(kind==='businessFont'?!extension:kind==='businessNameImage'?type!=='image/png':!['image/png','image/jpeg'].includes(type)))throw new HttpError(400,'invalid_request');
  const path = `${program.merchant_id}/${program.id}/designer/${kind}-${crypto.randomUUID()}.${extension || (type === 'image/png' ? 'png' : 'jpg')}`;
  const { data, error } = await admin.storage.from('program-assets').createSignedUploadUrl(path);
  if (error || !data) throw new Error('storage_signed_upload');
  return json(req, 200, { path, token: data.token, url: assetUrl(path) });
}

// Validate actual bytes before persisting logo/stamp references, including drafts
// and demo cards. Upload URLs authorize only unique, server-selected paths.
async function validateDesignPng(config: any) {
  const font=config.assets?.businessFont?.path;
  if(font){
    const {data,error}=await admin.storage.from('program-assets').download(font);
    if(error||!data||data.size>1048576)throw new HttpError(422,'invalid_business_font');
    const bytes=new Uint8Array(await data.slice(0,4).arrayBuffer()),magic=String.fromCharCode(...bytes),ext=font.split('.').pop();
    const valid=ext==='otf'&&magic==='OTTO'||ext==='woff2'&&magic==='wOF2'||ext==='ttf'&&bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0;
    if(!valid)throw new HttpError(422,'invalid_business_font');
  }
  const googleArt=config.assets?.googleStrip?.path;
  if(googleArt){
    const {data,error}=await admin.storage.from('program-assets').download(googleArt);
    if(error || !data)throw new HttpError(422,'missing_googleStrip');
    try { await decodePanelArt(new Uint8Array(await data.arrayBuffer()), { maxBytes: 15728640 }); }
    catch { throw new HttpError(422,'invalid_googleStrip'); }
  }
  for(const kind of ['logo','stamp','appleHeader','rewardLabel','businessNameImage','appleStrip']) {
    const path=config.assets?.[kind]?.path;
    if(!path || (kind!=='appleStrip' && !path.endsWith('.png')))continue; // legacy JPEG assets remain compatible
    const {data,error}=await admin.storage.from('program-assets').download(path);
    if(error || !data)throw new HttpError(422,`missing_${kind}`);
    if(data.size>2097152)throw new HttpError(422,`invalid_${kind}`);
    try {
      const bytes=new Uint8Array(await data.arrayBuffer());
      const img=kind==='appleStrip' ? await decodePanelArt(bytes) : await decodePng(bytes);
      if(kind==='businessNameImage') {
        let ink=false,transparent=false;
        for(let i=3;i<img.pixels.length;i+=4){
          if(img.pixels[i]>=8)ink=true;
          if(img.pixels[i]<255)transparent=true;
          if(ink&&transparent)break;
        }
        if(!ink||!transparent)throw new Error('transparent_name_required');
      }
    }catch{throw new HttpError(422,`invalid_${kind}`);}
  }
}

async function adminCardSave(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const program = await designProgram(body?.program_id);
  await assertAdminMerchant(user,program.merchant_id);
  const config = cleanDesign(body?.config, `${program.merchant_id}/${program.id}`);
  await validateDesignPng(config);
  const design_request_id = await linkedRequest(body?.design_request_id, program);
  // Saving a draft never touches the program, the request status or the applied design.
  const { data, error } = await admin.from('card_designs').upsert({ merchant_id: program.merchant_id, program_id: program.id, design_request_id, config, status: 'draft', updated_by: user.id },
    { onConflict: 'program_id' }).select(DRAFT_SELECT).single();
  if (error) throw new Error('db_card_designs');
  return json(req, 200, { draft: { ...data, config: withUrls(data.config) } });
}

// Existing class of the program → same class id, new branding (GET, merge, PUT so a removed hero is
// really removed). Objects reference the class, so every card already in Google Wallet shows the new
// branding with its own name, balance, card number, QR and messages unchanged; nothing is recreated.
async function updateClassBranding(programId: string) {
  const { data: program } = await admin.from('programs').select('id, merchant_id, name, bg, logo_path, hero_path, design_status, card_design').eq('id', programId).single();
  if (!program) throw new Error('db_programs');
  const { data: row } = await admin.from('wallet_classes').select('google_class_id').eq('program_id', programId).maybeSingle();
  // No class yet: it will be created from this design by the first "Ajouter à Google Wallet".
  if (!row) return { status: 'no_class' as const };
  const { data: m } = await admin.from('merchants').select('business_name').eq('id', program.merchant_id).single();
  const id = encodeURIComponent(row.google_class_id);
  const got = await google('GET', `/loyaltyClass/${id}`);
  if (got.status === 404) return { status: 'no_class' as const };
  if (got.status !== 200) throw gErr('class_get', got);
  const next = { ...got.data, ...classBranding(program, m?.business_name ?? ''), reviewStatus: 'UNDER_REVIEW' };
  if (!classBranding(program, m?.business_name ?? '').heroImage) delete next.heroImage;
  const put = await google('PUT', `/loyaltyClass/${id}`, next);
  if (put.status !== 200) throw gErr('class_update', put);
  return { status: 'synced' as const };
}
// Records the outcome on the design project; a failure never undoes the validated design.
async function syncDesignToGoogle(programId: string) {
  let out: { status: 'synced' | 'no_class' | 'error'; error: string | null };
  try { out = { ...(await updateClassBranding(programId)), error: null }; }
  catch (e) { out = { status: 'error', error: String((e as Error).message).slice(0, 300) }; console.error('wallet error', 'class-branding', out.error); }
  await admin.from('card_designs').update({ google_sync_status: out.status, google_sync_error: out.error, ...(out.status === 'error' ? {} : { google_synced_at: new Date().toISOString() }) }).eq('program_id', programId);
  return out;
}

async function adminCardGoogleSync(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const program = await designProgram(body?.program_id);
  await assertAdminMerchant(user,program.merchant_id);
  if (!program.card_design) throw new HttpError(409, 'design_not_validated');
  const google = await syncDesignToGoogle(program.id);
  const { data: draft } = await admin.from('card_designs').select(DRAFT_SELECT).eq('program_id', program.id).maybeSingle();
  return json(req, 200, { google, draft: draft ? { ...draft, config: withUrls(draft.config) } : null });
}

// Applies the design to the program. The design request keeps its status ("Marquer comme livré" stays separate).
async function adminCardValidate(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const program = await designProgram(body?.program_id);
  await assertAdminMerchant(user,program.merchant_id);
  const config = cleanDesign(body?.config, `${program.merchant_id}/${program.id}`);
  await validateDesignPng(config);
  const design_request_id = await linkedRequest(body?.design_request_id, program);
  // Every image must exist and really be a PNG or JPEG.
  const fit: Record<string, boolean> = {};
  for (const kind of ASSET_KINDS) {
    const a = (config.assets as any)[kind]; if (!a) continue;
    if(kind==='businessFont')continue; // validateDesignPng already verifies font magic and size.
    const { data: f } = await admin.storage.from('program-assets').download(a.path);
    if (!f) throw new HttpError(422, `missing_${kind}`);
    const bytes = new Uint8Array(await f.arrayBuffer()), info = imageInfo(bytes);
    if (!info) throw new HttpError(422, `invalid_${kind}`);
    if (kind === 'logo' || kind === 'hero') { const rule = IMAGE_RULES[kind]; fit[kind] = (rule.types as readonly string[]).includes(info.type) && bytes.length <= rule.maxBytes && rule.ok(info.w, info.h); }
  }
  const { preview: _preview, ...applied } = config;
  const now = new Date().toISOString();
  // The fields the existing card and Google Wallet class already read follow the design (only images that meet their rules).
  const patch: Record<string, unknown> = { card_design: applied, card_design_validated_at: now, bg: config.colors.primary, accent: config.colors.secondary };
  // A shop prepared by the admin gets its card from DPA Cards: its draft program becomes a finished
  // DPA design (the merchant then lands on the dashboard, not on the onboarding card step).
  if (program.design_status === 'draft') {
    const { data: prepared } = await admin.from('admin_created_merchants').select('merchant_id').eq('merchant_id', program.merchant_id).maybeSingle();
    if (prepared) Object.assign(patch, { design_status: 'validated', design_mode: 'dpa', design_validated_at: now });
  }
  if (config.assets.logo && fit.logo) patch.logo_path = config.assets.logo.path;
  if (config.assets.hero && fit.hero) patch.hero_path = config.assets.hero.path;
  const { data: saved, error } = await admin.from('programs').update(patch).eq('id', program.id).select(PROGRAM_SELECT).single();
  if (error) throw new Error('db_programs');
  const { data: draft, error: de } = await admin.from('card_designs').upsert({ merchant_id: program.merchant_id, program_id: program.id, design_request_id, config, status: 'validated', validated_at: now, updated_by: user.id, google_sync_status: 'pending', google_sync_error: null },
    { onConflict: 'program_id' }).select(DRAFT_SELECT).single();
  if (de) throw new Error('db_card_designs');
  // Then the Google Wallet class (best effort: an error is stored and can be retried from the admin).
  const google = await syncDesignToGoogle(program.id);
  return json(req, 200, { program: { ...programView(saved), card_design: withUrls(saved.card_design) },
    draft: { ...draft, config: withUrls(draft.config), google_sync_status: google.status, google_sync_error: google.error }, google });
}

// ---------------------------------------------------------------- admin: "Ajouter un client"
// A merchant account prepared by DPA Cards. The login is created without a password (the merchant
// app signs in with a password): "Envoyer l'accès au commerçant" later sends the standard
// "choose your password" link. No subscription is created, so the dashboard stays locked as usual.

// Configurable production address shared by admin invites and customer emails.
// Set DPA_SITE_URL in Supabase secrets during the hosting cutover.
const PUBLIC_SITE = (Deno.env.get('DPA_SITE_URL') ?? 'https://cards.digitalprojectagency.fr').replace(/\/$/, '');
const SLUG_MAX = 24; // create_merchant keeps the first 24 characters
const multiline = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const initialsOf = (name: string) => name.normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 4).toUpperCase() || 'DPA';

async function adminMerchantCreate(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  const o = b?.owner ?? {}, biz = b?.business ?? {}, pr = b?.program ?? {};
  const first = str(o.first, 80), last = str(o.last, 80), email = str(o.email, 254).toLowerCase(), phone = str(o.phone, 40);
  const business = str(biz.name, 120), activity = str(biz.activity, 60), address = str(biz.address, 200), slug = str(biz.slug, 60).toLowerCase();
  const mode = pr.mode === 'points' ? 'points' : 'passages', goal = Math.round(Number(pr.goal));
  const reward = str(pr.reward, 120), programName = str(pr.name, 80) || `Club ${business}`.slice(0, 80), conditions = multiline(pr.conditions, 600);
  const bad = (field: string) => json(req, 422, { error: 'invalid_' + field });
  if (!first) return bad('first');
  if (!EMAIL_RE.test(email)) return bad('email');
  if (!business) return bad('business');
  if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX) return bad('slug');
  if (mode === 'passages' ? !(goal >= 3 && goal <= 20) : !(goal >= 50 && goal <= 1000)) return bad('goal');
  if (!reward) return bad('reward');

  // Duplicates: never two shops on one slug, one login, or silently on the same name.
  const { data: taken } = await admin.from('merchants').select('id').eq('slug', slug).maybeSingle();
  if (taken) return json(req, 409, { error: 'slug_taken' });
  const { data: same } = await admin.from('merchants').select('business_name').ilike('business_name', business.replace(/[%_\\]/g, m => '\\' + m)).limit(3);
  if ((same ?? []).length && b?.allow_same_name !== true) return json(req, 409, { error: 'business_exists', existing: same!.map(x => x.business_name) });
  const { data: found, error: fe } = await admin.rpc('admin_user_by_email', { p_email: email });
  if (fe) throw new Error('db_user_by_email');
  const existing = (found ?? [])[0];
  if (existing?.has_merchant) return json(req, 409, { error: 'email_has_merchant' });
  // An existing login without a shop (it signed up, or is an admin) can own the new shop, on explicit request only.
  if (existing && b?.attach_existing !== true) return json(req, 409, { error: 'email_exists' });

  let userId = existing?.user_id as string | undefined, created = false;
  if (!userId) {
    const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { first_name: first, last_name: last, business_name: business } });
    if (error || !u?.user) return json(req, 409, { error: 'email_exists' });
    userId = u.user.id; created = true;
  }
  const { data, error } = await admin.rpc('admin_create_merchant', {
    p_user: userId, p_business: business, p_first: first, p_last: last, p_activity: activity, p_slug: slug,
    p_program: { name: programName, mode, goal, reward, conditions, logo: initialsOf(business) }, p_phone: phone, p_address: address,
  });
  if (error) {
    if (created) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    if (/user_has_merchant|merchants_one_per_creator|merchant_members_one_merchant_per_user/.test(error.message)) return json(req, 409, { error: 'email_has_merchant' });
    if (/merchants_slug_key/.test(error.message)) return json(req, 409, { error: 'slug_taken' });
    console.error('wallet error', 'admin-merchant-create', error.code);
    throw new Error('db_admin_create_merchant');
  }
  const m = data.merchant, p = data.program;
  // The rep is the admin of this verified session (never a value sent by the browser). The shop
  // still belongs to its owner; a failure here never undoes the creation (the director can attribute it).
  const { data: att, error: ae } = await admin.rpc('sales_attribute', { p_merchant: m.id, p_rep: null, p_actor: user.dpaEmail, p_source: 'admin_creation', p_reason: null });
  if (ae) console.error('wallet error', 'admin-merchant-create attribution', ae.code);
  return json(req, 200, {
    merchant: { id: m.id, business_name: m.business_name, activity: m.activity, address: m.address, phone: m.phone, slug: m.slug, first_name: m.first_name, last_name: m.last_name },
    program: { id: p.id, name: p.name, mode: p.mode, goal: p.goal, reward: p.reward, conditions: p.conditions },
    owner: { email, attached: !created }, public_url: `${PUBLIC_SITE}/join/${m.slug}`, subscription: null,
    sales_attribution: ae ? { attributed: false, reason: 'error' } : att,
  });
}

// "Envoyer l'accès au commerçant": the standard password link (same e-mail as « Mot de passe oublié »),
// only for shops prepared by the admin and only when the admin asks.
async function adminMerchantAccess(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.merchant_id ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'invalid_request');
  await assertAdminMerchant(user,id);
  const { data: m } = await admin.from('merchants').select('id, created_by').eq('id', id).maybeSingle();
  if (!m) throw new HttpError(404, 'merchant_not_found');
  const { data: row } = await admin.from('admin_created_merchants').select('access_sent_count').eq('merchant_id', id).maybeSingle();
  if (!row) throw new HttpError(409, 'not_admin_created');
  const email = (await admin.auth.admin.getUserById(m.created_by)).data.user?.email;
  if (!email) throw new HttpError(409, 'owner_missing');
  const origin = req.headers.get('origin') ?? '';
  const redirectTo = PUBLIC_SITE + '/';
  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
  const errCode = error ? String((error as any).code || error.message || 'email_failed').slice(0, 300) : null;
  const now = new Date().toISOString();
  await admin.from('admin_created_merchants').update(error ? { access_last_error: errCode } : { access_sent_at: now, access_sent_count: row.access_sent_count + 1, access_last_error: null }).eq('merchant_id', id);
  if (error) return json(req, 502, { error: 'access_email_failed', detail: errCode });
  return json(req, 200, { sent: true, email, sent_at: now });
}

// ---------------------------------------------------------------- admin: test cards ("Créer une carte test")
// Demo cards made with the same designer, linked to no merchant, program, customer or subscription
// (test_card_designs). Images: program-assets/tests/<id>/designer/. QR: DPA_TEST:<qr_token>, which the
// scanner shows as « Carte de démonstration » and lookup_card can never match (real cards are DPA1:).
// Google Wallet: own class / object ids (…dpa-test-class-<id>, …dpa-test-<id>), never a real program's.

const TEST_SELECT = 'id, created_by, name, config, test_balance, qr_token, google_class_id, google_object_id, google_synced_at, created_at, updated_at';
const testFolder = (id: string) => `tests/${id}`;
// Stamp progress is server-owned. Admin saves never overwrite the real scan counter.
const testConfig = (t: any) => ({ ...t.config, preview: { ...(t.config?.preview ?? {}), progress: Number(t.test_balance) || 0 } });
const testView = (t: any) => ({ ...t, progress: Number(t.test_balance) || 0, config: withUrls(testConfig(t)), qr_value: `DPA_TEST:${t.qr_token}`, card_number: `TEST ${String(t.id).slice(0, 4).toUpperCase()} ${String(t.qr_token).slice(0, 4).toUpperCase()}` });
async function testRow(id: unknown, user?: any) {
  const tid = String(id ?? '');
  if (!UUID_RE.test(tid)) throw new HttpError(400, 'invalid_request');
  const { data, error } = await admin.from('test_card_designs').select(TEST_SELECT).eq('id', tid).maybeSingle();
  if (error) throw new Error('db_test_cards');
  if (!data) throw new HttpError(404, 'test_card_not_found');
  if(user?.dpaRole!=='director' && data.created_by!==user?.id) throw new HttpError(403,'test_card_forbidden');
  return data;
}
async function testFiles(id: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of ['', '/designer']) {
    const { data } = await admin.storage.from('program-assets').list(testFolder(id) + sub, { limit: 1000 });
    for (const it of data ?? []) if (it.id) out.push(`${testFolder(id)}${sub}/${it.name}`);
  }
  return out;
}

async function adminTestCards(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  let q=admin.from('test_card_designs').select(TEST_SELECT).order('updated_at',{ascending:false}).limit(200);
  if(user.dpaRole!=='director') q=q.eq('created_by',user.id);
  const { data, error } = await q;
  if (error) throw new Error('db_test_cards');
  return json(req, 200, { tests: (data ?? []).map(testView) });
}
async function adminTestCardGet(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  return json(req, 200, { test: testView(await testRow(body?.id,user)) });
}
// Creates (no id) or updates a test card. Its design goes through the same whitelist as a real one.
async function adminTestCardSave(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const name = str(body?.name, 80) || 'Carte test';
  if (body?.id) {
    const t = await testRow(body.id,user);
    const config=cleanDesign(body?.config,testFolder(t.id));
    await validateDesignPng(config);
    const { data, error } = await admin.from('test_card_designs').update({ name, config }).eq('id', t.id).select(TEST_SELECT).single();
    if (error) throw new Error('db_test_cards');
    return json(req, 200, { test: testView(data) });
  }
  const id = crypto.randomUUID();
  const config = cleanDesign(body?.config ?? {}, testFolder(id));
  config.preview.progress = 0;
  config.preview.mode = 'passages';
  const { data, error } = await admin.from('test_card_designs').insert({ id, name, config, created_by: user.id }).select(TEST_SELECT).single();
  if (error) throw new Error('db_test_cards');
  return json(req, 200, { test: testView(data) });
}
async function adminTestCardUpload(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  const kind = String(body?.kind ?? '') as AssetKind, type = String(body?.type ?? '');
  const extension=kind==='businessFont'?({'font/ttf':'ttf','font/otf':'otf','font/woff2':'woff2'} as Record<string,string>)[type]:null;
  if(!ASSET_KINDS.includes(kind)||(kind==='businessFont'?!extension:kind==='businessNameImage'?type!=='image/png':!['image/png','image/jpeg'].includes(type)))throw new HttpError(400,'invalid_request');
  const path = `${testFolder(t.id)}/designer/${kind}-${crypto.randomUUID()}.${extension || (type === 'image/png' ? 'png' : 'jpg')}`;
  const { data, error } = await admin.storage.from('program-assets').createSignedUploadUrl(path);
  if (error || !data) throw new Error('storage_signed_upload');
  return json(req, 200, { path, token: data.token, url: assetUrl(path) });
}
// Copy: new id, new QR, its own copies of the images; no Google Wallet object.
async function adminTestCardDuplicate(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  const id = crypto.randomUUID(), cfg = JSON.parse(JSON.stringify(t.config ?? {}));
  for (const kind of ASSET_KINDS) {
    const a = cfg.assets?.[kind]; if (!a?.path) continue;
    const to = `${testFolder(id)}/designer/${kind}-${crypto.randomUUID()}.${a.path.split('.').pop()}`;
    const { error } = await admin.storage.from('program-assets').copy(a.path, to);
    cfg.assets[kind] = error ? null : { path: to };
  }
  const name = `Copie de ${t.name}`.slice(0, 80);
  const clean = cleanDesign(cfg, testFolder(id)); clean.preview.progress = 0;
  const { data, error } = await admin.from('test_card_designs').insert({ id, name, config: clean, created_by: user.id }).select(TEST_SELECT).single();
  if (error) throw new Error('db_test_cards');
  return json(req, 200, { test: testView(data) });
}
// Removes the test card, its images and deactivates its Google Wallet demo object. Nothing else is touched.
async function adminTestCardDelete(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  const files = await testFiles(t.id);
  if (files.length) await admin.storage.from('program-assets').remove(files);
  const wallet = t.google_object_id ? await deactivateObjects([t.google_object_id], 8000) : null;
  const { error } = await admin.from('test_card_designs').delete().eq('id', t.id);
  if (error) throw new Error('db_test_cards');
  return json(req, 200, { deleted: true, files: files.length, wallet });
}
// A new unique test QR (the old one stops matching this card).
async function adminTestCardNewQr(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  const { data, error } = await admin.from('test_card_designs').update({ qr_token: crypto.randomUUID() }).eq('id', t.id).select(TEST_SELECT).single();
  if (error) throw new Error('db_test_cards');
  return json(req, 200, { test: testView(data) });
}

// Authenticated scanners can operate only on a disposable test-card QR.
// No merchant_id, real card, customer, balance or card_events are referenced.
const TEST_QR_RE = /^DPA_TEST:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
async function scanTestRow(req: Request, code: unknown) {
  await authUser(req);
  const match = TEST_QR_RE.exec(String(code ?? '').trim());
  if (!match) throw new HttpError(400, 'invalid_test_qr');
  const { data, error } = await admin.from('test_card_designs').select(TEST_SELECT).eq('qr_token',match[1].toLowerCase()).maybeSingle();
  if (error) throw new Error('db_test_cards');
  if (!data) throw new HttpError(404, 'test_card_not_found');
  return data;
}
const scannerTestView = (t: any) => ({
  name: String(t.name || 'Carte test'), progress: Number(t.test_balance)||0,
  goal: Math.max(1,Math.min(1000,Number(t.config?.preview?.goal)||10)),
  mode: t.config?.preview?.mode === 'points' ? 'points' : 'passages',
  stamp_id: t.config?.stamps?.icon === 'library' ? libraryStampId(t.config?.stamps?.libraryId) : '',
  code: `DPA_TEST:${t.qr_token}`, is_test: true,
});
async function testScanLookup(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const t = await scanTestRow(req,body?.code);
  return json(req,200,{test:scannerTestView(t)});
}
async function testScanAdd(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const t = await scanTestRow(req,body?.code);
  const expected = body?.expected_progress;
  if (!Number.isInteger(expected) || expected<0) throw new HttpError(400,'invalid_test_progress');
  const current = Number(t.test_balance)||0;
  const goal = Math.max(1,Math.min(1000,Number(t.config?.preview?.goal)||10));
  if (current>=goal) throw new HttpError(409,'test_goal_reached');
  if (expected!==current) throw new HttpError(409,'test_progress_changed');
  const {data: next,error} = await admin.rpc('wallet_test_increment',{p_token:t.qr_token,p_expected:expected});
  if(error) throw new Error('db_test_scan');
  if(next===null) throw new HttpError(409,'test_progress_changed');
  // Google Wallet test passes can refresh. Apple passes must be re-added manually
  // until the PassKit update web service/APNs are deployed.
  let googleSynced = false;
  if(t.google_object_id) {
    try {
      const currentGoogle=await google('GET',`/loyaltyObject/${encodeURIComponent(t.google_object_id)}`);
      if(currentGoogle.status===200){
        const mode=t.config?.preview?.mode==='points'?'points':'passages';
        const patch:any={...currentGoogle.data,
          ...walletCounter(next,goal,mode),
          ...(hasSavedStampArt(t.config)?{heroImage:{sourceUri:{uri:await stampBoardUrl(t.id,Date.now(),true)}}}:{})};
        const updated=await google('PUT',`/loyaltyObject/${encodeURIComponent(t.google_object_id)}`,patch);
        googleSynced=updated.status===200;
      }
    } catch { /* The successful test scan must not be rolled back for a remote outage. */ }
  }
  return json(req,200,{test:{...scannerTestView(t),progress:next},google_synced:googleSynced});
}

// "Ajouter à Google Wallet" for a test card: a real demo pass in its own class, with the demo data.
// Only administrators may create Apple download links for isolated demo cards.
async function adminTestCardApple(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  if (!Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM') || !Deno.env.get('APPLE_PASS_CERT_PEM')) {
    throw new HttpError(503, 'apple_wallet_not_configured');
  }
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    b => b.toString(16).padStart(2, '0')).join('');
  const { error } = await admin.from('apple_wallet_test_links').upsert({
    test_card_id: t.id, token_hash: hash,
    expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
  }, { onConflict: 'test_card_id' });
  if (error) throw new Error('db_apple_test_link');
  return json(req, 200, { url: SUPABASE_URL + '/functions/v1/apple-pass?token=' + encodeURIComponent(token) });
}

async function adminTestCardWallet(req: Request): Promise<Response> {
  const user=await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const t = await testRow(body?.id,user);
  if (!ISSUER_ID) throw new HttpError(503, 'wallet_not_configured');
  try { sa(); } catch { throw new HttpError(503, 'wallet_not_configured'); }
  const d = t.config ?? {}, pv = d.preview ?? {}, colors = { ...(d.colors ?? {}), ...(d.google?.colors ?? {}) };
  const text = (value: string) => ({ defaultValue: { language: 'fr-FR', value } });
  // Only images that meet the Google rules (same as real programs); otherwise the generic DPA Cards logo.
  const fits = async (kind: 'logo' | 'hero') => {
    const p = d.assets?.[kind]?.path; if (!p || !designerPath(testFolder(t.id)).test(p)) return null;
    const { data: f } = await admin.storage.from('program-assets').download(p); if (!f) return null;
    const bytes = new Uint8Array(await f.arrayBuffer()), info = imageInfo(bytes), rule = IMAGE_RULES[kind];
    return info && (rule.types as readonly string[]).includes(info.type) && bytes.length <= rule.maxBytes && rule.ok(info.w, info.h) ? p : null;
  };
  const [logo, hero] = await Promise.all([fits('logo'), fits('hero')]);
  const issuer = String(d.identity?.name || 'Carte test DPA Cards').slice(0, 40);
  const classId = `${ISSUER_ID}.dpa-test-class-${t.id}`, objectId = `${ISSUER_ID}.dpa-test-${t.id}`;
  const branding = {
    issuerName: issuer, programName: hasSavedStampArt(d) ? issuer : 'Carte de démonstration',
    programLogo: { sourceUri: { uri: logo ? assetUrl(logo) : LOGO_URL }, contentDescription: text(issuer) },
    ...(hero && d.google?.showHero !== false ? { heroImage: { sourceUri: { uri: assetUrl(hero) }, contentDescription: text(issuer) } } : {}),
    hexBackgroundColor: HEX_RE.test(colors.primary ?? '') ? colors.primary : '#1C1F24',
    accountNameLabel: 'Client', accountIdLabel: 'N° de carte',
  };
  const cg = await google('GET', `/loyaltyClass/${encodeURIComponent(classId)}`);
  if (cg.status === 404) { const r = await google('POST', '/loyaltyClass', { id: classId, ...branding, reviewStatus: 'UNDER_REVIEW', countryCode: 'FR' }); if (r.status !== 200 && r.status !== 409) throw gErr('test_class_insert', r); }
  else if (cg.status === 200) { const next: any = { ...cg.data, ...branding, reviewStatus: 'UNDER_REVIEW' }; if (!branding.heroImage) delete next.heroImage;
    const r = await google('PUT', `/loyaltyClass/${encodeURIComponent(classId)}`, next); if (r.status !== 200) throw gErr('test_class_update', r); }
  else throw gErr('test_class_get', cg);
  const mode = pv.mode === 'points' ? 'points' : 'passages', view = testView(t);
  const object = {
    id: objectId, classId, state: 'ACTIVE',
    accountId: hasSavedStampArt(d) ? walletCardDigits(view.card_number) : view.card_number,
    ...(hasSavedStampArt(d) ? {} : {accountName:String(pv.client || 'Client test').slice(0,60)}),
    ...(hasSavedStampArt(d) ? {
      heroImage:{sourceUri:{uri:await stampBoardUrl(t.id,Date.now(),true)}},
    } : {}),
    ...(hasSavedStampArt(d) ? walletCounter(t.test_balance||0,pv.goal||10,mode)
      : {loyaltyPoints:{label:unitLabel(mode),balance:{int:Math.max(0,Math.round(Number(pv.progress)||0))}}}),
    barcode: { type: 'QR_CODE', value: view.qr_value, alternateText: 'CARTE TEST' },
    textModulesData: hasSavedStampArt(d) ? [] : [
      { id: 'reward', header: 'Récompense', body: `${pv.goal ?? 10} ${mode} = ${pv.reward || 'Récompense'}` },
      { id: 'demo', header: 'Carte de démonstration', body: 'Carte de test DPA Cards : elle n’appartient à aucun commerce et n’a aucune valeur.' },
    ],
  };
  const og = await google('GET', `/loyaltyObject/${encodeURIComponent(objectId)}`);
  if (og.status === 404) { const r = await google('POST', '/loyaltyObject', object); if (r.status !== 200 && r.status !== 409) throw gErr('test_object_insert', r); }
  else if (og.status === 200) {
    const next:any={...og.data,...object};
    if(hasSavedStampArt(d)) delete next.accountName; // an old saved demo may have the former Client field
    const r=await google('PUT',`/loyaltyObject/${encodeURIComponent(objectId)}`,next);
    if(r.status!==200)throw gErr('test_object_update',r);
  }
  else throw gErr('test_object_get', og);
  await admin.from('test_card_designs').update({ google_class_id: classId, google_object_id: objectId, google_synced_at: new Date().toISOString() }).eq('id', t.id);
  const origin = req.headers.get('origin');
  const jwt = await signJwt({ iss: sa().client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000),
    origins: origin && ALLOWED_ORIGINS.includes(origin) ? [origin] : [], payload: { loyaltyObjects: [{ id: objectId }] } });
  return json(req, 200, { url: `https://pay.google.com/gp/v/save/${jwt}`, class_id: classId, object_id: objectId });
}

async function sync(req: Request): Promise<Response> {
  const secret = req.headers.get('x-wallet-worker') ?? '';
  const { data: ok } = await admin.rpc('wallet_check_worker', { p_secret: secret });
  if (ok !== true) throw new HttpError(401, 'not_authenticated');
  const result = await runSync(25);
  return json(req, 200, result);
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method === 'GET' && path.includes('/stamp-board/')) return await publicStampBoard(req,path);
    if (req.method === 'GET' && path.endsWith('/logo.png')) {
      return new Response(Uint8Array.from(atob(LOGO_PNG_BASE64), c => c.charCodeAt(0)), {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
      });
    }
    if (req.method === 'POST' && path.endsWith('/save-link')) return await saveLink(req);
    if (req.method === 'POST' && path.endsWith('/apple-link')) return await appleLink(req);
    if (req.method === 'POST' && path.endsWith('/public-program')) return await publicProgram(req);
    if (req.method === 'POST' && path.endsWith('/join')) return await publicJoin(req);
    if (req.method === 'POST' && path.endsWith('/notify')) return await notify(req);
    if (req.method === 'POST' && path.endsWith('/delete-customer')) return await deleteCustomer(req);
    if (req.method === 'POST' && path.endsWith('/delete-account')) return await deleteAccount(req);
    if (req.method === 'POST' && path.endsWith('/merchant-access')) return await merchantAccess(req);
    if (req.method === 'POST' && path.endsWith('/admin-overview')) return await adminOverview(req);
    if (req.method === 'POST' && path.endsWith('/admin-merchant')) return await adminMerchant(req);
    if (req.method === 'POST' && path.endsWith('/admin-manual-access')) return await adminManualAccess(req);
    if (req.method === 'POST' && path.endsWith('/admin-designs')) return await adminDesigns(req);
    if (req.method === 'POST' && path.endsWith('/admin-design-status')) return await adminDesignStatus(req);
    if (req.method === 'POST' && path.endsWith('/admin-card-designer')) return await adminCardDesigner(req);
    if (req.method === 'POST' && path.endsWith('/admin-card-upload')) return await adminCardUpload(req);
    if (req.method === 'POST' && path.endsWith('/admin-card-save')) return await adminCardSave(req);
    if (req.method === 'POST' && path.endsWith('/admin-card-validate')) return await adminCardValidate(req);
    if (req.method === 'POST' && path.endsWith('/admin-card-google-sync')) return await adminCardGoogleSync(req);
    if (req.method === 'POST' && path.endsWith('/admin-merchant-create')) return await adminMerchantCreate(req);
    if (req.method === 'POST' && path.endsWith('/admin-merchant-access')) return await adminMerchantAccess(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales')) return await adminSales(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales-attribute')) return await adminSalesAttribute(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales-rule')) return await adminSalesRule(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales-validate')) return await adminSalesValidate(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales-cancel')) return await adminSalesCancel(req);
    if (req.method === 'POST' && path.endsWith('/admin-sales-payout')) return await adminSalesPayout(req);
    if (req.method === 'POST' && path.endsWith('/test-scan-lookup')) return await testScanLookup(req);
    if (req.method === 'POST' && path.endsWith('/test-scan-add')) return await testScanAdd(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-cards')) return await adminTestCards(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-get')) return await adminTestCardGet(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-save')) return await adminTestCardSave(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-upload')) return await adminTestCardUpload(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-duplicate')) return await adminTestCardDuplicate(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-delete')) return await adminTestCardDelete(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-new-qr')) return await adminTestCardNewQr(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-wallet')) return await adminTestCardWallet(req);
    if (req.method === 'POST' && path.endsWith('/admin-test-card-apple')) return await adminTestCardApple(req);
    if (req.method === 'POST' && path.endsWith('/finalize-design')) return await finalizeDesign(req);
    if (req.method === 'POST' && path.endsWith('/sync')) return await sync(req);
    return json(req, 404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.code });
    // Error codes only: no token, key or Google payload ever reaches the logs.
    console.error('wallet error', path, (e as Error).message);
    return json(req, 502, { error: 'wallet_unavailable' });
  }
});
