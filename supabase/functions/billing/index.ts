// DPA Cards — subscriptions with Stripe (test mode first).
//
//   POST /billing/checkout  owner session, { plan } → Stripe Checkout URL (setup fee + card saved)
//   POST /billing/verify    owner session, { session_id } → confirms the payment with Stripe, creates the subscription
//   POST /billing/summary   member session → subscription, payment method and invoices (from Stripe)
//   POST /billing/portal    owner session → Stripe Billing Portal URL
//   POST /billing/cancel    owner session → cancel at period end, refused while a 12-month commitment runs
//   POST /billing/webhook   Stripe signature → keeps public.subscriptions in sync with Stripe
//
// Why two steps: Stripe Checkout cannot combine a free trial with a billing cycle anchor.
// The Subscriptions API can: trial_end + billing_cycle_anchor gives a free trial, then a
// prorated invoice from the end of the trial to the anchor (the 1st), then a full invoice
// every 1st. So Checkout (mode=payment) charges the setup fee and saves the card, and the
// server then creates that subscription. Prices are fixed server-side by plan; the browser
// only names the plan. Secrets come from Edge Function secrets and are never logged.

import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

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

// The only place where plans are defined. Amounts are read back from Stripe prices.
const PLANS = {
  no_commitment: { setup: Deno.env.get('STRIPE_PRICE_SETUP_NO_COMMITMENT') ?? '', monthly: Deno.env.get('STRIPE_PRICE_MONTHLY_NO_COMMITMENT') ?? '', commitmentMonths: 0 },
  commitment: { setup: Deno.env.get('STRIPE_PRICE_SETUP_COMMITMENT') ?? '', monthly: Deno.env.get('STRIPE_PRICE_MONTHLY_COMMITMENT') ?? '', commitmentMonths: 12 },
} as const;
type PlanType = keyof typeof PLANS;

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
    items: [{ price: plan.monthly }],
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
  if (!plan.setup || !plan.monthly) throw new HttpError(503, 'billing_not_configured');

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
  const [setupPrice, monthlyPrice] = await Promise.all([s.prices.retrieve(plan.setup), s.prices.retrieve(plan.monthly)]);
  const eur = (c: number | null) => ((c ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const origin = siteOrigin(req);
  const metadata = { merchant_id: merchantId, plan_type: planType, user_id: user.id };
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    customer,
    // Card only: the subscription is later charged off-session on this saved card, which
    // methods like Klarna or Satispay (enabled by default on the account) do not allow.
    payment_method_types: ['card'],
    line_items: [{ price: plan.setup, quantity: 1 }],
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
    commitment_months: plan.commitmentMonths, stripe_setup_price_id: plan.setup, stripe_price_id: plan.monthly,
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
      if (session.mode === 'payment' && session.metadata?.merchant_id) await ensureSubscription(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
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
    return json(req, 404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.code, ...e.extra });
    console.error('billing error', path, (e as Error).message);
    return json(req, 502, { error: 'billing_unavailable' });
  }
});
