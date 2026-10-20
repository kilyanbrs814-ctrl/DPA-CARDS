import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {webkit} from '@playwright/test';
const out='app-store-output';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync('index.html','utf8');
const fixture=JSON.parse(fs.readFileSync('app-store/review-fixture.json','utf8'));
const anchor="    if(this.state.pubSlug) return this.bootPublic();";
if(source.split(anchor).length!==2)throw Error('Fixture anchor changed');
const views=[['01-accueil','home','Commerce'],['02-clients','clients','Clients'],['03-fiche-client','client','Emma'],['04-invitation','invite','QR'],['05-reglages','more',''],['06-carte','card','programme']];
const manifest={sourceSha:process.env.GITHUB_SHA,generatedAt:new Date().toISOString(),renderer:'WebKit desktop engine; actual current app UI, native companion mode, simulated device viewport; not iOS Simulator',devices:[],files:[]};
const browser=await webkit.launch({headless:true});
let server;
try{
 for(const [name,view,expected]of views){
 const fixtureCode=[
    '    // DPA_CAPTURE_FIXTURE: ephemeral, read-only screenshot fixture.',
    '    if (true) {',
    '      const captureFixture='+JSON.stringify(fixture)+';',
    '      useCalendar(true);',
    '      this.ready().then(api=>{',
    "        if(!api)throw new Error('Current application utilities unavailable.');",
    "        this.api={...api,access:async()=>({has_access:true,source:'manual'})};",
    '        const cl=captureFixture.clients;',
    "        this.setState({live:true,demo:false,hasAccess:true,accessSource:'manual',role:'owner',",
    '          merchant:captureFixture.merchant,sd:{...captureFixture.merchant},',
    '          program:captureFixture.program,draft:{...captureFixture.program},clients:cl,',
    '          notifs:[],screen:'+JSON.stringify(view)+',selId:cl[0].id,',
    "          busy:false,loadingHome:false,err:{},modal:null,toast:null,section:'profile',profiles:[],subscription:null});",
    '      });',
    '      return;',
    '    }'
   ].join('\n');
 const patched=source.replace(anchor,fixtureCode+'\n'+anchor).replace("const DPA_NATIVE_IOS=window.location.protocol==='capacitor:';","const DPA_NATIVE_IOS=true;");
 fs.writeFileSync('index.html',patched);
 cp.execFileSync('npm',['run','build'],{stdio:'inherit',timeout:120000});
 if(!server){server=cp.spawn('npm',['run','preview','--','--host','127.0.0.1'],{stdio:'inherit'});await new Promise(r=>setTimeout(r,1500));}
 for(const [family,width,height,scale]of [['iphone',402,874,3],['ipad',1032,1376,2]]){
 if(family==='iphone'&&view==='card')continue;
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:scale,isMobile:true,hasTouch:true,locale:'fr-FR'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173',{waitUntil:'networkidle'});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(2000);
 const text=await page.locator('body').innerText();
 if(text.length<80||expected&&!text.toLowerCase().includes(expected.toLowerCase())||/Espace non actif|Service de connexion indisponible/.test(text))throw Error('Screen not ready: '+family+'/'+view+' '+text+' '+errors.join('; '));
 const folder=path.join(out,family);fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,name+'.png'),ocr=path.join(folder,name+'.txt');
 await page.screenshot({path:file,animations:'disabled'});fs.writeFileSync(ocr,text);
 const b=fs.readFileSync(file);manifest.files.push({family,view,file:path.relative(out,file),width:b.readUInt32BE(16),height:b.readUInt32BE(20),ocr:path.relative(out,ocr)});
 fs.writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2));console.log('Captured '+family+'/'+name);
 await context.close();
 }
 }
}finally{server?.kill();await browser.close();fs.writeFileSync('index.html',source);}
