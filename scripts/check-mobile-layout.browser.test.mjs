import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('iPhone viewport has one safe-area frame, no unnecessary page scroll and password setup survives auth events',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const url=server.resolvedUrls.local[0];
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
 await page.route(url,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("const DPA_NATIVE_IOS=window.location.protocol==='capacitor:';",'const DPA_NATIVE_IOS=true;').replace('componentDidMount(){','componentDidMount(){ window.__testApp=this;')});});
 await page.goto(url);await page.waitForFunction(()=>window.__testApp);
 await page.evaluate(()=>{document.documentElement.classList.add('dpa-native-ios');document.documentElement.style.setProperty('--dpa-safe-top','55px');document.documentElement.style.setProperty('--dpa-safe-bottom','42px');});
 const fits=async()=>{const size=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.height+1,JSON.stringify(size));assert.equal(size.scrollWidth,size.width)};
 await fits();
 await page.evaluate(()=>window.__testApp.setState({screen:'reset'}));await page.getByRole('heading',{name:'Créer mon mot de passe'}).waitFor();await fits();
 await page.getByLabel('Mot de passe',{exact:true}).fill('example-password');await page.getByLabel('Confirmer le mot de passe',{exact:true}).fill('example-password');
 await page.evaluate(async()=>{const app=window.__testApp;app.api={...await window.dpaReady,configured:true,recoveryPending:true,completePasswordSetup:async()=>{app.onAuthEvent('USER_UPDATED',{user:{id:'u'}});if(app.state.f.pwdNew!=='example-password')throw Error('auth event erased password');return {email:'example@example.com',error:null,session:null}},clearRecovery(){this.recoveryPending=false}};app._ready=Promise.resolve(app.api)});
 await page.getByRole('button',{name:'Enregistrer le mot de passe',exact:true}).click();await page.getByRole('heading',{name:'Votre fidélité, simplement.',exact:true}).waitFor();assert.equal(await page.getByLabel('Adresse e-mail',{exact:true}).inputValue(),'example@example.com');
 await page.evaluate(()=>{window.__testApp.enterDemo();document.body.style.minHeight='1800px';});await page.locator('.dpa-mobile-header').waitFor();await page.evaluate(()=>window.scrollTo(0,150));await page.waitForTimeout(50);assert.equal(await page.locator('.dpa-mobile-header').evaluate(el=>el.getBoundingClientRect().top),55);
 await page.route('**/src/admin-backend.js',route=>route.fulfill({contentType:'application/javascript',body:'/* Layout test: no production authentication. */'}));await page.goto(new URL('admin.html',url).href);await page.evaluate(()=>{document.documentElement.classList.add('dpa-native-ios');document.documentElement.style.setProperty('--dpa-safe-top','55px');document.documentElement.style.setProperty('--dpa-safe-bottom','42px');});await fits();
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close()}
});
