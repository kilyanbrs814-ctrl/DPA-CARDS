import { passTypeId } from './auth.js';
const enc=new TextEncoder();
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64=s=>btoa(String.fromCharCode(...new Uint8Array(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromPEM=s=>Uint8Array.from(atob(s.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
let cached=null;
async function apnsJwt(){
  const id=Deno.env.get('APPLE_APNS_KEY_ID')||'';
  const pem=(Deno.env.get('APPLE_APNS_PRIVATE_KEY_PEM')||'').replace(/\\n/g,'\n');
  if(!/^[A-Z0-9]{10}$/.test(id)||!pem.includes('PRIVATE KEY'))return null;
  const now=Math.floor(Date.now()/1000);
  if(cached&&cached.id===id&&now-cached.at<2400)return cached.token;
  const key=await crypto.subtle.importKey('pkcs8',fromPEM(pem),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const header=b64(enc.encode(JSON.stringify({alg:'ES256',kid:id})));
  const claims=b64(enc.encode(JSON.stringify({iss:'HDK7R3283T',iat:now})));
  const msg=header+'.'+claims;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(msg));
  const token=msg+'.'+b64(signature);
  cached={id,at:now,token};
  return token;
}
// PassKit docs specify the same pass-type certificate used to sign the pass.
// Some Edge runtimes disable custom TLS clients; in that case an explicitly
// configured APNs signing key is attempted and must be confirmed on device.
function certificateClient(){
  if(typeof Deno.createHttpClient!=='function')return null;
  const cert=(Deno.env.get('APPLE_PASS_CERT_PEM')||'').replace(/\\n/g,'\n');
  const key=(Deno.env.get('APPLE_PASS_PRIVATE_KEY_PEM')||'').replace(/\\n/g,'\n');
  if(!cert.includes('BEGIN CERTIFICATE')||!key.includes('PRIVATE KEY'))return null;
  try{return Deno.createHttpClient({cert,key})}catch{return null}
}
async function notifyDevice(token,jwt,client){
  const headers={ 'apns-topic':passTypeId,'apns-push-type':'background',
    'apns-priority':'5','content-type':'application/json' };
  if(!client)headers.authorization='bearer '+jwt;
  const response=await fetch('https://api.push.apple.com/3/device/'+encodeURIComponent(token),{
    method:'POST',headers,body:'{}',signal:AbortSignal.timeout(10000),
    ...(client?{client}:{})
  });
  const reason=response.ok?'':String((await response.json().catch(()=>({}))).reason||'apns_'+response.status);
  return {ok:response.ok,invalid:['BadDeviceToken','Unregistered'].includes(reason),reason};
}
// Only the internal pg_net / pg_cron worker can flush this queue.
// No customer details or messages are included in APNs: Wallet fetches signed passes.
export async function processPassUpdates(req,{admin}){
  const secret=req.headers.get('x-wallet-worker')||'';
  if(!secret)return respond(401,{error:'unauthorized'});
  const {data:allowed,error:ae}=await admin.rpc('wallet_check_worker',{p_secret:secret});
  if(ae||allowed!==true)return respond(401,{error:'unauthorized'});
  const {data:changes,error:ce}=await admin.from('apple_wallet_changes').select('card_id,revision')
    .eq('push_pending',true).order('revision').limit(25);
  if(ce)return respond(503,{error:'database_unavailable'});
  if(!changes?.length)return respond(200,{processed:0,pushed:0});
  const ids=changes.map(c=>c.card_id);
  const {data:regs,error:re}=await admin.from('apple_wallet_registrations').select('card_id,device_library_id').in('card_id',ids);
  if(re)return respond(503,{error:'database_unavailable'});
  let pushTokenByDevice=new Map();
  if(regs?.length){
    const deviceIds=[...new Set(regs.map(r=>r.device_library_id))];
    const {data:devices,error:de}=await admin.from('apple_wallet_devices').select('device_library_id,push_token').in('device_library_id',deviceIds);
    if(de)return respond(503,{error:'database_unavailable'});
    pushTokenByDevice=new Map((devices||[]).map(d=>[d.device_library_id,d.push_token]));
  }
  const client=regs?.length?certificateClient():null;
  const jwt=regs?.length&&!client?await apnsJwt():null;
  if(regs?.length&&!jwt&&!client)return respond(503,{error:'apns_transport_not_configured'});
  let processed=0,pushed=0,failed=0;
  // A changed version is acknowledged only if it has not advanced while we sent.
  for(const change of changes){
    const own=(regs||[]).filter(r=>r.card_id===change.card_id);
    let allOK=true;
    const unique=[...new Set(own.map(r=>pushTokenByDevice.get(r.device_library_id)).filter(Boolean))];
    for(const token of unique){
      try{
        const result=await notifyDevice(token,jwt,client);
        if(result.ok){pushed++;continue;}
        if(result.invalid){
          // A stale device token cannot continue blocking other registrations.
          await admin.from('apple_wallet_devices').delete().eq('push_token',token);
          continue;
        }
        allOK=false;failed++;
      }catch{allOK=false;failed++}
    }
    if(allOK){
      const {error}=await admin.from('apple_wallet_changes').update({push_pending:false})
        .eq('card_id',change.card_id).eq('revision',change.revision);
      if(!error)processed++;
    }
  }
  return respond(failed?503:200,{processed,pushed,failed});
}
