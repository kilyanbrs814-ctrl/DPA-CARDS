// Official App Store Connect API. Uses the existing repository API-key secrets.
// No private key, bearer token, password or signed upload URL is logged or saved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const cfg=JSON.parse(fs.readFileSync('app-store/declarations.json','utf8'));
if(cfg.appId!=='6823642562'||cfg.bundleId!=='fr.digitalprojectagency.cards')throw new Error('Unexpected app');
const report={appId:cfg.appId,version:cfg.version,operations:[],privacy:cfg.privacy.status};
fs.mkdirSync('app-store-report',{recursive:true});
function save(){fs.writeFileSync('app-store-report/result.json',JSON.stringify(report,null,2));}
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
let jwt,until=0;
function authorization(){
 const now=Math.floor(Date.now()/1000);
 if(jwt&&now<until-60)return jwt;
 for(const name of ['ASC_API_KEY_B64','ASC_API_KEY_ID','ASC_API_ISSUER_ID'])if(!process.env[name])throw new Error('Missing existing Apple secret '+name);
 const header=b64({alg:'ES256',kid:process.env.ASC_API_KEY_ID.trim(),typ:'JWT'});
 until=now+900;
 const payload=b64({iss:process.env.ASC_API_ISSUER_ID.trim(),iat:now-10,exp:until,aud:'appstoreconnect-v1'});
 const key=crypto.createPrivateKey(Buffer.from(process.env.ASC_API_KEY_B64,'base64'));
 const signature=crypto.sign('sha256',Buffer.from(header+'.'+payload),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
 jwt=header+'.'+payload+'.'+signature;
 return jwt;
}
async function api(route,method='GET',body){
 if(!route.startsWith('/v1/'))throw new Error('Unexpected API route');
 const r=await fetch('https://api.appstoreconnect.apple.com'+route,{method,headers:{Authorization:'Bearer '+authorization(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const text=await r.text();
 if(!r.ok)throw new Error(method+' '+route+' '+r.status+' '+text);
 return text?JSON.parse(text):null;
}
async function list(route){
 let result=[];
 for(let n=0;route&&n<10;n++){
  const r=await api(route);result.push(...r.data);
  if(r.links?.next){const next=new URL(r.links.next);if(next.origin!=='https://api.appstoreconnect.apple.com')throw new Error('Unexpected pagination origin');route=next.pathname+next.search;}else route=null;
 }
 return result;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const app=(await api('/v1/apps/'+cfg.appId)).data;
 if(app.attributes.bundleId!==cfg.bundleId)throw new Error('App bundle mismatch');
 const infos=await list('/v1/apps/'+cfg.appId+'/appInfos');
 const info=infos.find(x=>x.attributes.appStoreState==='PREPARE_FOR_SUBMISSION')||infos.find(x=>['DEVELOPER_REJECTED','REJECTED','METADATA_REJECTED'].includes(x.attributes.appStoreState));
 if(!info)throw new Error('No editable app info; refusing to modify a submitted/live version');
 const age=(await api('/v1/appInfos/'+info.id+'/ageRatingDeclaration')).data;
 const attributes=Object.fromEntries(Object.entries(cfg.age).filter(([k])=>Object.hasOwn(age.attributes,k)));
 const missing=Object.keys(cfg.age).filter(k=>!Object.hasOwn(age.attributes,k));
 if(missing.length)throw new Error('Age declaration schema differs: '+missing.join(','));
 await api('/v1/ageRatingDeclarations/'+age.id,'PATCH',{data:{type:'ageRatingDeclarations',id:age.id,attributes}});
 const updatedAge=(await api('/v1/ageRatingDeclarations/'+age.id)).data;
 for(const [k,v]of Object.entries(attributes))if(updatedAge.attributes[k]!==v)throw new Error('Age field not persisted: '+k);
 report.operations.push({type:'age',status:'SAVED',attributes:updatedAge.attributes});
 await api('/v1/apps/'+cfg.appId,'PATCH',{data:{type:'apps',id:cfg.appId,attributes:{contentRightsDeclaration:cfg.contentRightsDeclaration}}});
 const updatedApp=(await api('/v1/apps/'+cfg.appId)).data;
 if(updatedApp.attributes.contentRightsDeclaration!==cfg.contentRightsDeclaration)throw new Error('Content-rights declaration not persisted');
 report.operations.push({type:'contentRights',status:'SAVED',value:updatedApp.attributes.contentRightsDeclaration});
 const localizations=await list('/v1/appInfos/'+info.id+'/appInfoLocalizations');
 const infoLoc=localizations.find(x=>x.attributes.locale===cfg.locale)||localizations.find(x=>x.attributes.locale.startsWith('fr'));
 if(!infoLoc)throw new Error('French app-info localization missing');
 if(infoLoc.attributes.privacyPolicyUrl!==cfg.privacyPolicyUrl)await api('/v1/appInfoLocalizations/'+infoLoc.id,'PATCH',{data:{type:'appInfoLocalizations',id:infoLoc.id,attributes:{privacyPolicyUrl:cfg.privacyPolicyUrl}}});
 report.operations.push({type:'privacyPolicyUrl',status:'SAVED',value:cfg.privacyPolicyUrl});
 save();
 if(process.env.DPA_UPLOAD_SCREENSHOTS==='1'){
  const versions=await list('/v1/apps/'+cfg.appId+'/appStoreVersions?filter[platform]=IOS&limit=50');
  const version=versions.find(v=>v.attributes.versionString===cfg.version&&['PREPARE_FOR_SUBMISSION','DEVELOPER_REJECTED','REJECTED','METADATA_REJECTED'].includes(v.attributes.appStoreState));
  if(!version)throw new Error('No editable target iOS 1.0 version');
  const locs=await list('/v1/appStoreVersions/'+version.id+'/appStoreVersionLocalizations');
  const loc=locs.find(x=>x.attributes.locale===cfg.locale)||locs.find(x=>x.attributes.locale.startsWith('fr'));
  if(!loc)throw new Error('French version localization missing');
  const manifest=JSON.parse(fs.readFileSync('capture-input/app-store/captures/manifest.json','utf8'));
  if(manifest.files.length!==11)throw new Error('Expected 11 verified captures');
  const sets=await list('/v1/appStoreVersionLocalizations/'+loc.id+'/appScreenshotSets');
  for(const [family,display]of [['iphone','APP_IPHONE_61'],['ipad','APP_IPAD_PRO_3GEN_129']]){
   let set=sets.find(s=>s.attributes.screenshotDisplayType===display);
   if(!set)set=(await api('/v1/appScreenshotSets','POST',{data:{type:'appScreenshotSets',attributes:{screenshotDisplayType:display},relationships:{appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:loc.id}}}}})).data;
   const existing=await list('/v1/appScreenshotSets/'+set.id+'/appScreenshots');
   const files=manifest.files.filter(x=>x.family===family);
   const planned=files.map(f=>'dpa-'+family+'-'+path.basename(f.file));
   if(existing.filter(s=>!planned.includes(s.attributes.fileName)).length+files.length>10)throw new Error('Existing screenshots would exceed Apple limit; preserving them');
   for(const item of files){
    const filename='dpa-'+family+'-'+path.basename(item.file);
    const bytes=fs.readFileSync(path.join('capture-input/app-store/captures',item.file));
    const checksum=crypto.createHash('md5').update(bytes).digest('hex');
    let shot=existing.find(x=>x.attributes.fileName===filename);
    if(shot&&shot.attributes.sourceFileChecksum!==checksum)throw new Error('Existing screenshot with different bytes: '+filename);
    if(!shot){
     shot=(await api('/v1/appScreenshots','POST',{data:{type:'appScreenshots',attributes:{fileName:filename,fileSize:bytes.length},relationships:{appScreenshotSet:{data:{type:'appScreenshotSets',id:set.id}}}}})).data;
     for(const op of shot.attributes.uploadOperations||[]){
      const url=new URL(op.url);
      if(url.protocol!=='https:')throw new Error('Insecure asset upload URL');
      const headers=Object.fromEntries((op.requestHeaders||[]).map(h=>[h.name,h.value]));
      const uploaded=await fetch(url,{method:op.method,headers,body:bytes.subarray(op.offset,op.offset+op.length)});
      if(!uploaded.ok)throw new Error('Apple asset upload failed: '+uploaded.status);
     }
     shot=(await api('/v1/appScreenshots/'+shot.id,'PATCH',{data:{type:'appScreenshots',id:shot.id,attributes:{uploaded:true,sourceFileChecksum:checksum}}})).data;
    }
    for(let attempt=0;attempt<45;attempt++){
     shot=(await api('/v1/appScreenshots/'+shot.id)).data;
     const state=shot.attributes.assetDeliveryState?.state;
     if(state==='COMPLETE')break;
     if(state==='FAILED')throw new Error('Apple failed to process '+filename+': '+JSON.stringify(shot.attributes.assetDeliveryState));
     if(attempt===44)throw new Error('Apple asset processing timed out for '+filename);
     await pause(3000);
    }
    report.operations.push({type:'screenshot',status:'COMPLETE',id:shot.id,family,filename,checksum});
    console.log('Uploaded and verified '+filename);
    save();
   }
  }
 }
 console.log(JSON.stringify(report,null,2));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## DPA Cards App Store\n\n'+report.operations.map(x=>'- '+x.type+': '+x.status+(x.filename?' '+x.filename:'')).join('\n')+'\n\nPrivacy data-type questionnaire still requires the App Store Connect web form. It has NOT been published by this job.\n');
}catch(e){report.error=e.message;save();console.error(e.message);process.exitCode=1;}
