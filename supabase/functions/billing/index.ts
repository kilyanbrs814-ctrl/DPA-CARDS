// DPA Cards — subscriptions with Stripe (test mode first).
//
//   POST /billing/checkout  owner session, { plan } → Stripe Checkout URL (setup fee + card saved)
//   POST /billing/verify    owner session, { session_id } → confirms the payment with Stripe, creates the subscription
//   POST /billing/summary   member session → subscription, payment method and invoices (from Stripe)
//   POST /billing/portal    owner session → Stripe Billing Portal URL
//   POST /billing/cancel    owner session → cancel at period end, refused while a 12-month commitment runs
//   POST /billing/design-checkout  owner session → Stripe Checkout for the 29,90 € custom design (one-time), once the subscription is valid
//   POST /billing/design-verify    member session, { session_id } → confirms that payment with Stripe
//   POST /billing/design-cancel    owner session, { design_request_id } → cancels an unpaid request (never a paid one)
//   POST /billing/webhook   Stripe signature → keeps public.subscriptions in sync with Stripe and
//                           confirms custom design payments (metadata.type = custom_design)
//
// Why two steps: Stripe Checkout cannot combine a free trial with a billing cycle anchor.
// The Subscriptions API can: trial_end + billing_cycle_anchor gives a free trial, then a
// prorated invoice from the end of the trial to the anchor (the 1st), then a full invoice
// every 1st. So Checkout (mode=payment) charges the setup fee and saves the card, and the
// server then creates that subscription. Prices are fixed server-side by plan; the browser
// only names the plan. Secrets come from Edge Function secrets and are never logged.

import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ADMIN_ALERT_EMAIL, sendEmail, simpleMail } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SITE_URL = 'https://dpa-cards.vercel.app';
const ALLOWED_ORIGINS = (Deno.env.get('WALLET_ALLOWED_ORIGINS') ?? 'https://dpa-cards.vercel.app,http://localhost:5173,http://localhost:5174')
  .split(',').map(s => s.trim()).filter(Boolean);
const TRIAL_DAYS = 15;
const ACCESS = ['trialing', 'active'];

function envKey(jsonVar: string, legacyVar: string): string {
  try { const keys = JSON.parse(Deno.env.get(jsonVar) ?? '{}'); if (keys.default) return keys.default; } catch { /* legacy */ }
  return Deno.env.get(legacyVar) ?? '';
}
const PUBLISHABLE_KEY = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const admin = createClient(SUPABASE_URL, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() }) : null;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// The only place where prices are defined: Stripe lookup_key, amount in cents (TTC), recurring.
// Prices are created by scripts/stripe-setup.mjs; the amount is checked here, so an old or
// wrong price is never used. Custom design: 29,90 € TTC one-time, never an amount from the browser.
const PRICES = {
  setup_no_commitment: { lookup: 'dpa_setup_no_commitment', cents: 4900, recurring: false },
  monthly_no_commitment: { lookup: 'dpa_monthly_no_commitment', cents: 2490, recurring: true },
  setup_commitment: { lookup: 'dpa_setup_commitment', cents: 2900, recurring: false },
  monthly_commitment: { lookup: 'dpa_monthly_commitment', cents: 1990, recurring: true },
  custom_design: { lookup: 'dpa_custom_design', cents: 2990, recurring: false },
} as const;
type PriceName = keyof typeof PRICES;

const PLANS = {
  no_commitment: { setup: 'setup_no_commitment', monthly: 'monthly_no_commitment', commitmentMonths: 0 },
  commitment: { setup: 'setup_commitment', monthly: 'monthly_commitment', commitmentMonths: 12 },
} as const;
type PlanType = keyof typeof PLANS;

