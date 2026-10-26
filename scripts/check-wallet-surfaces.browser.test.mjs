import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('dashboard enrollment, effective Wallet previews, onboarding fallback and public member progression',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
  const url=server.resolvedUrls.local[0],browser=await chromium.launch();
  const dir=new URL('../test-results/wallet-surfaces/',import.meta.url);mkdirSync(dir,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/ReferenceError|TypeError|SyntaxError/.test(m.text()))errors.push(m.text())});
    // Fail closed: no test is allowed to write to the real backend.
    await page.route('https://*.supabase.co/**',route=>route.abort());
    await page.route(url,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});});
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__testApp);
    await page.evaluate(async()=>{
      const a=window.__testApp;a.api={...await window.dpaReady,configured:true,
        access:async()=>({has_access:true}),enroll:async(request,first,email)=>{
          window.__enrolled={request,first,email};return {id:'new-client',first,last:'',card:'DPA 8765',qrValue:'DPA1:enrolled',balance:0,history:[],joined:'2026-10-26'};
        }};
      a.enterDemo();a.setState({live:true,demo:false,role:'owner',hasAccess:true,consent:false,f:{...a.state.f,joinFirst:'',joinEmail:''},
        merchant:{...a.state.merchant,id:'shop-a',business:'Boulangerie',slug:'boulangerie'},
        program:{...a.state.program,designMode:'custom',selfServiceStampId:'croissant',cardDesign:null,goal:10,name:'Club Boulangerie',bg:'#FFFFFF',pattern:'stripes',reward:'Café'},
        clients:[{id:'sample',first:'Nora',last:'Martin',balance:3,card:'DPA 1234',qrValue:'DPA1:real-sample',joined:'2026-10-25',history:[]}]});
    });
    const home=page.getByRole('region',{name:'Ma carte',exact:true});
    await home.locator('[data-preview-kind="self-service-stamps"]').waitFor();
    assert.equal(await home.locator('[data-native-stamp]').count(),10);
    assert.equal(await home.locator('[data-native-stamp="filled"]').count(),3);
    assert.match(await home.innerText(),/Nora Martin/);assert.doesNotMatch(await home.innerText(),/Club Boulangerie/);
    const enroll=page.getByRole('region',{name:'Ajouter un client depuis l’accueil'});
    await enroll.waitFor();await enroll.scrollIntoViewIfNeeded();
    await page.screenshot({path:fileURLToPath(new URL('dashboard-desktop.png',dir)),fullPage:true});
    await enroll.getByRole('button',{name:'Créer la carte du client'}).click();assert.equal(await page.evaluate(()=>window.__enrolled),undefined);
    await enroll.getByLabel('Prénom',{exact:true}).fill('Camille');await enroll.getByLabel(/E-mail/).fill('camille@example.com');
    await enroll.getByRole('checkbox').check();await enroll.getByRole('button',{name:'Créer la carte du client'}).click();
    await page.getByRole('heading',{name:'Votre carte est prête'}).waitFor();
    assert.equal((await page.evaluate(()=>window.__enrolled)).first,'Camille');
    assert.equal(await page.locator('[data-dpa-qr="DPA1:enrolled"]').count(),1);
    await page.setViewportSize({width:393,height:852});
    await page.screenshot({path:fileURLToPath(new URL('joined-mobile.png',dir)),fullPage:true});
    // Saved request retried after visits must display the server ledger balance.
    await page.evaluate(async()=>{const a=window.__testApp;a.api.publicJoin=async()=>({first:'Camille',cardNumber:'DPA 8765',qrValue:'DPA1:enrolled',balance:4,apple:{},wallet:{}});a.setState({pubSlug:'boulangerie'});await a.joinPublic(a.state.f)});
    assert.equal(await page.locator('[data-native-stamp="filled"]').count(),4);
    // The API remains the authority when staff permissions or access change.
    await page.setViewportSize({width:1440,height:1100});
    await page.evaluate(()=>window.__testApp.setState({screen:'home',pubSlug:null,role:'staff',permissions:{add_clients:false}}));
    assert.equal(await enroll.count(),0);
    await page.evaluate(async()=>{const a=window.__testApp;window.__enrolled=null;await a.joinLive({joinFirst:'Forbidden',joinEmail:''})});
    assert.equal(await page.evaluate(()=>window.__enrolled),null);
    await page.evaluate(()=>window.__testApp.setState({role:'owner',hasAccess:false}));assert.equal(await enroll.count(),0);
    // Step 1 starts before a program exists: no stamp is selected or displayed.
    await page.evaluate(()=>{const a=window.__testApp;a.setState({screen:'ob',program:null,clients:[],toast:null,ob:{...a.initState().ob,biz:'spaceessentials'},tab:'apple'})});
    const apple=page.getByLabel('Aperçu de la carte Apple Wallet',{exact:true});await apple.waitFor();
    assert.match(await apple.innerText(),/LOGO/);assert.doesNotMatch(await apple.innerText(),/BASH|Club|Nom du programme|\bCARTE\b/);
    assert.ok((await apple.boundingBox()).height<360,'Apple onboarding preview shrinks without program and card rows');
    assert.equal(await apple.locator('[data-native-stamp]').count(),0);
    await page.screenshot({path:fileURLToPath(new URL('onboarding-apple.png',dir)),fullPage:true});
    await page.getByRole('tab',{name:'Aperçu Google Wallet'}).click();
    const google=page.getByLabel('Aperçu de la carte Google Wallet',{exact:true});
    assert.match(await google.innerText(),/spaceessentials/);assert.doesNotMatch(await google.innerText(),/Nom du programme|N° de carte/);
    assert.match(await google.innerText(),/Membre/);assert.match(await google.innerText(),/Votre récompense/);
    assert.ok((await google.boundingBox()).height<400,'Google onboarding preview shrinks without extra rows');
    const brand=google.locator('[data-google-brand="centered"]'),logo=brand.locator('[data-logo-placeholder]');
    const logoBounds=await logo.boundingBox(),brandBounds=await brand.boundingBox();
    assert.ok(Math.abs(logoBounds.x+logoBounds.width/2-brandBounds.x-brandBounds.width/2)<2,'Google logo is centered');
    assert.ok((await brand.getByText('spaceessentials',{exact:true}).boundingBox()).y>=logoBounds.y+logoBounds.height,'Commerce is below the logo');
    assert.equal(await google.locator('[data-stamp-slot]').count(),0);
    await page.screenshot({path:fileURLToPath(new URL('onboarding-google.png',dir)),fullPage:true});
    await page.evaluate(()=>{const a=window.__testApp;a.setState({ob:{...a.state.ob,step:3,design:'custom',stampId:'',hex:'#D4AF37',prog:'Programme test'},program:{...a.initState().program,logoUrl:'/assets/dpa-cards-logo.png'}})});
    await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').waitFor({state:'attached'});
    assert.equal(await google.locator('img[src="/assets/dpa-cards-logo.png"]').count(),1);
    assert.equal(await google.locator('[data-stamp-slot]').count(),0);
    await page.getByRole('radio',{name:'Pizza',exact:true}).click();
    assert.equal(await google.locator('img[src="/assets/stamps/pizza.png"]').count(),9);
    assert.equal(await google.locator('img[src="/assets/stamps/cadeau.png"]').count(),1);
    await page.getByRole('tab',{name:'Aperçu Apple Wallet'}).click();
    assert.equal(await apple.locator('img[src="/assets/dpa-cards-logo.png"]').count(),1);
    assert.equal(await apple.locator('img[src="/assets/stamps/pizza.png"]').count(),9);
    assert.equal(await apple.locator('img[src="/assets/stamps/cadeau.png"]').count(),1);
    // An explicit no-stamp choice must remove both panels immediately, retain
    // the selected stamp for switching back, and stay compact on mobile.
    await page.getByRole('radio',{name:'Sans tampons',exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'Sans tampons',exact:true}).getAttribute('aria-checked'),'true');
    assert.equal(await page.getByRole('searchbox',{name:'Rechercher un tampon'}).count(),0);
    assert.equal(await apple.locator('[data-native-stamp]').count(),0);
    assert.doesNotMatch(await apple.innerText(),/Programme test|\bCARTE\b/);
    await page.screenshot({path:fileURLToPath(new URL('onboarding-without-stamps-apple.png',dir)),fullPage:true});
    await page.getByRole('tab',{name:'Aperçu Google Wallet'}).click();
    assert.equal(await google.locator('[data-stamp-slot]').count(),0);
    assert.match(await google.innerText(),/0 \/ 10/);
    await page.getByRole('radio',{name:'Avec tampons',exact:true}).click();
    assert.equal(await google.locator('[data-stamp-slot]').count(),10);
    await page.getByRole('radio',{name:'Sans tampons',exact:true}).click();
    await page.setViewportSize({width:393,height:852});
    assert.equal(await page.locator('[data-native-stamp],[data-stamp-slot]').count(),0);
    await page.screenshot({path:fileURLToPath(new URL('onboarding-without-stamps-mobile.png',dir)),fullPage:true});
    // The same effective program drives customer/public surfaces after saving.
    await page.setViewportSize({width:1440,height:1100});
    await page.evaluate(()=>{const a=window.__testApp;a.setState({screen:'home',hasAccess:true,role:'owner',program:{...a.state.program,designMode:'custom',selfServiceShowStamps:false,selfServiceStampId:null}})});
    await home.locator('[data-preview-kind="self-service-simple"]').waitFor();
    assert.equal(await home.locator('[data-native-stamp]').count(),0);
    assert.doesNotMatch(await home.innerText(),/Club Boulangerie|\bCARTE\b/);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});
