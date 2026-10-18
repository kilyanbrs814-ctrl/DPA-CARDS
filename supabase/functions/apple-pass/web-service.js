import { passTypeId, passAuthToken, validPassToken } from './auth.js';

// Official Apple Wallet PassKit web-service protocol.
// Called by Wallet itself (not by the merchant web app).
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const empty=status=>new Response(null,{status,headers:{'cache-control':'no-store'}});
const bad=(status,message)=>json(status,{error:message});
function segments(req){
  const p=new URL(req.url).pathname;
  const i=p.indexOf('/v1/');
  return i<0?[]:p.slice(i+4).split('/').map(x=>{try{return decodeURIComponent(x)}catch{return ''}});
}
async function authorized(admin,cardId,req,signerKey){
  if(!UUID.test(cardId))return false;
  const actual=req.headers.get('authorization')||'';
  const expected=await passAuthToken(cardId,signerKey);
  if(!actual.startsWith('ApplePass ')||!validPassToken(actual.slice(10),expected))return false;
  const {data,error}=await admin.from('cards').select('id').eq('id',cardId).maybeSingle();
  return !error&&!!data;
}
export async function handlePasskit(req,{admin,signerKey,renderPass}) {
  const p=segments(req);
  if(p.length===0)return bad(404,'not_found');
  if(!signerKey)return bad(503,'apple_wallet_not_configured');
  // POST /v1/devices/{id}/registrations/{passType}/{serial}
  if(p.length===5&&p[0]==='devices'&&p[2]==='registrations'&&p[3]===passTypeId&&['POST','DELETE'].includes(req.method)){
    const [device,cardId]=[p[1],p[4]];
    if(!ID.test(device)||!await authorized(admin,cardId,req,signerKey))return bad(401,'unauthorized');
    if(req.method==='DELETE'){
      const {error}=await admin.from('apple_wallet_registrations').delete().eq('device_library_id',device).eq('card_id',cardId);
      return error?bad(503,'database_unavailable'):empty(200);
    }
    const body=await req.json().catch(()=>({}));
    const token=String(body.pushToken||'');
    if(!/^[A-Za-z0-9_-]{16,512}$/.test(token))return bad(400,'invalid_push_token');
    const {data:prior,error:priorError}=await admin.from('apple_wallet_registrations').select('card_id').eq('device_library_id',device).eq('card_id',cardId).maybeSingle();
    if(priorError)return bad(503,'database_unavailable');
    const {error:deviceError}=await admin.from('apple_wallet_devices').upsert({device_library_id:device,push_token:token,updated_at:new Date().toISOString()},{onConflict:'device_library_id'});
    if(deviceError)return bad(503,'database_unavailable');
    const {error:registrationError}=await admin.from('apple_wallet_registrations').upsert({device_library_id:device,card_id:cardId},{onConflict:'device_library_id,card_id'});
    if(registrationError)return bad(503,'database_unavailable');
    const {error:versionError}=await admin.from('apple_wallet_changes').upsert({card_id:cardId,push_pending:false},{onConflict:'card_id',ignoreDuplicates:true});
    if(versionError)return bad(503,'database_unavailable');
    return empty(prior?200:201);
  }
  // GET /v1/devices/{id}/registrations/{passType}?passesUpdatedSince={revision}
  if(p.length===4&&p[0]==='devices'&&p[2]==='registrations'&&p[3]===passTypeId&&req.method==='GET'){
    const device=p[1];if(!ID.test(device))return bad(400,'invalid_device');
    const {data:rows,error}=await admin.from('apple_wallet_registrations').select('card_id').eq('device_library_id',device);
    if(error)return bad(503,'database_unavailable');
    if(!rows?.length)return empty(204);
    const since=new URL(req.url).searchParams.get('passesUpdatedSince');
    if(since!==null&&!/^(0|[1-9][0-9]{0,18})$/.test(since))return bad(400,'invalid_revision');
    let q=admin.from('apple_wallet_changes').select('card_id,revision')
      .in('card_id',rows.map(r=>r.card_id)).order('revision',{ascending:true});
    if(since!==null)q=q.gt('revision',since);
    const {data:changed,error:ce}=await q;
    if(ce)return bad(503,'database_unavailable');
    if(!changed?.length)return empty(204);
    return json(200,{serialNumbers:changed.map(x=>x.card_id),lastUpdated:String(changed[changed.length-1].revision)});
  }
  // GET /v1/passes/{passType}/{serial}
  if(p.length===3&&p[0]==='passes'&&p[1]===passTypeId&&req.method==='GET'){
    const cardId=p[2];
    if(!await authorized(admin,cardId,req,signerKey))return bad(401,'unauthorized');
    try{
      const {pkpass}=await renderPass(cardId);
      return new Response(new Uint8Array(pkpass),{status:200,headers:{'content-type':'application/vnd.apple.pkpass','cache-control':'private,no-store','last-modified':new Date().toUTCString()}});
    }catch{return bad(503,'pass_unavailable')}
  }
  // Apple can report malformed pass logs; do not store potentially sensitive payloads.
  if(p.length===1&&p[0]==='log'&&req.method==='POST')return empty(200);
  return bad(404,'not_found');
}