// Active Stripe price ids, cached 10 minutes per instance. A missing price, or an amount that
// differs from PRICES, makes billing unavailable rather than charging a wrong amount.
let priceCache: { at: number; ids: Record<PriceName, string> } | null = null;
async function priceIds(): Promise<Record<PriceName, string>> {
  if (priceCache && Date.now() - priceCache.at < 600_000) return priceCache.ids;
  const s = requireStripe();
  const list = await s.prices.list({ lookup_keys: Object.values(PRICES).map(p => p.lookup), active: true, limit: 10 });
  const ids = {} as Record<PriceName, string>;
  for (const [name, want] of Object.entries(PRICES) as [PriceName, (typeof PRICES)[PriceName]][]) {
    const p = list.data.find(x => x.lookup_key === want.lookup);
    if (!p || p.unit_amount !== want.cents || p.currency !== 'eur' || !!p.recurring !== want.recurring) {
      console.error('billing error', 'price', want.lookup);
      throw new HttpError(503, 'billing_not_configured');
    }
    ids[name] = p.id;
  }
  priceCache = { at: Date.now(), ids };
  return ids;
}

// ---------------------------------------------------------------- http

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return ALLOWED_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' }
    : {};
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(req) } });
class HttpError extends Error { constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); } }
const siteOrigin = (req: Request) => { const o = req.headers.get('origin') ?? ''; return ALLOWED_ORIGINS.includes(o) ? o : SITE_URL; };
const requireStripe = () => { if (!stripe) throw new HttpError(503, 'billing_not_configured'); return stripe; };
const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

async function member(req: Request, ownerOnly = true) {
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) throw new HttpError(401, 'not_authenticated');
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await userClient.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (!user) throw new HttpError(401, 'not_authenticated');
  const { data: m } = await admin.from('merchant_members').select('merchant_id, role').eq('user_id', user.id).maybeSingle();
  if (!m) throw new HttpError(403, 'no_merchant');
  if (ownerOnly && m.role !== 'owner') throw new HttpError(403, 'owner_only');
  return { user, merchantId: m.merchant_id as string };
}

async function rowOf(merchantId: string) {
  const { data, error } = await admin.from('subscriptions').select('*').eq('merchant_id', merchantId).maybeSingle();
  if (error) throw new Error('db_subscriptions');
  return data;
}

// ---------------------------------------------------------------- dates (Europe/Paris)

// UTC offset of Paris at a given instant, in minutes.
function parisOffset(at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime()) / 60000;
}
// 1st of the month following `ts` (Unix seconds), at 00:00 Paris time, as Unix seconds.
function firstOfNextMonthParis(ts: number): number {
  const d = new Date(ts * 1000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' })
    .formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  const guess = new Date(Date.UTC(p.year, p.month, 1, 0, 0, 0)); // month index p.month = next month
  return Math.floor((guess.getTime() - parisOffset(guess) * 60000) / 1000);
}
function addMonths(ts: number, n: number): number { const d = new Date(ts * 1000); d.setUTCMonth(d.getUTCMonth() + n); return Math.floor(d.getTime() / 1000); }

// ---------------------------------------------------------------- Stripe → Supabase

function periodOf(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0] as any;
  const start = (sub as any).current_period_start ?? item?.current_period_start;
  const end = (sub as any).current_period_end ?? item?.current_period_end;
  return { start, end };
}

async function syncSubscription(sub: Stripe.Subscription, extra: Record<string, unknown> = {}) {
  const merchantId = sub.metadata?.merchant_id;
  if (!merchantId) return null;
  // Only the merchant's current subscription may write the row (a late event from an older one is ignored).
  const current = await rowOf(merchantId);
  if (!current) return null;
  if (current.stripe_subscription_id ? current.stripe_subscription_id !== sub.id : sub.metadata?.checkout_session !== current.stripe_checkout_session_id) return current;
  const { start, end } = periodOf(sub);
  const price = sub.items?.data?.[0]?.price;
  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_price_id: price?.id ?? null,
    monthly_amount_cents: price?.unit_amount ?? null,
    status: sub.status,
    trial_start: iso(sub.trial_start), trial_end: iso(sub.trial_end),
    current_period_start: iso(start), current_period_end: iso(end),
    billing_cycle_anchor: iso(sub.billing_cycle_anchor),
    cancel_at_period_end: !!sub.cancel_at_period_end, cancel_at: iso(sub.cancel_at), canceled_at: iso(sub.canceled_at),
    ...extra,
  };
  if (sub.metadata?.commitment_end) {
    patch.commitment_months = 12;
    patch.commitment_start = sub.metadata.commitment_start ?? null;
    patch.commitment_end = sub.metadata.commitment_end;
  }
  const { data, error } = await admin.from('subscriptions').update(patch).eq('merchant_id', merchantId).select().maybeSingle();
  if (error) throw new Error('db_sync');
  return data;
}

