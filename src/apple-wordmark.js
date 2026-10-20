// Optional DPA Cards Apple Wallet header: logo, merchant name and business type.
// Rendered once in the admin's browser at Retina 3x resolution.
// Classic mode still uses iOS native logoText and an independent logo PNG.
export const APPLE_WORDMARK_VERSION=5;
export const GOOGLE_WIDE_LOGO_VERSION=1;
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
 const hasSymbol=await drawArtwork(ctx,design?.assets?.logo?.url||'',1,1,47,47);
 const left=hasSymbol?52:2;
 const wordmark=design?.assets?.businessNameImage?.url||'';
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
 const symbol=await drawArtwork(ctx,design?.assets?.logo?.url||'',16,20,350,360);
 const left=symbol?392:24;
 const wordmark=await drawArtwork(ctx,design?.assets?.businessNameImage?.url||'',left,52,1280-left-24,296);
 if(!wordmark)throw new Error('Logo texte inaccessible : veuillez le réimporter.');
 const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!png||png.size>2097152)throw new Error('Logo Google Wallet trop lourd après préparation (2 Mo maximum).');
 return png;
}
