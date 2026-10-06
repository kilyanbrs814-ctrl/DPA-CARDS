// DPA Cards — one-off Stripe configuration (test mode by default).
//
// Creates or reuses, idempotently:
//   - product "DPA Cards" (subscription prices) and the custom design product
//   - 5 prices, found again through their lookup_key (the billing Edge Function looks them up
//     by lookup_key and checks the amount, so no price id is stored in the secrets):
//       dpa_setup_no_commitment   49,00 € one-time
//       dpa_monthly_no_commitment 24,90 € / month
//       dpa_setup_commitment      29,00 € one-time
//       dpa_monthly_commitment    19,90 € / month
//       dpa_custom_design         29,90 € one-time
//     When an amount changes, a new price takes over the lookup_key and every other active
//     price of these products is archived (existing subscriptions keep billing normally).
//   - webhook endpoint → <SUPABASE_URL>/functions/v1/billing/webhook
//   - 2 Billing Portal configurations: default (cancellation at period end) and
//     commitment (cancellation disabled while the 12-month commitment runs)
//
// Usage:
//   node scripts/stripe-setup.mjs --key-file <file with STRIPE_SECRET_KEY=...> [--out <secrets.env>] [--design-product <prod_...>] [--live]
// <secrets.env> (optional) is written for `supabase secrets set --env-file`; keep it outside the repo and delete it after.
// --design-product reuses an existing product for the custom design price.
// A live key (sk_live_) is refused unless --live is given.

import fs from 'node:fs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const keyFile = arg('--key-file'), out = arg('--out'), designProductArg = arg('--design-product'), live = process.argv.includes('--live');
const SUPABASE_URL = 'https://fiuffxchvjcghcvfaout.supabase.co';
if (!keyFile) { console.error('usage: --key-file <file> [--out <secrets.env>] [--design-product <prod_...>] [--live]'); process.exit(1); }
const keyText = fs.readFileSync(keyFile, 'utf8');
const KEY = (/STRIPE_SECRET_KEY\s*=\s*(\S+)/.exec(keyText) || /\b((?:sk|rk)_(?:test|live)_\S+)/.exec(keyText) || [])[1];
if (!KEY) { console.error('STRIPE_SECRET_KEY introuvable dans le fichier'); process.exit(1); }
if (/^(sk|rk)_live_/.test(KEY) && !live) { console.error('Clé live refusée sans --live'); process.exit(1); }

async function api(method, path, params) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const url = 'https://api.stripe.com/v1' + path + (method === 'GET' && body ? '?' + body : '');
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2025-02-24.acacia' }, body: method === 'GET' ? undefined : body });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${j.error && j.error.message}`);
  return j;
}
function flatten(o, prefix = '', acc = []) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flatten(v, key, acc); else if (v !== undefined) acc.push([key, String(v)]);
  }
  return acc;
}

// Same amounts as PRICES in supabase/functions/billing/index.ts.
const PRICES = [
  ['dpa_setup_no_commitment', 4900, null, 'Frais de mise en place — sans engagement', 'main'],
  ['dpa_monthly_no_commitment', 2490, 'month', 'Abonnement mensuel — sans engagement', 'main'],
  ['dpa_setup_commitment', 2900, null, 'Frais de mise en place — engagement 12 mois', 'main'],
  ['dpa_monthly_commitment', 1990, 'month', 'Abonnement mensuel — engagement 12 mois', 'main'],
  ['dpa_custom_design', 2990, null, 'Création de carte sur mesure', 'design'],
];
const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'invoice.finalized'];

