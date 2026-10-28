// DPA Cards — subscriptions with Stripe (test mode first).
//
//   POST /billing/checkout  owner session, { plan, billing? } → Stripe Checkout URL (setup fee + card saved);
//                           billing = 'prepaid' (commitment only): setup fee + every monthly payment of the
//                           commitment in one payment, no subscription, no renewal
//   POST /billing/verify    owner session, { session_id } → confirms the payment with Stripe, creates the subscription
//                           (or opens the prepaid period)
//   POST /billing/summary   member session → subscription, payment method and invoices (from Stripe)
//   POST /billing/portal    owner session → Stripe Billing Portal URL
//   POST /billing/cancel    owner session → cancel at period end, refused while a 12-month commitment runs
//   POST /billing/design-checkout  owner session → Stripe Checkout for the 29,90 € custom design (one-time), once the subscription is valid
//   POST /billing/design-verify    member session, { session_id } → confirms that payment with Stripe
//   POST /billing/design-cancel    owner session, { design_request_id } → cancels an unpaid request (never a paid one)
//   POST /billing/webhook   Stripe signature → keeps public.subscriptions in sync with Stripe, records
//                           collected / failed invoices and refunds in public.sales_payments (commissions), and
//                           confirms custom design payments (metadata.type = custom_design) and prepaid
//                           commitments (metadata.billing_mode = prepaid: paid, failed, expired, refunded, disputed)
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
import { selectedMembership } from '../_shared/merchant-context.ts';
import { profileBilling } from './profiles.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// The canonical URL is configurable so Stripe returns remain correct after the DNS cutover.
// Do not deploy this function before the new domain is ready and allowed in Supabase.
const SITE_URL = (Deno.env.get('DPA_SITE_URL') ?? 'https://cards.digitalprojectagency.fr').replace(/\/$/, '');
const ALLOWED_ORIGINS = (Deno.env.get('WALLET_ALLOWED_ORIGINS') ?? 'https://cards.digitalprojectagency.fr,http://localhost:5173,http://localhost:5174')
  .split(',').map(s => s.trim()).filter(Boolean);
// Allow the new custom domain even if the production secret still contains an older origin.
if (!ALLOWED_ORIGINS.includes('https://cards.digitalprojectagency.fr')) ALLOWED_ORIGINS.push('https://cards.digitalprojectagency.fr');
// The native iOS WebView uses this fixed origin for authenticated admin payment setup.
// The actual Stripe checkout still happens on Stripe, outside the WebView.
if (!ALLOWED_ORIGINS.includes('capacitor://localhost')) ALLOWED_ORIGINS.push('capacitor://localhost');
const TRIAL_MONTHS = 1;
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
  setup_no_commitment: { lookup: 'dpa_setup_no_commitment', cents: 5000, recurring: false },
  monthly_no_commitment: { lookup: 'dpa_monthly_no_commitment', cents: 3000, recurring: true },
  setup_commitment: { lookup: 'dpa_setup_commitment', cents: 2500, recurring: false },
  monthly_commitment: { lookup: 'dpa_monthly_commitment', cents: 2000, recurring: true },
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
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-merchant-id, x-dpa-web-profiles', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' }
    : {};
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(req) } });
class HttpError extends Error { constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); } }
// Native requests may use the API, but Stripe must redirect to an HTTPS page.
const siteOrigin = (req: Request) => { const o = req.headers.get('origin') ?? ''; return o === 'capacitor://localhost' ? SITE_URL : ALLOWED_ORIGINS.includes(o) ? o : SITE_URL; };
const requireStripe = () => { if (!stripe) throw new HttpError(503, 'billing_not_configured'); return stripe; };
const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

async function member(req: Request, ownerOnly = true, accountWide = true) {
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) throw new HttpError(401, 'not_authenticated');
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await userClient.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (!user) throw new HttpError(401, 'not_authenticated');
  const m = await selectedMembership(admin,req,user.id);
  if (!m) throw new HttpError(403, 'no_merchant');
  if (ownerOnly && m.role !== 'owner') throw new HttpError(403, 'owner_only');
  if(!accountWide)return {user,merchantId:m.merchant_id as string};
  const {data:merchant}=await admin.from('merchants').select('billing_account_id').eq('id',m.merchant_id).single();
  const {data:account}=await admin.from('merchant_billing_accounts').select('owner_id,primary_merchant_id').eq('id',merchant?.billing_account_id).single();
  if(!account || (ownerOnly && account.owner_id!==user.id))throw new HttpError(403,'owner_only');
  return {user,merchantId:account.primary_merchant_id as string};
}

async function rowOf(merchantId: string) {
  const { data, error } = await admin.from('subscriptions').select('*').eq('merchant_id', merchantId).maybeSingle();
  if (error) throw new Error('db_subscriptions');
  return data;
}

async function billingQuantity(merchantId:string) {
 const {data:m,error:me}=await admin.from('merchants').select('billing_account_id').eq('id',merchantId).single();
 if(me)throw new Error('db_profiles');
 const {data:activations,error}=await admin.from('merchant_activations').select('merchant_id').eq('account_id',m.billing_account_id);
 if(error)throw new Error('db_profiles');
 return {quantity:Math.max(1,activations.length),activated:activations.some(x=>x.merchant_id===merchantId)};
}

type CheckoutActor = {user: {id: string; email?: string | null}; merchantId: string; adminCheckout?: boolean};

