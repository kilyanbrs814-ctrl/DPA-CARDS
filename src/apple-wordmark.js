// Compose the Apple logo + an enlarged, system-style merchant name once in the
// admin's browser, NOT during pass signing (Supabase Edge CPU is tightly limited).
// The complete brand is centered vertically in Apple's existing 160x50pt logo slot.
// No native logoText is emitted for these cards: native text size is not configurable.
// Increment when saved rasterized headers must be rebuilt (legacy assets may wrap).
export const APPLE_WORDMARK_VERSION=2;
const WIDTH=160,HEIGHT=50,SCALE=3;
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:'#FFFFFF';
const luminance=color=>{
  const n=hex(color).slice(1);
  const [r,g,b]=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*r+0.7152*g+0.0722*b;
};
function foreground(d) {
  const bg=hex(d.apple?.colors?.primary||d.colors?.primary||'#1C1F24');
  const preferred=hex(d.apple?.colors?.text||d.colors?.text||'#FFFFFF');
  const contrast=c=>{const x=luminance(c),y=luminance(bg);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
  if(contrast(preferred)>=4.5)return preferred;
  return contrast('#FFFFFF')>contrast('#1C1F24')?'#FFFFFF':'#1C1F24';
}
// A single line is mandatory. Never split a merchant name across two lines.
const PRESETS={
  system:'-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Arial, sans-serif',
  space:'"Space Grotesk", system-ui, sans-serif',
  playfair:'"Playfair Display", Georgia, serif',
  hanken:'"Hanken Grotesk", system-ui, sans-serif',
};
const loadedFonts=new Map();
export async function resolveBusinessFont(design){
  const choice=String(design?.apple?.businessNameFont||'system');
  if(choice!=='custom')return PRESETS[choice]||PRESETS.system;
  const url=design?.assets?.businessFont?.url;
  if(!url)throw new Error('Importez une police pour le nom du commerce.');
  if(!loadedFonts.has(url))loadedFonts.set(url,(async()=>{
    const r=await fetch(url,{credentials:'omit',mode:'cors'});
    if(!r.ok)throw new Error('Police inaccessible : veuillez la réimporter.');
    const bytes=await r.arrayBuffer();
    if(bytes.byteLength>1048576)throw new Error('Police trop lourde (1 Mo maximum).');
    const family='DpaMerchant'+loadedFonts.size;
    const face=new FontFace(family,bytes,{style:'normal',weight:'400 900'});
    await face.load();
    document.fonts.add(face);
    return '"'+family+'"';
  })().catch(e=>{loadedFonts.delete(url);throw e}));
  return loadedFonts.get(url);
}
function singleLine(ctx,name,available,family){
  const apply=size=>{ctx.font=`700 ${size}px ${family}`;};
  for(let size=23;size>=11;size--){apply(size);if(ctx.measureText(name).width<=available)return {text:name,size};}
  apply(11);
  let shortened=name;
  while(shortened.length>1&&ctx.measureText(shortened+'…').width>available)shortened=shortened.slice(0,-1).trimEnd();
  return {text:shortened===name?name:shortened+'…',size:11};
}

async function imageFromUrl(url){
  if(!url)return null;
  const response=await fetch(url,{mode:'cors',credentials:'omit'});
  if(!response.ok)throw new Error('Logo inaccessible : veuillez le réimporter.');
  const blob=await response.blob();
  if(blob.size>2097152)throw new Error('Logo trop lourd : 2 Mo maximum.');
  if(typeof createImageBitmap==='function')return createImageBitmap(blob);
  const object=URL.createObjectURL(blob);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=object;});
    return img;
  }finally{URL.revokeObjectURL(object);}
}
export async function createAppleWordmark(design) {
  const name=String(design?.identity?.name||'DPA Cards').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,40)||'DPA Cards';
  const canvas=document.createElement('canvas');
  canvas.width=WIDTH*SCALE;canvas.height=HEIGHT*SCALE;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Impossible de préparer le logo Apple Wallet.');
  ctx.scale(SCALE,SCALE);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const img=await imageFromUrl(design?.assets?.logo?.url||'');
  let textLeft=1;
  if(img){
    // Respect transparent edges and preserve the logo's original aspect ratio.
    const iw=img.width,ih=img.height;
    const source=document.createElement('canvas');
    source.width=iw;source.height=ih;
    const sc=source.getContext('2d',{willReadFrequently:true});
    sc.drawImage(img,0,0);
    const data=sc.getImageData(0,0,iw,ih).data;
    let x0=iw,y0=ih,x1=-1,y1=-1;
    for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
      if(data[(y*iw+x)*4+3]<8)continue;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    }
    if(x1>=x0){
      const sw=x1-x0+1,sh=y1-y0+1;
      const factor=Math.min(46/sw,46/sh);
      const dw=sw*factor,dh=sh*factor;
      ctx.drawImage(source,x0,y0,sw,sh,2+(46-dw)/2,(HEIGHT-dh)/2,dw,dh);
      textLeft=54;
    }
    if(typeof img.close==='function')img.close();
  }
  const area=WIDTH-textLeft-2;
  // The original logo stays separate in the editor. Apple's fixed header
  // receives one combined 160×50pt bitmap, so no native logoText can wrap.
  if(design?.assets?.businessNameImage?.url) {
    const wordmark=await imageFromUrl(design.assets.businessNameImage.url);
    const source=document.createElement('canvas');
    source.width=wordmark.width;source.height=wordmark.height;
    const sc=source.getContext('2d',{willReadFrequently:true});
    if(!sc)throw new Error('Image du nom impossible à lire.');
    sc.drawImage(wordmark,0,0);
    const data=sc.getImageData(0,0,source.width,source.height).data;
    let x0=source.width,y0=source.height,x1=-1,y1=-1,transparent=false;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const a=data[(y*source.width+x)*4+3];
      if(a<255)transparent=true;
      if(a<8)continue;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    }
    if(!transparent||x1<x0)throw new Error('Importez un PNG du nom avec fond transparent et lettres visibles.');
    const w=x1-x0+1,h=y1-y0+1,ratio=Math.min(area/w,44/h);
    const dw=w*ratio,dh=h*ratio;
    ctx.drawImage(source,x0,y0,w,h,textLeft,(HEIGHT-dh)/2,dw,dh);
    if(typeof wordmark.close==='function')wordmark.close();
  } else {
    const family=await resolveBusinessFont(design);
    // Without a custom PNG, render the saved text and chosen font on one line.
    if(design?.apple?.businessNameFont!=='custom' && document.fonts?.load)
      await document.fonts.load('700 23px '+family);
    const {text,size}=singleLine(ctx,name,area,family);
    ctx.font=`700 ${size}px ${family}`;
    ctx.fillStyle=foreground(design);ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(text,textLeft,HEIGHT/2,area);
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob||blob.size>2097152)throw new Error('Logo Apple Wallet trop lourd après préparation.');
  return blob;
}
