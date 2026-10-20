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

/** Merchants upload text artwork only; reject a background rectangle or blank PNG. */
export async function prepareBusinessNamePng(file) {
  const png=await preparePngUpload(file);
  const img=await decodePng(new Uint8Array(await png.arrayBuffer()));
  let hasInk=false,hasTransparent=false;
  for(let i=3;i<img.pixels.length;i+=4){
    if(img.pixels[i]>=8)hasInk=true;
    if(img.pixels[i]<255)hasTransparent=true;
    if(hasInk&&hasTransparent)break;
  }
  if(!hasInk||!hasTransparent)throw new Error('Image du nom : PNG transparent avec du texte visible obligatoire (sans fond).');
  return png;
}

/** Google Wallet's circular program logo requires a square PNG >=660px.
 * Prepare a 660px square with the complete uploaded logo, preserving its original colors and alpha. */
export async function prepareGoogleLogoPng(file) {
  const original=await preparePngUpload(file);
  const img=await decodePng(new Uint8Array(await original.arrayBuffer()));
  const source=document.createElement('canvas');
  source.width=img.width;source.height=img.height;
  source.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(img.pixels),img.width,img.height),0,0);
  const result=document.createElement('canvas');
  result.width=660;result.height=660;
  const scale=Math.min(660/img.width,660/img.height);
  const w=img.width*scale,h=img.height*scale;
  const ctx=result.getContext('2d');
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,(660-w)/2,(660-h)/2,w,h);
  const png=await new Promise(resolve=>result.toBlob(resolve,'image/png'));
  if(!png || png.size>2097152)throw new Error('Logo Google Wallet trop lourd (2 Mo maximum).');
  return png;
}