// Director can start a Stripe-hosted checkout in front of a merchant.
// Only the prepared PRIMARY merchant may be sold this way: not an arbitrary
// shop, user ID, amount, or account provided by a browser.
async function adminCheckoutActor(req: Request): Promise<CheckoutActor> {
 const auth=req.headers.get('authorization')??'';
 if(!/^Bearer\s+\S+/.test(auth))throw new HttpError(401,'not_authenticated');
 const token=auth.replace(/^Bearer\s+/,'');
 const sb=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await sb.auth.getUser(token);
 if(error||!user?.email_confirmed_at||!user.email)throw new HttpError(403,'not_admin');
 const {data:director}=await admin.from('admin_users').select('role').eq('email',user.email.trim().toLowerCase()).maybeSingle();
 if(director?.role!=='director')throw new HttpError(403,'not_director');
 const body=await req.clone().json().catch(()=>({}));
 const merchantId=String(body?.merchant_id??'');
 if(!UUID.test(merchantId))throw new HttpError(400,'invalid_merchant');
 const {data:m}=await admin.from('merchants').select('id,created_by,billing_account_id').eq('id',merchantId).maybeSingle();
 const {data:prepared}=await admin.from('admin_created_merchants').select('merchant_id').eq('merchant_id',merchantId).maybeSingle();
 if(!m||!prepared)throw new HttpError(403,'not_admin_created');
 const {data:account}=await admin.from('merchant_billing_accounts').select('owner_id,primary_merchant_id').eq('id',m.billing_account_id).maybeSingle();
 if(!account||account.primary_merchant_id!==merchantId||account.owner_id!==m.created_by)throw new HttpError(409,'not_primary_merchant');
 const {data:owner}=await admin.auth.admin.getUserById(m.created_by);
 if(!owner.user?.email)throw new HttpError(409,'owner_missing');
 return {user:{id:owner.user.id,email:owner.user.email},merchantId,adminCheckout:true};
}

