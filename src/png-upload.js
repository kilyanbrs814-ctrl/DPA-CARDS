import { decodePng } from '../supabase/functions/_shared/png.js';
export async function preparePngUpload(file) {
  if(file.type!=='image/png' || file.size>2097152)throw new Error('PNG uniquement, 2 Mo maximum.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  let decoded;
  try { decoded=await decodePng(bytes); } catch { throw new Error('PNG invalide : utilisez un PNG 8 bits non entrelacé, de 2048 × 2048 px maximum.'); }
  const ratio=Math.min(1,1024/decoded.width,1024/decoded.height);
  const source=document.createElement('canvas');source.width=decoded.width;source.height=decoded.height;
  source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(decoded.pixels),decoded.width,decoded.height),0,0);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(decoded.width*ratio));canvas.height=Math.max(1,Math.round(decoded.height*ratio));
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob || blob.size>2097152)throw new Error('PNG trop lourd après préparation.');
  return blob;
}
