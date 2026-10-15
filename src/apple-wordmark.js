// Compose the Apple logo + an enlarged, system-style merchant name once in the
// admin's browser, NOT during pass signing (Supabase Edge CPU is tightly limited).
// The complete brand is centered vertically in Apple's existing 160x50pt logo slot.
// No native logoText is emitted for these cards: native text size is not configurable.
const WIDTH=160,HEIGHT=50,SCALE=3;
const FONT='-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Arial, sans-serif';
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
function textLines(ctx,name,available){
  const setFont=size=>{ctx.font=`700 ${size}px ${FONT}`};
  // Single line is preferred; long two-word shop names get a readable, centered
  // two-line header rather than shrinking to Apple's old tiny native logoText.
  let size=23;setFont(size);
  if(ctx.measureText(name).width<=available)return {lines:[name],size};
  const words=name.split(/\s+/).filter(Boolean);
  if(words.length>1){
    let result=null;
    for(let i=1;i<words.length;i++){
      const pair=[words.slice(0,i).join(' '),words.slice(i).join(' ')];
      for(let fs=21;fs>=16;fs--){
        setFont(fs);
        if(Math.max(...pair.map(x=>ctx.measureText(x).width))<=available){
          if(!result||fs>result.size)result={lines:pair,size:fs};
          break;
        }
      }
    }
    if(result)return result;
  }
  for(size=22;size>=15;size--){setFont(size);if(ctx.measureText(name).width<=available)return {lines:[name],size};}
  // Never render text beneath the card number or outside the native logo slot.
  setFont(15);
  let cut=name;
  while(cut.length>1&&ctx.measureText(cut+'…').width>available)cut=cut.slice(0,-1);
  return {lines:[cut+'…'],size:15};
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
  const {lines,size}=textLines(ctx,name,area);
  ctx.font=`700 ${size}px ${FONT}`;
  ctx.fillStyle=foreground(design);ctx.textAlign='left';ctx.textBaseline='middle';
  const lineHeight=lines.length===2?Math.min(24,size+2):size+2;
  const mid=HEIGHT/2;
  lines.forEach((line,i)=>{
    const y=mid+(i-(lines.length-1)/2)*lineHeight;
    ctx.fillText(line,textLeft,y,area);
  });
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob||blob.size>2097152)throw new Error('Logo Apple Wallet trop lourd après préparation.');
  return blob;
}
