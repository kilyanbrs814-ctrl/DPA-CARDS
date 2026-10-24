import {createClient} from 'npm:@supabase/supabase-js@2';
import {decodePng,crc32} from '../_shared/png.js';

const supa=Deno.env.get('SUPABASE_URL')||'';
function secretKey() {
  try { const j=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(j.default)return j.default; } catch {}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
const admin=createClient(supa,secretKey(),{auth:{persistSession:false,autoRefreshToken:false}});
const DRIVE_FOLDER='1vSy2iXweuL8325u4a8-5mLlCdBj0_c3-';
const MAX_INPUT=4_000_000;
const MAX_BODY=5_600_000;
const MAX_SIDE=512;
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS',
 'access-control-allow-headers':'content-type,x-dpa-stamp-token','cache-control':'no-store','x-content-type-options':'nosniff'};
function reply(code:number,data:unknown){return new Response(JSON.stringify(data),{status:code,headers:{'content-type':'application/json',...cors}});}
function u32(n:number){return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function join(parts:Uint8Array[]){const l=parts.reduce((n,v)=>n+v.length,0),out=new Uint8Array(l);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function chunk(name:string,data:Uint8Array){const typ=new TextEncoder().encode(name);return join([u32(data.length),typ,data,u32(crc32(join([typ,data])))]);}
async function normalisePng(bytes:Uint8Array){
  const png=await decodePng(bytes,{maxBytes:MAX_INPUT,maxDimension:2048});
  const scale=Math.min(1,MAX_SIDE/Math.max(png.width,png.height));
  const w=Math.max(1,Math.round(png.width*scale)),h=Math.max(1,Math.round(png.height*scale));
  const raw=new Uint8Array(h*(1+w*4));
  for(let y=0;y<h;y++){
    const sy=Math.min(png.height-1,Math.floor(y/scale)),row=y*(1+w*4);
    for(let x=0;x<w;x++){
      const sx=Math.min(png.width-1,Math.floor(x/scale)),src=(sy*png.width+sx)*4;
      raw.set(png.pixels.subarray(src,src+4),row+1+x*4);
    }
  }
  const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  return join([new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk('IHDR',join([u32(w),u32(h),new Uint8Array([8,6,0,0,0])])),
    chunk('IDAT',compressed),chunk('IEND',new Uint8Array())]);
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const path=new URL(req.url).pathname;
  try{
    if(req.method==='GET'&&path.endsWith('/stamp-sync/catalog')){
      const {data,error}=await admin.from('drive_stamp_catalog').select('id,label,imported_at').eq('enabled',true).order('label').limit(1000);
      if(error)throw Error('catalog_query_failed');
      return reply(200,{items:(data||[]).map(p=>({id:p.id,label:p.label,
        url:supa+'/storage/v1/object/public/program-assets/stamp-library/'+p.id+'.png',imported_at:p.imported_at}))});
    }
    if(req.method!=='POST'||!path.endsWith('/stamp-sync/import'))return reply(404,{error:'not_found'});
    const token=req.headers.get('x-dpa-stamp-token')||'';
    if(!/^[a-f0-9]{64}$/i.test(token))return reply(401,{error:'unauthorized'});
    const {data:verified,error:verifyError}=await admin.rpc('verify_drive_stamp_sync',{p_folder:DRIVE_FOLDER,p_token:token});
    if(verifyError||verified!==true)return reply(401,{error:'unauthorized'});
    if(Number(req.headers.get('content-length')||0)>MAX_BODY)return reply(413,{error:'oversized'});
    const bodyText=await req.text();if(bodyText.length>MAX_BODY)return reply(413,{error:'oversized'});
    const body=JSON.parse(bodyText);
    const fileId=String(body?.fileId||'');
    const fileName=String(body?.fileName||'');
    const modifiedTime=String(body?.modifiedTime||'');
    if(!/^[\w-]{10,120}$/.test(fileId)||!fileName.toLowerCase().endsWith('.png')||fileName.length>150
      ||!/^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(modifiedTime))return reply(422,{error:'invalid_metadata'});
    const id='gd-'+fileId,storagePath='stamp-library/'+id+'.png';
    const {data:existing,error:exErr}=await admin.from('drive_stamp_catalog')
      .select('modified_time').eq('id',id).maybeSingle();
    if(exErr)throw Error('metadata_query_failed');
    if(existing?.modified_time&&new Date(existing.modified_time).getTime()>=new Date(modifiedTime).getTime())
      return reply(200,{status:'unchanged',id});
    const base64=String(body?.base64||'');
    if(base64.length>Math.ceil(MAX_INPUT*4/3)+8 || !/^[\w+/=]+$/.test(base64))return reply(413,{error:'oversized'});
    const bytes=Uint8Array.from(atob(base64.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    if(bytes.length>MAX_INPUT)return reply(413,{error:'oversized'});
    let png:Uint8Array;
    try{png=await normalisePng(bytes);}catch(e){return reply(422,{error:'invalid_png'});}
    const {error:storageError}=await admin.storage.from('program-assets').upload(storagePath,png,{
      contentType:'image/png',upsert:true,cacheControl:'300'});
    if(storageError)throw Error('storage_upload_failed');
    const label=fileName.slice(0,-4).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,100)||'Tampon';
    const {error:recordError}=await admin.from('drive_stamp_catalog').upsert({
      id,drive_file_id:fileId,label,storage_path:storagePath,modified_time:new Date(modifiedTime).toISOString(),enabled:true,
      imported_at:new Date().toISOString()}, {onConflict:'id'});
    if(recordError)throw Error('metadata_save_failed');
    return reply(200,{status:'imported',id,label});
  }catch(e){
    console.error('stamp-sync error',e instanceof Error?e.message:'unknown');
    return reply(500,{error:'sync_failed'});
  }
});
