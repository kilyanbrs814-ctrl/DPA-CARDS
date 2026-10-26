import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {registrationPage,registrationPayload} from '../src/registration-page.js';
import {saveQrToPhotos} from '../src/qr-photo.js';
import {workspaceIdentity} from '../src/workspace-identity.js';
test('dark registration header remains readable and unsafe colours are ignored',()=>{
 assert.equal(registrationPage({bg:'#24415B',name:'Club',registrationPage:{fg:'#000000'}}).fg,'#FFFFFF');
 const p=registrationPage({registrationPage:{title:'  Mon club ',bg:'url(javascript:1)',description:'x'.repeat(500)}});assert.equal(p.title,'Mon club');assert.equal(p.bg,'#FFFFFF');assert.equal(p.description.length,400);
 assert.deepEqual(Object.keys(registrationPayload({title:'Club',extra:'ignored'})),['title','description','bg','fg','button']);
});
test('photo export sends a real PNG directly to Media and only reports success after native save',async()=>{
 let saved=false;await saveQrToPhotos('data:image/png;base64,aGVsbG8=',async()=>({Media:{savePhoto:async options=>{assert.deepEqual(options,{path:'data:image/png;base64,aGVsbG8='});saved=true}}}));assert.ok(saved);
 await assert.rejects(saveQrToPhotos('https://untrusted.example/image.png',async()=>{throw Error('must not load')}),/invalid_qr_image/);
 await assert.rejects(saveQrToPhotos('data:image/png;base64,aGVsbG8=',async()=>({Media:{savePhoto:async()=>{throw Object.assign(Error('denied'),{code:'accessDenied'})}}})),/denied/);
});
test('workspace membership and merchant reads are separately scoped to the authenticated user',async()=>{
 const members=[{merchant_id:'m',role:'owner'},{merchant_id:'n',role:'owner'}];
 const calls=[];const client={from(table){calls.push(table);return {select(columns){calls.push(columns);return this},eq(key,value){calls.push([key,value]);return this},async order(){return {data:members}},async single(){return {data:{id:'n',business_name:'Shop'}}}}}};
 const storage={getItem:()=> 'n',setItem(){}};
 assert.deepEqual(await workspaceIdentity(client,{id:'u'},storage),{role:'owner',permissions:undefined,merchants:{id:'n',business_name:'Shop'},memberships:members});assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='user_id'&&x[1]==='u'));assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='id'&&x[1]==='n'));assert.ok(!calls.includes('role, merchants(*)'));
});
test('legacy Vercel authentication landing keeps path, query and fragment on the canonical site',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const code=html.match(/<script>(if\(location.protocol==='https:'[^<]+)<\/script>/)[1];let destination;
 vm.runInNewContext(code,{location:{protocol:'https:',hostname:'dpa-cards-old.vercel.app',pathname:'/',search:'?setup=1',hash:'#type=recovery',replace:url=>destination=url}});assert.equal(destination,'https://cards.digitalprojectagency.fr/?setup=1#type=recovery');
});
