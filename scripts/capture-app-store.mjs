// Native interface with a read-only snapshot of the isolated review demo account.
// Only this temporary checkout is patched. Production and ios-testflight are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
const root=process.cwd(), tmp=process.env.RUNNER_TEMP;
if(!tmp || process.platform!=='darwin') throw new Error('Run on the macOS screenshot runner.');
const out=path.join(root,'app-store-output'); fs.mkdirSync(out,{recursive:true});
const log=fs.openSync(path.join(out,'native-build.log'),'a');
function run(cmd,args,opts={}){
 const started=Date.now();console.log('Running '+cmd+' '+args.slice(0,4).join(' '));
 try{const result=cp.execFileSync(cmd,args,{cwd:root,encoding:'utf8',timeout:cmd==='xcodebuild'?360000:180000,stdio:['ignore',log,log],...opts});console.log(cmd+' finished in '+Math.round((Date.now()-started)/1000)+'s');return result;}
 catch(e){console.error(fs.readFileSync(path.join(out,'native-build.log'),'utf8').split('\n').slice(-45).join('\n'));throw e;}
}
function json(cmd,args){return JSON.parse(run(cmd,args,{stdio:['ignore','pipe',log]}));}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const available=json('xcrun',['simctl','list','devices','available','--json']);
let phone,tablet;
for(const devices of Object.values(available.devices)) for(const d of devices) {
 if(!d.isAvailable)continue;
 if(/^iPhone (16|17) Pro$/.test(d.name))phone??=d;
 if(/^iPad Pro 13-inch/.test(d.name))tablet??=d;
}
if(!phone||!tablet)throw new Error('A 6.3-inch iPhone Pro and 13-inch iPad Pro are required.');
const bundle='fr.digitalprojectagency.cards';
const source=fs.readFileSync('index.html','utf8');
const fixture=JSON.parse(fs.readFileSync('app-store/review-fixture.json','utf8'));
const anchor="    if(this.state.pubSlug) return this.bootPublic();";
if(source.split(anchor).length!==2)throw new Error('Capture hook no longer matches current app.');
const views=[
 ['01-accueil','home','Commerce'],
 ['02-clients','clients','Clients'],
 ['03-fiche-client','client','Emma'],
 ['04-invitation','invite','QR'],
 ['05-reglages','more','Paramètres'],
 ['06-carte','card','programme']
];
const manifest={sourceSha:process.env.GITHUB_SHA,generatedAt:new Date().toISOString(),fixture:'Isolated Apple review demo; read-only snapshot, no credentials',devices:[],files:[]};
try{
 // App icon and launch artwork are not visible in in-app screenshots. Skip only
 // the ephemeral native asset-catalog build; all actual web UI assets stay intact.
 const projectFile='ios/App/App.xcodeproj/project.pbxproj';
 const pbx=fs.readFileSync(projectFile,'utf8');
 const pruned=pbx.replace(/^\s*[A-F0-9]{24} \/\* Assets\.xcassets in Resources \*\/,\r?\n/gm,'');
 if(pruned===pbx)throw new Error('Native asset-catalog resource entry not found');
 fs.writeFileSync(projectFile,pruned);
 console.log('Building the native simulator application before booting a device.');
 run('npm',['run','build']);
 run('npx',['cap','sync','ios']);
 run('xcodebuild',['-project','ios/App/App.xcodeproj','-scheme','App','-configuration','Debug','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(tmp,'DPA-Capture-Build'),'CODE_SIGNING_ALLOWED=NO','ARCHS='+process.arch.replace('x64','x86_64'),'ONLY_ACTIVE_ARCH=YES','ASSETCATALOG_COMPILER_APPICON_NAME=','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME=','ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS=NO','-jobs','2','build']);
 const app=path.join(tmp,'DPA-Capture-Build/Build/Products/Debug-iphonesimulator/App.app');
 for(const [family,d] of [['iphone',phone],['ipad',tablet]]){
  console.log('Booting '+d.name+'; only one simulator runs at a time.');
  if(d.state!=='Booted')run('xcrun',['simctl','boot',d.udid]);
  run('xcrun',['simctl','bootstatus',d.udid,'-b']);
  run('xcrun',['simctl','status_bar',d.udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100']);
  manifest.devices.push({family,name:d.name,udid:d.udid});
  for(const [name,view,expected] of views){
   if(family==='iphone' && view==='card')continue;
   console.log('Preparing '+family+'/'+name);
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
   fs.writeFileSync('index.html',source.replace(anchor,fixtureCode+'\n'+anchor));
   run('npm',['run','build']);
   // The native code and plugins are unchanged. Replace only this unsigned
   // simulator package's bundled web resources, exactly as cap copy does.
   const web=path.join(app,'public');
   if(!fs.existsSync(web))throw new Error('Generated Capacitor public resource folder missing');
   fs.rmSync(web,{recursive:true});
   fs.cpSync('dist',web,{recursive:true});
   try{run('xcrun',['simctl','terminate',d.udid,bundle]);}catch{}
   run('xcrun',['simctl','install',d.udid,app]);
   run('xcrun',['simctl','launch',d.udid,bundle]);
   const folder=path.join(out,family);fs.mkdirSync(folder,{recursive:true});
   const file=path.join(folder,name+'.png'),ocr=path.join(folder,name+'.txt');
   let ok=false;
   for(let attempt=0;attempt<3;attempt++){
    await pause(5000);
    run('xcrun',['simctl','io',d.udid,'screenshot','--type=png',file]);
    try{
     run(path.join(tmp,'dpa-verify-screenshot'),[file,ocr]);
     const text=fs.readFileSync(ocr,'utf8');
     if(view!=='more'&&!text.toLocaleLowerCase('fr').includes(expected.toLocaleLowerCase('fr')))throw new Error('Expected screen missing: '+expected);
     ok=true;break;
    }catch(e){if(attempt===2)throw e;}
   }
   if(!ok)throw new Error('Screenshot did not become ready.');
   const buf=fs.readFileSync(file),width=buf.readUInt32BE(16),height=buf.readUInt32BE(20);
   const accepted=family==='iphone'?['1206x2622','1179x2556']:['2064x2752','2048x2732'];
   if(!accepted.includes(width+'x'+height))throw new Error('Unexpected dimensions: '+width+'x'+height);
   manifest.files.push({family,view,file:path.relative(out,file),width,height,ocr:path.relative(out,ocr)});
   fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
   console.log('Captured '+family+'/'+name+' '+width+'x'+height);
  }
  run('xcrun',['simctl','shutdown',d.udid]);
 }
}finally{
 fs.writeFileSync('index.html',source);
 for(const d of [phone,tablet])try{run('xcrun',['simctl','shutdown',d.udid]);}catch{}
 fs.closeSync(log);
}
