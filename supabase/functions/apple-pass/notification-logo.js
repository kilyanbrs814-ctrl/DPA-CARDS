// A dedicated 600x600 PNG for Apple Wallet notification icons.
// This is a merchant-scoped setting and does not change the card's header artwork.
const ORIGINS=new Set(['https://cards.digitalprojectagency.fr','capacitor://localhost']);
const cors=req=>({
  'access-control-allow-origin':ORIGINS.has(req.headers.get('origin'))?req.headers.get('origin'):'null',
  'access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-merchant-id',
  'access-control-allow-methods':'POST, OPTIONS','vary':'Origin',
});
const respond=(req,status,data)=>new Response(JSON.stringify(data),{
  status,headers:{...cors(req),'cache-control':'no-store','content-type':'application/json'},
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function manageNotificationLogo(req,{admin,decodePng}){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=='POST')return respond(req,405,{error:'method_not_allowed'});
  const bearer=(req.headers.get('authorization')||'').match(/^Bearer (\S+)$/i)?.[1];
  if(!bearer)return respond(req,401,{error:'unauthorized'});
  const {data:{user},error:authError}=await admin.auth.getUser(bearer);
  if(authError||!user)return respond(req,401,{error:'unauthorized'});
  const {data:members,error:me}=await admin.from('merchant_members').select('merchant_id,role,permissions').eq('user_id',user.id);
  if(me)return respond(req,503,{error:'database_unavailable'});
  const choice=req.headers.get('x-merchant-id');
  let member=choice?members.find(m=>m.merchant_id===choice):null;
  if(!choice&&members.length===1)member=members[0];
  if(!choice&&members.length>1){
    const {data:account}=await admin.from('merchant_billing_accounts').select('primary_merchant_id')
      .eq('owner_id',user.id).maybeSingle();
    member=members.find(m=>m.merchant_id===account?.primary_merchant_id);
  }
  if(!member||!UUID.test(member.merchant_id))return respond(req,403,{error:'forbidden'});
  if(member.role!=='owner'&&member.permissions?.notifications!==true)
    return respond(req,403,{error:'employee_permission_denied'});
  const mid=member.merchant_id;
  const {data:active,error:ae}=await admin.rpc('merchant_has_access',{p_merchant:mid});
  if(ae||active!==true)return respond(req,403,{error:'subscription_required'});
  const {data:program,error:pe}=await admin.from('programs').select('id,notification_logo_path')
    .eq('merchant_id',mid).eq('is_active',true).maybeSingle();
  if(pe)return respond(req,503,{error:'database_unavailable'});
  if(!program)return respond(req,404,{error:'program_not_found'});
  const old=program.notification_logo_path;
  const type=req.headers.get('content-type')||'';
  if(type.includes('application/json')){
    const body=await req.json().catch(()=>({}));
    if(body?.action!=='remove')return respond(req,422,{error:'invalid_request'});
    const {error}=await admin.from('programs').update({notification_logo_path:null}).eq('id',program.id).eq('merchant_id',mid);
    if(error)return respond(req,503,{error:'database_unavailable'});
    if(old)await admin.storage.from('program-assets').remove([old]).catch(()=>{});
    return respond(req,200,{notification_logo_path:null});
  }
  if(!type.includes('multipart/form-data'))return respond(req,415,{error:'invalid_image_type'});
  const form=await req.formData().catch(()=>null);
  const file=form?.get('logo');
  if(!file||typeof file.arrayBuffer!=='function'||file.type!=='image/png'||file.size>2_000_000||file.size<64)
    return respond(req,422,{error:'invalid_notification_logo'});
  let bytes;
  try{
    bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length<24||!([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)))
      return respond(req,422,{error:'invalid_notification_logo'});
    const decoded=await decodePng(bytes);
    if(decoded.width!==600||decoded.height!==600)
      return respond(req,422,{error:'notification_logo_dimensions'});
  }catch{
    return respond(req,422,{error:'invalid_notification_logo'});
  }
  const path=mid+'/'+program.id+'/notification-logo-'+crypto.randomUUID()+'.png';
  const {error:upError}=await admin.storage.from('program-assets').upload(path,bytes,
    {contentType:'image/png',cacheControl:'31536000',upsert:false});
  if(upError)return respond(req,503,{error:'logo_upload_failed'});
  const {error:writeError}=await admin.from('programs').update({notification_logo_path:path})
    .eq('id',program.id).eq('merchant_id',mid);
  if(writeError){
    await admin.storage.from('program-assets').remove([path]).catch(()=>{});
    return respond(req,503,{error:'database_unavailable'});
  }
  if(old)await admin.storage.from('program-assets').remove([old]).catch(()=>{});
  return respond(req,200,{notification_logo_path:path});
}
