// Server-side whitelist: uploaded merchant paths must never be replaced by arbitrary URLs.
// These PNG assets are versioned with the frontend at cards.digitalprojectagency.fr.
import { decodePng } from './png.js';
const IDS = 'pizza baguette glace donut riz-crousty ciseaux fleuriste barber burger the carwash spa vernis patte fitness poulet bubble-tea tacos kebab sushi crepe croissant cafe milkshake cookie maquillage sneaker shopping bijouterie vetements telephonie pneumatique animalerie'.split(' ');
export const LIBRARY_STAMP_IDS = Object.freeze(IDS);
const allowed = new Set(IDS);
export function libraryStampId(value) { return typeof value==='string' && allowed.has(value) ? value : ''; }
const cache = new Map();
export async function loadLibraryStamp(value) {
  const id=libraryStampId(value);
  if (!id) return null;
  if (!cache.has(id)) {
    cache.set(id,(async()=>{
      const url='https://cards.digitalprojectagency.fr/assets/stamps/'+id+'.png';
      const r=await fetch(url,{signal:AbortSignal.timeout(6000),redirect:'error'});
      if(!r.ok || !String(r.headers.get('content-type')||'').includes('image/png'))throw new Error('library_stamp_not_available');
      if(Number(r.headers.get('content-length')||0)>2000000)throw new Error('library_stamp_oversized');
      const bytes=new Uint8Array(await r.arrayBuffer());
      if(bytes.byteLength>2000000)throw new Error('library_stamp_oversized');
      return await decodePng(bytes,{maxBytes:2000000,maxDimension:512});
    })().catch(()=>{cache.delete(id);return null}));
  }
  return cache.get(id);
}
