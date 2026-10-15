import {parseCode} from '../src/scanner.js';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
// Exercise the actual Edge entrypoint with isolated DB/storage and ephemeral signing keys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {transform} from 'esbuild';
import {fixture} from './fixtures/png.mjs';
const mid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
test('signed demo and real pkpass contain scoped PNGs, native counters and intact scanner QR',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dpa-sign-'));
 const mod=new URL('../supabase/functions/apple-pass/.png-test.mjs',import.meta.url);
 const originalFetch=globalThis.fetch;let handler;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=DPA isolated test'],{stdio:'ignore'});
  const cert=readFileSync(join(dir,'cert.pem'),'utf8'),key=readFileSync(join(dir,'key.pem'),'utf8');
  const rawCert=Buffer.from(cert.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64');
  globalThis.fetch=async()=>new Response(rawCert);
  globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',APPLE_PASS_CERT_PEM:cert,APPLE_PASS_PRIVATE_KEY_PEM:key}[n])},serve:fn=>{handler=fn;}};
  let demo=true,reads=[],showName=false;
  const config=()=>({identity:{name:'PNG test'},assets:{logo:{path:base()+'/designer/logo-'+id+'.png'},stamp:{path:base()+'/designer/stamp-'+id+'.png'}},stamps:{icon:'custom',emoji:'🍔'},colors:{primary:'#000000',secondary:'#2448F0'},apple:{showBusinessName:showName},preview:{progress:3,goal:10}});
  const base=()=>demo?'tests/'+id:mid+'/'+pid;
  globalThis.__pngClient={
   rpc:async()=>({data:true}),
   storage:{from:()=>({download:async path=>{reads.push(path);assert.ok(path.startsWith(base()+'/'));return {data:new Blob([fixture()])};}})},
   from:table=>{
    const rows={apple_wallet_links:demo?null:{card_id:id,expires_at:'2099-01-01'},apple_wallet_test_links:{test_card_id:id},test_card_designs:{id,name:'PNG test',config:config(),test_balance:3,qr_token:id},cards:{id,merchant_id:mid,program_id:pid,customer_id:id,qr_token:pid,card_number:'DPA-9876'},programs:{id:pid,merchant_id:mid,mode:'passages',goal:10,reward:'Reward',design_status:'validated',card_design:config()},merchants:{business_name:'Own shop'},customers:{first_name:'Customer'},card_events:[{seq:2,balance_after:6}]};
    const q={};for(const m of ['select','eq','gt','order','limit','upsert'])q[m]=()=>q;
    q.single=q.maybeSingle=async()=>({data:rows[table]});q.then=resolve=>Promise.resolve({data:rows[table]}).then(resolve);return q;
   }
  };
  let code=readFileSync(new URL('../supabase/functions/apple-pass/index.ts',import.meta.url),'utf8')
   .replace(/import \{ createClient \} from 'npm:[^']+';/,"const createClient=()=>globalThis.__pngClient;")
   .replace('npm:passkit-generator@3.6.1','passkit-generator');
  writeFileSync(mod,(await transform(code,{loader:'ts',format:'esm'})).code);
  await import(pathToFileURL(mod.pathname).href+'?test='+Date.now());
  for(const nativeName of [false,true]){
   showName=nativeName;
   for(const isDemo of [true,false]){
   demo=isDemo;reads=[];
   const res=await handler(new Request('https://test/functions/v1/apple-pass?token='+'a'.repeat(32)));
   assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'application/vnd.apple.pkpass');
   writeFileSync(join(dir,'pass.zip'),Buffer.from(await res.arrayBuffer()));
   const contents=JSON.parse(execFileSync('unzip',['-p',join(dir,'pass.zip'),'pass.json'],{encoding:'utf8'}));
   assert.equal(contents.logoText,nativeName?'PNG test':undefined,'PassKit must own the optional native heading');
   assert.equal(contents.storeCard.secondaryFields[0].value,demo?'3':'6');
   assert.equal(contents.barcodes[0].message,demo?'DPA_TEST:'+id:'DPA1:'+pid);
   assert.equal(contents.barcodes[0].altText,'Par DPA Cards');
   if(contents.barcode)assert.equal(contents.barcode.altText,'Par DPA Cards');
   const message=contents.barcodes[0].message, qr=QRCode.create(message,{errorCorrectionLevel:'M'});
   const dim=(qr.modules.size+8)*6,rgba=new Uint8ClampedArray(dim*dim*4).fill(255);
   for(let y=0;y<qr.modules.size;y++)for(let x=0;x<qr.modules.size;x++)if(qr.modules.get(y,x))for(let yy=0;yy<6;yy++)for(let xx=0;xx<6;xx++){
     const at=(((y+4)*6+yy)*dim+(x+4)*6+xx)*4;rgba[at]=rgba[at+1]=rgba[at+2]=0;
   }
   assert.equal(jsQR(rgba,dim,dim).data,message);
   assert.equal(parseCode(message).kind,demo?'demo':'qr');
   if(!demo)assert.equal(contents.storeCard.headerFields[0].value,'9876');
   assert.equal(reads.length,2);
   execFileSync('unzip',['-o','-q',join(dir,'pass.zip'),'-d',join(dir,'unpacked')]);
   const manifest=JSON.parse(readFileSync(join(dir,'unpacked/manifest.json')));
   for(const name of ['icon.png','icon@2x.png','logo.png','logo@2x.png','strip.png','strip@2x.png','pass.json'])assert.ok(manifest[name]);
   const logoFile=readFileSync(join(dir,'unpacked/logo.png'));
   assert.equal(logoFile.readUInt32BE(16),nativeName?64:160,'logo width must leave room for native text');
   assert.equal(logoFile.readUInt32BE(20),nativeName?48:50);
   const logo2=readFileSync(join(dir,'unpacked/logo@2x.png'));
   assert.equal(logo2.readUInt32BE(16),logoFile.readUInt32BE(16)*2);
   assert.equal(logo2.readUInt32BE(20),logoFile.readUInt32BE(20)*2);
   assert.ok(!manifest['logo@3x.png'],'optional 3x export skipped to protect Edge CPU budget');
   execFileSync('openssl',['smime','-verify','-inform','DER','-in',join(dir,'unpacked/signature'),'-content',join(dir,'unpacked/manifest.json'),'-noverify'],{stdio:'ignore'});
   }
  }
 } finally {globalThis.fetch=originalFetch;delete globalThis.Deno;delete globalThis.__pngClient;rmSync(mod,{force:true});rmSync(dir,{recursive:true,force:true});}
});