// After a paid Checkout session: the subscription with a 15-day trial, prorated to the next 1st.
// Idempotent (same Stripe idempotency key for the same Checkout session).
async function ensureSubscription(session: Stripe.Checkout.Session) {
  const s = requireStripe();
  const merchantId = session.metadata?.merchant_id;
  const planType = session.metadata?.plan_type as PlanType;
  if (!merchantId || !(planType in PLANS)) throw new HttpError(400, 'invalid_session');
  if (session.payment_status !== 'paid') return { paid: false, row: await rowOf(merchantId) };

  const row = await rowOf(merchantId);
  if (row?.stripe_subscription_id) {
    const sub = await s.subscriptions.retrieve(row.stripe_subscription_id);
    return { paid: true, row: await syncSubscription(sub) };
  }
  const pi = typeof session.payment_intent === 'string'
    ? await s.paymentIntents.retrieve(session.payment_intent)
    : session.payment_intent as Stripe.PaymentIntent;
  const paymentMethod = typeof pi?.payment_method === 'string' ? pi.payment_method : pi?.payment_method?.id;
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customer || !paymentMethod) throw new HttpError(409, 'payment_method_missing');

  const plan = PLANS[planType];
  const monthlyPrice = (await priceIds())[plan.monthly];
  const trialEnd = (session.created ?? Math.floor(Date.now() / 1000)) + TRIAL_DAYS * 86400;
  const safeTrialEnd = Math.max(trialEnd, Math.floor(Date.now() / 1000) + 3600);
  const anchor = firstOfNextMonthParis(safeTrialEnd);
  const metadata: Record<string, string> = { merchant_id: merchantId, plan_type: planType, checkout_session: session.id };
  if (plan.commitmentMonths) {
    // Commitment: 12 full monthly periods counted from the first full invoice (the anchor).
    metadata.commitment_start = new Date((session.created ?? Date.now() / 1000) * 1000).toISOString();
    metadata.commitment_end = new Date(addMonths(anchor, plan.commitmentMonths) * 1000).toISOString();
  }
  await s.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });
  const sub = await s.subscriptions.create({
    customer,
    items: [{ price: monthlyPrice }],
    default_payment_method: paymentMethod,
    trial_end: safeTrialEnd,
    billing_cycle_anchor: anchor,
    proration_behavior: 'create_prorations',
    metadata,
  }, { idempotencyKey: `dpa-sub-${session.id}` });
  return { paid: true, row: await syncSubscription(sub, { stripe_setup_payment_intent_id: pi?.id ?? null, setup_paid_at: new Date().toISOString() }) };
}

// ---------------------------------------------------------------- routes

