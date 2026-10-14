// DPA Cards: creates a signed Apple Wallet pass from one real loyalty card.
// GET /functions/v1/apple-pass?token=<opaque bearer token>
// Signing material is never accessible in the browser or repository.
// This is the first-install endpoint: live Wallet updates require a separate
// Apple PassKit web service + APNs registration, not implemented here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PKPass } from 'npm:passkit-generator@3.6.1';
import { Buffer } from 'node:buffer';
import { Image } from 'npm:imagescript@1.3.1';
import { realApplePassData, hex } from './real-card.js';

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
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const reply = (status, code) => new Response(JSON.stringify({ error: code }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
function hexHash(bytes) { return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function rgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#2448F0';
  const c = [1, 3, 5].map(i => parseInt(hex.substring(i, i + 2), 16));
  return 'rgb(' + c.join(', ') + ')';
}
function textColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 'rgb(255, 255, 255)';
  const rgb = [1, 3, 5].map(i => parseInt(hex.substring(i, i + 2), 16));
  const lightness = rgb.reduce((n, v, i) => n + (v / 255) * [0.2126, 0.7152, 0.0722][i], 0);
  return lightness > 0.62 ? 'rgb(24, 28, 37)' : 'rgb(255, 255, 255)';
}

let wwdrPromise;
async function wwdrCert() {
  if (!wwdrPromise) wwdrPromise = (async () => {
    const url = 'https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer';
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('apple_intermediate_unavailable');
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return '-----BEGIN CERTIFICATE-----\n' + base64.match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  })().catch(e => { wwdrPromise = null; throw e; });
  return wwdrPromise;
}
async function brandedLogo(program) {
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

async function createDemoPass(testId, signerKey, signerCert) {
  const { data: t, error } = await supabase.from('test_card_designs')
    .select('id, name, config, qr_token').eq('id', testId).maybeSingle();
  if (error || !t) throw new SafeError(404, 'test_card_not_found');
  const d = t.config || {}, pv = d.preview || {}, name = String(d.identity?.name || t.name || 'DPA Cards').slice(0, 40);
  const primary = d.apple?.colors?.primary || d.colors?.primary || '#2448F0';
  const mode = pv.mode === 'points' ? 'POINTS' : 'PASSAGES';
  const balance = Math.max(0, Math.round(Number(pv.progress) || 0));
  const goal = Math.max(1, Math.round(Number(pv.goal) || 10));
  const barcode = { format: 'PKBarcodeFormatQR', message: 'DPA_TEST:' + t.qr_token, messageEncoding: 'iso-8859-1', altText: 'CARTE TEST' };
  const json = {
    formatVersion: 1, passTypeIdentifier: PASS_TYPE_ID, teamIdentifier: TEAM_ID,
    serialNumber: 'test-' + t.id, organizationName: name,
    description: 'Démonstration DPA Cards – sans valeur commerciale',
    logoText: name, backgroundColor: rgb(primary), foregroundColor: textColor(primary),
    labelColor: textColor(primary),
    storeCard: {
      primaryFields: [{ key: 'progress', label: mode, value: balance + ' / ' + goal }],
      secondaryFields: [{ key: 'client', label: 'CARTE DE DÉMONSTRATION', value: String(pv.client || 'Client test').slice(0, 60) }],
      auxiliaryFields: [
        { key: 'reward', label: 'RÉCOMPENSE FICTIVE', value: String(pv.reward || 'Récompense test').slice(0, 80) },
        { key: 'number', label: 'N°', value: 'TEST ' + t.id.slice(0, 8).toUpperCase() },
      ],
      backFields: [{ key: 'notice', label: 'DPA Cards – test',
        value: "Cette carte est une démonstration. Aucun commerce, client, abonnement ou point de fidélité réel n'y est associé." }],
    },
    barcode, barcodes: [barcode],
  };
  const fallback = Buffer.from(ICON_B64, 'base64');
  const logoPath = d.assets?.logo?.path;
  const logo = await brandedLogo({ logo_path: typeof logoPath === 'string' && logoPath.startsWith('tests/' + testId + '/designer/') ? logoPath : null }) || fallback;
  const pass = new PKPass({
    'icon.png': fallback, 'icon@2x.png': fallback, 'logo.png': logo,
    'pass.json': Buffer.from(JSON.stringify(json), 'utf8'),
  }, {
    wwdr: await wwdrCert(),
    signerCert: signerCert.replace(/\\n/g, '\n'),
    signerKey: signerKey.replace(/\\n/g, '\n'),
  });
  return { pkpass: await pass.getAsBuffer(), cardId: null, merchantId: null };
}

// Artwork for REAL passes only. All paths are restricted to this card's own program
// by realAppleBrand(); the service key is never used with a browser-provided path.
const rgbaNum = (color, alpha = 255) => parseInt(hex(color, '#2448F0').slice(1), 16) * 256 + alpha;
async function storedImage(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('program-assets').download(path);
    if (error || !data || data.size > 2_500_000) return null;
    const original = await Image.decode(new Uint8Array(await data.arrayBuffer()));
    if (!original.width || !original.height || original.width * original.height > 12_000_000) return null;
    return original;
  } catch {
    // An absent/bad logo or cover must never prevent a customer's valid pass.
    return null;
  }
}
async function realCardImages(brand, balance, goal) {
  const images = {};
  const source = await storedImage(brand.logo);
  if (source) {
    try {
      for (const scale of [1, 2]) {
        const width = 160 * scale, height = 50 * scale;
        const logo = new Image(width, height);
        logo.fill(0x00000000);
        const fit = source.clone().contain(width - 16 * scale, height - 8 * scale);
        logo.composite(fit, Math.floor((width - fit.width) / 2), Math.floor((height - fit.height) / 2));
        images[scale === 1 ? 'logo.png' : 'logo@2x.png'] = Buffer.from(await logo.encode());
      }
      // The lock screen icon belongs to this commerce, not to the DPA test brand.
      for (const scale of [1, 2]) {
        const side = 29 * scale;
        const icon = new Image(side, side);
        icon.fill(rgbaNum(brand.primary));
        const mark = source.clone().contain(side - 8 * scale, side - 8 * scale);
        icon.composite(mark, Math.floor((side - mark.width) / 2), Math.floor((side - mark.height) / 2));
        images[scale === 1 ? 'icon.png' : 'icon@2x.png'] = Buffer.from(await icon.encode());
      }
    } catch {
      // Keep the fallback DPA icon only when the conversion truly fails.
      delete images['logo.png']; delete images['logo@2x.png'];
    }
  }
  // Apple store cards use a strip, not a freely positioned full-size background.
  // iOS decides where to put native fields and may not show strip artwork on recent versions.
  try {
    const cover = await storedImage(brand.artwork);
    const W = 750, H = 246;
    const banner = new Image(W, H);
    banner.fill(rgbaNum(brand.primary));
    if (cover) {
      const ratio = Math.max(W / cover.width, H / cover.height);
      const scaled = cover.resize(Math.ceil(cover.width * ratio), Math.ceil(cover.height * ratio));
      const left = Math.max(0, Math.floor((scaled.width - W) / 2));
      const top = Math.max(0, Math.floor((scaled.height - H) * brand.heroFocus / 100));
      banner.composite(scaled.crop(left, top, W, H), 0, 0);
      // Native progress fields are drawn over the left part of the strip.
      const shade = new Image(370, H);
      shade.fill(rgbaNum(brand.primary, 235));
      banner.composite(shade, 0, 0);
    } else {
      const right = new Image(370, H);
      right.fill(rgbaNum(brand.secondary));
      banner.composite(right, 380, 0);
      // Stamp-style decoration, derived from the client's REAL progress, no fake demo data.
      const count = Math.max(1, Math.min(10, Math.round(goal)));
      const complete = Math.max(0, Math.min(count, Math.floor(balance / goal * count)));
      const columns = count > 5 ? 5 : count;
      const rows = Math.ceil(count / columns);
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / columns), col = i % columns;
        const x = Math.round(420 + (columns === 1 ? 130 : col * 63));
        const y = rows === 1 ? 126 : 76 + row * 94;
        if (i < complete) {
          banner.drawCircle(x, y, 23, rgbaNum(brand.stamps?.filled, 255) || rgbaNum(brand.accent));
        } else {
          banner.drawCircle(x, y, 23, rgbaNum(brand.stamps?.empty, 170));
          banner.drawCircle(x, y, 18, rgbaNum(brand.secondary));
        }
      }
    }
    images['strip@2x.png'] = Buffer.from(await banner.encode());
    images['strip.png'] = Buffer.from(await banner.clone().resize(375, 123).encode());
  } catch {
    // Native text and barcode still make this pass usable.
  }
  return images;
}

async function createPass(token) {
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

  const { data: card, error: cardError } = await supabase.from('cards')
    .select('id, merchant_id, customer_id, program_id, card_number, qr_token').eq('id', link.card_id).maybeSingle();
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
  // Read the merchant's approved Apple design, never the designer's DEMO preview.
  const { brand, json, balance, goal } = realApplePassData({
    program, merchant: merchantResult.data, customer: customerResult.data,
    card, balance: eventResult.data?.[0]?.balance_after || 0,
  });
  const fallback = Buffer.from(ICON_B64, 'base64');
  const imageFiles = await realCardImages(brand, balance, goal);
  const pass = new PKPass({
    'icon.png': fallback, 'icon@2x.png': fallback,
    ...imageFiles,
    'pass.json': Buffer.from(JSON.stringify(json), 'utf8'),
  }, {
    wwdr: await wwdrCert(),
    signerCert: certPem.replace(/\\n/g, '\n'),
    signerKey: keyPem.replace(/\\n/g, '\n'),
  });
  return { pkpass: await pass.getAsBuffer(), cardId: card.id, merchantId: card.merchant_id };
}
Deno.serve(async req => {
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
