import {db} from './db-bootstrap.mjs';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import fs from 'node:fs';
const director='contact@digitalprojectagency.fr', mael='mael.81400@icloud.com',zak='zakariabouras2020@gmail.com';
const val=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const service=()=>db.exec('reset role; set role service_role;');
const program={name:'Programme test',mode:'passages',goal:10,reward:'À définir'};
async function user(){await db.exec('reset role');const id=uuid();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.invalid']);await service();return id;}
const createSQL='select public.sales_create_merchant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result';
async function create(actor,name){const id=await user(),key=uuid(),args=[actor,key,'fingerprint',id,name,'Test','','',name,program,'',''];const {result}=await val(createSQL,args);return {id:result.merchant.id,owner:id,key,args};}
async function pay(m,kind,cents,opts={}){const p={provider:'stripe',provider_payment_id:uuid(),provider_charge_ref:uuid(),merchant_id:m.id,kind,status:'paid',amount_cents:cents,paid_at:'2026-09-15T12:00:00Z',livemode:true,...opts};return {p,row:(await val('select to_jsonb(sales_record_payment($1)) as r',[p])).r};}
const comm=async(p)=>val("select * from commissions where payment_id=$1 and reverses_id is null and status<>'cancelled'",[p.row.id]);
const refund=(p,n)=>val('select sales_record_refund($1,$2,$3,$4)',['stripe',p.p.provider_charge_ref,n,p.p.livemode]);
let checks=0;async function test(name,fn){try{await fn();console.log('PASS',name);checks++;}catch(e){console.error('FAIL',name,e.message);await db.close();process.exit(1);}}
let m,z,k,initial,settled;
await test('Maël / Zak / direction alias attribution',async()=>{
 m=await create(mael,'test-mael');z=await create(zak,'test-zak');k=await create(director,'test-kilyan');
 for(const [x,name] of [[m,'Maël'],[z,'Zak'],[k,'Kilyan']])assert.equal((await val('select r.display_name from merchant_attributions a join sales_reps r on r.id=a.sales_rep_id where merchant_id=$1',[x.id])).display_name,name);
});
await test('Direct signup -> Kilyan, atomic with merchant',async()=>{
 const id=await user();await db.exec('reset role; set role authenticated;');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 const d=(await val("select create_merchant('test-direct','Test','','','test-direct',$1) as r",[program])).r.merchant;
 await service();assert.equal((await val('select r.display_name from merchant_attributions a join sales_reps r on r.id=a.sales_rep_id where merchant_id=$1',[d.id])).display_name,'Kilyan');
});
await test('Same creation request -> same merchant, no duplicate',async()=>{assert.equal((await val(createSQL,m.args)).result.merchant.id,m.id);});
await test('Attribution failure rolls back merchant; retry succeeds once',async()=>{
 await db.exec('reset role');await db.query("insert into admin_users(email) values('unknown@example.invalid')");const owner=await user(),args=['unknown@example.invalid',uuid(),'f',owner,'test-retry','Test','','','test-retry',program,'',''];
 await assert.rejects(()=>val(createSQL,args),/sales_rep_not_configured/);assert.equal((await val('select count(*)::integer n from merchants where created_by=$1',[owner])).n,0);args[0]=mael;await val(createSQL,args);await val(createSQL,args);assert.equal((await val('select count(*)::integer n from merchants where created_by=$1',[owner])).n,1);
});
await test('Owner card update then other admin update keeps attribution',async()=>{
 const before=await val('select * from merchant_attributions where merchant_id=$1',[m.id]);await db.exec('reset role; set role authenticated;');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[m.owner]);await db.query("update programs set reward='Dessert offert' where merchant_id=$1",[m.id]);await service();await db.query("update programs set name='Carte préparée par admin' where merchant_id=$1",[m.id]);assert.deepEqual(await val('select * from merchant_attributions where merchant_id=$1',[m.id]),before);
});
await test('100 EUR Maël -> 70; 20 EUR monthly Zak -> 14',async()=>{initial=await pay(m,'setup',10000);assert.equal((await comm(initial)).amount_cents,7000);assert.equal((await comm(await pay(z,'subscription',2000))).amount_cents,1400);});
await test('Design / prepaid / other / later setup -> 70%, only once',async()=>{for(const kind of ['design','prepaid','other','setup']){const p=await pay(m,kind,2990);assert.equal((await comm(p)).amount_cents,2093);await val('select sales_record_payment($1)',[p.p]);assert.equal((await val('select count(*)::integer n from commissions where payment_id=$1',[p.row.id])).n,1);}});
await test('Kilyan, zero invoice and failed payment -> no commission',async()=>{for(const p of [await pay(k,'setup',10000),await pay(m,'subscription',0),await pay(m,'subscription',2000,{status:'failed',paid_at:null})])assert.equal(await comm(p),undefined);});
await test('Late failed event does not regress a paid receipt',async()=>{await val('select sales_record_payment($1)',[{...initial.p,status:'failed',amount_cents:200}]);assert.equal((await comm(initial)).amount_cents,7000);});
await test('Refund before invoice survives out-of-order delivery',async()=>{const pi=uuid();await val('select sales_record_refund($1,$2,$3,$4)',['stripe',pi,3000,true]);assert.equal((await comm(await pay(z,'design',10000,{provider_charge_ref:pi}))).amount_cents,4900);});
await test('Repeated partial refund before payout -> exact 56 EUR',async()=>{await refund(initial,2000);await refund(initial,2000);assert.equal((await comm(initial)).amount_cents,5600);});
await test('Payout carries arrears; retries and duplicate bank references protected',async()=>{
 settled=await comm(initial);await val('select sales_validate($1,$2)',[director,[settled.id]]);const args=[director,settled.sales_rep_id,'2026-10-01',[settled.id],5600,'2026-10-12','TRANSFER-TEST-1','isolated fixture',uuid()];const sql='select to_jsonb(sales_payout($1,$2,$3,$4,$5,$6,$7,$8,$9)) as p';const p=(await val(sql,args)).p;assert.equal((await val(sql,args)).p.id,p.id);await assert.rejects(()=>val(sql,[...args.slice(0,8),uuid()]),/duplicate_reference/);
});
await test('Full refund after payout preserves transfer and creates one adjustment',async()=>{await refund(initial,10000);await refund(initial,10000);assert.equal((await comm(initial)).amount_cents,5600);assert.equal((await comm(initial)).status,'paid');const adj=await val("select count(*)::integer n,sum(amount_cents)::integer total from commissions where reverses_id=$1 and status='to_validate'",[settled.id]);assert.deepEqual(adj,{n:1,total:-5600});});
await test('Actual dispute/refund debits are capped at receipt; duplicate events are not deducted twice; won dispute restores amount',async()=>{
 const p=await pay(z,'prepaid',10000),dispute=(n,t)=>val('select sales_record_dispute($1,$2,$3,$4,$5)',['stripe',p.p.provider_charge_ref,n,true,t]);await dispute(6000,10);await refund(p,4000);assert.equal(await comm(p),undefined);await dispute(0,20);await dispute(6000,10);assert.equal((await comm(p)).amount_cents,4200);
});
await test('Attribution correction requires reason; historical payments stay with seller',async()=>{
 const old=await pay(m,'other',1000),rep=(await val('select sales_rep_id from merchant_attributions where merchant_id=$1',[z.id])).sales_rep_id;const sql='select sales_attribute($1,$2,$3,$4,$5)';await assert.rejects(()=>val(sql,[m.id,rep,director,'manual','']),/reason_required/);await val(sql,[m.id,rep,director,'manual','Proven correction']);assert.equal((await comm(old)).sales_rep_id,settled.sales_rep_id);assert.equal((await comm(await pay(m,'other',1000))).sales_rep_id,rep);
});
await test('TEST/LIVE separate even for identical provider ID',async()=>{
 const live=await pay(z,'setup',10000),t=await pay(z,'setup',10000,{...live.p,livemode:false});assert.notEqual(t.row.id,live.row.id);assert.equal((await comm(t)).amount_cents,7000);const d=(await val('select sales_dashboard_mode(null,null,false) d')).d;assert.equal(d.payments.length,1);assert.equal(d.commissions.length,1);assert.ok(!(await val('select sales_dashboard(null,null) d')).d.payments.some(p=>p.id===t.row.id));
});
await test('Global total is sum of 3 reps; arrears separate from period',async()=>{
 const month=(await val("select sales_dashboard('2026-10-01','2026-10-01') d")).d;assert.equal(month.reps.reduce((s,r)=>s+r.revenue_total_cents,0),0);assert.ok(month.reps.some(r=>r.balance_cents!==0));const d=(await val('select sales_dashboard(null,null) d')).d;assert.equal(d.reps.reduce((s,r)=>s+r.revenue_total_cents,0),Number((await val('select sum(amount_cents-least(amount_cents,refunded_cents+disputed_cents)) total from sales_payments where livemode and paid_at is not null')).total));fs.writeFileSync('/tmp/dpa-dashboard-fixture.json',JSON.stringify(d));
});
await test('Historical repair requires exact preview, is idempotent and preserves settled entries',async()=>{
 const p=await pay(z,'other',1500);await db.query('delete from commissions where payment_id=$1',[p.row.id]);
 const ids=[p.row.id],sql='select sales_reconcile_preview($1,$2) p';const preview=(await val(sql,[director,ids])).p;
 await assert.rejects(()=>val('select sales_reconcile_history($1,$2,$3,$4)',[director,ids,[],'invalid preview']),/preview_changed/);
 await val('select sales_reconcile_history($1,$2,$3,$4)',[director,ids,preview,'Verified isolated historical receipt']);assert.equal((await comm(p)).amount_cents,1050);
 const next=(await val(sql,[director,ids])).p;await val('select sales_reconcile_history($1,$2,$3,$4)',[director,ids,next,'Repeat reviewed repair']);assert.equal((await val('select count(*)::integer n from commissions where payment_id=$1',[p.row.id])).n,1);
 assert.equal((await comm(initial)).status,'paid');
});
await test('Unknown historical Stripe mode is quarantined and cannot be blindly reconciled',async()=>{
 const p=await pay(z,'other',200);await db.query('delete from commissions where payment_id=$1',[p.row.id]);await db.query('update sales_payments set livemode=null where id=$1',[p.row.id]);const preview=(await val('select sales_reconcile_preview($1,$2) p',[director,[p.row.id]])).p;await assert.rejects(()=>val('select sales_reconcile_history($1,$2,$3,$4)',[director,[p.row.id],preview,'No evidence']),/historical_evidence_required/);assert.equal((await val('select sales_dashboard(null,null) d')).d.anomalies.unknown_mode_payments,1);
});
await test('Financial tables use RLS and privileged new RPCs are not executable by clients',async()=>{
 for(const t of ['sales_creation_requests','sales_charge_adjustments','sales_payments','commissions'])assert.equal((await val('select relrowsecurity r from pg_class where oid=$1::regclass',[t])).r,true);
 assert.equal((await val("select has_function_privilege('authenticated','public.sales_create_merchant(text,uuid,text,uuid,text,text,text,text,text,jsonb,text,text)','execute') b")).b,false);
});
await test('Client cannot write labels, commissions, rules or invoke financial RPCs',async()=>{
 await db.exec('reset role; set role authenticated;');for(const sql of ["update merchant_attributions set source='manual'",'update commissions set amount_cents=1','update commission_rules set percent=1',"select sales_dashboard(null,null)","select sales_record_payment('{}')", "select sales_attribute(null,null,'contact@digitalprojectagency.fr','manual','fraud')"])await assert.rejects(()=>db.query(sql),/permission denied/);await service();
});
console.log(`${checks} acceptance groups passed (isolated PostgreSQL/PGlite).`);await db.close();
