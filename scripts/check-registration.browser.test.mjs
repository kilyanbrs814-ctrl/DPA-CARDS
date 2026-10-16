import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('mobile registration edit persists, public header reflects it, photo export is awaited and system area stays opaque',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const url=server.resolvedUrls.local[0];const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(url,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("const DPA_NATIVE_IOS=window.location.protocol==='capacitor:';",'const DPA_NATIVE_IOS=true;').replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')})});
 await page.goto(url);await page.waitForFunction(()=>window.__testApp);await page.evaluate(async()=>{const a=window.__testApp;a.utils=await window.dpaReady;a.enterDemo();document.documentElement.classList.add('dpa-native-ios');document.documentElement.style.setProperty('--dpa-safe-top','55px')});
 await page.getByRole('button',{name:'Modifier ma page d’inscription',exact:true}).click();await page.getByLabel('Titre de la page',{exact:true}).fill('Bienvenue chez nous');await page.getByLabel('Texte de présentation',{exact:true}).fill('Votre fidélité est récompensée.');await page.getByRole('button',{name:'Enregistrer ma page',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__testApp.state.program.registrationPage.title),'Bienvenue chez nous');await page.getByRole('button',{name:'Voir la page d’inscription',exact:true}).click();await page.getByRole('heading',{name:'Bienvenue chez nous',exact:true}).waitFor();
 await page.evaluate(async()=>{const a=window.__testApp;let p=a.state.program;window.__savedPhotos=0;a.api={...await window.dpaReady,configured:true,qrPng:async()=> 'data:image/png;base64,aGVsbG8=',saveQrToPhotos:async()=>{window.__savedPhotos++},access:async()=>({has_access:true})};a.setState({live:true,demo:false,hasAccess:true,screen:'invite'})});
 await page.getByRole('button',{name:'Enregistrer dans Photos',exact:true}).click();await page.getByText('QR code enregistré dans Photos.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__savedPhotos),1);
 await page.evaluate(()=>{const a=window.__testApp;a.go('home');document.body.style.minHeight='1800px'});await page.locator('.dpa-mobile-header').waitFor();await page.evaluate(()=>window.scrollTo(0,200));await page.waitForTimeout(50);
 const cover=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement,'::before');return {position:s.position,height:s.height,bg:s.backgroundColor,z:s.zIndex}});assert.deepEqual(cover,{position:'fixed',height:'55px',bg:'rgb(246, 245, 241)',z:'35'});
 await page.screenshot({path:'/tmp/dpa-next-home.png'});
 // A load failure keeps the valid session and offers retry, without blaming the password.
 await page.evaluate(async()=>{const a=window.__testApp;a.api.loadAll=async()=>{throw Error('workspace_members_unavailable')};await a.openLive({user:{id:'u'}})});await page.getByRole('heading',{name:'Connexion réussie',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Réessayer d’ouvrir mon espace',exact:true}).isVisible());assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close()}
});