async function initialQuote(req:Request,actor?:CheckoutActor):Promise<Response> {
 const {merchantId}=actor??await member(req);const body=await req.json();
 const plan=PLANS[body.plan as PlanType];if(!plan)throw new HttpError(422,'invalid_plan');
 const b=await billingQuantity(merchantId),row=await rowOf(merchantId),pre=body.billing==='prepaid';
 if(pre && body.plan!=='commitment')throw new HttpError(422,'invalid_plan');
 const {data:m}=await admin.from('merchants').select('billing_account_id').eq('id',merchantId).single();
 const {data:open,error:oe}=await admin.from('merchant_initial_checkouts').select('*').eq('account_id',m?.billing_account_id).is('closed_at',null).maybeSingle();
 if(oe)throw new Error('db_checkout_claim');
 if(open && (open.plan!==body.plan || open.billing!==(pre?'prepaid':'monthly'))){
  if(!open.stripe_session_id)throw new HttpError(409,'checkout_in_progress');
  const s=requireStripe();let cs=await s.checkout.sessions.retrieve(open.stripe_session_id);
  if(cs.status==='open'){try{cs=await s.checkout.sessions.expire(cs.id);}catch{cs=await s.checkout.sessions.retrieve(cs.id);}}
  if(cs.payment_status==='paid'||(cs.mode==='setup'&&cs.status==='complete')){
   if(cs.metadata?.billing_mode==='prepaid')await confirmPrepaid(cs);else await ensureSubscription(cs);
   throw new HttpError(409,'already_subscribed');
  }
  if(cs.status!=='expired')throw new HttpError(409,'payment_processing');
  const {error}=await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('id',open.id);
  if(error)throw new Error('db_checkout_claim');
 }
 return json(req,200,{quote:{current_count:b.activated?b.quantity:0,new_count:b.quantity,activation_cents:b.activated?0:PRICES[plan.setup].cents,
  current_monthly_cents:row&&ACCESS.includes(row.status)?row.monthly_amount_cents:0,new_monthly_cents:b.quantity*PRICES[plan.monthly].cents,
  monthly_difference_cents:b.quantity*PRICES[plan.monthly].cents-(row&&ACCESS.includes(row.status)?row.monthly_amount_cents:0),proration_cents:0,
  immediate_cents:(b.activated?0:PRICES[plan.setup].cents)+(pre?b.quantity*PRICES[plan.monthly].cents*(plan.commitmentMonths-1):0),effective_at:new Date().toISOString(),
  proration_collection:pre?'now':'after_trial',billing:pre?'prepaid':'monthly',quantity:b.quantity,setup:b.activated?0:PRICES[plan.setup].cents}});
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
    monthly_amount_cents: price?.unit_amount!=null ? price.unit_amount*(sub.items.data[0].quantity??1) : null,
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

// ---------------------------------------------------------------- Stripe → sales ledger (commissions)

// One Stripe invoice = one row of public.sales_payments (unique on provider + invoice id, so a
// webhook received twice updates the same row). Only money actually collected (or a failed
// attempt) is recorded: the 0 € invoice that opens the trial is skipped. Commissions are then
// derived in the database from these rows, never from the subscription status.
async function recordInvoice(inv: any, failed: boolean) {
  const amount = failed ? inv.amount_due : inv.amount_paid;
  if (!amount || amount <= 0 || inv.currency !== 'eur') return;
  const subId = (typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id) ?? inv.parent?.subscription_details?.subscription ?? null;
  const meta = { ...(inv.subscription_details?.metadata ?? {}), ...(inv.parent?.subscription_details?.metadata ?? {}), ...(inv.metadata ?? {}) };
  let merchantId: string | null = meta.merchant_id ?? null, plan: string | null = meta.plan_type ?? null;
  if (!merchantId && subId) {
    const { data } = await admin.from('subscriptions').select('merchant_id, plan_type').eq('stripe_subscription_id', subId).maybeSingle();
    merchantId = data?.merchant_id ?? null; plan = plan ?? data?.plan_type ?? null;
  }
  if (!merchantId) return;
  const kind = subId ? 'subscription' : meta.type === 'custom_design' ? 'design' : meta.billing_mode === 'prepaid' ? 'prepaid' : meta.plan_type ? 'setup' : 'other';
  const line = (inv.lines?.data ?? []).find((l: any) => l.period) ?? null;
  const pi = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id ?? null;
  // Prepaid: one payment for the whole period, recorded once at its date with the period it covers.
  let period: { start: string | null; end: string | null } = { start: null, end: null };
  if (kind === 'subscription') period = { start: iso(line?.period?.start), end: iso(line?.period?.end) };
  if (kind === 'prepaid' && UUID.test(meta.purchase_id ?? '')) {
    const { data } = await admin.from('prepaid_purchases').select('access_start, access_end').eq('id', meta.purchase_id).maybeSingle();
    period = { start: data?.access_start ?? null, end: data?.access_end ?? null };
  }
  const { error } = await admin.rpc('sales_record_payment', { p: {
    provider: 'stripe', provider_payment_id: inv.id, merchant_id: merchantId, kind, status: failed ? 'failed' : 'paid',
    amount_cents: amount, currency: inv.currency, plan_type: plan, provider_subscription_id: subId, provider_charge_ref: pi,
    period_start: period.start, period_end: period.end,
    paid_at: failed ? null : iso(inv.status_transitions?.paid_at) ?? new Date().toISOString(), failed_at: failed ? new Date().toISOString() : null,
  } });
  if (error) { console.error('billing error', 'sales_record_payment', error.code); throw new Error('db_sales_payment'); }
}

// After a paid Checkout session: the subscription with a 15-day trial, prorated to the next 1st.
// Idempotent (same Stripe idempotency key for the same Checkout session).
async function ensureSubscription(session: Stripe.Checkout.Session) {
  const s = requireStripe();
  const merchantId = session.metadata?.merchant_id;
  const planType = session.metadata?.plan_type as PlanType;
  if (!merchantId || !(planType in PLANS)) throw new HttpError(400, 'invalid_session');
  if (session.payment_status !== 'paid' && !(session.mode==='setup'&&session.status==='complete')) return { paid: false, row: await rowOf(merchantId) };
  // The setup fee's invoice (Checkout creates it): recorded here too, in case its webhook is late.
  // Same invoice id as the webhook, so it is never counted twice; a ledger hiccup never blocks the subscription.
  if (session.invoice) {
    try { await recordInvoice(typeof session.invoice === 'string' ? await s.invoices.retrieve(session.invoice) : session.invoice, false); }
    catch (e) { console.error('billing error', 'setup ledger', (e as Error).message); }
  }

  let row = await rowOf(merchantId);
  if(session.metadata?.initial_claim && row && !row.stripe_subscription_id && row.status==='incomplete') {
    const {data:claim}=await admin.from('merchant_initial_checkouts').select('*').eq('id',session.metadata.initial_claim).eq('billing','monthly').single();
    const {data:account}=claim?await admin.from('merchant_billing_accounts').select('primary_merchant_id').eq('id',claim.account_id).single():{data:null};
    if(account?.primary_merchant_id!==merchantId || (claim.stripe_session_id && claim.stripe_session_id!==session.id))throw new HttpError(403,'invalid_session');
    const {error}=await admin.from('subscriptions').update({stripe_checkout_session_id:session.id}).eq('merchant_id',merchantId).eq('status','incomplete').is('stripe_subscription_id',null);
    if(error)throw new Error('db_subscriptions');
    row=await rowOf(merchantId);
  }
  if (row?.stripe_subscription_id) {
    const sub = await s.subscriptions.retrieve(row.stripe_subscription_id);
    const payment=(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id)||null;
    const {error}=await admin.rpc('profile_confirm_initial',{p_merchant:merchantId,p_payment:payment,p_amount:session.amount_total});
    if(error)throw new Error('db_initial_activation');
    const {error:closeError}=await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('stripe_session_id',session.id);
    if(closeError)throw new Error('db_checkout_claim');
    return { paid: true, row: await syncSubscription(sub) };
  }
  // Never a monthly subscription on top of a prepaid period (old checkout tab paid meanwhile): manual follow-up.
  if (row?.billing_mode === 'prepaid' && ACCESS.includes(row.status)) {
    console.error('billing error', 'monthly checkout paid during a prepaid period', session.id);
    return { paid: true, row };
  }
  const pi = typeof session.payment_intent === 'string'
    ? await s.paymentIntents.retrieve(session.payment_intent)
    : session.payment_intent as Stripe.PaymentIntent;
  const setupIntent=!pi&&session.setup_intent?(typeof session.setup_intent==='string'?await s.setupIntents.retrieve(session.setup_intent):session.setup_intent):null;
  const paymentMethod = typeof pi?.payment_method === 'string' ? pi.payment_method : pi?.payment_method?.id || (typeof setupIntent?.payment_method==='string'?setupIntent.payment_method:setupIntent?.payment_method?.id);
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customer || !paymentMethod) throw new HttpError(409, 'payment_method_missing');

  const plan = PLANS[planType];
  // A pre-deployment checkout retains its explicitly accepted price.
  const monthlyPrice = row?.stripe_price_id || (await priceIds())[plan.monthly];
  const trialEnd = addMonths(session.created ?? Math.floor(Date.now() / 1000), TRIAL_MONTHS);
  const safeTrialEnd = Math.max(trialEnd, Math.floor(Date.now() / 1000) + 3600);
  const anchor = safeTrialEnd;
  const metadata: Record<string, string> = { merchant_id: merchantId, plan_type: planType, checkout_session: session.id };
  if (plan.commitmentMonths) {
    // Commitment: 12 full monthly periods counted from the first full invoice (the anchor).
    metadata.commitment_start = new Date((session.created ?? Date.now() / 1000) * 1000).toISOString();
    metadata.commitment_end = new Date(addMonths(session.created ?? Math.floor(Date.now() / 1000), plan.commitmentMonths) * 1000).toISOString();
  }
  await s.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });
  const sub = await s.subscriptions.create({
    customer,
    items: [{ price: monthlyPrice,quantity:Number(session.metadata?.commerce_quantity||1) }],
    default_payment_method: paymentMethod,
    trial_end: safeTrialEnd,
    billing_cycle_anchor: anchor,
    proration_behavior: 'create_prorations',
    metadata,
  }, { idempotencyKey: `dpa-sub-${session.id}` });
  const synced=await syncSubscription(sub, { stripe_setup_payment_intent_id: pi?.id ?? null, setup_paid_at: new Date().toISOString() });
  const {error:activationError}=await admin.rpc('profile_confirm_initial',{p_merchant:merchantId,p_payment:pi?.id||setupIntent?.id,p_amount:session.amount_total??0});
  if(activationError)throw new Error('db_initial_activation');
  const {error:closeError}=await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('stripe_session_id',session.id);
  if(closeError)throw new Error('db_checkout_claim');
  return {paid:true,row:synced};
}

