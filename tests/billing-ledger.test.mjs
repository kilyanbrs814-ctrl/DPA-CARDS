// Actual recordInvoice function, with isolated database and deterministic Stripe transport.
// Does not claim a real Stripe Checkout/network/webhook end-to-end test.
import {db} from './db-bootstrap.mjs';
import {transformWithEsbuild} from 'vite';
import fs from 'node:fs';import assert from 'node:assert/strict';import{randomUUID as uuid}from'node:crypto';
const source=fs.readFileSync('supabase/functions/billing/index.ts','utf8');
const fn=source.slice(source.indexOf('async function recordInvoice('),source.indexOf('// After a paid Checkout session:'));
const code=(await transformWithEsbuild(fn,'recordInvoice.ts')).code;
const owner=uuid();await db.query('insert into auth.users(id,email) values($1,$2)',[owner,'billing@example.invalid']);await db.exec('set role service_role');
const args=['mael.81400@icloud.com',uuid(),'billing-fixture',owner,'test-billing','Test','','','test-billing',{name:'Programme',mode:'passages',goal:10,reward:'Draft'},'',''];
const merchant=(await db.query('select sales_create_merchant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r',args)).rows[0].r.merchant;
const rpc=async(name,args)=>{try{const keys=Object.keys(args);const sql=`select ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`;return{data:(await db.query(sql,Object.values(args))).rows,error:null};}catch(error){return{data:null,error};}};
const admin={rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})};
let current,refunded=0;const stripe={invoices:{retrieve:async()=>current},charges:{list:async()=>({data:[{amount_refunded:refunded}]})}};
const record=new Function('admin','requireStripe','STRIPE_KEY','iso','UUID',code+';return recordInvoice;')(admin,()=>stripe,'sk_test_fixture',n=>n?new Date(n*1000).toISOString():null,/^[0-9a-f-]{36}$/);
const total=async()=>Number((await db.query("select coalesce(sum(amount_cents),0) n from commissions where status<>'cancelled'")).rows[0].n);
for(const [kind,metadata,subscription]of[['setup',{plan_type:'commitment'},null],['design',{type:'custom_design'},null],['prepaid',{billing_mode:'prepaid'},null],['other',{},null],['subscription',{},'sub_fixture']]){
 current={id:'in_'+uuid(),status:'paid',amount_paid:10000,amount_due:10000,currency:'eur',livemode:false,payment_intent:'pi_'+uuid(),subscription,metadata:{merchant_id:merchant.id,...metadata},status_transitions:{paid_at:1791800000}};
 const before=await total();await record({id:current.id},false);assert.equal(await total(),before+7000);await record({id:current.id,status:'failed'},true);assert.equal(await total(),before+7000);
 refunded=4000;await record({id:current.id},false);assert.equal(await total(),before+4200);refunded=0;console.log('PASS actual recordInvoice handler',kind,'TEST, replay, late event, refund sync');
}
current={...current,id:'in_live_wrong',livemode:true};await assert.rejects(()=>record(current,false),/stripe_mode_mismatch/);console.log('PASS invoice mode mismatch refused');await db.close();
