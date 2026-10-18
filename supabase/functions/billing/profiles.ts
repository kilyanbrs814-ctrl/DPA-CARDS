import { activationFee, monthlyTotal, prepaidProration } from '../_shared/profile-pricing.js';

// Durable payment saga. The database serializes each billing account. Checkout
// pays activation (+ annual top-up); only then is the EXISTING subscription
// updated. If a worker stops, webhooks/resume finish the same operation.
export function profileBilling(d: any) {
 const {admin,requireStripe,member,priceIds,rowOf,syncSubscription,HttpError,json,siteOrigin}=d;
 const check=(r:any)=>{if(r.error)throw new Error('db_profiles');return r.data;};
 async function context(req:Request) {
  const {user,merchantId}=await member(req,true,false);
  const m=check(await admin.from('merchants').select('billing_account_id').eq('id',merchantId).single());
  const a=check(await admin.from('merchant_billing_accounts').select('*').eq('id',m.billing_account_id).eq('owner_id',user.id).single());
  if(!a)throw new HttpError(403,'owner_only');
  return {user,merchantId,account:a,row:await rowOf(a.primary_merchant_id)};
 }
 async function operations(accountId:string) {
  return check(await admin.from('merchant_profile_operations').select('*').eq('account_id',accountId)
   .in('status',['quoted','accepted','paid']).maybeSingle());
 }
 async function save(id:string,patch:any) {
  return check(await admin.from('merchant_profile_operations').update(patch).eq('id',id).select().single());
 }
 function verifySubscription(sub:any) {
  const item=sub.items?.data?.[0];
  if(sub.items?.data?.length!==1 || !['active','trialing'].includes(sub.status) || sub.cancel_at_period_end || sub.cancel_at || sub.schedule || sub.pending_update ||
   sub.collection_method!=='charge_automatically' || sub.currency!=='eur' || item?.price?.recurring?.interval!=='month' || item?.price?.recurring?.interval_count!==1 ||
   sub.discount || sub.discounts?.length || sub.automatic_tax?.enabled || sub.default_tax_rates?.length || item.tax_rates?.length || sub.pause_collection || sub.pending_invoice_item_interval)
   throw new HttpError(409,'unsupported_subscription');
  return item;
 }
 const fingerprint=(sub:any)=>JSON.stringify({id:sub.id,status:sub.status,item:sub.items.data[0].id,price:sub.items.data[0].price.id,
  quantity:sub.items.data[0].quantity,anchor:sub.billing_cycle_anchor,trial:sub.trial_end,period:sub.current_period_end});
 async function quote(req:Request) {
  const s=requireStripe(),c=await context(req);
  const existing=await operations(c.account.id);
  if(existing && (existing.status!=='quoted'||new Date(existing.expires_at)>new Date())) {
   if(existing.merchant_id!==c.merchantId)throw new HttpError(409,'checkout_in_progress');
   return json(req,200,{operation:existing});
  }
  const activations=check(await admin.from('merchant_activations').select('merchant_id').eq('account_id',c.account.id));
  if(activations.some((a:any)=>a.merchant_id===c.merchantId))throw new HttpError(409,'already_activated');
  if(!activations.length || !c.row || !['active','trialing'].includes(c.row.status))throw new HttpError(409,'primary_activation_required');
  const p=check(await admin.from('programs').select('design_status').eq('merchant_id',c.merchantId).eq('is_active',true).single());
  const request=check(await admin.from('design_requests').select('id').eq('merchant_id',c.merchantId).eq('status','pending_payment').limit(1).maybeSingle());
  if(!p || (p.design_status==='draft' && !request))throw new HttpError(409,'onboarding_incomplete');
  const n=activations.length,now=Math.floor(Date.now()/1000),next=monthlyTotal(n+1);
  const q:any={current_count:n,new_count:n+1,activation_cents:activationFee(n+1),new_monthly_cents:next,
   effective_at:new Date(now*1000).toISOString(),proration_date:now,currency:'eur',billing_mode:c.row.billing_mode,
   primary_merchant_id:c.account.primary_merchant_id};
  if(c.row.billing_mode==='prepaid') {
   const purchase=check(await admin.from('prepaid_purchases').select('*').eq('id',c.row.prepaid_purchase_id).single());
   if(!purchase || purchase.conflict || purchase.refunded_cents || purchase.dispute_status || !purchase.months || !c.row.current_period_end || new Date(c.row.current_period_end)<=new Date())throw new HttpError(409,'prepaid_rule_required');
   q.current_monthly_cents=c.row.monthly_amount_cents;
   q.prepaid_purchase_id=purchase.id;q.access_start=c.row.current_period_start;q.access_end=c.row.current_period_end;
   q.proration_cents=prepaidProration(q.current_monthly_cents,next,Date.parse(q.access_start),Date.parse(q.access_end),now*1000,purchase.months);
   q.proration_collection='now';
  } else {
   const sub=await s.subscriptions.retrieve(c.row.stripe_subscription_id),item=verifySubscription(sub);
   q.current_monthly_cents=item.price.unit_amount*item.quantity;
   q.subscription_id=sub.id;q.subscription_item_id=item.id;q.subscription_fingerprint=fingerprint(sub);
   q.price_id=(await priceIds())[c.row.plan_type==='commitment'?'monthly_commitment':'monthly_no_commitment'];
   const up=await s.invoices.retrieveUpcoming({customer:c.row.stripe_customer_id,subscription:sub.id,
    subscription_items:[{id:item.id,price:q.price_id,quantity:n+1}],subscription_proration_date:now});
   if(up.lines.has_more)throw new HttpError(409,'unsupported_subscription');
   q.proration_cents=up.lines.data.filter((l:any)=>l.proration && l.period?.start===now).reduce((a:number,l:any)=>a+l.amount,0);
   q.proration_collection='next_invoice';q.next_invoice_at=new Date((up.next_payment_attempt||up.period_end)*1000).toISOString();
  }
  if(!Number.isSafeInteger(q.current_monthly_cents))throw new HttpError(409,'unsupported_subscription');
  q.monthly_difference_cents=next-q.current_monthly_cents;
  q.immediate_cents=q.activation_cents+(q.proration_collection==='now'?q.proration_cents:0);
  const result=await admin.rpc('profile_quote_begin',{p_merchant:c.merchantId,p_owner:c.user.id,p_quote:q});
  if(result.error)throw new HttpError(409,/checkout_in_progress/.test(result.error.message)?'checkout_in_progress':'quote_changed');
  return json(req,200,{operation:result.data});
 }
 async function currentMatches(op:any) {
  const s=requireStripe(),q=op.quote,row=await rowOf(q.primary_merchant_id);
  if(q.billing_mode==='prepaid')return row?.prepaid_purchase_id===q.prepaid_purchase_id && row.current_period_end===q.access_end && row.monthly_amount_cents===q.current_monthly_cents && row.status==='active';
  const sub=await s.subscriptions.retrieve(q.subscription_id);
  try{verifySubscription(sub);}catch{return false;}
  return fingerprint(sub)===q.subscription_fingerprint;
 }
 async function accept(req:Request) {
  const s=requireStripe(),c=await context(req),body=await req.json();
  let op=await operations(c.account.id);
  if(!op || op.merchant_id!==c.merchantId || op.id!==body.operation_id || body.confirmed!==true)throw new HttpError(409,'quote_changed');
  if(op.status==='paid')return json(req,200,{operation:await finish(op)});
  if(op.status==='quoted') {
   if(new Date(op.expires_at)<=new Date())throw new HttpError(409,'quote_expired');
   if(!await currentMatches(op))throw new HttpError(409,'quote_changed');
   // CAS: all repeated accepts refer to exactly the same durable operation.
   const r=await admin.from('merchant_profile_operations').update({status:'accepted',accepted_at:new Date().toISOString()})
    .eq('id',op.id).eq('status','quoted').select().maybeSingle();
   check(r);op=r.data||check(await admin.from('merchant_profile_operations').select('*').eq('id',op.id).single());
  }
  if(op.stripe_session_id) {
   const cs=await s.checkout.sessions.retrieve(op.stripe_session_id);
   if(cs.payment_status==='paid')return json(req,200,{operation:await confirm(cs)});
   if(cs.status!=='open')throw new HttpError(409,'payment_processing');
   return json(req,200,{url:cs.url,operation:op});
  }
  // Never reuse a Stripe idempotency key after its retention period. An accepted
  // operation with no persisted session is recovered by scanning its customer.
  const sessions=await s.checkout.sessions.list({customer:c.row.stripe_customer_id,limit:100});
  const found=sessions.data.find((cs:any)=>cs.metadata?.profile_operation===op.id);
  if(!found && Date.now()-Date.parse(op.accepted_at)>23*3600000)throw new HttpError(409,'payment_processing');
  const q=op.quote,origin=siteOrigin(req),metadata={type:'merchant_profile',profile_operation:op.id,merchant_id:op.merchant_id,account_id:op.account_id};
  const items:any[]=[{price_data:{currency:'eur',unit_amount:op.activation_cents,product_data:{name:`Activation du commerce n°${op.ordinal}`}},quantity:1}];
  if(q.proration_collection==='now' && q.proration_cents>0)items.push({price_data:{currency:'eur',unit_amount:q.proration_cents,product_data:{name:'Complément au prorata de la période prépayée restante'}},quantity:1});
  const cs=found||await s.checkout.sessions.create({mode:'payment',customer:c.row.stripe_customer_id,line_items:items,metadata,
   payment_intent_data:{metadata},invoice_creation:{enabled:true,invoice_data:{metadata}},locale:'fr',
   success_url:`${origin}/?profile_payment=return`,cancel_url:`${origin}/?profile_payment=cancel`,
   custom_text:{submit:{message:`Activation unique : ${(q.activation_cents/100).toFixed(2)} €. Nouveau total : ${(q.new_monthly_cents/100).toFixed(2)} €/mois pour ${q.new_count} commerces. ${q.proration_collection==='next_invoice'?'Prorata sur la prochaine facture.':'Complément de période prépayée inclus.'}`}}
  },{idempotencyKey:`dpa-profile-checkout-${op.id}`});
  op=await save(op.id,{stripe_session_id:cs.id});
  if(cs.payment_status==='paid')return json(req,200,{operation:await confirm(cs)});
  return json(req,200,{url:cs.url,operation:op});
 }
 async function finish(op:any) {
  if(op.status==='complete')return op;
  if(op.status!=='paid')throw new HttpError(409,'payment_processing');
  const s=requireStripe(),q=op.quote;
  if(q.billing_mode==='prepaid') {
   const row=await rowOf(q.primary_merchant_id);
   if(row?.prepaid_purchase_id!==q.prepaid_purchase_id || row.current_period_end!==q.access_end || new Date(q.access_end)<=new Date())return compensate(op);
   check(await admin.from('subscriptions').update({monthly_amount_cents:q.new_monthly_cents}).eq('merchant_id',q.primary_merchant_id));
  } else {
   let sub=await s.subscriptions.retrieve(q.subscription_id);
   // Metadata and item update happen in ONE Stripe request. This also recovers
   // after the 24h key window without repeating a proration or quantity change.
   if(sub.metadata?.profile_operation!==op.id) {
    // Validate this exact snapshot. A second read between this check and the
    // update could mistake a concurrent fulfillment of OUR operation for an
    // unrelated contract change and incorrectly refund an activated commerce.
    let same=false;try{verifySubscription(sub);same=fingerprint(sub)===q.subscription_fingerprint;}catch{/* changed */}
    if(!same)return compensate(op);
    sub=await s.subscriptions.update(q.subscription_id,{items:[{id:q.subscription_item_id,price:q.price_id,quantity:q.new_count}],
     proration_behavior:'create_prorations',proration_date:q.proration_date,payment_behavior:'error_if_incomplete',
     metadata:{profile_operation:op.id}},{idempotencyKey:`dpa-profile-subscription-${op.id}`});
   }
   const item=sub.items.data[0];
   if(!['active','trialing'].includes(sub.status)||item.price.id!==q.price_id||item.quantity!==q.new_count)throw new HttpError(409,'payment_processing');
   await syncSubscription(sub);
  }
  check(await admin.rpc('profile_complete',{p_operation:op.id,p_payment:op.stripe_payment_id}));
  return check(await admin.from('merchant_profile_operations').select('*').eq('id',op.id).single());
 }
 async function compensate(op:any) {
  // An independently changed/expired contract cannot be silently charged under
  // new terms. If fulfillment is impossible, return the entire new payment;
  // activation rank is never consumed. Replays reuse the same refund.
  const refund=await requireStripe().refunds.create({payment_intent:op.stripe_payment_id,amount:op.quote.immediate_cents,
   metadata:{profile_operation:op.id}},{idempotencyKey:`dpa-profile-refund-${op.id}`});
  if(refund.status!=='succeeded')throw new HttpError(409,'payment_processing');
  return save(op.id,{status:'cancelled',stripe_refund_id:refund.id});
 }
 async function confirm(cs:any) {
  const op=check(await admin.from('merchant_profile_operations').select('*').eq('id',cs.metadata?.profile_operation).single());
  if(op.status==='complete'||(op.status==='cancelled'&&op.stripe_refund_id))return op;
  if(cs.payment_status!=='paid')return op;
  if(!['accepted','paid'].includes(op.status) || cs.customer!==(await rowOf(op.quote.primary_merchant_id))?.stripe_customer_id ||
   (op.stripe_session_id && cs.id!==op.stripe_session_id) || cs.currency!=='eur' || cs.amount_total!==op.quote.immediate_cents)throw new HttpError(409,'amount_mismatch');
  const pi=typeof cs.payment_intent==='string'?cs.payment_intent:cs.payment_intent?.id;
  if(!pi)throw new HttpError(409,'payment_processing');
  const r=await admin.from('merchant_profile_operations').update({status:'paid',stripe_session_id:cs.id,stripe_payment_id:pi})
   .eq('id',op.id).in('status',['accepted','paid']).select().maybeSingle();check(r);
  return finish(r.data||check(await admin.from('merchant_profile_operations').select('*').eq('id',op.id).single()));
 }
 async function resume(req:Request) {
  const c=await context(req);let op=await operations(c.account.id);
  if(!op || op.merchant_id!==c.merchantId)return json(req,200,{operation:null});
  if(op.status==='paid')op=await finish(op);
  else if(op.stripe_session_id) {
   const cs=await requireStripe().checkout.sessions.retrieve(op.stripe_session_id);
   if(cs.payment_status==='paid')op=await confirm(cs);
   else if(cs.status==='expired')op=await save(op.id,{status:'cancelled'});
  }
  return json(req,200,{operation:op});
 }
 async function cancel(req:Request) {
  const c=await context(req);let op=await operations(c.account.id);
  if(!op || op.merchant_id!==c.merchantId)return json(req,200,{});
  // CAS prevents a concurrent first accept from opening a payable session while
  // cancellation releases the account lock. Accepted attempts expire at Stripe.
  if(op.status==='quoted') {
   const r=await admin.from('merchant_profile_operations').update({status:'cancelled'}).eq('id',op.id).eq('status','quoted').select().maybeSingle();
   if(check(r))return json(req,200,{});
   throw new HttpError(409,'checkout_in_progress');
  }
  if(op.status==='paid')return json(req,200,{operation:await finish(op)});
  if(!op.stripe_session_id)throw new HttpError(409,'checkout_in_progress');
  let cs=await requireStripe().checkout.sessions.retrieve(op.stripe_session_id);
  if(cs.status==='open') {try{cs=await requireStripe().checkout.sessions.expire(cs.id);}catch{cs=await requireStripe().checkout.sessions.retrieve(cs.id);}}
  if(cs.payment_status==='paid')return json(req,200,{operation:await confirm(cs)});
  if(cs.status!=='expired')throw new HttpError(409,'payment_processing');
  await save(op.id,{status:'cancelled'});return json(req,200,{});
 }
 return {quote,accept,resume,cancel,confirm,finish};
}