async function checkout(req: Request): Promise<Response> {
  const s = requireStripe();
  const { user, merchantId } = await member(req);
  const body = await req.json().catch(() => ({}));
  const planType = String(body?.plan ?? '') as PlanType;
  if (!(planType in PLANS)) throw new HttpError(422, 'invalid_plan');
  const plan = PLANS[planType];
  const ids = await priceIds();
  const setupId = ids[plan.setup], monthlyId = ids[plan.monthly];

  const { data: program } = await admin.from('programs').select('id').eq('merchant_id', merchantId).eq('is_active', true).maybeSingle();
  if (!program) throw new HttpError(409, 'onboarding_incomplete');
  const existing = await rowOf(merchantId);
  if (existing && ACCESS.includes(existing.status)) throw new HttpError(409, 'already_subscribed');
  // A subscription that still exists at Stripe but is unpaid is settled in the portal, never duplicated.
  if (existing?.stripe_subscription_id && ['past_due', 'unpaid', 'paused'].includes(existing.status)) throw new HttpError(409, 'payment_issue');

  const { data: merchant } = await admin.from('merchants').select('business_name').eq('id', merchantId).single();
  let customer = existing?.stripe_customer_id as string | undefined;
  if (!customer) {
    const c = await s.customers.create({ email: user.email ?? undefined, name: merchant?.business_name ?? undefined, metadata: { merchant_id: merchantId, user_id: user.id } },
      { idempotencyKey: `dpa-customer-${merchantId}` });
    customer = c.id;
  }
  const [setupPrice, monthlyPrice] = await Promise.all([s.prices.retrieve(setupId), s.prices.retrieve(monthlyId)]);
  const eur = (c: number | null) => ((c ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const origin = siteOrigin(req);
  const metadata = { merchant_id: merchantId, plan_type: planType, user_id: user.id };
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    customer,
    // Card only: the subscription is later charged off-session on this saved card, which
    // methods like Klarna or Satispay (enabled by default on the account) do not allow.
    payment_method_types: ['card'],
    line_items: [{ price: setupId, quantity: 1 }],
    payment_intent_data: { setup_future_usage: 'off_session', metadata, description: 'DPA Cards — frais de mise en place' },
    invoice_creation: { enabled: true, invoice_data: { metadata, description: 'Frais de mise en place DPA Cards' } },
    metadata,
    locale: 'fr',
    custom_text: { submit: { message: `Aujourd’hui : frais de mise en place. Votre abonnement à ${eur(monthlyPrice.unit_amount)}/mois commence après ${TRIAL_DAYS} jours d’essai gratuit, au prorata jusqu’au 1er du mois suivant, puis chaque 1er du mois${plan.commitmentMonths ? ', avec un engagement de 12 mois' : ', sans engagement'}.` } },
    success_url: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/subscription/cancel`,
  });
  const row = {
    merchant_id: merchantId, stripe_customer_id: customer, stripe_checkout_session_id: session.id, plan_type: planType,
    commitment_months: plan.commitmentMonths, stripe_setup_price_id: setupId, stripe_price_id: monthlyId,
    setup_amount_cents: setupPrice.unit_amount, monthly_amount_cents: monthlyPrice.unit_amount,
  };
  if (existing) {
    // An unpaid attempt, or a subscription that has ended: start again from a clean row.
    const reset = {
      status: 'incomplete', stripe_subscription_id: null, stripe_setup_payment_intent_id: null, setup_paid_at: null,
      trial_start: null, trial_end: null, current_period_start: null, current_period_end: null, billing_cycle_anchor: null,
      commitment_start: null, commitment_end: null, cancel_at_period_end: false, cancel_at: null, canceled_at: null,
      cancel_requested_at: null, latest_invoice_status: null,
    };
    const { error } = await admin.from('subscriptions').update({ ...row, ...reset }).eq('merchant_id', merchantId);
    if (error) throw new Error('db_subscriptions');
  } else {
    const { error } = await admin.from('subscriptions').insert({ ...row, status: 'incomplete' });
    if (error) throw new Error('db_subscriptions');
  }
  return json(req, 200, { url: session.url });
}

async function verify(req: Request): Promise<Response> {
  const s = requireStripe();
  const { merchantId } = await member(req, false);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.session_id ?? '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, 'invalid_session');
  const session = await s.checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
  // Never trust the URL alone: the session must be this merchant's, and paid according to Stripe.
  if (session.metadata?.merchant_id !== merchantId) throw new HttpError(403, 'forbidden');
  const r = await ensureSubscription(session);
  return json(req, 200, { paid: r.paid, status: r.row?.status ?? 'incomplete', access: !!r.row && ACCESS.includes(r.row.status), subscription: r.row });
}

async function summary(req: Request): Promise<Response> {
  const { merchantId } = await member(req, false);
  const row = await rowOf(merchantId);
  const out: Record<string, unknown> = { subscription: row, payment_method: null, invoices: [], upcoming: null };
  if (stripe && row?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(row.stripe_customer_id, { expand: ['invoice_settings.default_payment_method'] }) as Stripe.Customer;
      const pm = customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null;
      if (pm && typeof pm === 'object' && pm.card) out.payment_method = { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year };
      const inv = await stripe.invoices.list({ customer: row.stripe_customer_id, limit: 12 });
      out.invoices = inv.data.filter(i => i.status !== 'draft').map(i => ({ number: i.number, date: iso(i.created), amount_cents: i.total, currency: i.currency, status: i.status, url: i.hosted_invoice_url, pdf: i.invoice_pdf }));
      if (row.stripe_subscription_id && ACCESS.includes(row.status)) {
        try {
          const up = await stripe.invoices.retrieveUpcoming({ customer: row.stripe_customer_id, subscription: row.stripe_subscription_id });
          out.upcoming = { date: iso(up.next_payment_attempt ?? up.period_end), amount_cents: up.amount_due, currency: up.currency };
        } catch { /* no upcoming invoice (e.g. cancellation scheduled) */ }
      }
    } catch (e) { console.error('billing error', 'summary', (e as Error).message); }
  }
  return json(req, 200, out);
}

const commitmentRunning = (row: any) => row?.plan_type === 'commitment' && row?.commitment_end && new Date(row.commitment_end) > new Date();

async function portal(req: Request): Promise<Response> {
  const s = requireStripe();
  const { merchantId } = await member(req);
  const row = await rowOf(merchantId);
  if (!row?.stripe_customer_id) throw new HttpError(409, 'no_subscription');
  // During a 12-month commitment the portal configuration has cancellation turned off.
  const configuration = commitmentRunning(row) ? Deno.env.get('STRIPE_PORTAL_CONFIG_COMMITMENT') : Deno.env.get('STRIPE_PORTAL_CONFIG_DEFAULT');
  const p = await s.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${siteOrigin(req)}/`, ...(configuration ? { configuration } : {}), locale: 'fr' });
  return json(req, 200, { url: p.url });
}

