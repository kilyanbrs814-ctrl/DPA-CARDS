import { decodePng } from '../_shared/png.js';
import { loadRewardStamp } from '../_shared/reward-stamp.js';
import { libraryStampId, loadLibraryStamp } from '../_shared/stamp-library.js';
// DPA Cards: creates a signed Apple Wallet pass from one real loyalty card.
// GET /functions/v1/apple-pass?token=<opaque bearer token>
// Signing material is never accessible in the browser or repository.
// This is the first-install endpoint: live Wallet updates require a separate
// Apple PassKit web service + APNs registration, not implemented here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { passAuthToken, passServiceUrl } from './auth.js';
import { handlePasskit } from './web-service.js';
import { processPassUpdates } from './push.js';
import { notifyApple } from './campaigns.js';
import { PKPass } from 'npm:passkit-generator@3.6.1';
import { Buffer } from 'node:buffer';
import { realApplePassData, visibleCardNumber, testAssetPath, appleHeaderName } from './real-card.js';
import { decodePanelArt, makeRealStrip, makeDemoStrip, makeDemoLogo, makeAppleHeaderLogo } from './real-strip.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
function serviceKey() { try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k.default) return k.default; } catch {} return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; }
const SERVICE_KEY = serviceKey();
const PASS_TYPE_ID = 'pass.fr.digitalprojectagency.cards';
const TEAM_ID = 'HDK7R3283T';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAABnElEQVR4nGPkWtDEQAPARAtDR80dNXfUXKyABc4SZud6FFHMwMDw69/fDz9/nH37rOPioTNvnsHFGRgYPv76ceTlo4IT2559+8zAwJCnZdFu6srAwGC6cea1D6/wuff82+diSzsiD6xS5xfZ6RFvICwJF+de2Jx7fKu3rNoECy+IYJyqwYvvX/4zMMSrGqCZgyUcfv/7d+LVk/pz+ziYWZLVjJCldjy5zcDAoCsozsDAYCoirSkgOu36qX3P7kUp67ExMRMwFwLufnrHwMCgxCuILOgho8rAwHD5/UsGBoZ4VYM///8tvnNh3q1zQuycPnLqyCpZGHAAVT5hBgaGe5/fQ7iGwpJf42s//fq5/cntopPbuVhYQxV1WBiZ7ocVQRTEqxqse3ANn7msTExGwlL1Ro4///6de+scRPD82+c2W+bA1cSo6POwsgXuWb7r6R0GBoZ2E9ccLXMZbr4nXz9hDwdDYck3MZUrncJuf3zrtmPBhbfPsfomXtXw3///J14/hnCPv3rMxMgYq2IAV8A4Wl+Mmjtq7pA3FwDGM5K4BAgMHQAAAABJRU5ErkJggg==';

