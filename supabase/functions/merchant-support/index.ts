import { createClient } from 'npm:@supabase/supabase-js@2';
const url = Deno.env.get('SUPABASE_URL')!;
const key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false } });
const site = 'https://cards.digitalprojectagency.fr';
const cors = {'access-control-allow-origin':site,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, x-client-info, content-type, x-merchant-id','cache-control':'no-store'};
const json = (status:number, value:Record<string,unknown>) => Response.json(value,{status,headers:cors});
const field = (x:unknown) => typeof x === 'string' ? x.trim() : '';
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST') return json(405,{error:'method_not_allowed'});
  const origin=req.headers.get('origin');
  if(origin && origin!==site) return json(403,{error:'origin_not_allowed'});
  const token=/^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!token) return json(401,{error:'not_authenticated'});
  try {
    const {data,error}=await db.auth.getUser(token);
    const user=data?.user;
    if(error || !user?.email_confirmed_at || !user.email) return json(401,{error:'not_authenticated'});
    if(user.factors?.some(f=>f.status==='verified')){
      const payload=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      if(JSON.parse(atob(payload)).aal!=='aal2') return json(403,{error:'mfa_required'});
    }
    const raw=await req.text();
    if(raw.length>8000) return json(413,{error:'message_too_long'});
    const body=JSON.parse(raw);
    const id=field(body?.merchantId), shop=field(body?.shop), subject=field(body?.subject), message=field(body?.message);
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
      !shop || shop.length>120 || /[\r\n]/.test(shop) || !subject || subject.length>130 || /[\r\n]/.test(subject) ||
      !message || message.length>4000) return json(422,{error:'invalid_support_request'});
    const {data:member,error:memberError}=await db.from('merchant_members').select('role, merchants(business_name)')
      .eq('merchant_id',id).eq('user_id',user.id).maybeSingle();
    if(memberError) return json(503,{error:'support_unavailable'});
    if(!member) return json(403,{error:'merchant_required'});
    const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('EMAIL_FROM');
    if(!apiKey || !from) return json(503,{error:'support_unavailable'});
    const linked=Array.isArray(member.merchants)?member.merchants[0]:member.merchants;
    const content='Commerce indiqué : '+shop+'\nCommerce du compte : '+(linked?.business_name||id)+'\nE-mail du compte : '+user.email+'\n\n'+message;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{
      authorization:'Bearer '+apiKey,'content-type':'application/json',
      'idempotency-key':'dpa-support/'+user.id+'/'+Math.floor(Date.now()/60000),
    },body:JSON.stringify({from,to:['contact@digitalprojectagency.fr'],reply_to:user.email,subject:'[DPA Cards] '+subject,text:content})});
    if(response.status===409 || response.status===429) return json(429,{error:'support_rate_limited'});
    if(!response.ok) { console.error('support email status',response.status);return json(502,{error:'support_send_failed'}); }
    return json(200,{ok:true});
  } catch(e) {
    if(e instanceof SyntaxError) return json(422,{error:'invalid_support_request'});
    return json(503,{error:'support_unavailable'});
  }
});