async function cancel(req: Request): Promise<Response> {
  const s = requireStripe();
  const { merchantId } = await member(req);
  const row = await rowOf(merchantId);
  if (!row?.stripe_subscription_id || !ACCESS.concat(['past_due', 'unpaid']).includes(row.status)) throw new HttpError(409, 'no_subscription');
  if (commitmentRunning(row)) {
    // Not cancelled automatically: the request is recorded for a manual follow-up.
    await admin.from('subscriptions').update({ cancel_requested_at: new Date().toISOString() }).eq('merchant_id', merchantId);
    throw new HttpError(409, 'commitment_active', { commitment_end: row.commitment_end });
  }
  const sub = await s.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true });
  return json(req, 200, { subscription: await syncSubscription(sub, { cancel_requested_at: new Date().toISOString() }) });
}

// ---------------------------------------------------------------- custom design (29,90 € one-time)
// The request exists as 'pending_payment' (files + brief); it becomes an order ('submitted')
// only once Stripe confirms the payment. Separate from the subscription in every way.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function customerFor(s: Stripe, merchantId: string, email?: string | null, name?: string | null) {
  const row = await rowOf(merchantId);
  if (row?.stripe_customer_id) return row.stripe_customer_id as string;
  const found = await s.customers.search({ query: `metadata['merchant_id']:'${merchantId}'`, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  return (await s.customers.create({ email: email ?? undefined, name: name ?? undefined, metadata: { merchant_id: merchantId } })).id;
}

async function designCheckout(req: Request): Promise<Response> {
  const { user, merchantId } = await member(req);
  // The design is paid after the offer: no design checkout without a valid subscription
  // (this only orders the steps; the two payments stay independent).
  const sub = await rowOf(merchantId);
  if (!sub || !ACCESS.includes(sub.status)) throw new HttpError(402, 'subscription_required');
  const s = requireStripe();
  const designPrice = (await priceIds()).custom_design;
  const body = await req.json().catch(() => ({}));
  const wanted = body?.design_request_id ? String(body.design_request_id) : null;
  if (wanted && !UUID.test(wanted)) throw new HttpError(400, 'invalid_request');
  // The merchant's own request: the one named, or the latest unpaid one ("Reprendre ma commande").
  let q = admin.from('design_requests').select('*').eq('merchant_id', merchantId);
  q = wanted ? q.eq('id', wanted) : q.eq('status', 'pending_payment').order('created_at', { ascending: false }).limit(1);
  const { data: reqRow, error } = await q.maybeSingle();
  if (error) throw new Error('db_design_requests');
  if (!reqRow) throw new HttpError(404, 'design_request_not_found');
  if (reqRow.payment_status === 'paid') throw new HttpError(409, 'design_already_paid');
  if (reqRow.status !== 'pending_payment') throw new HttpError(409, 'design_request_not_found');

  const { data: merchant } = await admin.from('merchants').select('business_name').eq('id', merchantId).single();
  const customer = await customerFor(s, merchantId, user.email, merchant?.business_name);
  const metadata = { type: 'custom_design', merchant_id: merchantId, design_request_id: reqRow.id, user_id: user.id };
  const origin = siteOrigin(req);
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    customer,
    payment_method_types: ['card'],
    line_items: [{ price: designPrice, quantity: 1 }],
    payment_intent_data: { metadata, description: 'DPA Cards — création de carte sur mesure' },
    invoice_creation: { enabled: true, invoice_data: { metadata, description: 'Création de carte sur mesure DPA Cards' } },
    metadata,
    locale: 'fr',
    custom_text: { submit: { message: 'Paiement unique pour la création de votre carte par DPA Cards. Il ne démarre pas votre abonnement.' } },
    success_url: `${origin}/design/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/design/cancel`,
  });
  const { error: ue } = await admin.from('design_requests').update({ stripe_checkout_session_id: session.id }).eq('id', reqRow.id).eq('status', 'pending_payment');
  if (ue) throw new Error('db_design_requests');
  return json(req, 200, { url: session.url });
}