class SafeError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const reply = (status: number, code: string) => new Response(JSON.stringify({ error: code }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
function hexHash(bytes: ArrayBuffer | Uint8Array) { return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function rgb(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#2448F0';
  const c = [1, 3, 5].map(i => parseInt(hex.substring(i, i + 2), 16));
  return 'rgb(' + c.join(', ') + ')';
}
function textColor(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 'rgb(255, 255, 255)';
  const rgb = [1, 3, 5].map(i => parseInt(hex.substring(i, i + 2), 16));
  const lightness = rgb.reduce((n, v, i) => n + (v / 255) * [0.2126, 0.7152, 0.0722][i], 0);
  return lightness > 0.62 ? 'rgb(24, 28, 37)' : 'rgb(255, 255, 255)';
}

let wwdrPromise: Promise<string> | null = null;
async function wwdrCert() {
  if (!wwdrPromise) wwdrPromise = (async () => {
    const url = 'https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer';
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('apple_intermediate_unavailable');
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return '-----BEGIN CERTIFICATE-----\n' + (base64.match(/.{1,64}/g) ?? []).join('\n') + '\n-----END CERTIFICATE-----\n';
  })().catch(e => { wwdrPromise = null; throw e; });
  return wwdrPromise;
}
async function brandedLogo(program: { logo_path?: string | null }) {
  // Program-controlled paths are never used as a target hostname.
  const path = program.logo_path;
  let url = SUPABASE_URL + '/functions/v1/wallet/logo.png';
  if (path && typeof path === 'string' && !path.includes('..')) {
    url = SUPABASE_URL + '/storage/v1/object/public/program-assets/' +
      path.split('/').map(encodeURIComponent).join('/');
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type') || '';
    const bytes = Buffer.from(await response.arrayBuffer());
    return mime.includes('image/png') && bytes.length < 2_000_000 ? bytes : null;
  } catch { return null; }
}

async function createDemoPass(testId: string, signerKey: string, signerCert: string) {
  const { data: t, error } = await supabase.from('test_card_designs')
    .select('id, name, config, qr_token, test_balance').eq('id', testId).maybeSingle();
  if (error || !t) throw new SafeError(404, 'test_card_not_found');
  // Use this test card's own saved designer config, not DPA's default template.
  const d = t.config || {}, pv = d.preview || {};
  const name = String(d.identity?.name || t.name || 'DPA Cards').slice(0, 40);
  const composedPath=d.apple?.headerMode==='custom' && d.apple?.showBusinessName===true && d.apple?.headerArtworkVersion===4
    ? testAssetPath(d.assets?.appleHeader,testId,'appleHeader') : null;
  const primary = d.apple?.colors?.primary || d.colors?.primary || '#2448F0';
  const accent = d.colors?.accent || '#F2C94C';
  const label = String(d.apple?.label || d.label || (pv.mode === 'points' ? 'POINTS' : 'TAMPONS')).slice(0, 16);
  const balance = Math.max(0, Math.round(Number(t.test_balance) || 0));
  const goal = Math.max(1, Math.round(Number(pv.goal) || 10));
  const barcode = { format: 'PKBarcodeFormatQR', message: 'DPA_TEST:' + t.qr_token,
    messageEncoding: 'iso-8859-1', altText: 'Par DPA Cards' };
  const json = {
    formatVersion: 1, passTypeIdentifier: PASS_TYPE_ID, teamIdentifier: TEAM_ID,
    // Each preview gets a fresh demo serial. Wallet otherwise reuses the old
    // installed card with the same serial even when its design has changed.
    serialNumber: 'test-' + t.id + '-' + crypto.randomUUID(),
    organizationName: name,
    ...(d.apple?.showBusinessName === true && !composedPath ? { logoText: appleHeaderName(name) } : {}),
    description: 'Démonstration DPA Cards – sans valeur commerciale',
    backgroundColor: rgb(primary), foregroundColor: textColor(primary),
    labelColor: textColor(primary),
    storeCard: (d.stamps?.emoji || d.stamps?.icon==='custom' || d.stamps?.icon==='library') ? {
      // Same visible fields as the real saved loyalty pass. The test QR stays
      // DPA_TEST: and the test UUID never becomes a real card identifier.
      headerFields: [{key:'number',label:'',value:visibleCardNumber('TEST '+t.id.slice(0,4)+' '+t.qr_token.slice(0,4))}],
      primaryFields: [{key:'artwork',label:'',value:'\u00a0'}],
      secondaryFields: [
        {key:'done',label:pv.mode==='points'?'Points gagnés':'Passages effectués',value:String(balance),textAlignment:'PKTextAlignmentLeft'},
        {key:'remaining',label:pv.mode==='points'?'Points restants':'Passages restants',value:String(Math.max(0,goal-balance)),textAlignment:'PKTextAlignmentRight'},
      ],
      backFields: [
        {key:'demo',label:'DÉMONSTRATION',value:'Cette carte ne possède aucune valeur commerciale.'},
        {key:'reward',label:'RÉCOMPENSE SIMULÉE',value:String(pv.reward || 'Récompense test').slice(0,80)},
        ...(d.stamps?.icon==='emoji' ? [{key:'emoji_credits',label:'ILLUSTRATIONS',value:'Noto Emoji (Google, Apache 2.0) ; Twemoji (Twitter, CC BY 4.0) — github.com/jdecked/twemoji'}] : []),
        ...(d.apple?.showSubtitle!==false && d.identity?.subtitle
          ? [{key:'subtitle',label:'LE COMMERCE',value:String(d.identity.subtitle).slice(0,80)}]:[]),
      ],
    } : {
      primaryFields: [{ key: 'progress', label: label.toUpperCase(),
        value: balance + '/' + goal }],
      secondaryFields: [
        { key: 'client', label: 'CLIENT', value: String(pv.client || 'Client test').slice(0, 60) },
        { key: 'reward', label: 'RÉCOMPENSE', value: String(pv.reward || 'Récompense test').slice(0, 80) },
      ],
      auxiliaryFields: [
        { key: 'available', label: 'DISPONIBLES', value: Math.max(0, Number(pv.available) || 0) },
        { key: 'number', label: 'CARTE TEST', value: 'TEST ' + t.id.slice(0, 8).toUpperCase() },
      ],
      backFields: [
        ...(d.apple?.showSubtitle !== false && d.identity?.subtitle ?
          [{ key: 'subtitle', label: 'DÉMONSTRATION', value: String(d.identity.subtitle).slice(0, 80) }] : []),
        { key: 'notice', label: 'DPA Cards – test', value:
          "Cette carte est une démonstration. Aucun commerce, client, abonnement ou point de fidélité réel n'y est associé." },
      ],
    },
    barcode, barcodes: [barcode],
  };
  const fallback = Buffer.from(ICON_B64, 'base64');
  const images: Record<string, Uint8Array> = { 'icon.png': fallback, 'icon@2x.png': fallback };
  try {
    const icon = await makeDemoLogo(name, accent, 1, 'icon');
    const icon2 = await makeDemoLogo(name, accent, 2, 'icon');
    images['icon.png'] = Buffer.from(icon);
    images['icon@2x.png'] = Buffer.from(icon2);
  } catch { /* Keep the valid fallback icon. */ }

  const testAsset = (kind: string) => testAssetPath(d.assets?.[kind],testId,kind);
  const uploaded=await realLogo(testAsset('logo'));
  const composed=composedPath ? await realLogo(composedPath) : null;
  if(composedPath && !composed)throw new SafeError(422,'invalid_apple_header');
  const compact=d.apple?.showBusinessName===true && !composedPath;
  images['logo.png']=Buffer.from(await makeAppleHeaderLogo(name,accent,primary,composed||uploaded,1,compact));
  images['logo@2x.png']=Buffer.from(await makeAppleHeaderLogo(name,accent,primary,composed||uploaded,2,compact));
  const stampBytes=d.stamps?.icon==='custom' ? await realLogo(testAsset('stamp')) : null;
  const selectedLibrary=d.stamps?.icon==='library'?libraryStampId(d.stamps.libraryId):'';
  const stamp=stampBytes ? await decodePng(stampBytes) : selectedLibrary ? await loadLibraryStamp(selectedLibrary) : null;
  if((d.stamps?.icon==='custom' && testAsset('stamp') || selectedLibrary) && !stamp) throw new SafeError(422,'invalid_stamp');
  const rewardPath=d.apple?.showReward===true ? testAsset('rewardLabel') : null;
  const rewardBytes=rewardPath ? await realLogo(rewardPath) : null;
  if(rewardPath && !rewardBytes)throw new SafeError(422,'invalid_reward_label');
  const rewardArt=rewardBytes ? await decodePng(rewardBytes) : null;
  const panelArt=await loadPanelArt(testAsset('appleStrip'));
  const finalStar=await loadRewardStamp(d.stamps?.rewardId);
  if(rewardArt && (rewardArt.width!==630||rewardArt.height!==52))throw new SafeError(422,'invalid_reward_label');
  // Apple displays its native primary text on top of the strip image. It cannot
  // use the exact HTML layout, but the two-row colored stamps and blue gradient
  // now come from the same saved config as the Apple preview.
  try {
    images['strip.png'] = Buffer.from(await makeDemoStrip({...d,preview:{...pv,progress:balance}}, 1, stamp, rewardArt, finalStar, panelArt));
    images['strip@2x.png'] = Buffer.from(await makeDemoStrip({...d,preview:{...pv,progress:balance}}, 2, stamp, rewardArt, finalStar, panelArt));
    // Retain an exact 1125×432 rendition when a custom full-width image is used.
    // Skip the extra CPU/storage for old cards without custom strip artwork.
    if(panelArt)images['strip@3x.png'] = Buffer.from(await makeDemoStrip({...d,preview:{...pv,progress:balance}}, 3, stamp, rewardArt, finalStar, panelArt));
  } catch { console.error('apple-pass demo strip unavailable'); }
  const pass = new PKPass({ ...images, 'pass.json': Buffer.from(JSON.stringify(json), 'utf8') }, {
    wwdr: await wwdrCert(),
    signerCert: signerCert.replace(/\\n/g, '\n'),
    signerKey: signerKey.replace(/\\n/g, '\n'),
  });
  return { pkpass: await pass.getAsBuffer(), cardId: null, merchantId: null };
}

// Real cards only. Do not change how demo/test passes are signed and delivered.
// Some merchants have a real PNG logo saved by the design tool; use its native
// bytes. Never download arbitrary URLs or another merchant's assets.
async function realLogo(path: string | null) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('program-assets').download(path);
    if (error || !data || data.size > 2097152) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    await decodePng(bytes);
    return Buffer.from(bytes);
  } catch { return null; }
}

async function loadPanelArt(path: string | null) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('program-assets').download(path);
    if (error || !data || data.size > 2097152) throw new Error('invalid_asset');
    return await decodePanelArt(new Uint8Array(await data.arrayBuffer()));
  } catch { throw new SafeError(422, 'invalid_apple_strip'); }
}

