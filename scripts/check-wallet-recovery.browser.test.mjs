import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('customer profiles recover their own card on desktop/mobile, copy links, handle races and retry errors',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
  const origin=server.resolvedUrls.local[0],browser=await chromium.launch();
  const out=new URL('../test-results/wallet-recovery/',import.meta.url);mkdirSync(out,{recursive:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/ReferenceError|TypeError/.test(m.text()))errors.push(m.text())});
    await page.route('https://*.supabase.co/**',route=>route.abort());
    await page.route(origin,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});});
    await page.goto(origin);await page.waitForFunction(()=>window.__testApp);
    await page.evaluate(async()=>{
      const a=window.__testApp;window.__walletCalls=[];window.__googleFail=false;window.__delayApple=true;
      const google=async id=>{window.__walletCalls.push(['google',id]);if(window.__googleFail){window.__googleFail=false;throw Error('wallet_unavailable')}return {url:'https://pay.google.com/gp/v/save/'+id}};
      a.api={...await window.dpaReady,configured:true,access:async()=>({has_access:true}),
        appleWalletLink:async id=>{window.__walletCalls.push(['apple',id]);if(window.__delayApple)await new Promise(resolve=>window.__finishApple=resolve);return {url:'https://wallet.example/apple-pass?token='+id}},
        walletLink:google,enroll:()=>{throw Error('Recovery must not enroll')}};
      a.enterDemo();a.setState({live:true,demo:false,hasAccess:true,role:'owner',screen:'clients',
        merchant:{...a.state.merchant,id:'merchant-a'},
        clients:[{id:'card-a',first:'Nora',last:'Martin',card:'DPA 1234',balance:3,joined:'2026-10-25',history:[],qrValue:'DPA1:nora'},
          {id:'card-b',first:'Camille',last:'Durand',card:'DPA 5678',balance:7,joined:'2026-10-25',history:[],qrValue:'DPA1:camille'}]});
    });
    await page.getByRole('button',{name:/Nora Martin/}).click();
    const panel=page.getByRole('region',{name:'Récupérer la carte du client'});await panel.waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__walletCalls),[],'No link is rotated merely by opening a profile');
    await panel.getByRole('button',{name:'iPhone · Apple Wallet'}).click();
    await panel.getByRole('button',{name:'Android · Google Wallet'}).click();
    const google=panel.getByLabel('Lien de récupération Google Wallet');await google.waitFor();
    assert.equal(await google.inputValue(),'https://pay.google.com/gp/v/save/card-a');
    await panel.getByRole('button',{name:'Copier le lien'}).click();
    await panel.getByText('Lien copié.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://pay.google.com/gp/v/save/card-a');
    await panel.getByRole('button',{name:'iPhone · Apple Wallet'}).click();
    assert.equal((await page.evaluate(()=>window.__walletCalls)).filter(c=>c[0]==='apple').length,1,'Platform switching reuses the in-flight Apple request');
    await page.evaluate(()=>{window.__delayApple=false;window.__finishApple()});
    const apple=panel.getByLabel('Lien de récupération Apple Wallet');await apple.waitFor();
    assert.equal(await apple.inputValue(),'https://wallet.example/apple-pass?token=card-a');
    assert.equal(await panel.getByRole('img',{name:'QR code pour remettre la carte dans Apple Wallet'}).count(),1);
    assert.equal(await page.evaluate(()=>window.__testApp.state.clients[0].balance),3);
    await panel.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('profile-desktop.png',out))});
    // An error on the next customer's link is retryable, and never displays the prior customer's URL.
    await page.evaluate(()=>{window.__googleFail=true;window.__testApp.go('clients')});
    await page.getByRole('button',{name:/Camille Durand/}).click();await panel.waitFor();
    assert.equal(await panel.locator('input').count(),0);
    await panel.getByRole('button',{name:'Android · Google Wallet'}).click();await panel.getByRole('alert').waitFor();
    assert.equal(await panel.locator('input').count(),0);
    await panel.getByRole('button',{name:'Réessayer'}).click();await google.waitFor();
    assert.equal(await google.inputValue(),'https://pay.google.com/gp/v/save/card-b');
    await page.setViewportSize({width:393,height:852});await panel.waitFor();
    await panel.getByRole('button',{name:'Android · Google Wallet'}).click();await google.waitFor();
    assert.equal(await google.inputValue(),'https://pay.google.com/gp/v/save/card-b');
    await panel.scrollIntoViewIfNeeded();
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=394);
    await page.screenshot({path:fileURLToPath(new URL('profile-mobile.png',out))});
    await panel.getByRole('button',{name:'Copier le lien'}).click();
    await panel.getByText('Lien copié.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://pay.google.com/gp/v/save/card-b');
    assert.equal(await page.evaluate(()=>window.__testApp.state.clients[1].balance),7);
    await page.evaluate(()=>window.__testApp.setState({hasAccess:false}));assert.equal(await panel.count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});
