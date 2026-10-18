import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileBilling} from '../supabase/functions/billing/profiles.ts';

function harness({prepaid=false,status='accepted'}={}) {
 const calls={sessions:0,updates:0,activations:0,syncs:0,refunds:0};let failSync=false;
 const sub={id:'sub_1',status:'active',currency:'eur',collection_method:'charge_automatically',metadata:{},billing_cycle_anchor:123,
  current_period_start:100,current_period_end:10000000000,trial_end:null,items:{data:[{id:'si_1',quantity:1,price:{id:'old_price',unit_amount:2490,recurring:{interval:'month',interval_count:1}}}]}};
 const fingerprint=JSON.stringify({id:'sub_1',status:'active',item:'si_1',price:'old_price',quantity:1,anchor:123,trial:null,period:10000000000});
 const q={current_count:1,new_count:2,activation_cents:3000,current_monthly_cents:2490,new_monthly_cents:4000,
  monthly_difference_cents:1510,immediate_cents:prepaid?12060+3000:3000,billing_mode:prepaid?'prepaid':'monthly',
  primary_merchant_id:'primary',subscription_id:'sub_1',subscription_item_id:'si_1',subscription_fingerprint:fingerprint,
  price_id:'price_20',proration_date:12345,proration_cents:prepaid?12060:800,proration_collection:prepaid?'now':'next_invoice',
  prepaid_purchase_id:'annual',access_end:'2027-01-01T00:00:00Z'};
 const op={id:'op_2',account_id:'account',merchant_id:'draft',ordinal:2,activation_cents:3000,quote:q,status,expires_at:new Date(Date.now()+900000).toISOString(),accepted_at:new Date().toISOString(),stripe_session_id:null};
 const row={merchant_id:'primary',status:'active',stripe_subscription_id:'sub_1',stripe_customer_id:'cus_1',monthly_amount_cents:2490,
  billing_mode:prepaid?'prepaid':'monthly',prepaid_purchase_id:'annual',current_period_end:q.access_end};
 const tables={merchant_profile_operations:[op],merchants:[{id:'draft',billing_account_id:'account'}],merchant_billing_accounts:[{id:'account',owner_id:'owner',primary_merchant_id:'primary'}],subscriptions:[row]};
 function builder(name) {
  const predicates=[];let patch=null,one=false;
  const b={select(){return b},eq(k,v){predicates.push(o=>o[k]===v);return b},in(k,v){predicates.push(o=>v.includes(o[k]));return b},
   update(p){patch=p;return b},maybeSingle(){one=true;return b},single(){one=true;return b},
   then(resolve,reject){try{const out=(tables[name]||[]).filter(o=>predicates.every(f=>f(o)));if(patch)out.forEach(o=>Object.assign(o,patch));
    return Promise.resolve({data:structuredClone(one?out[0]||null:out),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return b;
 }
 const admin={from:builder,async rpc(name,args){if(name==='profile_complete'){
  if(op.status==='complete')return {data:null,error:null};
  assert.equal(op.status,'paid');assert.equal(args.p_payment,op.stripe_payment_id);calls.activations++;op.status='complete';return {data:null,error:null};
 }throw Error(name);}};
 let cs=null;const updateKeys=new Map();
 const stripe={
  refunds:{create:async()=>{calls.refunds++;return {id:'re_profile',status:'succeeded'}}},
  subscriptions:{retrieve:async()=>structuredClone(sub),update:async(id,patch,{idempotencyKey})=>{
   if(!updateKeys.has(idempotencyKey)){calls.updates++;sub.metadata={...sub.metadata,...patch.metadata};sub.items.data[0]={id:'si_1',quantity:patch.items[0].quantity,price:{id:patch.items[0].price,unit_amount:2000,recurring:{interval:'month',interval_count:1}}};updateKeys.set(idempotencyKey,structuredClone(sub));}
   return updateKeys.get(idempotencyKey);}},
  checkout:{sessions:{list:async()=>({data:cs?[structuredClone(cs)]:[]}),retrieve:async()=>structuredClone(cs),expire:async()=>{cs.status='expired';return structuredClone(cs)},
   create:async body=>{calls.sessions++;cs={id:'cs_2',url:'https://checkout.stripe.com/test',customer:'cus_1',payment_status:'unpaid',status:'open',currency:'eur',amount_total:q.immediate_cents,metadata:body.metadata,payment_intent:'pi_2'};return structuredClone(cs);}}}
 };
 class HttpError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
 const api=profileBilling({admin,requireStripe:()=>stripe,member:async()=>({user:{id:'owner'},merchantId:'draft'}),rowOf:async()=>structuredClone(row),
  priceIds:async()=>({monthly_no_commitment:'price_20'}),syncSubscription:async()=>{calls.syncs++;if(failSync){failSync=false;throw Error('connection interrupted');}},HttpError,
  json:(req,status,body)=>body,siteOrigin:()=> 'https://cards.example.com'});
 const request=(body={})=>new Request('https://example.test',{method:'POST',body:JSON.stringify(body)});
 return {api,op,row,q,sub,calls,request,paid:()=>{cs.payment_status='paid';cs.status='complete';return structuredClone(cs)},interrupt:()=>failSync=true};
}

test('double accept reuses one Checkout; unpaid/abandoned flow never grants access',async()=>{
 const h=harness();const req=()=>h.request({operation_id:'op_2',confirmed:true});
 await h.api.accept(req());await h.api.accept(req());
 assert.equal(h.calls.sessions,1);assert.equal(h.calls.updates,0);assert.equal(h.calls.activations,0);
 await h.api.resume(h.request());assert.equal(h.calls.activations,0);
 await h.api.cancel(h.request());assert.equal(h.op.status,'cancelled');assert.equal(h.calls.activations,0);
});
test('payment confirmation changes the existing item and quantity; repeated webhook activates once',async()=>{
 const h=harness();await h.api.accept(h.request({operation_id:'op_2',confirmed:true}));const cs=h.paid();
 await Promise.all([h.api.confirm(cs),h.api.confirm(cs)]);
 assert.equal(h.calls.updates,1);assert.equal(h.calls.activations,1);assert.equal(h.sub.id,'sub_1');assert.equal(h.sub.items.data[0].quantity,2);
});
test('interruption after Stripe update is resumed without another charge or proration',async()=>{
 const h=harness();await h.api.accept(h.request({operation_id:'op_2',confirmed:true}));const cs=h.paid();h.interrupt();
 await assert.rejects(h.api.confirm(cs),/connection interrupted/);assert.equal(h.op.status,'paid');assert.equal(h.calls.activations,0);
 await h.api.resume(h.request());assert.equal(h.op.status,'complete');assert.equal(h.calls.updates,1);assert.equal(h.calls.sessions,1);assert.equal(h.calls.activations,1);
});
test('annual addition charges only activation plus prorated top-up; no subscription is created',async()=>{
 const h=harness({prepaid:true});await h.api.accept(h.request({operation_id:'op_2',confirmed:true}));
 assert.equal(h.q.immediate_cents,15060);await h.api.confirm(h.paid());
 assert.equal(h.row.monthly_amount_cents,4000);assert.equal(h.row.current_period_end,'2027-01-01T00:00:00Z');
 assert.equal(h.calls.updates,0);assert.equal(h.calls.activations,1);
});
test('explicit consent, owner context, frozen amounts and freshness are enforced',async()=>{
 const h=harness();await assert.rejects(h.api.accept(h.request({operation_id:'op_2'})),/quote_changed/);
 await h.api.accept(h.request({operation_id:'op_2',confirmed:true}));const cs=h.paid();
 await assert.rejects(h.api.confirm({...cs,amount_total:1}),/amount_mismatch/);assert.equal(h.calls.activations,0);
 const expired=harness({status:'quoted'});expired.op.expires_at=new Date(0).toISOString();
 await assert.rejects(expired.api.accept(expired.request({operation_id:'op_2',confirmed:true})),/quote_expired/);
});
test('a contract changed during Checkout is refunded instead of leaving paid inaccessible rights',async()=>{
 const h=harness();await h.api.accept(h.request({operation_id:'op_2',confirmed:true}));const cs=h.paid();
 h.sub.status='canceled';const result=await h.api.confirm(cs);
 assert.equal(result.status,'cancelled');assert.equal(result.stripe_refund_id,'re_profile');
 await h.api.confirm(cs);assert.equal(h.calls.refunds,1);assert.equal(h.calls.activations,0);
});