async function createPass(token: string) {
  if (!/^[A-Za-z0-9_-]{24,160}$/.test(token)) throw new SafeError(401, 'invalid_link');
  const keyPem = Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM') || '';
  const certPem = Deno.env.get('APPLE_PASS_CERT_PEM') || '';
  if (!keyPem.includes('PRIVATE KEY-----') || !certPem.includes('BEGIN CERTIFICATE-----')) {
    throw new SafeError(503, 'apple_wallet_not_configured');
  }

  const tokenHash = hexHash(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const { data: link, error: linkError } = await supabase.from('apple_wallet_links')
    .select('card_id, expires_at').eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString()).maybeSingle();
  if (linkError) throw new Error('db_link');
  if (!link) {
    const { data: demoLink, error: demoError } = await supabase.from('apple_wallet_test_links')
      .select('test_card_id').eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (demoError) throw new Error('db_test_link');
    if (!demoLink) throw new SafeError(404, 'link_expired');
    return createDemoPass(demoLink.test_card_id, keyPem, certPem);
  }

  return createRealPass(link.card_id);
}

async function createRealPass(cardId: string) {
  const keyPem = Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM') || '';
  const certPem = Deno.env.get('APPLE_PASS_CERT_PEM') || '';
  if (!keyPem || !certPem) throw new SafeError(503, 'apple_wallet_not_configured');
  const { data: card, error: cardError } = await supabase.from('cards')
    .select('id, merchant_id, customer_id, program_id, card_number, qr_token').eq('id', cardId).maybeSingle();
  if (cardError || !card) throw new SafeError(404, 'card_not_found');
  const [access, programResult, merchantResult, customerResult, eventResult] = await Promise.all([
    supabase.rpc('merchant_has_access', { p_merchant: card.merchant_id }),
    supabase.from('programs').select('id, name, mode, goal, reward, bg, card_design, logo_path, design_status').eq('id', card.program_id).eq('merchant_id', card.merchant_id).single(),
    supabase.from('merchants').select('business_name').eq('id', card.merchant_id).single(),
    supabase.from('customers').select('first_name, last_name').eq('id', card.customer_id).eq('merchant_id', card.merchant_id).single(),
    supabase.from('card_events').select('seq, balance_after').eq('card_id', card.id).order('seq', { ascending: false }).limit(1),
  ]);
  if (access.error || access.data !== true) throw new SafeError(403, 'program_unavailable');
  if (programResult.error || merchantResult.error || customerResult.error || eventResult.error) throw new Error('db_pass');
  const program = programResult.data;
  if (!program || program.design_status !== 'validated') throw new SafeError(409, 'design_pending');
  // Native Store Card fields read only from the validated real program.
  // No designer test-card values, third-party image libraries or WASM at startup.
  const { brand, json, balance, goal } = realApplePassData({
    program, merchant: merchantResult.data, customer: customerResult.data,
    card, balance: eventResult.data?.[0]?.balance_after || 0,
  });
  const fallback = Buffer.from(ICON_B64, 'base64');
  const logo = await realLogo(brand.logo);
  const composed=brand.appleHeader ? await realLogo(brand.appleHeader) : null;
  if(brand.appleHeader && !composed)throw new SafeError(422,'invalid_apple_header');
  const compact=brand.showBusinessName && !brand.appleHeader;
  const assets: Record<string, Uint8Array> = {
    'icon.png': fallback, 'icon@2x.png': Buffer.from(await makeDemoLogo('DPA',brand.accent,2,'icon')),
    ...(logo ? { 'logo.png': logo, 'logo@2x.png': logo } : {}),
  };
  assets['logo.png']=Buffer.from(await makeAppleHeaderLogo(brand.issuer,brand.accent,brand.primary,composed||logo,1,compact));
  assets['logo@2x.png']=Buffer.from(await makeAppleHeaderLogo(brand.issuer,brand.accent,brand.primary,composed||logo,2,compact));
  const stampBytes=brand.stamp ? await realLogo(brand.stamp) : null;
  const stamp=stampBytes ? await decodePng(stampBytes) : brand.libraryId ? await loadLibraryStamp(brand.libraryId) : null;
  if((brand.stamp || brand.libraryId) && !stamp) throw new SafeError(422,'invalid_stamp');
  const rewardBytes=brand.rewardLabel ? await realLogo(brand.rewardLabel) : null;
  if(brand.rewardLabel && !rewardBytes)throw new SafeError(422,'invalid_reward_label');
  const rewardArt=rewardBytes ? await decodePng(rewardBytes) : null;
  const panelArt=await loadPanelArt(brand.appleStrip);
  const finalStar=await loadRewardStamp(brand.stamps?.rewardId);
  if(rewardArt && (rewardArt.width!==630||rewardArt.height!==52))throw new SafeError(422,'invalid_reward_label');
  // Strip is optional: a rendering issue should not prevent a customer from
  // receiving a valid pass containing all native fields and QR code.
  try {
    assets['strip.png'] = Buffer.from(await makeRealStrip(brand, balance, goal, 1, stamp, rewardArt, finalStar, panelArt));
    assets['strip@2x.png'] = Buffer.from(await makeRealStrip(brand, balance, goal, 2, stamp, rewardArt, finalStar, panelArt));
    if(panelArt)assets['strip@3x.png'] = Buffer.from(await makeRealStrip(brand, balance, goal, 3, stamp, rewardArt, finalStar, panelArt));
  } catch {
    console.error('apple-pass real strip unavailable');
  }
  const {data:notice,error:noticeError}=await supabase.from('apple_wallet_changes')
    .select('message_text,changed_at').eq('card_id',card.id).maybeSingle();
  if(noticeError)throw new Error('db_apple_changes');
  const nextJson: any = {
    ...json, webServiceURL:passServiceUrl(SUPABASE_URL),
    authenticationToken:await passAuthToken(card.id,keyPem),
  };
  if(notice?.message_text && nextJson.storeCard) {
    nextJson.storeCard = {...nextJson.storeCard,backFields:[
      ...(nextJson.storeCard.backFields||[]),
      {key:'notice',label:'MESSAGE DU COMMERCE',
       value:notice.message_text+' · '+new Date(notice.changed_at).toISOString(),
       changeMessage:'%@'},
    ]};
  }
  const pass = new PKPass({
    ...assets, 'pass.json': Buffer.from(JSON.stringify(nextJson), 'utf8'),
  }, {
    wwdr: await wwdrCert(),
    signerCert: certPem.replace(/\\n/g, '\n'),
    signerKey: keyPem.replace(/\\n/g, '\n'),
  });
  return { pkpass: await pass.getAsBuffer(), cardId: card.id, merchantId: card.merchant_id };
}
Deno.serve(async req => {
  if (new URL(req.url).pathname.endsWith('/apple-pass/notify')) return notifyApple(req,{admin:supabase});
  if (new URL(req.url).pathname.endsWith('/apple-pass/push') && req.method === 'POST') {
    return processPassUpdates(req,{admin:supabase});
  }
  if (new URL(req.url).pathname.includes('/apple-pass/v1/')) {
    return handlePasskit(req,{admin:supabase,signerKey:Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM')||'',renderPass:createRealPass});
  }
  if (req.method !== 'GET') return reply(405, 'method_not_allowed');
  try {
    const token = new URL(req.url).searchParams.get('token') || '';
    const { pkpass, cardId, merchantId } = await createPass(token);
    if (cardId) {
      // One real signed .pkpass delivered per distinct card; test passes never count.
      // This is not proof that the user tapped Add in Apple Wallet.
      const { error: statsError } = await supabase.from('apple_wallet_downloads')
        .upsert({ card_id: cardId, merchant_id: merchantId }, { onConflict: 'card_id', ignoreDuplicates: true });
      if (statsError) throw new Error('db_apple_downloads');
    }
    return new Response(new Uint8Array(pkpass), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.apple.pkpass',
        'content-disposition': 'attachment; filename="DPA-Cards.pkpass"',
        'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (e) {
    if (e instanceof SafeError) return reply(e.status, e.code);
    // No token, card data or signing key appears in API error responses or logs.
    console.error('apple-pass generation failed', e instanceof Error ? e.name : 'unknown');
    return reply(502, 'apple_wallet_unavailable');
  }
});
