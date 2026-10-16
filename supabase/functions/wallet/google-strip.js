// Google-only renderer. Apple generators and settings are not modified.
import { notoEmoji, compositeEmoji } from '../apple-pass/emoji-art.js';
function rgb(value, fallback) {
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
// One bounded size setting controls PNG/library/emoji/circle/reward-star stamps.
// Slots and row/column positions remain fixed to avoid altering the card layout.
export function stampScale(size) {
  const n=Number(size);
  return size==null || size==='' || !Number.isFinite(n) ? 1 : clamp(n,50,120)/100;
}
// Scale center-to-center distances (never the bitmap or ring radius).
// Invalid and legacy configs produce the same strip as before.
export function stampOpacity(value) {
 const n=Number(value);
 return value==null||value===''||!Number.isFinite(n)?22:clamp(Math.round(n),0,100);
}
export function stampSpacing(spacing) {
  const n=Number(spacing);
  return spacing==null || spacing==='' || !Number.isFinite(n) ? 1 : clamp(n,50,120)/100;
}
const u32 = n => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const concat = chunks => {
  const size = chunks.reduce((sum, part) => sum + part.length, 0);
  const dest = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { dest.set(part, offset); offset += part.length; }
  return dest;
};
function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const tag = new TextEncoder().encode(type);
  return concat([u32(payload.length), tag, payload, u32(crc32(concat([tag, payload])))]);
}
function pixel(pixels, width, x, y, rgb) {
  const index = (y * width + x) * 4;
  pixels[index] = rgb[0]; pixels[index + 1] = rgb[1];
  pixels[index + 2] = rgb[2]; pixels[index + 3] = 255;
}
function circle(pixels, width, height, cx, cy, r, color) {
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(height, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(width, Math.ceil(cx + r)); x++)
      if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r2)
        pixel(pixels, width, x, y, color);
}
function overlayPanel(pixels, width, height, art, left, top, right, bottom, radius=0) {
  if(!art?.pixels || art.width<1 || art.height<1)return;
  const drawW=right-left,drawH=bottom-top;
  if(drawW<=0||drawH<=0)return;
  const ratio=Math.max(drawW/art.width,drawH/art.height);
  const step=1/ratio;
  const cropX=(art.width-drawW*step)/2,cropY=(art.height-drawH*step)/2;
  const source=art.pixels,srcW=art.width,srcH=art.height;
  const sameSize=srcW===drawW&&srcH===drawH;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    if(radius){
      const cx=clamp(x,left+radius,right-radius),cy=clamp(y,top+radius,bottom-radius);
      if((x-cx)**2+(y-cy)**2>radius*radius)continue;
    }
    const dest=(y*width+x)*4;
    let r=0,g=0,b=0,a=0;
    if(sameSize){
      // Do not resample an image already at its destination size.
      const i=((y-top)*srcW+x-left)*4;
      a=source[i+3]/255;
      r=source[i]*a;g=source[i+1]*a;b=source[i+2]*a;
    }else if(step<=1){
      // Bilinear interpolation when a small source needs enlarging.
      const sx=cropX+(x-left+.5)*step-.5,sy=cropY+(y-top+.5)*step-.5;
      const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
      for(let iy=0;iy<2;iy++)for(let ix=0;ix<2;ix++){
        const px=clamp(x0+ix,0,srcW-1),py=clamp(y0+iy,0,srcH-1);
        const weight=(ix?fx:1-fx)*(iy?fy:1-fy);
        const i=(py*srcW+px)*4,opacity=source[i+3]/255*weight;
        a+=opacity;r+=source[i]*opacity;g+=source[i+1]*opacity;b+=source[i+2]*opacity;
      }
    }else{
      // Integrate every contributing pixel's covered area. Sampling the
      // center pixel alone caused Barber Factory's thin marble veins to alias.
      const sx0=cropX+(x-left)*step,sx1=sx0+step;
      const sy0=cropY+(y-top)*step,sy1=sy0+step;
      for(let sy=Math.floor(sy0);sy<Math.ceil(sy1);sy++){
        const wy=Math.min(sy+1,sy1)-Math.max(sy,sy0);
        if(wy<=0)continue;
        const py=clamp(sy,0,srcH-1);
        for(let sx=Math.floor(sx0);sx<Math.ceil(sx1);sx++){
          const wx=Math.min(sx+1,sx1)-Math.max(sx,sx0);
          if(wx<=0)continue;
          const px=clamp(sx,0,srcW-1);
          const i=(py*srcW+px)*4,opacity=source[i+3]/255*wx*wy;
          a+=opacity;r+=source[i]*opacity;g+=source[i+1]*opacity;b+=source[i+2]*opacity;
        }
      }
      const invArea=1/(step*step);
      a*=invArea;r*=invArea;g*=invArea;b*=invArea;
    }
    if(a<=0)continue;
    const inv=1-Math.min(1,a);
    pixels[dest]=Math.round(r+pixels[dest]*inv);
    pixels[dest+1]=Math.round(g+pixels[dest+1]*inv);
    pixels[dest+2]=Math.round(b+pixels[dest+2]*inv);
    pixels[dest+3]=255;
  }
}

