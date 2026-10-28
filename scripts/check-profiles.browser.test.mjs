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
   a.enterDemo();a.setState({live:true,demo:false,role:'owner',hasAccess:true,billingMerchantId:'a',billedCount:1,primaryActivated:true,
    merchant:{...a.state.merchant,id:'a',business:'Commerce A'},profiles:[{id:'a',name:'Commerce A',role:'owner'},{id:'b',name:'Commerce B',role:'owner'}]});
  });
  await page.getByRole('button',{name:'Changer de commerce',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Vos commerces'}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Commerce A Sélectionné'}).getAttribute('aria-current'),'true');
  assert.equal(await page.getByText('Commerce sélectionné',{exact:true}).count(),1);
  assert.equal(await page.getByText('Accès DPA Cards : actif',{exact:true}).count(),1);
  await dialog.getByRole('button',{name:'Commerce B',exact:true}).click();assert.equal(await page.evaluate(()=>window.__switched),'b');
  await dialog.getByRole('button',{name:'Ajouter un commerce',exact:true}).click();
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



test('web profiles: a secondary merchant cannot start a quote before the primary is billed',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const url=server.resolvedUrls.local[0];
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(url,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});});
  await page.goto(url);await page.waitForFunction(()=>window.__testApp);
  await page.evaluate(async()=>{
   const a=window.__testApp;
   a.api={...await window.dpaReady,configured:true,switchProfile:id=>window.__switched=id,
    billing:{profileQuote:async()=>{window.__quoteCalled=true;throw Error('Quote must be blocked');}}};
   a.enterDemo();
   a.setState({live:true,demo:false,role:'owner',screen:'billing',hasAccess:false,
    accessSource:'none',primaryActivated:false,selectedActivated:false,billedCount:0,
    billingMerchantId:'a',merchant:{...a.state.merchant,id:'b',business:'Commerce B'},
    program:{...a.state.program,designStatus:'validated'},
    profiles:[{id:'a',name:'Commerce A',role:'owner'},{id:'b',name:'Commerce B',role:'owner'}]});
  });
  await page.getByRole('heading',{name:'Activation du commerce en attente'}).waitFor();
  await page.getByText('Le commerce principal n’est pas activé dans la facturation.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Activer ce commerce',exact:true}).count(),0);
  assert.equal(await page.getByText('Accès DPA Cards : non activé',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Changer de commerce',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Commerce B Sélectionné'}).getAttribute('aria-current'),'true');
  await page.getByRole('dialog').getByRole('button',{name:'Fermer',exact:true}).click();
  await page.getByRole('button',{name:'Revenir au commerce principal'}).click();
  assert.equal(await page.evaluate(()=>window.__switched),'a');
  assert.equal(await page.evaluate(()=>!!window.__quoteCalled),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});


test('native iPhone stays single-commerce: no signup, profile selector or Stripe CTAs',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const url=server.resolvedUrls.local[0];
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(url,async route=>{
   const response=await route.fetch();let body=await response.text();
   assert.ok(body.includes("const DPA_NATIVE_IOS=window.location.protocol==='capacitor:';"));
   body=body.replace("const DPA_NATIVE_IOS=window.location.protocol==='capacitor:';","const DPA_NATIVE_IOS=true;");
   body=body.replace('componentDidMount(){','componentDidMount(){window.__testApp=this;');
   await route.fulfill({response,body});
  });
  await page.goto(url);await page.waitForFunction(()=>window.__testApp);
  await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Créer mon compte',exact:true}).count(),0);
  await page.evaluate(async()=>{
   const a=window.__testApp;a.api={...await window.dpaReady,configured:true,access:async()=>({has_access:true}),
    switchProfile:id=>{window.__nativeSelected=id;},
    billing:{profileQuote:async()=>{window.__stripeQuoteCalled=true;throw Error('unexpected Stripe quote');},
     profileAccept:async()=>{window.__stripePaymentCalled=true;throw Error('unexpected Stripe purchase');},
     designCheckout:async()=>{window.__designChargeCalled=true;throw Error('unexpected design checkout');}}};
   a.enterDemo();a.setState({live:true,demo:false,role:'owner',hasAccess:true,billingMerchantId:'primary',
    merchant:{...a.state.merchant,id:'primary',business:'Premier commerce'},
    profiles:[{id:'primary',name:'Premier commerce',role:'owner'},{id:'second',name:'Deuxième commerce',role:'owner'}]});
  });
  // Multi-commerce controls are deliberately web-only, even with two memberships.
  assert.equal(await page.getByRole('button',{name:'Changer de commerce',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Ajouter un commerce',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Activer ce commerce',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.__nativeSelected),undefined);
  await page.evaluate(()=>{
   const a=window.__testApp; a.beginAddProfile();a.go('billing');a.choosePlan('no_commitment');
  });
  assert.equal(await page.evaluate(()=>window.__testApp.state.screen),'home');
  assert.equal(await page.getByRole('button',{name:'Mon abonnement',exact:true}).count(),0);
  await page.evaluate(()=>window.__testApp.go('signup'));
  assert.equal(await page.evaluate(()=>window.__testApp.state.screen),'home');
  await page.evaluate(()=>{
   const a=window.__testApp;a.setState({hasAccess:false,screen:'home'});
   a.go('billing');
  });
  await page.getByRole('heading',{name:'Espace non actif'}).waitFor();
  await page.getByRole('button',{name:'Vérifier mon accès'}).waitFor();
  assert.equal(await page.getByText('Choisir cette offre').count(),0);
  assert.equal(await page.getByRole('button',{name:'Activer ce commerce',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>!!window.__stripeQuoteCalled||!!window.__stripePaymentCalled||!!window.__designChargeCalled),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
