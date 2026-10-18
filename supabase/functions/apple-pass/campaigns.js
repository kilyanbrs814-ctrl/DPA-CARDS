// Merchant campaign dispatch for confirmed Apple Wallet installations.
// HTTP POST /apple-pass/notify is authenticated with the merchant's Supabase JWT.
// Queueing an APNs update is not proof it appeared on the customer's device.
const ORIGIN='https://cards.digitalprojectagency.fr';
const opts=req=>({origin:req.headers.get('origin')===ORIGIN?ORIGIN:'null',
  headers:'authorization, apikey, content-type, x-client-info, x-merchant-id',
  methods:'POST, OPTIONS'});
const cors=req=>{
  const o=opts(req);
  return {'access-control-allow-origin':o.origin,'access-control-allow-headers':o.headers,
    'access-control-allow-methods':o.methods,'vary':'Origin'};
};
const send=(req,status,data)=>new Response(JSON.stringify(data),{status,
  headers:{'content-type':'application/json','cache-control':'no-store',...cors(req)}});
const clean=(x,n)=>String(x??'').normalize('NFC').replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,n);
export async function notifyApple(req,{admin}){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=='POST')return send(req,405,{error:'method_not_allowed'});
  if(!Deno.env.get('APPLE_APNS_KEY_ID')||!Deno.env.get('APPLE_APNS_PRIVATE_KEY_PEM'))
    return send(req,503,{error:'apple_notifications_unavailable'});
  const bearer=(req.headers.get('authorization')||'').match(/^Bearer (\S+)$/i)?.[1];
  if(!bearer)return send(req,401,{error:'unauthorized'});
  const {data:{user},error:authError}=await admin.auth.getUser(bearer);
  if(authError||!user)return send(req,401,{error:'unauthorized'});
  const {data:members,error:membersError}=await admin.from('merchant_members').select('merchant_id,role').eq('user_id',user.id);
  if(membersError)return send(req,503,{error:'database_unavailable'});
  const choice=req.headers.get('x-merchant-id');
  let member=choice?members.find(m=>m.merchant_id===choice):null;
  if(!choice&&members.length===1)member=members[0];
  if(!member&&!choice&&members.length>1){
    const {data:account}=await admin.from('merchant_billing_accounts').select('primary_merchant_id').eq('owner_id',user.id).maybeSingle();
    member=members.find(m=>m.merchant_id===account?.primary_merchant_id);
  }
  if(!member)return send(req,403,{error:'forbidden'});
  const mid=member.merchant_id;
  const {data:active,error:activeError}=await admin.rpc('merchant_has_access',{p_merchant:mid});
  if(activeError||active!==true)return send(req,403,{error:'subscription_required'});
  const b=await req.json().catch(()=>({}));
  const title=clean(b.title,60),body=clean(b.body,200);
  if(!title||!body)return send(req,422,{error:!title?'empty_title':'empty_body'});
  const audience=String(b.audience||'');
  if(!['all','reward','near','inactive','selected'].includes(audience))
    return send(req,422,{error:'invalid_audience'});
  const kind=['points','reward','message'].includes(b.kind)?b.kind:'message';
  const ids=audience==='selected'&&Array.isArray(b.card_ids)?
    [...new Set(b.card_ids.map(x=>String(x).toLowerCase()))]:[];
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if(audience==='selected'&&(!ids.length||ids.length>2000||ids.some(id=>!uuid.test(id))))
    return send(req,422,{error:'invalid_card'});
  if(ids.length){
    let count=0;
    for(let i=0;i<ids.length;i+=150){
      const {count:n,error}=await admin.from('cards').select('id',{head:true,count:'exact'}).eq('merchant_id',mid).in('id',ids.slice(i,i+150));
      if(error)return send(req,503,{error:'database_unavailable'});
      count+=n||0;
    }
    if(count!==ids.length)return send(req,403,{error:'forbidden_card'});
  }
  const input={title,body,kind,audience,card_ids:ids,notify:true,platform:'apple',status:'sending',merchant_id:mid,created_by:user.id,error:null};
  let row;
  if(b.draft_id&&uuid.test(String(b.draft_id))){
    const {data,error}=await admin.from('notifications').update(input).eq('id',b.draft_id)
      .eq('merchant_id',mid).eq('status','draft').select('id').maybeSingle();
    if(error||!data)return send(req,404,{error:'notification_not_found'});
    row=data;
  }else{
    const {data,error}=await admin.from('notifications').insert(input).select('id').single();
    if(error)return send(req,503,{error:'db_notifications'});
    row=data;
  }
  const finish=async fields=>admin.from('notifications').update({...fields,sent_at:new Date().toISOString()}).eq('id',row.id);
  try{
    const {data:targets,error:te}=await admin.rpc('notification_targets',{p_merchant:mid,p_audience:audience,p_card_ids:ids});
    if(te)throw new Error('db_targets');
    const list=targets||[];
    const registered=new Set();
    for(let i=0;i<list.length;i+=150){
      const cardIds=list.slice(i,i+150).map(x=>x.card_id);
      const {data,error}=await admin.from('apple_wallet_registrations').select('card_id').in('card_id',cardIds);
      if(error)throw new Error('db_registrations');
      for(const r of data||[])registered.add(r.card_id);
    }
    const deliveries=[];
    for(const card of list){
      if(!registered.has(card.card_id)){
        deliveries.push({card_id:card.card_id,status:'no_wallet',error:null});
      }else{
        const {data,error}=await admin.rpc('apple_wallet_queue_notice',{
          p_card:card.card_id,p_message:(title+' — '+body).slice(0,200),
        });
        deliveries.push({card_id:card.card_id,status:!error&&data===true?'queued':'failed',
          error:error?'apple_queue_failed':null});
      }
    }
    for(let i=0;i<deliveries.length;i+=200){
      const {error}=await admin.from('notification_deliveries').insert(deliveries.slice(i,i+200).map(d=>({
        notification_id:row.id,card_id:d.card_id,merchant_id:mid,platform:'apple',status:d.status,error:d.error,
      })));
      if(error)throw new Error('db_deliveries');
    }
    const queued=deliveries.filter(x=>x.status==='queued').length;
    const failed=deliveries.filter(x=>x.status==='failed').length;
    const noWallet=deliveries.filter(x=>x.status==='no_wallet').length;
    const status=queued?(failed?'partial':'sent'):'failed';
    await finish({status,targeted:list.length,sent_count:queued,apple_queued_count:queued,
      failed_count:failed,no_wallet_count:noWallet,error:queued?null:noWallet?'no_wallet':'apple_queue_failed'});
    return send(req,200,{notification_id:row.id,status,targeted:list.length,sent:queued,appleQueued:queued,googleSent:0,failed,quotaExceeded:0,noWallet});
  }catch{
    await finish({status:'failed',error:'apple_queue_failed'});
    return send(req,503,{error:'apple_queue_failed'});
  }
}
