import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('installation, landing demo and start guide through the merchant home',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const origin=server.resolvedUrls.local[0];
  const browser=await chromium.launch({headless:true});
  try {
    for (const device of [
      {platform:'Win32',ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',href:'/downloads/DPA-Cards-Windows.exe'},
      {platform:'iPhone',ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',href:'https://apps.apple.com/fr/app/dpa-cards/id6823642562'},
    ]) {
      const context=await browser.newContext({userAgent:device.ua});
      await context.addInitScript(platform=>Object.defineProperty(navigator,'platform',{get:()=>platform}),device.platform);
      const page=await context.newPage();
      await page.goto(origin);
      const install=page.locator('dpa-install-app:visible a');
      await install.waitFor();
      assert.equal(await install.getAttribute('href'),device.href);
      await page.locator('[data-dpa-demo-qr] svg').waitFor();
      assert.equal(await page.locator('#demo a[href*="public-demo"]').count(),2);
      await page.getByRole('button',{name:'Ajouter un passage test'}).click();
      assert.match(await page.locator('[data-dpa-visit-status]').innerText(),/7 passages/);
      await context.close();
    }
    const page=await browser.newPage({viewport:{width:393,height:852}});
    const url=new URL('/connexion',origin).href;
    await page.route(url,async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});
    });
    await page.goto(url);
    await page.waitForFunction(()=>window.__testApp);
    await page.evaluate(()=>window.__testApp.enterDemo());
    for (const width of [393,1440]) {
      await page.setViewportSize({width,height:960});
      await page.getByRole('button',{name:'Guide de démarrage',exact:true}).click();
      const guide=page.getByRole('dialog',{name:'Configurez votre carte'});
      await guide.waitFor();
      for(const title of ['Configurez votre carte','Affichez votre QR au comptoir','Validez un passage']) {
        assert.equal(await page.locator('.dpa-guide-panel h2').innerText(),title);
        assert.equal(await page.locator('.dpa-guide-highlight').count(),1);
        const box=await page.locator('.dpa-guide-panel').boundingBox();
        assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1);
        await page.locator('.dpa-guide-panel [data-next]').click();
      }
      await page.locator('.dpa-guide-panel').waitFor({state:'detached'});
      assert.equal(await page.locator('.dpa-guide-highlight').count(),0);
      const pdf=await page.getByRole('link',{name:'Guide PDF illustré'}).getAttribute('href');
      const download=await page.request.get(new URL('/downloads/Guide-DPA-Cards-mobile.pdf',origin).href);
      assert.equal(download.status(),200);
      assert.ok(pdf.endsWith('/downloads/Guide-DPA-Cards-mobile.pdf'));
    }
    await page.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