// Change of mind before paying: the unpaid request is cancelled and the program stays a draft
// the merchant customises. Open Checkout sessions for it are expired first, so it can no longer
// be paid; one paid in the meantime becomes an order instead. A paid request (submitted,
// in_progress, delivered) is never touched here, and the subscription is not involved.
async function designCancel(req: Request): Promise<Response> {
  const { merchantId } = await member(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.design_request_id ?? '');
  if (!UUID.test(id)) throw new HttpError(400, 'invalid_request');
  const { data: r, error } = await admin.from('design_requests')
    .select('id, merchant_id, program_id, status, payment_status, stripe_checkout_session_id').eq('id', id).maybeSingle();
  if (error) throw new Error('db_design_requests');
  if (!r || r.merchant_id !== merchantId) throw new HttpError(404, 'design_request_not_found');
  if (r.status === 'cancelled' && r.payment_status !== 'paid') return json(req, 200, { cancelled: true });
  if (r.payment_status === 'paid' || r.status !== 'pending_payment') throw new HttpError(409, 'design_not_cancellable');
  if (r.stripe_checkout_session_id) {
    const s = requireStripe();
    const last = await s.checkout.sessions.retrieve(r.stripe_checkout_session_id);
    const customer = typeof last.customer === 'string' ? last.customer : last.customer?.id;
    const open = customer ? (await s.checkout.sessions.list({ customer, status: 'open', limit: 100 })).data : [];
    const sessions = [last, ...open.filter(x => x.id !== last.id)].filter(x => x.metadata?.design_request_id === id);
    for (const x of sessions) {
      let cur = x;
      if (cur.status === 'open') {
        try { cur = await s.checkout.sessions.expire(cur.id); } catch { cur = await s.checkout.sessions.retrieve(cur.id); }
      }
      if (cur.payment_status === 'paid') await confirmDesign(await s.checkout.sessions.retrieve(cur.id, { expand: ['payment_intent'] }));
      if (cur.status === 'complete' || cur.payment_status === 'paid') throw new HttpError(409, 'design_not_cancellable');
    }
  }
  const { data: done, error: ue } = await admin.from('design_requests').update({ status: 'cancelled' })
    .eq('id', id).eq('status', 'pending_payment').neq('payment_status', 'paid').select('id').maybeSingle();
  if (ue) throw new Error('db_design_requests');
  if (!done) throw new HttpError(409, 'design_not_cancellable');
  // Self-customisation again (an unpaid request never moved the program out of draft).
  await admin.from('programs').update({ design_mode: null }).eq('id', r.program_id).eq('design_status', 'draft').eq('design_mode', 'dpa');
  return json(req, 200, { cancelled: true });
}