(async () => {
  const acct = await api('GET', '/account');
  console.log(`Compte Stripe ${acct.id} (${live ? 'LIVE' : 'test'})`);

  const products = await api('GET', '/products/search', { query: "metadata['app']:'dpa-cards'" });
  const product = products.data[0] || await api('POST', '/products', { name: 'DPA Cards', metadata: { app: 'dpa-cards' } });
  console.log('Produit :', product.id);

  const designProduct = designProductArg ? await api('GET', `/products/${designProductArg}`)
    : (await api('GET', '/products/search', { query: "metadata['app']:'dpa-cards-design'" })).data[0]
      || await api('POST', '/products', { name: 'DPA Cards — Création de carte sur mesure', metadata: { app: 'dpa-cards-design' } });
  console.log('Produit design :', designProduct.id);

  const ids = {};
  const found = await api('GET', '/prices', { ...Object.fromEntries(PRICES.map((p, i) => [`lookup_keys[${i}]`, p[0]])), limit: 10 });
  for (const [lookup, amount, interval, nickname, prod] of PRICES) {
    let p = found.data.find(x => x.lookup_key === lookup && x.active && x.unit_amount === amount && x.currency === 'eur');
    if (!p) p = await api('POST', '/prices', { product: prod === 'design' ? designProduct.id : product.id, currency: 'eur', unit_amount: amount, lookup_key: lookup, transfer_lookup_key: true, nickname, tax_behavior: 'inclusive', ...(interval ? { recurring: { interval } } : {}) });
    ids[lookup] = p.id; console.log(`Prix ${lookup} : ${p.id} (${(amount / 100).toFixed(2)} €)`);
  }
  // Older prices of these products are archived so they can never be used again.
  const keep = new Set(Object.values(ids));
  for (const prodId of [product.id, designProduct.id]) {
    const olds = await api('GET', '/prices', { product: prodId, active: true, limit: 100 });
    for (const o of olds.data) if (!keep.has(o.id)) { await api('POST', `/prices/${o.id}`, { active: false }); console.log(`Ancien prix archivé : ${o.id} (${(o.unit_amount / 100).toFixed(2)} €)`); }
  }

  const hookUrl = `${SUPABASE_URL}/functions/v1/billing/webhook`;
  const hooks = await api('GET', '/webhook_endpoints', { limit: 100 });
  let webhookSecret = null, hook = hooks.data.find(h => h.url === hookUrl);
  if (hook) {
    await api('POST', `/webhook_endpoints/${hook.id}`, { enabled_events: Object.fromEntries(EVENTS.map((e, i) => [i, e])) });
    console.log(`Webhook existant ${hook.id} (secret non récupérable : garder celui déjà configuré)`);
  } else {
    hook = await api('POST', '/webhook_endpoints', { url: hookUrl, enabled_events: Object.fromEntries(EVENTS.map((e, i) => [i, e])), api_version: '2025-02-24.acacia', description: 'DPA Cards → Supabase billing' });
    webhookSecret = hook.secret; console.log('Webhook créé :', hook.id);
  }

  const configs = await api('GET', '/billing_portal/configurations', { limit: 100 });
  const portal = async (name, cancel) => {
    const existing = configs.data.find(c => c.metadata && c.metadata.dpa === name && c.active);
    const params = {
      business_profile: { headline: 'DPA Cards — gérer mon abonnement' },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: { 0: 'email', 1: 'address', 2: 'tax_id' } },
        subscription_cancel: cancel ? { enabled: true, mode: 'at_period_end' } : { enabled: false },
        subscription_update: { enabled: false },
      },
      metadata: { dpa: name },
    };
    const c = existing ? await api('POST', `/billing_portal/configurations/${existing.id}`, params) : await api('POST', '/billing_portal/configurations', params);
    console.log(`Portail ${name} : ${c.id}`); return c.id;
  };
  const portalDefault = await portal('default', true), portalCommitment = await portal('commitment', false);

  if (!out) { if (webhookSecret) console.log('ATTENTION : webhook créé sans --out, son secret est perdu : supprimez-le dans Stripe puis relancez avec --out.'); return; }
  const lines = [
    `STRIPE_SECRET_KEY=${KEY}`,
    `STRIPE_PORTAL_CONFIG_DEFAULT=${portalDefault}`,
    `STRIPE_PORTAL_CONFIG_COMMITMENT=${portalCommitment}`,
  ];
  if (webhookSecret) lines.push(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`);
  fs.writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Secrets écrits dans ${out} (à pousser avec supabase secrets set --env-file, puis à supprimer)`);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
