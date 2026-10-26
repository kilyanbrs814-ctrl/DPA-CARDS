import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {fixture} from './fixtures/png.mjs';
import {PNG} from 'pngjs';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('onboarding imports and crops a logo into the actual Storage API and saves the selected draft program',async()=>{
  // Explicit fake credentials keep CI independent of private env files. Every
  // Supabase request is intercepted below; the real upload client is exercised.
  const server=await createServer({define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://logo-test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('test-publishable-key')
  },server:{host:'127.0.0.1',port:0}});await server.listen();
  const origin=server.resolvedUrls.local[0],browser=await chromium.launch();
  const merchant='20000000-0000-4000-8000-000000000002',program='30000000-0000-4000-8000-000000000002';
  const row={id:program,merchant_id:merchant,name:'Club test',mode:'passages',goal:10,reward:'Café',bg:'#FFFFFF',accent:'#EFEDE8',pattern:'none',design_status:'draft',logo_path:null};
  const out=new URL('../test-results/onboarding-logo/',import.meta.url);mkdirSync(out,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],uploads=[];let saved=null,deny=true;
    let finalized;
    page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://*.supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname==='/functions/v1/wallet/finalize-design'){
        finalized=req.postDataJSON();return route.fulfill({json:{status:'validated',wallet:'ready'}});
      }
      if(url.pathname.startsWith('/storage/v1/object/program-assets/')&&req.method()==='POST'){
        const path=decodeURIComponent(url.pathname.split('/program-assets/')[1]);uploads.push(path);
        assert.ok(path.startsWith(merchant+'/'+program+'/logo-'));
        if(deny)return route.fulfill({status:400,json:{statusCode:'403',error:'Unauthorized',message:'new row violates row-level security policy'}});
        const body=req.postDataBuffer(),signature=Buffer.from([137,80,78,71,13,10,26,10]),start=body.indexOf(signature),iend=body.indexOf(Buffer.from('IEND'),start);
        const png=PNG.sync.read(body.subarray(start,iend+8));assert.equal(png.width,660);assert.equal(png.height,660);
        return route.fulfill({json:{Id:'upload',Key:'program-assets/'+path}});
      }
      if(url.pathname==='/rest/v1/programs'&&req.method()==='PATCH'){
        assert.equal(url.searchParams.get('id'),'eq.'+program);saved=req.postDataJSON().logo_path;
        assert.equal(saved,uploads.at(-1));return route.fulfill({json:{...row,logo_path:saved}});
      }
      if(url.pathname.startsWith('/storage/v1/object/public/program-assets/'))return route.fulfill({contentType:'image/png',body:fixture(660,660)});
      return route.abort();
    });
    await page.route(origin,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('componentDidMount(){','componentDidMount(){window.__testApp=this;')});});
    await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__testApp);
    await page.evaluate(async({row,merchant})=>{
      const a=window.__testApp;a.api=await window.dpaReady;
      a.setState({live:true,demo:false,screen:'ob',role:'owner',hasAccess:false,clients:[],program:a.api.toProgram(row),
        merchant:{...a.state.merchant,id:merchant,business:'Commerce B'},
        ob:{...a.initState().ob,step:3,biz:'Commerce B',prog:'Club test',design:'custom'}});
    },{row,merchant});
    const input=page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]');
    const pick=async()=>{
      await input.setInputFiles({name:'logo.png',mimeType:'image/png',buffer:fixture(240,120)});
      await page.getByRole('button',{name:'Valider le recadrage'}).click();
    };
    await pick();await page.getByRole('alert').filter({hasText:'Le logo ne peut pas être enregistré'}).waitFor();
    assert.equal(saved,null);deny=false;
    await pick();await page.waitForFunction(()=>window.__testApp.state.program.logoPath!==null);
    assert.equal((await page.evaluate(()=>window.__testApp.state.program)).logoPath,saved);
    assert.equal(await page.getByLabel('Aperçu de la carte Apple Wallet',{exact:true}).locator('img[alt="Logo"]').count(),1);
    await page.screenshot({path:fileURLToPath(new URL('logo-saved-desktop.png',out)),fullPage:true});
    await page.setViewportSize({width:393,height:852});await pick();
    await page.waitForFunction(()=>window.__testApp.state.imgBusy===null&&window.__testApp.state.modal===null);
    assert.equal((await page.evaluate(()=>window.__testApp.state.program)).logoPath,saved);
    await page.screenshot({path:fileURLToPath(new URL('logo-saved-mobile.png',out)),fullPage:true});
    await page.getByRole('radio',{name:'Sans tampons',exact:true}).click();
    await page.evaluate(()=>{const a=window.__testApp;a.saveDraftNow=async()=>{};a.api={...a.api,
      session:async()=>({user:{id:'test-owner'}}),loadAll:async()=>({merchant:a.state.merchant,hasAccess:false,program:{...a.state.program,selfServiceShowStamps:false,selfServiceStampId:null,designStatus:'validated',designMode:'custom'}})};});
    await page.getByRole('button',{name:'Valider ma carte',exact:true}).click();
    await page.waitForFunction(()=>window.__testApp.state.screen==='billing');
    assert.deepEqual(finalized,{show_stamps:false,stamp_id:null});
    assert.equal((await page.evaluate(()=>window.__testApp.state.program)).selfServiceShowStamps,false);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});