// Signed links (7 days) to the brief files, for the alert e-mail.
async function signedLinks(paths: string[]) {
  const out: [string, string][] = [];
  let ref = 0;
  for (const p of paths) {
    const { data } = await admin.storage.from('design-requests').createSignedUrl(p, 7 * 86400);
    if (data?.signedUrl) out.push([/\/logo\.[a-z]+$/i.test(p) ? 'Logo' : `Référence ${++ref}`, data.signedUrl]);
  }
  return out;
}

async function sendDesignAlert(r: any) {
  const [{ data: m }, { data: p }] = await Promise.all([
    admin.from('merchants').select('business_name, first_name, last_name, phone, created_by').eq('id', r.merchant_id).single(),
    admin.from('programs').select('name').eq('id', r.program_id).single(),
  ]);
  let ownerEmail: string | null = null;
  try { ownerEmail = (await admin.auth.admin.getUserById(m!.created_by)).data.user?.email ?? null; } catch { /* optional */ }
  const files = [r.logo_path, ...(r.reference_paths ?? [])].filter(Boolean);
  const links = await signedLinks(files);
  const paid = ((r.amount_cents ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: (r.currency ?? 'eur').toUpperCase() });
  const { text, html } = simpleMail('Nouvelle demande de création sur mesure.', [
    ['Commerce', m?.business_name],
    ['Responsable', r.contact_name || `${m?.first_name ?? ''} ${m?.last_name ?? ''}`.trim()],
    ['Email', r.contact_email || ownerEmail],
    ['Téléphone', r.contact_phone || m?.phone || null],
    ['Couleurs souhaitées', r.colors],
    ['Description', r.description],
    ['Programme', p?.name],
    ['Date', new Date(r.paid_at ?? r.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })],
    ['Montant payé', paid],
    ['ID demande', r.id],
  ], links);
  return sendEmail({ to: ADMIN_ALERT_EMAIL, subject: `Nouvelle demande de design DPA Cards — ${m?.business_name ?? ''}`, text, html, replyTo: r.contact_email || ownerEmail || undefined });
}

