import { appleToken } from './check-testflight-processing.mjs';

export async function appStoreApi(path, method='GET', data) {
  if (!path.startsWith('/') || path.includes('://')) throw new Error('Invalid App Store API path');
  const token=appleToken({keyId:process.env.ASC_API_KEY_ID,issuer:process.env.ASC_API_ISSUER_ID,pem:Buffer.from(process.env.ASC_API_KEY_B64,'base64')});
  const response=await fetch('https://api.appstoreconnect.apple.com/v1'+path,{
    method,redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    ...(data?{body:JSON.stringify({data})}:{}),
  });
  if (!response.ok) {
    const details=await response.json().catch(()=>({}));
    throw new Error('App Store API '+method+' '+path.split('?')[0]+' HTTP '+response.status+' '+(details.errors||[]).map(error=>error.code+': '+error.title).join(', '));
  }
  return response.status===204?{}:response.json();
}
