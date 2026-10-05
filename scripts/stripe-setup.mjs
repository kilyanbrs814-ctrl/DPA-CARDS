// DPA Cards — one-off Stripe configuration (test mode by default).
//
// Creates or reuses, idempotently:
//   - product "DPA Cards"
//   - 4 prices, found again through their lookup_key:
//       dpa_setup_no_commitment   29,00 € one-time
//       dpa_monthly_no_commitment 14,90 € / month
//       dpa_setup_commitment      14,90 € one-time
//       dpa_monthly_commitment     9,90 € / month
//   - webhook endpoint → <SUPABASE_URL>/functions/v1/billing/webhook
//   - 2 Billing Portal configurations: default (cancellation at period end) and
//     commitment (cancellation disabled while the 12-month commitment runs)
//
// Usage:
//   node scripts/stripe-setup.mjs --key-file <file with STRIPE_SECRET_KEY=...> --out <secrets.env> [--live]
// <secrets.env> is written for `supabase secrets set --env-file`; keep it outside the repo and delete it after.
// A live key (sk_live_) is refused unless --live is given.

import fs from 'node:fs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const keyFile = arg('--key-file'), out = arg('--out'), live = process.argv.includes('--live');
const SUPABASE_URL = 'https://fiuffxchvjcghcvfaout.supabase.co';
if (!keyFile || !out) { console.error('usage: --key-file <file> --out <secrets.env> [--live]'); process.exit(1); }
const KEY = (/STRIPE_SECRET_KEY\s*=\s*(\S+)/.exec(fs.readFileSync(keyFile, 'utf8')) || [])[1];
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

const PRICES = [
  ['dpa_setup_no_commitment', 2900, null, 'Frais de mise en place — sans engagement'],
  ['dpa_monthly_no_commitment', 1490, 'month', 'Abonnement mensuel — sans engagement'],
  ['dpa_setup_commitment', 1490, null, 'Frais de mise en place — engagement 12 mois'],
  ['dpa_monthly_commitment', 990, 'month', 'Abonnement mensuel — engagement 12 mois'],
];
const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'invoice.finalized'];

(async () => {
  const acct = await api('GET', '/account');
  console.log(`Compte Stripe ${acct.id} (${live ? 'LIVE' : 'test'})`);

  const products = await api('GET', '/products/search', { query: "metadata['app']:'dpa-cards'" });
  const product = products.data[0] || await api('POST', '/products', { name: 'DPA Cards', metadata: { app: 'dpa-cards' } });
  console.log('Produit :', product.id);

  const ids = {};
  const found = await api('GET', '/prices', { 'lookup_keys[0]': PRICES[0][0], 'lookup_keys[1]': PRICES[1][0], 'lookup_keys[2]': PRICES[2][0], 'lookup_keys[3]': PRICES[3][0], limit: 10 });
  for (const [lookup, amount, interval, nickname] of PRICES) {
    let p = found.data.find(x => x.lookup_key === lookup && x.active);
    if (p && (p.unit_amount !== amount || p.currency !== 'eur')) throw new Error(`Le prix ${lookup} existe avec un autre montant : à vérifier dans Stripe`);
    if (!p) p = await api('POST', '/prices', { product: product.id, currency: 'eur', unit_amount: amount, lookup_key: lookup, nickname, tax_behavior: 'inclusive', ...(interval ? { recurring: { interval } } : {}) });
    ids[lookup] = p.id; console.log(`Prix ${lookup} : ${p.id}`);
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

  const lines = [
    `STRIPE_SECRET_KEY=${KEY}`,
    `STRIPE_PRICE_SETUP_NO_COMMITMENT=${ids.dpa_setup_no_commitment}`,
    `STRIPE_PRICE_MONTHLY_NO_COMMITMENT=${ids.dpa_monthly_no_commitment}`,
    `STRIPE_PRICE_SETUP_COMMITMENT=${ids.dpa_setup_commitment}`,
    `STRIPE_PRICE_MONTHLY_COMMITMENT=${ids.dpa_monthly_commitment}`,
    `STRIPE_PORTAL_CONFIG_DEFAULT=${portalDefault}`,
    `STRIPE_PORTAL_CONFIG_COMMITMENT=${portalCommitment}`,
  ];
  if (webhookSecret) lines.push(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`);
  fs.writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Secrets écrits dans ${out} (à pousser avec supabase secrets set --env-file, puis à supprimer)`);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