// Once Stripe definitively fails a deferred SEPA charge, release the initial
// checkout claim. Never release it merely because the redirect says "unpaid":
// the bank may still be processing the payment.
async function failInitialAsyncCheckout(session: Stripe.Checkout.Session) {
  const id = session.metadata?.initial_claim;
  if (!id || session.mode !== 'payment') return;
  const s = requireStripe();
  const latest = await s.checkout.sessions.retrieve(session.id);
  if (latest.payment_status === 'paid') {
    await ensureSubscription(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
    return;
  }
  if (latest.status !== 'complete' || latest.payment_status !== 'unpaid') return;
  const { data: claim, error } = await admin.from('merchant_initial_checkouts')
    .select('id,stripe_session_id').eq('id',id).is('closed_at',null).maybeSingle();
  if (error) throw new Error('db_checkout_claim');
  if (!claim || claim.stripe_session_id !== session.id) return;
  const { error: ce } = await admin.from('merchant_initial_checkouts')
    .update({closed_at: new Date().toISOString()}).eq('id',id)
    .eq('stripe_session_id',session.id).is('closed_at',null);
  if (ce) throw new Error('db_checkout_claim');
}

// ---------------------------------------------------------------- commitment paid in one go (prepaid)
// One Checkout payment (mode=payment, no saved card, no subscription): the commitment's setup fee
// once + its monthly price × its months, both taken from the verified Stripe prices, never from
// the browser. The price is frozen in public.prepaid_purchases before Checkout opens; the period
// (payment date + 12 calendar months, Paris time) opens only once Stripe says the session is paid.

const PREPAID_PLAN: PlanType = 'commitment';

// Abandoned attempts are closed before a new checkout (one attempt at a time per shop). An attempt
// paid in the meantime is confirmed instead, and the caller then refuses a second purchase.
async function settleOpenPrepaid(merchantId: string) {
  const s = requireStripe();
  const { data: open, error } = await admin.from('prepaid_purchases').select('id, stripe_checkout_session_id')
    .eq('merchant_id', merchantId).in('status', ['pending', 'processing']);
  if (error) throw new Error('db_prepaid');
  for (const p of open ?? []) {
    if (!p.stripe_checkout_session_id) { await admin.rpc('prepaid_mark', { p_id: p.id, p_status: 'canceled' }); continue; }
    let cs = await s.checkout.sessions.retrieve(p.stripe_checkout_session_id);
    if (cs.status === 'open') { try { cs = await s.checkout.sessions.expire(cs.id); } catch { cs = await s.checkout.sessions.retrieve(cs.id); } }
    if (cs.payment_status === 'paid') { await confirmPrepaid(await s.checkout.sessions.retrieve(cs.id, { expand: ['payment_intent'] })); continue; }
    // Completed but not paid yet = deferred payment method still processing: no second payment meanwhile.
    if (cs.status === 'complete') throw new HttpError(409, 'payment_processing');
    await admin.rpc('prepaid_mark', { p_id: p.id, p_status: 'canceled' });
  }
}

// An open monthly Checkout session of this shop cannot be paid any more once a prepaid one starts.
async function expireOpenMonthly(row: any) {
  if (!row?.stripe_checkout_session_id || row.stripe_subscription_id || row.status !== 'incomplete' || row.billing_mode === 'prepaid') return;
  const s = requireStripe();
  let cs = await s.checkout.sessions.retrieve(row.stripe_checkout_session_id);
  if (cs.status === 'open') { try { cs = await s.checkout.sessions.expire(cs.id); } catch { cs = await s.checkout.sessions.retrieve(cs.id); } }
  if (cs.payment_status === 'paid') { await ensureSubscription(await s.checkout.sessions.retrieve(cs.id, { expand: ['payment_intent'] })); throw new HttpError(409, 'already_subscribed'); }
}

function prepaidError(error: { message?: string; code?: string }): never {
  const msg = error.message ?? '';
  for (const code of ['already_subscribed', 'payment_issue', 'checkout_in_progress']) if (msg.includes(code)) throw new HttpError(409, code);
  if (error.code === '23505') throw new HttpError(409, 'checkout_in_progress');
  console.error('billing error', 'prepaid', error.code);
  throw new Error('db_prepaid');
}

async function checkoutPrepaid(req: Request, user: { id: string; email?: string | null }, merchantId: string, claim:any,adminCheckout=false): Promise<Response> {
  const s = requireStripe();
  const plan = PLANS[PREPAID_PLAN];
  const ids = await priceIds();
  const [setupPrice, monthlyPrice] = await Promise.all([s.prices.retrieve(ids[plan.setup]), s.prices.retrieve(ids[plan.monthly])]);
  // priceIds() already checked these amounts against PRICES; the purchase is computed from them only.
  const commerce=await billingQuantity(merchantId);
  const monthly = monthlyPrice.unit_amount!*commerce.quantity, setup = commerce.activated?0:PRICES[plan.setup].cents, months = plan.commitmentMonths;

  const { error: xe } = await admin.rpc('prepaid_expire', { p_merchant: merchantId });
  if (xe) throw new Error('db_prepaid');
  const existing = await rowOf(merchantId);
  if (existing && ACCESS.includes(existing.status) && !(existing.billing_mode === 'prepaid' && new Date(existing.current_period_end) <= new Date())) throw new HttpError(409, 'already_subscribed');
  if (existing?.stripe_subscription_id && ['past_due', 'unpaid', 'paused'].includes(existing.status)) throw new HttpError(409, 'payment_issue');
  await settleOpenPrepaid(merchantId);
  await expireOpenMonthly(existing);

  const { data: purchase, error } = await admin.rpc('prepaid_begin', { p_merchant: merchantId, p_user: user.id, p_months: months, p_monthly: monthly, p_setup: setup });
  if (error) prepaidError(error);
  try {
    const { data: merchant } = await admin.from('merchants').select('business_name').eq('id', merchantId).single();
    const customer = await customerFor(s, merchantId, user.email, merchant?.business_name);
    const eur = (c: number) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const origin = siteOrigin(req);
    const metadata = { merchant_id: merchantId, plan_type: PREPAID_PLAN, billing_mode: 'prepaid', purchase_id: purchase.id, user_id: user.id,initial_claim:claim.id };
    const taxBehavior = monthlyPrice.tax_behavior && monthlyPrice.tax_behavior !== 'unspecified' ? { tax_behavior: monthlyPrice.tax_behavior } : {};
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer,
      payment_method_types: ['card', 'sepa_debit'],
      line_items: [
        ...(setup?[{price:setupPrice.id,quantity:1}]:[]),
        { price_data: { currency: 'eur', unit_amount: monthly, product_data: { name: `Offre avec engagement — mensualité (${months-1} mensualités payées, 1 mois offert sur 12)` }, ...taxBehavior }, quantity: months-1 },
      ],
      payment_intent_data: { metadata, description: `DPA Cards — offre avec engagement payée en une fois (${months} mois)` },
      invoice_creation: { enabled: true, invoice_data: { metadata, description: `Offre avec engagement DPA Cards — ${months-1} mois payants sur ${months} + frais de mise en place` } },
      metadata,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      custom_text: { submit: { message: `Paiement unique de ${eur(purchase.total_cents)} : ${months} × ${eur(monthly)} + ${eur(setup)} de mise en place. Accès de ${months} mois à partir de la confirmation du paiement. Aucun prélèvement mensuel, aucun renouvellement automatique.` } },
      success_url: adminCheckout ? `${origin}/activation-result.html?status=success` : `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: adminCheckout ? `${origin}/activation-result.html?status=cancel` : `${origin}/subscription/cancel`,
    }, { idempotencyKey: `dpa-prepaid-${purchase.id}` });
    const { error: ae } = await admin.rpc('prepaid_attach_session', { p_id: purchase.id, p_session: session.id, p_customer: customer });
    if (ae) throw new Error('db_prepaid');
    const {error:claimError}=await admin.from('merchant_initial_checkouts').update({stripe_session_id:session.id}).eq('id',claim.id);
    if(claimError)throw new Error('db_checkout_claim');
    return json(req, 200, { url: session.url });
  } catch (e) {
    await admin.rpc('prepaid_mark', { p_id: purchase.id, p_status: 'canceled' });
    throw e;
  }
}

// Stripe says the session is paid (checked here, with the amount frozen at purchase): period opened once.
async function confirmPrepaid(session: Stripe.Checkout.Session) {
  const s = requireStripe();
  const purchaseId = session.metadata?.purchase_id ?? '', merchantId = session.metadata?.merchant_id;
  if (session.metadata?.billing_mode !== 'prepaid' || !UUID.test(purchaseId) || !merchantId) throw new HttpError(400, 'invalid_session');
  const { data: p } = await admin.from('prepaid_purchases').select('*').eq('id', purchaseId).maybeSingle();
  if (!p || p.merchant_id !== merchantId || (p.stripe_checkout_session_id && p.stripe_checkout_session_id !== session.id)) throw new HttpError(403, 'forbidden');
  if (!p.stripe_checkout_session_id) await admin.rpc('prepaid_attach_session', { p_id: p.id, p_session: session.id, p_customer: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null });
  if (session.payment_status !== 'paid') {
    // complete + unpaid = deferred payment still processing; expired = abandoned. No access either way.
    if (session.status === 'complete') await admin.rpc('prepaid_mark', { p_id: p.id, p_status: 'processing' });
    if (session.status === 'expired') await admin.rpc('prepaid_mark', { p_id: p.id, p_status: 'canceled' });
    const { data: fresh } = await admin.from('prepaid_purchases').select('*').eq('id', p.id).single();
    return { paid: false, pending: session.status === 'complete', purchase: fresh, row: await rowOf(merchantId) };
  }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null;
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const { data, error } = await admin.rpc('prepaid_confirm', {
    p_id: p.id, p_session: session.id, p_amount: session.amount_total, p_currency: session.currency,
    p_payment_intent: pi, p_invoice: invoiceId, p_customer: customer, p_paid_at: null,
  });
  if (error) {
    console.error('billing error', 'prepaid_confirm', error.code, (error.message ?? '').slice(0, 40));
    throw new HttpError(409, (error.message ?? '').includes('amount_mismatch') ? 'amount_mismatch' : 'invalid_session');
  }
  // Sales ledger (same invoice id as the invoice.paid webhook: never counted twice; never blocks the access).
  if (invoiceId) {
    try { await recordInvoice(await s.invoices.retrieve(invoiceId), false); }
    catch (e) { console.error('billing error', 'prepaid ledger', (e as Error).message); }
  }
  if (data.purchase?.conflict) console.error('billing error', 'prepaid paid while another offer is valid', p.id);
  if(!data.purchase?.conflict){
   const {error:ae}=await admin.rpc('profile_confirm_initial',{p_merchant:merchantId,p_payment:pi,p_amount:p.setup_cents});
   if(ae)throw new Error('db_initial_activation');
   const {error:closeError}=await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('stripe_session_id',session.id);
   if(closeError)throw new Error('db_checkout_claim');
  }
  return { paid: true, pending: false, purchase: data.purchase, row: data.subscription };
}

async function prepaidOf(merchantId: string, id?: string | null) {
  let q = admin.from('prepaid_purchases').select('id, months, monthly_cents, base_cents, setup_cents, total_cents, currency, auto_renew, status, conflict, dispute_status, access_start, access_end, paid_at, refunded_cents, refunded_at, access_revoked_at')
    .eq('merchant_id', merchantId);
  q = id ? q.eq('id', id) : q.in('status', ['paid', 'refunded', 'partially_refunded']).order('paid_at', { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------- routes

async function checkout(req: Request, actor?: CheckoutActor): Promise<Response> {
  const s = requireStripe();
  const { user, merchantId } = actor??await member(req);
  const body = await req.json().catch(() => ({}));
  const planType = String(body?.plan ?? '') as PlanType;
  if(body.confirmed!==true)throw new HttpError(422,'confirmation_required');
  const commerce=await billingQuantity(merchantId);
  if(body.quote?.quantity!==commerce.quantity || body.quote?.setup!==(commerce.activated?0:PRICES[plan.setup].cents))throw new HttpError(409,'quote_changed');
  if (!(planType in PLANS)) throw new HttpError(422, 'invalid_plan');
  const billing = String(body?.billing ?? 'monthly');
  if (!['monthly', 'prepaid'].includes(billing) || (billing === 'prepaid' && planType !== PREPAID_PLAN)) throw new HttpError(422, 'invalid_plan');
  const { data: program } = await admin.from('programs').select('id').eq('merchant_id', merchantId).eq('is_active', true).maybeSingle();
  if (!program) throw new HttpError(409, 'onboarding_incomplete');
  await admin.rpc('prepaid_expire',{p_merchant:merchantId});
  const current=await rowOf(merchantId);
  if(current&&ACCESS.includes(current.status))throw new HttpError(409,'already_subscribed');
  if(current?.stripe_subscription_id&&['past_due','unpaid','paused'].includes(current.status))throw new HttpError(409,'payment_issue');
  const {data:claim,error:claimError}=await admin.rpc('claim_initial_checkout',{p_merchant:merchantId,p_plan:planType,p_billing:billing,p_quantity:commerce.quantity,p_setup:commerce.activated?0:PRICES[plan.setup].cents});
  if(claimError)throw new HttpError(409,'checkout_in_progress');
  if(!claim.stripe_session_id && current?.stripe_customer_id){
    for await(const candidate of s.checkout.sessions.list({customer:current.stripe_customer_id,limit:100})){
      if(candidate.metadata?.initial_claim===claim.id){
        claim.stripe_session_id=candidate.id;
        const {error}=await admin.from('merchant_initial_checkouts').update({stripe_session_id:candidate.id}).eq('id',claim.id);
        if(error)throw new Error('db_checkout_claim');break;
      }
      if(candidate.created*1000<Date.parse(claim.created_at)-300000)break;
    }
  }
  if(claim.stripe_session_id){
    const prior=await s.checkout.sessions.retrieve(claim.stripe_session_id);
    if(prior.payment_status==='paid'||prior.payment_status==='no_payment_required'){
      if(billing==='prepaid')await confirmPrepaid(prior);else await ensureSubscription(prior);
      throw new HttpError(409,'already_subscribed');
    }
    if(prior.status==='open')return json(req,200,{url:prior.url});
    if(prior.status==='complete')throw new HttpError(409,'payment_processing');
    await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('id',claim.id);
    throw new HttpError(409,'quote_changed');
  }
  if(Date.now()-Date.parse(claim.created_at)>23*3600000){
    if(!current?.stripe_customer_id)throw new HttpError(409,'payment_processing');
    await admin.from('merchant_initial_checkouts').update({closed_at:new Date().toISOString()}).eq('id',claim.id);
    throw new HttpError(409,'quote_changed');
  }
  if (billing === 'prepaid') return await checkoutPrepaid(req, user, merchantId,claim,actor?.adminCheckout===true);

  const plan = PLANS[planType];
  const ids = await priceIds();
  const setupId = ids[plan.setup], monthlyId = ids[plan.monthly];
  // An ended prepaid period is 'expired' before anything else; an open prepaid attempt is closed.
  await admin.rpc('prepaid_expire', { p_merchant: merchantId });
  const existing = await rowOf(merchantId);
  if (existing && ACCESS.includes(existing.status)) throw new HttpError(409, 'already_subscribed');
  // A subscription that still exists at Stripe but is unpaid is settled in the portal, never duplicated.
  if (existing?.stripe_subscription_id && ['past_due', 'unpaid', 'paused'].includes(existing.status)) throw new HttpError(409, 'payment_issue');
  await expireOpenMonthly(existing);
  // A prepaid attempt still open is closed first (or confirmed if it was paid meanwhile: then no second offer).
  await settleOpenPrepaid(merchantId);
  const settled = await rowOf(merchantId);
  if (settled?.billing_mode === 'prepaid' && ACCESS.includes(settled.status)) throw new HttpError(409, 'already_subscribed');

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
  // Reserve the incomplete row BEFORE Checkout can deliver a webhook. A late
  // response may attach a session but can never overwrite an active subscription.
  const pendingRow={merchant_id:merchantId,stripe_customer_id:customer,plan_type:planType,commitment_months:plan.commitmentMonths,
    stripe_setup_price_id:setupId,stripe_price_id:monthlyId,setup_amount_cents:commerce.activated?0:PRICES[plan.setup].cents,monthly_amount_cents:monthlyPrice.unit_amount!*commerce.quantity,
    status:'incomplete',stripe_subscription_id:null,stripe_checkout_session_id:null,stripe_setup_payment_intent_id:null,setup_paid_at:null,
    trial_start:null,trial_end:null,current_period_start:null,current_period_end:null,billing_cycle_anchor:null,commitment_start:null,commitment_end:null,
    cancel_at_period_end:false,cancel_at:null,canceled_at:null,cancel_requested_at:null,latest_invoice_status:null,billing_mode:'monthly',prepaid_purchase_id:null};
  const reserved=existing?await admin.from('subscriptions').update(pendingRow).eq('merchant_id',merchantId).eq('status',existing.status)
    :await admin.from('subscriptions').upsert(pendingRow,{onConflict:'merchant_id',ignoreDuplicates:true});
  if(reserved.error)throw new Error('db_subscriptions');
  const metadata = { merchant_id: merchantId, plan_type: planType, user_id: user.id,commerce_quantity:String(commerce.quantity),initial_claim:claim.id };
  const session = await s.checkout.sessions.create({
    mode: !commerce.activated?'payment':'setup',
    customer,
    // Show both card and SEPA debit in Stripe-hosted Checkout.
    // Checkout collects the card details or IBAN and mandate securely; the
    // merchant never gives this information to the DPA Cards admin interface.
    payment_method_types: ['card', 'sepa_debit'],
    // Save a reusable method for the existing off-session subscription flow.
    ...(!commerce.activated?{line_items:[{price_data:{currency:'eur',unit_amount:PRICES[plan.setup].cents,product:typeof setupPrice.product==='string'?setupPrice.product:setupPrice.product.id},quantity:1}],
      payment_intent_data:{setup_future_usage:'off_session' as const,metadata,description:'DPA Cards — frais d’activation'},
      invoice_creation:{enabled:true,invoice_data:{metadata,description:'Activation DPA Cards'}}}:{setup_intent_data:{metadata}}),
    metadata,
    locale: 'fr',
    custom_text: { submit: { message: `Aujourd’hui : ${eur(commerce.activated?0:PRICES[plan.setup].cents)} d’activation. Votre abonnement à ${eur(monthlyPrice.unit_amount!*commerce.quantity)}/mois pour ${commerce.quantity} commerce(s) commence après un mois d’essai gratuit, au prorata jusqu’au 1er du mois suivant, puis chaque 1er du mois${plan.commitmentMonths ? ', avec un engagement de 12 mois' : ', sans engagement'}.` } },
    success_url: actor?.adminCheckout ? `${origin}/activation-result.html?status=success` : `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: actor?.adminCheckout ? `${origin}/activation-result.html?status=cancel` : `${origin}/subscription/cancel`,
  },{idempotencyKey:`dpa-initial-checkout-${claim.id}`});
  const {error:attachError}=await admin.from('merchant_initial_checkouts').update({stripe_session_id:session.id}).eq('id',claim.id);
  if(attachError)throw new Error('db_checkout_claim');
  const {error:subscriptionAttachError}=await admin.from('subscriptions').update({stripe_checkout_session_id:session.id}).eq('merchant_id',merchantId).eq('status','incomplete').is('stripe_subscription_id',null);
  if(subscriptionAttachError)throw new Error('db_subscriptions');
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
  if (session.metadata?.billing_mode === 'prepaid') {
    const r = await confirmPrepaid(session);
    const { data: access } = await admin.rpc('merchant_has_access', { p_merchant: merchantId });
    return json(req, 200, { paid: r.paid, pending: r.pending, billing_mode: 'prepaid', status: r.row?.status ?? 'incomplete',
      access: r.paid && access === true && r.row?.prepaid_purchase_id === r.purchase?.id, subscription: r.row, prepaid: await prepaidOf(merchantId, r.purchase?.id) });
  }
  const r = await ensureSubscription(session);
  const pending = !r.paid && session.status === 'complete' && session.mode === 'payment' && session.payment_status !== 'paid';
  return json(req, 200, { paid: r.paid, pending, status: r.row?.status ?? 'incomplete',
    access: !!r.row && ACCESS.includes(r.row.status), subscription: r.row });
}