function drawFadedRing(pixels,width,height,cx,cy,outer,inner,ink,alpha) {
 if(alpha<=0)return;
 for(let y=Math.max(0,Math.floor(cy-outer));y<Math.min(height,Math.ceil(cy+outer));y++)
  for(let x=Math.max(0,Math.floor(cx-outer));x<Math.min(width,Math.ceil(cx+outer));x++){
   const r2=(x+.5-cx)**2+(y+.5-cy)**2;
   if(r2>outer*outer||r2<=inner*inner)continue;
   const dest=(y*width+x)*4;
   for(let k=0;k<3;k++)pixels[dest+k]=Math.round(pixels[dest+k]*(1-alpha)+ink[k]*alpha);
   pixels[dest+3]=255;
  }
}

async function demoPng(width, height, pixels) {
  const scan = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    scan[row] = 0;
    scan.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
  }
  const compressed = new Uint8Array(await new Response(
    new Blob([scan]).stream().pipeThrough(new CompressionStream('deflate'))
  ).arrayBuffer());
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])),
    chunk('IDAT', compressed), chunk('IEND', new Uint8Array()),
  ]);
}
export async function makeGoogleStampHero(d, progress, goal, mode='passages', customIcon=null, finalStar=null, panelArt=null) {
  const width=1032,height=812;
  const pixels=new Uint8Array(width*height*4);
  const primary=rgb(d?.google?.colors?.primary||d?.colors?.primary,'#1C1F24');
  const done=Math.max(0,Math.floor(Number(progress)||0)),target=Math.max(1,Math.floor(Number(goal)||10));
  // Keep all artwork visible. A wide legacy banner is centered on the card color.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixel(pixels,width,x,y,primary);
  let artHeight=height;
  if(panelArt?.pixels){
    const ratio=Math.min(width/panelArt.width,height/panelArt.height);
    const w=Math.round(panelArt.width*ratio),h=Math.round(panelArt.height*ratio);
    const left=Math.floor((width-w)/2),top=Math.floor((height-h)/2);
    artHeight=h;
    overlayPanel(pixels,width,height,panelArt,left,top,left+w,top+h);
  }
  if(d?.google?.showStamps===false)return demoPng(width,height,pixels);
  const selected=typeof d?.stamps?.emoji==='string' ? d.stamps.emoji : '';
  const bitmap=customIcon || (selected ? await notoEmoji(selected) : null);
  if(mode==='points'||target>30) {
    // A large horizontal progress bar, no fake round stamps for points mode.
    const left=105,right=width-105, top=height/2-20, frac=Math.min(1,done/target);
    const ink=rgb(d?.stamps?.filled,'#F2C94C'),empty=rgb(d?.stamps?.empty,'#FFFFFF');
    for(let y=top;y<top+40;y++)for(let x=left;x<right;x++)
      pixel(pixels,width,x,y,x-left<(right-left)*frac?ink:empty);
    return demoPng(width,height,pixels);
  }
  const n=Math.max(1,Math.min(20,target)),rows=n<=6?1:n<=14?2:3,cols=Math.ceil(n/rows);
  const stampFactor=stampScale(d?.stamps?.size);
  const spacing=stampSpacing(d?.stamps?.spacing);
  const inactiveOpacity=stampOpacity(d?.stamps?.inactiveOpacity);
  for(let i=0;i<n;i++){
    const row=Math.floor(i/cols),col=i%cols;
    const rowCount=Math.min(cols,n-row*cols);
    const spaceX=rows===1?152:cols>5?115:154;
    const x=Math.round(width/2+(col-(rowCount-1)/2)*spaceX*spacing);
    const spaceY=rows===1?0:Math.min(rows===2?235:192,artHeight/(rows+1));
    const y=Math.round(height/2+(row-(rows-1)/2)*spaceY*spacing);
    const stamp=i===n-1&&finalStar?finalStar:bitmap;
    if(stamp)compositeEmoji(pixels,width,height,x,y,Math.round(130*stampFactor),stamp,i<done,inactiveOpacity);
    else {
      const ink=rgb(d?.stamps?.filled,'#F2C94C'),empty=rgb(d?.stamps?.empty,'#FFFFFF');
      if(i<done)circle(pixels,width,height,x,y,52*stampFactor,ink);
      else if(inactiveOpacity>=22){
        circle(pixels,width,height,x,y,52*stampFactor,empty);
        circle(pixels,width,height,x,y,47*stampFactor,primary);
      } else drawFadedRing(pixels,width,height,x,y,52*stampFactor,47*stampFactor,empty,inactiveOpacity/22);
    }
  }
  return demoPng(width,height,pixels);
}
