import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const wallet=read('supabase/functions/wallet/index.ts');
const billing=read('supabase/functions/billing/index.ts');
const profiles=read('supabase/functions/billing/profiles.ts');
const designer=read('src/card-designer.js');
const ui=read('src/admin-backend.js');
const sql=read('supabase/migrations/20261018234500_onsite_initial_activation.sql');

test('demo card attribution is admin scoped and never transfers demo QR or stamps',()=>{
 assert.match(wallet,/async function adminTestCardAssign\(req: Request\)/);
 assert.match(wallet,/const user = await requireAdmin\(req\)/);
 assert.match(wallet,/await assertAdminMerchant\(user, merchantId\)/);
 assert.match(wallet,/const t = await testRow\(body\?\.id, user\)/);
 assert.match(wallet,/await admin\.storage\.from\('program-assets'\)\.copy\(original, dest\)/);
 assert.match(wallet,/progress: 0, available: 0/);
 assert.match(wallet,/const \{ preview: _preview, \.\.\.cardDesign \} = config/);
 assert.match(wallet,/source_test_id: t\.id.*demo_preserved: true/s);
 assert.doesNotMatch(wallet.slice(wallet.indexOf('async function adminTestCardAssign('),wallet.indexOf('async function adminTestCardDelete(')),/qr_token:\s*t\.qr_token/);
 assert.match(ui,/testAssign: \(testId, merchantId\)/);
 assert.match(designer,/data-assign-test-card/);
 assert.match(designer,/Créer un nouveau compte commerçant/);
 assert.match(designer,/Attribuer au commerce sélectionné/);
});

test('onsite receipt is first-activation only, one use per receipt and director restricted',()=>{
 assert.match(wallet,/async function adminOnsiteActivation\(req: Request\)/);
 assert.match(wallet,/const user = await requireDirector\(req\)/);
 assert.match(wallet,/admin\.rpc\('record_onsite_initial_activation'/);
 assert.match(sql,/unique \(provider,receipt_ref\)/);
 assert.match(sql,/merchant_id uuid not null unique/);
 assert.match(sql,/v_count<>0/);
 assert.match(sql,/checkout_in_progress/);
 assert.match(sql,/insert into public\.merchant_activations/);
 assert.match(sql,/source in \('legacy','stripe','onsite'\)/);
 assert.match(sql,/grant execute on function public\.record_onsite_initial_activation\(uuid,text,uuid\) to service_role/);
 assert.match(designer,/data-onsite-activation/);
 assert.match(designer,/Je certifie avoir encaissé 50 €/);
});

test('Stripe collects activation only once and accepts card and SEPA in both modes',async()=>{
 const checkoutSource=stripTypeScriptTypes(billing.slice(
  billing.indexOf('async function checkout(req:'),billing.indexOf('async function verify(req:')
 ));
 for(const activated of [false,true]){
  const setupCents=activated?0:5000;
  const query={
   select(){return this;},eq(){return this;},is(){return this;},update(){return this;},upsert(){return {};},
   maybeSingle(){return {data:{id:'program'}};},single(){return {data:{business_name:'Commerce'}};},
  };
  let claimed,session;
  const checkout=runInNewContext(checkoutSource+'\ncheckout',{
   PLANS:{no_commitment:{setup:'setup',monthly:'monthly',commitmentMonths:0}},
   PRICES:{setup:{cents:5000}},ACCESS:[],
   billingQuantity:async()=>({quantity:1,activated}),rowOf:async()=>null,
   priceIds:async()=>({setup:'price_setup',monthly:'price_monthly'}),
   expireOpenMonthly:async()=>{},settleOpenPrepaid:async()=>{},
   siteOrigin:()=> 'https://example.test',json:(_req,status,body)=>({status,body}),
   admin:{from:()=>query,rpc:async(name,args)=>{
    if(name==='claim_initial_checkout')claimed=args;
    return {data:{id:'claim',created_at:new Date().toISOString()}};
   }},
   requireStripe:()=>({
    customers:{create:async()=>({id:'cus_test'})},
    prices:{retrieve:async()=>({unit_amount:2000,product:'prod_test'})},
    checkout:{sessions:{create:async params=>{
     session=params;
     return {id:'cs_test',url:'https://stripe.example.test/checkout'};
    }}},
   }),
  });
  const request={json:async()=>({plan:'no_commitment',confirmed:true,quote:{quantity:1,setup:setupCents}})};
  const result=await checkout(request,{user:{id:'user'},merchantId:'merchant'});
  assert.equal(result.status,200);
  assert.equal(claimed.p_setup,setupCents);
  assert.deepEqual([...session.payment_method_types],['card','sepa_debit']);
  assert.equal(session.mode,activated?'setup':'payment');
  assert.equal(session.line_items?.[0].price_data.unit_amount,activated?undefined:setupCents);
  assert.equal(Boolean(session.setup_intent_data),activated);
  assert.equal(session.payment_intent_data?.setup_future_usage,activated?undefined:'off_session');
 }
 assert.match(billing,/session\.payment_status !== 'paid' && !\(session\.mode==='setup'&&session\.status==='complete'\)/);
 assert.match(profiles,/payment_method_types:\['card','sepa_debit'\]/);
 assert.match(designer,/Les coordonnées bancaires ne sont pas saisies dans cette administration/);
});

test('admin can start hosted Stripe collection immediately without a merchant login',()=>{
 assert.match(billing,/async function adminCheckoutActor\(req: Request\)/);
 assert.match(billing,/if\(director\?\.role!=='director'\)/);
 assert.match(billing,/if\(!m\|\|!prepared\)/);
 assert.match(billing,/account\.primary_merchant_id!==merchantId\|\|account\.owner_id!==m\.created_by/);
 assert.match(billing,/path\.endsWith\('\/admin-initial-quote'\)/);
 assert.match(billing,/path\.endsWith\('\/admin-checkout'\)/);
 assert.match(billing,/actor\?\.adminCheckout \? \x60\$\{origin\}\/activation-result\.html\?status=success\x60/);
 assert.match(ui,/paymentQuote: \(merchantId, plan, billing\)/);
 assert.match(ui,/paymentCheckout: \(merchantId, plan, billing, quote\)/);
 assert.match(designer,/data-admin-stripe-checkout/);
 assert.match(designer,/Ouvrir Stripe avec le commerçant/);
 assert.match(designer,/Copier le lien à envoyer au commerçant/);
});
