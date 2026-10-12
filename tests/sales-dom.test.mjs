// Component interactions in JSDOM. These tests do not claim pixel/layout/browser verification.
import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[k]=dom.window[k];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{createRoot}=await import('react-dom/client');
const{makeSales}=await import('../src/sales.js'),{makeCardDesigner}=await import('../src/card-designer.js');
const h=React.createElement,fixture=JSON.parse(fs.readFileSync('/tmp/dpa-dashboard-fixture.json'));
const click=async label=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.textContent.trim().endsWith(label));assert.ok(el,label);await React.act(async()=>el.click());};
for(const width of [1440,375]){
 let calls=[],created=[];const api={sales:async b=>{calls.push(b);return fixture},testList:async()=>({tests:[]}),createMerchant:async b=>{created.push(b);throw Error('captured')}};
 const{SalesDashboard}=makeSales(React,api),{CardDesigner}=makeCardDesigner(React,api);
 let root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(h(SalesDashboard,{width,toast:()=>{},onOpenMerchant:()=>{}})));
 for(const label of ['Mes ventes','Zak','Maël','Global'])await click(label);
 await click('Commerçants');await click(width>=1000?'Modifier':'Modifier le commercial');
 const repSelect=document.querySelector('[role="dialog"] select[aria-label="Commercial"]');assert.ok(repSelect);for(const name of ['Kilyan','Maël','Zak'])assert.ok([...repSelect.options].some(o=>o.textContent===name));await click('Annuler');
 await click('Paiements');assert.ok(document.body.textContent.includes('Retenu (litige)'));assert.ok(document.body.textContent.includes('Net encaissé'));
 for(const label of ['Relevé et versements','Commerçants','Paiements','Vue d’ensemble'])await click(label);
 const select=document.querySelector('select[aria-label="Environnement"]');await React.act(async()=>{select.value='test';select.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(calls.at(-1).mode,'test');assert.ok(document.body.textContent.includes('Solde cumulé (reports compris)'));assert.ok(document.body.textContent.includes('CA total'));
 await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(h(CardDesigner,{width,merchants:[],target:null,onTarget:()=>{},toast:()=>{}})));
 await click('Ajouter un client');assert.equal(document.querySelector('#nc-reward'),null);
 for(const[id,value]of[['nc-first','Test'],['nc-email','test@example.invalid'],['nc-business','Test UI']])await React.act(async()=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
 const form=document.querySelector('form');await React.act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(created.length,1);assert.equal(created[0].defer_card,true);assert.match(created[0].request_id,/^[0-9a-f-]{36}$/);await React.act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(created[0].request_id,created[1].request_id);
 await React.act(async()=>document.querySelector('input[type="checkbox"]').click());assert.ok(document.querySelector('#nc-reward'));await React.act(async()=>root.unmount());console.log('PASS component interactions at width prop',width,'(JSDOM, no visual layout claim)');
}
dom.window.close();