async function summary(req: Request): Promise<Response> {
  const { merchantId } = await member(req, false);
  await admin.rpc('prepaid_expire', { p_merchant: merchantId });
  const row = await rowOf(merchantId);
  const out: Record<string, unknown> = { subscription: row, payment_method: null, invoices: [], upcoming: null,
    prepaid: row?.billing_mode === 'prepaid' ? await prepaidOf(merchantId, row.prepaid_purchase_id) : null };
  const {data:merchant}=await admin.from('merchants').select('billing_account_id').eq('id',merchantId).single();
  const {data:activations,error:activationError}=await admin.from('merchant_activations').select('merchant_id').eq('account_id',merchant?.billing_account_id);
  if(activationError)throw new Error('db_profiles');
  out.commerce_count=activations?.length||0;
  const {data:additions,error:additionError}=await admin.from('merchant_profile_operations').select('ordinal,activation_cents,quote,confirmed_at')
    .eq('account_id',merchant?.billing_account_id).eq('status','complete').order('confirmed_at',{ascending:false});
  if(additionError)throw new Error('db_profiles');
  out.profile_additions=additions;
  out.prepaid_additions_cents=(additions||[]).filter(x=>x.quote.billing_mode==='prepaid'&&x.quote.prepaid_purchase_id===row?.prepaid_purchase_id)
    .reduce((total,x)=>total+x.quote.immediate_cents,0);
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
  const { user, merchantId } = await member(req,true,false);
  // A director-granted manual entitlement also permits ordering the independent
  // paid custom design. It does NOT waive the 29,90 € Stripe design charge.
  const {data:hasAccess,error:accessError}=await admin.rpc('merchant_has_access',{p_merchant:merchantId});
  if(accessError)throw new Error('db_merchant_access');
  if(hasAccess!==true)throw new HttpError(402,'subscription_required');
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
  const { merchantId } = await member(req,true,false);
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
  const { merchantId } = await member(req, false,false);
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
  // Received events (information only: every handler below is idempotent on its own).
  await admin.from('sales_provider_events').upsert({ provider: 'stripe', event_id: event.id, type: event.type }, { onConflict: 'provider,event_id', ignoreDuplicates: true });
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      if(session.metadata?.type==='merchant_profile'){
        const latest=await s.checkout.sessions.retrieve(session.id);
        if(event.type==='checkout.session.async_payment_failed')await profiles.failed(latest);
        else if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')await profiles.confirm(latest);
        break;
      }
      if (session.metadata?.billing_mode === 'prepaid') {
        // Paid / processing / expired: read again from Stripe (never from the event alone).
        if (event.type === 'checkout.session.async_payment_failed') {
          const id = session.metadata?.purchase_id ?? '';
          if (UUID.test(id)) await admin.rpc('prepaid_mark', { p_id: id, p_status: 'failed' });
        } else await confirmPrepaid(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
        break;
      }
      if (event.type === 'checkout.session.async_payment_failed') {
        await failInitialAsyncCheckout(session);
        break;
      }
      if (event.type === 'checkout.session.expired') break;
      if (session.metadata?.type === 'custom_design') await confirmDesign(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] }));
      else if (['payment','setup'].includes(session.mode) && session.metadata?.merchant_id && session.metadata?.plan_type) await ensureSubscription(await s.checkout.sessions.retrieve(session.id, { expand: ['payment_intent','setup_intent'] }));
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
      // Sales ledger: collected or failed money only. An error makes Stripe retry the event.
      if (event.type !== 'invoice.finalized') await recordInvoice(inv, event.type === 'invoice.payment_failed');
      break;
    }
    case 'charge.refunded': {
      // Cumulative refunded amount, matched to the invoice through its payment intent.
      const ch = event.data.object as Stripe.Charge;
      const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id ?? null;
      if (pi) {
        const { error } = await admin.rpc('sales_record_refund', { p_provider: 'stripe', p_charge_ref: pi, p_refunded: ch.amount_refunded });
        if (error) { console.error('billing error', 'sales_record_refund', error.code); throw new Error('db_sales_refund'); }
        // Prepaid commitment: full refund ends the paid period, a partial one is recorded.
        const { error: pe } = await admin.rpc('prepaid_refund', { p_payment_intent: pi, p_refunded: ch.amount_refunded });
        if (pe) { console.error('billing error', 'prepaid_refund', pe.code); throw new Error('db_prepaid_refund'); }
      }
      break;
    }
    case 'charge.dispute.created':
    case 'charge.dispute.closed': {
      // Prepaid commitment only (monthly payments keep their existing handling): lost = the period ends.
      const d = event.data.object as Stripe.Dispute;
      const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
      const st = event.type === 'charge.dispute.created' ? 'open' : d.status === 'lost' ? 'lost' : d.status === 'won' ? 'won' : null;
      if (pi && st) {
        const { error } = await admin.rpc('prepaid_dispute', { p_payment_intent: pi, p_status: st });
        if (error) { console.error('billing error', 'prepaid_dispute', error.code); throw new Error('db_prepaid_dispute'); }
      }
      break;
    }
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const profiles=profileBilling({admin,requireStripe,member,priceIds,rowOf,syncSubscription,HttpError,json,siteOrigin});
Deno.serve(async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method === 'POST' && path.endsWith('/webhook')) return await webhook(req);
    if (req.method === 'POST' && path.endsWith('/admin-initial-quote')) return await initialQuote(req,await adminCheckoutActor(req));
    if (req.method === 'POST' && path.endsWith('/admin-checkout')) return await checkout(req,await adminCheckoutActor(req));
    if (req.method === 'POST' && path.endsWith('/initial-quote')) return await initialQuote(req);
    if (req.method === 'POST' && path.endsWith('/profile-quote')) return await profiles.quote(req);
    if (req.method === 'POST' && path.endsWith('/profile-accept')) return await profiles.accept(req);
    if (req.method === 'POST' && path.endsWith('/profile-resume')) return await profiles.resume(req);
    if (req.method === 'POST' && path.endsWith('/profile-cancel')) return await profiles.cancel(req);
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
