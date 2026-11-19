// Release maintenance only: finalize the already uploaded, audited 1.3 (26).
// No binary upload, new tester, external group, or App Store submission.
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleToken, matchingBuild } from './check-testflight-processing.mjs';

export const target = Object.freeze({app:'6823642562',version:'1.3',number:'26',revision:'3978b339efe3160ee480570407af1438a46f7f9b'});

export function exemptionUpdate(build) {
  assert.equal(build?.attributes?.version,target.number,'Wrong build number');
  assert.equal(build.attributes.processingState,'VALID','Apple has not validated the binary');
  assert.notEqual(build.attributes.expired,true,'Build has expired');
  assert.notEqual(build.attributes.usesNonExemptEncryption,true,'Never override an existing non-exempt declaration');
  return build.attributes.usesNonExemptEncryption===false ? null : {
    data:{type:'builds',id:build.id,attributes:{usesNonExemptEncryption:false}},
  };
}

export function internalGroups(groups, previous = []) {
  const allowed=groups.filter(g=>g.attributes?.isInternalGroup===true);
  const preferred=allowed.filter(g=>previous.includes(g.id));
  if(preferred.length) return preferred;
  if(allowed.length===1) return allowed;
  throw new Error('Cannot choose an existing internal tester group unambiguously');
}

export function missingManualGroups(groups, assigned) {
  // Apple's default/all-builds group is managed automatically. Manually adding
  // the same build while exemption processing assigns it returns HTTP 422.
  return groups.filter(g=>!g.attributes.hasAccessToAllBuilds&&!assigned.includes(g.id));
}

async function main() {
  for(const name of ['ASC_API_KEY_B64','ASC_API_KEY_ID','ASC_API_ISSUER_ID']) assert.ok(process.env[name],'Missing '+name);
  const pem=Buffer.from(process.env.ASC_API_KEY_B64,'base64');
  const api=async(path,method='GET',body)=>{
    assert.ok(path.startsWith('/v1/'),'Unexpected API path');
    const jwt=appleToken({keyId:process.env.ASC_API_KEY_ID,issuer:process.env.ASC_API_ISSUER_ID,pem});
    const response=await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{authorization:'Bearer '+jwt,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok) {
      const errors=await response.json().catch(()=>({}));
      throw new Error('Apple '+method+' '+path.split('?')[0]+': HTTP '+response.status+' '+(errors.errors?.map(e=>e.code).join(',')||''));
    }
    return response.status===204?{}:response.json();
  };
  const include='preReleaseVersion,buildBetaDetail,betaGroups';
  const query=new URLSearchParams({'filter[app]':target.app,'filter[version]':target.number,'filter[preReleaseVersion.version]':target.version,include,limit:'5'});
  const data=await api('/v1/builds?'+query),build=matchingBuild(data,target.version,target.number);
  assert.ok(build,'The exact uploaded build was not found');
  const prior=await api('/v1/builds?'+new URLSearchParams({'filter[app]':target.app,include,sort:'-uploadedDate',limit:'50'}));
  const previous=prior.data.filter(b=>b.id!==build.id&&b.attributes.processingState==='VALID'&&b.attributes.usesNonExemptEncryption===false);
  console.log('Existing validated builds with an exempt declaration: '+previous.map(b=>b.attributes.version).join(', '));
  // Audit of target.revision: HTTPS/WSS are provided by WKWebView, and Supabase
  // uses system WebCrypto only for random values, SHA-256 PKCE and JWT verification.
  // No custom encryption or third-party cryptography implementation is bundled.
  // Apple documentation: export-compliance-documentation-for-encryption.
  const patch=exemptionUpdate(build);
  if(patch) { await api('/v1/builds/'+build.id,'PATCH',patch); console.log('Completed audited OS-only encryption exemption for 1.3 (26).'); }
  const groupsResponse=await api('/v1/betaGroups?'+new URLSearchParams({'filter[app]':target.app,limit:'200'}));
  const priorIds=previous.flatMap(b=>b.relationships?.betaGroups?.data?.map(g=>g.id)||[]);
  const groups=internalGroups(groupsResponse.data,priorIds);
  const refreshed=await api('/v1/builds/'+build.id+'?'+new URLSearchParams({include}));
  const currentIds=refreshed.data.relationships?.betaGroups?.data?.map(g=>g.id)||[];
  const missing=missingManualGroups(groups,currentIds);
  if(missing.length) {
    await api('/v1/builds/'+build.id+'/relationships/betaGroups','POST',{data:missing.map(g=>({type:'betaGroups',id:g.id}))});
    console.log('Added build to '+missing.length+' existing internal group(s).');
  }
  const deadline=Date.now()+10*60*1000;
  while(Date.now()<deadline) {
    const state=await api('/v1/builds/'+build.id+'?'+new URLSearchParams({include}));
    const detailId=state.data.relationships?.buildBetaDetail?.data?.id;
    const detail=state.included?.find(x=>x.type==='buildBetaDetails'&&x.id===detailId);
    const internal=state.included?.filter(x=>x.type==='betaGroups'&&x.attributes.isInternalGroup)||[];
    const result={...target,buildId:build.id,processingState:state.data.attributes.processingState,usesNonExemptEncryption:state.data.attributes.usesNonExemptEncryption,internalBuildState:detail?.attributes.internalBuildState,internalGroupCount:internal.length};
    writeFileSync('testflight-ready.json',JSON.stringify(result,null,2));
    console.log('DPA Cards 1.3 (26): '+result.processingState+' · '+result.internalBuildState+' · '+internal.length+' internal group(s)');
    if(result.processingState==='VALID'&&result.internalBuildState==='IN_BETA_TESTING'&&internal.length>0) {
      if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## DPA Cards 1.3 (26)\n\nApple : VALID / IN_BETA_TESTING\n\nRévision : '+target.revision+'\n');
      return;
    }
    if(['FAILED','INVALID'].includes(result.processingState)||['PROCESSING_EXCEPTION','EXPIRED','IN_EXPORT_COMPLIANCE_REVIEW'].includes(result.internalBuildState)) throw new Error('Apple beta state requires attention: '+result.internalBuildState);
    await new Promise(resolve=>setTimeout(resolve,20000));
  }
  throw new Error('Internal beta activation is still pending. The uploaded build is preserved.');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) main().catch(error=>{console.error(error.message);process.exitCode=1;});