// Paid according to Stripe → order + one alert e-mail (atomic claim on notified_at).
async function confirmDesign(session: Stripe.Checkout.Session) {
  const s = requireStripe();
  const requestId = session.metadata?.design_request_id, merchantId = session.metadata?.merchant_id;
  if (session.metadata?.type !== 'custom_design' || !requestId || !merchantId) throw new HttpError(400, 'invalid_session');
  const { data: reqRow } = await admin.from('design_requests').select('id, merchant_id').eq('id', requestId).maybeSingle();
  if (!reqRow || reqRow.merchant_id !== merchantId) throw new HttpError(403, 'forbidden');
  if (session.payment_status !== 'paid') return { paid: false, request: null };
  const items = await s.checkout.sessions.listLineItems(session.id, { limit: 5 });
  const designPrice = (await priceIds()).custom_design;
  if (!items.data.some(i => i.price?.id === designPrice) || session.amount_total !== PRICES.custom_design.cents) throw new HttpError(409, 'invalid_session');
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const { data, error } = await admin.rpc('design_mark_paid', { p_request: requestId, p_session: session.id, p_payment_intent: pi, p_amount: session.amount_total, p_currency: session.currency });
  if (error) throw new Error('db_design_mark_paid');
  const { data: claimed } = await admin.from('design_requests').update({ notified_at: new Date().toISOString() })
    .eq('id', requestId).eq('payment_status', 'paid').is('notified_at', null).select().maybeSingle();
  if (claimed) {
    const r = await sendDesignAlert(claimed);
    await admin.from('design_requests').update({ notify_error: r.sent ? null : r.error }).eq('id', requestId);
    if (!r.sent) console.error('billing error', 'design alert', r.error);
  }
  const { data: fresh } = await admin.from('design_requests').select('id, status, payment_status, paid_at, amount_cents, currency').eq('id', requestId).single();
  return { paid: true, request: fresh ?? data.request };
}

async function designVerify(req: Request): Promise<Response> {
  const s = requireStripe();
  const { merchantId } = await member(req, false);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.session_id ?? '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, 'invalid_session');
  const session = await s.checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
  if (session.metadata?.merchant_id !== merchantId || session.metadata?.type !== 'custom_design') throw new HttpError(403, 'forbidden');
  const r = await confirmDesign(session);
  return json(req, 200, r);
}

async function webhook(req: Request): Promise<Response> {
  const s = requireStripe();
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const signature = req.headers.get('stripe-signature') ?? '';
  if (!secret || !signature) throw new HttpError(400, 'invalid_signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try { event = await s.webhooks.constructEventAsync(raw, signature, secret, undefined, cryptoProvider); }
  catch { throw new HttpError(400, 'invalid_signature'); }

  const subOfInvoice = (inv: any): string | null =>
    (typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id) ?? inv.parent?.subscription_details?.subscription ?? null;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.type === 'custom_design') await confirmDesign(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
      else if (session.mode === 'payment' && session.metadata?.merchant_id && session.metadata?.plan_type) await ensureSubscription(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.finalized': {
      const inv = event.data.object as any;
      const subId = subOfInvoice(inv);
      if (subId) await syncSubscription(await s.subscriptions.retrieve(subId), { latest_invoice_status: event.type === 'invoice.payment_failed' ? 'payment_failed' : inv.status });
      break;
    }
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method === 'POST' && path.endsWith('/webhook')) return await webhook(req);
    if (req.method === 'POST' && path.endsWith('/checkout')) return await checkout(req);
    if (req.method === 'POST' && path.endsWith('/verify')) return await verify(req);
    if (req.method === 'POST' && path.endsWith('/summary')) return await summary(req);
    if (req.method === 'POST' && path.endsWith('/portal')) return await portal(req);
    if (req.method === 'POST' && path.endsWith('/cancel')) return await cancel(req);
    if (req.method === 'POST' && path.endsWith('/design-checkout')) return await designCheckout(req);
    if (req.method === 'POST' && path.endsWith('/design-verify')) return await designVerify(req);
    if (req.method === 'POST' && path.endsWith('/design-cancel')) return await designCancel(req);
    return json(req, 404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.code, ...e.extra });
    console.error('billing error', path, (e as Error).message);
    return json(req, 502, { error: 'billing_unavailable' });
  }
});
