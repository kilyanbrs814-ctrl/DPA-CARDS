import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test('web profiles: header, selector, always-visible addition, new onboarding and explicit payment consent on mobile',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const url=server.resolvedUrls.local[0];
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(url,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});});
  await page.goto(url);await page.waitForFunction(()=>window.__testApp);await page.evaluate(async()=>{
   const a=window.__testApp;a.api={...await window.dpaReady,configured:true,access:async()=>({has_access:true}),uuid:()=>crypto.randomUUID(),
    switchProfile:id=>window.__switched=id,billing:{profileQuote:async()=>({operation:{id:'op2',quote:{current_count:1,new_count:2,activation_cents:3000,current_monthly_cents:2490,new_monthly_cents:4000,monthly_difference_cents:1510,
     effective_at:'2026-10-18T12:00:00Z',proration_cents:850,proration_collection:'next_invoice',immediate_cents:3000}}}),profileAccept:async()=>{window.__accepted=(window.__accepted||0)+1;return {operation:{status:'complete'}}}}};
   a.enterDemo();a.setState({live:true,demo:false,role:'owner',hasAccess:true,billingMerchantId:'a',billedCount:1,
    merchant:{...a.state.merchant,id:'a',business:'Commerce A'},profiles:[{id:'a',name:'Commerce A',role:'owner'},{id:'b',name:'Commerce B',role:'owner'}]});
  });
  await page.getByRole('button',{name:'Changer de profil',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Vos commerces'}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Commerce A Actif'}).getAttribute('aria-current'),'true');
  await dialog.getByRole('button',{name:'Commerce B',exact:true}).click();assert.equal(await page.evaluate(()=>window.__switched),'b');
  await dialog.getByRole('button',{name:'Ajouter un profil',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__testApp.state.screen),'ob');
  assert.equal(await page.evaluate(()=>window.__testApp.state.clients.length),0);
  assert.equal(await page.evaluate(()=>window.__testApp.state.merchant.id),null);
  await page.evaluate(()=>{const a=window.__testApp;a.setState({screen:'home',merchant:{...a.state.merchant,id:'b',business:'Commerce B'},program:{...a.state.program,designStatus:'validated'},hasAccess:false,addingProfile:null});});
  await page.getByRole('button',{name:'Activer ce commerce',exact:true}).click();await dialog.getByRole('heading',{name:'Confirmer les montants'}).waitFor();
  await dialog.getByText('24,90 €',{exact:true}).waitFor();
  const pay=dialog.getByRole('button',{name:'Confirmer et continuer vers le paiement',exact:true});assert.equal(await pay.isDisabled(),true);
  await dialog.getByRole('checkbox').check();assert.equal(await pay.isEnabled(),true);
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=394);
  mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../test-results/profiles-mobile.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await page.setViewportSize({width:1440,height:960});await page.screenshot({path:new URL('../test-results/profiles-desktop.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
