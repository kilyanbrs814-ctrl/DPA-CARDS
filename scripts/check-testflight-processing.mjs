// Runs only on the release runner. No private key or signed JWT is ever logged.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function appleToken({keyId,issuer,pem,now=Math.floor(Date.now()/1000)}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = encode({alg:'ES256',kid:keyId,typ:'JWT'}) + '.' + encode({iss:issuer,iat:now-5,exp:now+600,aud:'appstoreconnect-v1'});
  return data + '.' + sign('sha256', Buffer.from(data), {key:createPrivateKey(pem),dsaEncoding:'ieee-p1363'}).toString('base64url');
}

export function matchingBuild(response, appVersion, number) {
  return response.data?.find(build => {
    const releaseId = build.relationships?.preReleaseVersion?.data?.id;
    const release = response.included?.find(item => item.type==='preReleaseVersions' && item.id===releaseId);
    return build.attributes.version===String(number) && release?.attributes.version===appVersion;
  });
}

async function main() {
  const release = JSON.parse(readFileSync(new URL('../release.json',import.meta.url),'utf8'));
  const version = process.env.MARKETING_VERSION || release.appVersion, number = process.env.GITHUB_RUN_NUMBER;
  const app = process.env.APP_STORE_APP_ID;
  for (const name of ['ASC_API_KEY_B64','ASC_API_KEY_ID','ASC_API_ISSUER_ID','GITHUB_RUN_NUMBER','APP_STORE_APP_ID']) {
    if (!process.env[name]) throw new Error('Missing release configuration: '+name);
  }
  if (!/^\d+$/.test(number) || !/^\d+$/.test(app)) throw new Error('Invalid app/build number');
  const pem = Buffer.from(process.env.ASC_API_KEY_B64,'base64');
  const params = new URLSearchParams({'filter[app]':app,'filter[version]':number,'filter[preReleaseVersion.version]':version,include:'preReleaseVersion,buildBetaDetail,betaGroups',limit:'5'});
  const deadline = Date.now()+15*60*1000;
  let result = {releaseId:release.releaseId,appVersion:version,buildNumber:number,revision:process.env.GITHUB_SHA,processingState:'NOT_VISIBLE'};
  while (Date.now()<deadline) {
    const token = appleToken({keyId:process.env.ASC_API_KEY_ID,issuer:process.env.ASC_API_ISSUER_ID,pem});
    const response = await fetch('https://api.appstoreconnect.apple.com/v1/builds?'+params,{
      headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('App Store Connect read failed (HTTP '+response.status+'). Upload may already have succeeded; rerun only the verification job.');
    const data = await response.json(), build = matchingBuild(data,version,number);
    if (build) {
      const detailId = build.relationships?.buildBetaDetail?.data?.id;
      const detail = data.included?.find(item => item.type==='buildBetaDetails' && item.id===detailId);
      const groups = data.included?.filter(item => item.type==='betaGroups' && item.attributes?.isInternalGroup) || [];
      result = {...result,buildId:build.id,processingState:build.attributes.processingState,
        internalBuildState:detail?.attributes.internalBuildState || null,internalGroupCount:groups.length};
    }
    writeFileSync('testflight-status.json',JSON.stringify(result,null,2));
    console.log('DPA Cards '+version+' ('+number+'): '+result.processingState+(result.internalBuildState?' · '+result.internalBuildState:''));
    if (['FAILED','INVALID'].includes(result.processingState)) throw new Error('Apple rejected build processing: '+result.processingState);
    if (result.processingState==='VALID') {
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## DPA Cards '+version+' ('+number+')\n\nMise à jour : '+release.releaseId+'\n\nApple : '+result.processingState+' — '+(result.internalBuildState || 'état bêta non renseigné')+'\n');
      if (['MISSING_EXPORT_COMPLIANCE','IN_EXPORT_COMPLIANCE_REVIEW','PROCESSING_EXCEPTION','EXPIRED'].includes(result.internalBuildState)) {
        throw new Error('Apple requires attention before testing: '+result.internalBuildState+'. The uploaded build is preserved.');
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve,20000));
  }
  throw new Error('Apple is still processing the uploaded build. Rerun only the verification job later.');
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
