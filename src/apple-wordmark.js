// Optional DPA Cards Apple Wallet header: logo, merchant name and business type.
// Rendered once in the admin's browser at Retina 3x resolution.
// Classic mode still uses iOS native logoText and an independent logo PNG.
export const APPLE_WORDMARK_VERSION=6;
export const GOOGLE_WIDE_LOGO_VERSION=2;
const WIDTH=160,HEIGHT=50,SCALE=3;
const FONT='"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const validHex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#FFFFFF';
function luminance(hex) {
 const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function foreground(design) {
 const bg=validHex(design.apple?.colors?.primary||design.colors?.primary||'#1C1F24');
 const prefer=validHex(design.apple?.colors?.text||design.colors?.text||'#FFFFFF');
 const contrast=c=>{const a=luminance(c),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
 return contrast(prefer)>=4.5?prefer:(contrast('#FFFFFF')>contrast('#1C1F24')?'#FFFFFF':'#1C1F24');
}
const clean=(value,max)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
async function loadLogo(url) {
 if(!url)return null;
 const response=await fetch(url,{credentials:'omit',mode:'cors'});
 if(!response.ok)throw new Error('Logo inaccessible : veuillez le réimporter.');
 const blob=await response.blob();
 if(blob.size>2097152)throw new Error('Logo trop lourd : 2 Mo maximum.');
 if(typeof createImageBitmap==='function')return createImageBitmap(blob);
 const object=URL.createObjectURL(blob);
 try {
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=object;});
  return img;
 } finally {URL.revokeObjectURL(object);}
}

/** Contain transparent artwork without baking in a square background.
 * Bounding the alpha content also removes padding present in uploaded PNGs. */
async function drawArtwork(ctx,url,x,y,width,height) {
 const img=await loadLogo(url);
 if(!img)return false;
 try {
  const source=document.createElement('canvas');
  source.width=img.width;source.height=img.height;
  const scan=source.getContext('2d',{willReadFrequently:true});
  if(!scan)throw new Error('Logo non lisible.');
  scan.drawImage(img,0,0);
  const pixels=scan.getImageData(0,0,img.width,img.height).data;
  let x0=img.width,y0=img.height,x1=-1,y1=-1;
  for(let row=0;row<img.height;row++)for(let col=0;col<img.width;col++){
   if(pixels[(row*img.width+col)*4+3]<8)continue;
   if(col<x0)x0=col;if(col>x1)x1=col;
   if(row<y0)y0=row;if(row>y1)y1=row;
  }
  if(x1<x0)return false;
  const sw=x1-x0+1,sh=y1-y0+1,factor=Math.min(width/sw,height/sh);
  const w=sw*factor,h=sh*factor;
  ctx.drawImage(source,x0,y0,sw,sh,x+(width-w)/2,y+(height-h)/2,w,h);
  return true;
 } finally {if(typeof img.close==='function')img.close();}
}

function sizeThatFits(ctx,value,available,max,min,weight) {
 for(let size=max;size>=min;size--) {
  ctx.font=weight+' '+size+'px '+FONT;
  if(ctx.measureText(value).width<=available)return size;
 }
 return min;
}
export async function createAppleWordmark(design) {
 const canvas=document.createElement('canvas');
 canvas.width=WIDTH*SCALE;canvas.height=HEIGHT*SCALE;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw new Error('Impossible de préparer l’en-tête Apple Wallet.');
 ctx.scale(SCALE,SCALE);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 // When a wordmark exists, make the pictogram more compact to prioritize readable lettering.
 // Apple's entire logo artwork is capped at 160 x 50 pt.
 const wordmark=design?.assets?.businessNameImage?.url||'';
 const hasSymbol=await drawArtwork(ctx,design?.assets?.logo?.url||'',1,wordmark?9:1,wordmark?31:47,wordmark?31:47);
 const left=hasSymbol?(wordmark?36:52):2;
 if(wordmark) {
  const rendered=await drawArtwork(ctx,wordmark,left+1,4,WIDTH-left-3,HEIGHT-8);
  if(rendered) {
   const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!png||png.size>2097152)throw new Error('Image Apple Wallet trop lourde après préparation.');
   return png;
  }
 }
 const width=WIDTH-left-2;
 const title=clean(design?.identity?.name,40)||'DPA Cards';
 const subtitle=design?.apple?.showSubtitle===false?'':clean(design?.identity?.subtitle,40);
 ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=foreground(design);
 if(subtitle) {
  const size=sizeThatFits(ctx,title,width,21,14,750);
  ctx.font='750 '+size+'px '+FONT;
  ctx.fillText(title,left,17,width);
  ctx.font='500 8.7px '+FONT;
  ctx.fillText(subtitle.toLocaleUpperCase('fr-FR'),left,35,width);
 } else {
  const size=sizeThatFits(ctx,title,width,25,15,750);
  ctx.font='750 '+size+'px '+FONT;
  ctx.fillText(title,left,HEIGHT/2,width);
 }
 const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!png||png.size>2097152)throw new Error('Image Apple Wallet trop lourde après préparation.');
 return png;
}

/** Google Wallet loyaltyClass.wideProgramLogo: transparent 16:5 artwork.
 * The native account/card-number field stays under Google's control. */
export async function createGoogleWideLogo(design) {
 const canvas=document.createElement('canvas');
 canvas.width=1280;canvas.height=400;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw new Error('Impossible de préparer le logo large Google Wallet.');
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 // Reserve a smaller icon so long horizontal names have almost the entire logo width.
 const symbol=await drawArtwork(ctx,design?.assets?.logo?.url||'',16,88,222,224);
 const left=symbol?250:24;
 const wordmark=await drawArtwork(ctx,design?.assets?.businessNameImage?.url||'',left,24,1280-left-18,352);
 if(!wordmark)throw new Error('Logo texte inaccessible : veuillez le réimporter.');
 const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!png||png.size>2097152)throw new Error('Logo Google Wallet trop lourd après préparation (2 Mo maximum).');
 return png;
}

/** Render-time only: ignore transparent PNG padding without changing the merchant's original.
 * Older uploaded artwork stays valid; new and old imports get the same tight preview. */
const tightWordmarkCache=new Map();
export function tightWordmarkPreview(url) {
 if(!url)return Promise.resolve('');
 if(tightWordmarkCache.has(url))return tightWordmarkCache.get(url);
 const task=(async()=>{
  const img=await loadLogo(url);
  if(!img)return url;
  try{
   const canvas=document.createElement('canvas');
   canvas.width=img.width;canvas.height=img.height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx)return url;
   ctx.drawImage(img,0,0);
   const data=ctx.getImageData(0,0,img.width,img.height).data;
   let left=img.width,top=img.height,right=-1,bottom=-1;
   for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){
    if(data[(y*img.width+x)*4+3]<8)continue;
    if(x<left)left=x;if(x>right)right=x;
    if(y<top)top=y;if(y>bottom)bottom=y;
   }
   if(right<left)return url;
   const inset=1;
   left=Math.max(0,left-inset);top=Math.max(0,top-inset);
   right=Math.min(img.width-1,right+inset);bottom=Math.min(img.height-1,bottom+inset);
   const cropped=document.createElement('canvas');
   cropped.width=right-left+1;cropped.height=bottom-top+1;
   cropped.getContext('2d').drawImage(canvas,left,top,cropped.width,cropped.height,0,0,cropped.width,cropped.height);
   return cropped.toDataURL('image/png');
  } finally {if(typeof img.close==='function')img.close();}
 })();
 tightWordmarkCache.set(url,task);
 return task;
}
