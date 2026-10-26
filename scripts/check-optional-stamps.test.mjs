import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selfServiceChoice,selfServiceWithoutStamps,simpleGoogleTemplate,simpleGoogleFields} from '../supabase/functions/_shared/self-service-layout.js';
import {realApplePassData} from '../supabase/functions/apple-pass/real-card.js';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('new cards require stamps and accept only integer opacity percentages',()=>{
 assert.throws(()=>selfServiceChoice({show_stamps:false,stamp_id:'pizza'}),/stamps_required/);
 assert.deepEqual(selfServiceChoice({show_stamps:true,stamp_id:'pizza',inactive_opacity:67}),{showStamps:true,stampId:'pizza',inactiveOpacity:67});
 assert.equal(selfServiceChoice({}).inactiveOpacity,32,'old callers retain historical opacity');
 for(const value of [0,100])assert.equal(selfServiceChoice({stamp_id:'pizza',inactive_opacity:value}).inactiveOpacity,value);
 for(const value of [-1,101,3.5,'50',null])assert.throws(()=>selfServiceChoice({stamp_id:'pizza',inactive_opacity:value}),/invalid_stamp_opacity/);
 for(const p of [{show_stamps:'false'},{show_stamps:null},{show_stamps:true,stamp_id:'cadeau'},{stamp_id:'../logo'}])assert.throws(()=>selfServiceChoice(p),/invalid_stamp/);
});
const program={design_mode:'custom',design_status:'validated',self_service_show_stamps:false,self_service_stamp_id:'pizza',card_design:null,name:'Club interne',mode:'passages',goal:10,reward:'café offert',bg:'#FFFFFF'};
const input={program,merchant:{business_name:'Mon commerce'},customer:{first_name:'Nora',last_name:'Martin'},card:{id:'card',card_number:'DPA 1234',qr_token:'real-qr'},balance:4};
test('native Apple no-stamp card has real counter, member/reward, QR, and no program/card/strip front',()=>{
 const {brand,json}=realApplePassData(input);assert.equal(brand.selfServiceStamps,false);assert.equal(brand.showStamps,false);
 assert.equal(brand.selfServiceNoStamps,true);assert.equal(json.storeCard,undefined);
 assert.deepEqual(json.generic.primaryFields,[]);assert.equal(json.generic.headerFields[0].value,'4 / 10');
 assert.deepEqual(json.generic.secondaryFields.map(x=>[x.label,x.value]),[['MEMBRE','Nora Martin'],['RÉCOMPENSE','café offert']]);
 assert.equal(json.generic.auxiliaryFields,undefined);assert.equal(json.barcode.message,'DPA1:real-qr');
 assert.ok(json.generic.backFields.some(x=>x.key==='card'),'internal card reference remains in details');
 const advanced={...program,card_design:{identity:{name:'Sur mesure'},stamps:{icon:'library',libraryId:'pizza'},apple:{showStamps:true}}};
 const before=JSON.stringify(advanced);assert.equal(realApplePassData({...input,program:advanced}).brand.selfServiceNoStamps,false);assert.equal(JSON.stringify(advanced),before);
 const legacy={...program,self_service_show_stamps:null,self_service_stamp_id:null};
 assert.equal(realApplePassData({...input,program:legacy}).json.generic.primaryFields[0].value,'Club interne');
});
test('native Google template displays member/reward/progress and its update preserves the real balance',()=>{
 assert.equal(selfServiceWithoutStamps(program),true);
 assert.equal(selfServiceWithoutStamps({...program,self_service_show_stamps:null}),false);
 assert.equal(selfServiceWithoutStamps({...program,card_design:{}}),false);
 const template=JSON.stringify(simpleGoogleTemplate());assert.match(template,/object.accountName/);assert.match(template,/reward/);assert.doesNotMatch(template,/accountId|hero|stamp/);
 const a=simpleGoogleFields(program,4),b=simpleGoogleFields(program,5);
 assert.equal(a.textModulesData.find(x=>x.id==='progress').body,'4 / 10');assert.equal(b.textModulesData.find(x=>x.id==='progress').body,'5 / 10');
 assert.equal(a.textModulesData.find(x=>x.id==='reward').body,'café offert');assert.equal(a.heroImage,undefined);
});
test('migration preserves existing rows and only the backend can save the new choice',async()=>{
 const db=new PGlite();try{
 await db.exec("create role authenticated;create table programs(id int, design_status text);insert into programs values(1,'validated');grant select on programs to authenticated;grant update(design_status) on programs to authenticated;");
 await db.exec(readFileSync(new URL('../supabase/migrations/20261026221700_optional_self_service_stamps.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select self_service_show_stamps from programs')).rows[0].self_service_show_stamps,null);
 await db.exec('set role authenticated;');await assert.rejects(db.exec('update programs set self_service_show_stamps=false where id=1'),/permission denied/);
 await db.exec('reset role;update programs set self_service_show_stamps=false where id=1;');assert.equal((await db.query('select self_service_show_stamps from programs')).rows[0].self_service_show_stamps,false);
 }finally{await db.close();}
});
