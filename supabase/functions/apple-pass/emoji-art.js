// Pure PNG emoji compositing for Wallet graphics; no native image addon or WASM.
// Open Noto Emoji images: https://github.com/googlefonts/noto-emoji
// Most PNG image resources in that repository are Apache-2.0.
// Deliberately do not copy Apple's or Samsung's proprietary emoji artwork.
const sig = [137,80,78,71,13,10,26,10];
const rgba = (r,g,b,a) => [r,g,b,a];
const readInt = (bytes, offset) => new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);
function concat(chunks) {
  const length=chunks.reduce((n,v)=>n+v.length,0);
  const out=new Uint8Array(length);let off=0;
  for(const chunk of chunks){out.set(chunk,off);off+=chunk.length;}
  return out;
}
export async function decodeEmojiPng(source, limits = {}) {
  // Local program logos may be larger than remote Noto images. Callers must
  // explicitly raise limits; public emoji URLs still use strict defaults.
  const maxBytes = limits.maxBytes ?? 350000;
  const maxDimension = limits.maxDimension ?? 256;
  const bin = source instanceof Uint8Array ? source : new Uint8Array(source);
  if(bin.length<60 || bin.length>maxBytes || sig.some((b,i)=>bin[i]!==b))throw new Error('emoji_png_invalid');
  let width=0,height=0,type=0,depth=0,interlace=0,palette=null,alpha=null;
  const idat=[];
  for(let off=8;off+12<=bin.length;){
    const len=readInt(bin,off), name=String.fromCharCode(...bin.subarray(off+4,off+8));
    if(len>maxBytes || off+len+12>bin.length)throw new Error('emoji_png_chunk');
    const data=bin.subarray(off+8,off+8+len);
    if(name==='IHDR') {
      width=readInt(data,0);height=readInt(data,4);depth=data[8];type=data[9];interlace=data[12];
      if(width<1||height<1||width>maxDimension||height>maxDimension||depth!==8||interlace!==0||![2,3,6].includes(type))throw new Error('emoji_png_format');
    }
    if(name==='PLTE')palette=data;
    if(name==='tRNS')alpha=data;
    if(name==='IDAT')idat.push(data);
    off+=len+12;
    if(name==='IEND')break;
  }
  if(!width||!height||!idat.length)throw new Error('emoji_png_missing');
  const bpp=type===6?4:type===2?3:1, line=width*bpp;
  const inflated=new Uint8Array(await new Response(
    new Blob([concat(idat)]).stream().pipeThrough(new DecompressionStream('deflate'))
  ).arrayBuffer());
  if(inflated.length!==height*(line+1))throw new Error('emoji_png_size');
  const pixels=new Uint8Array(width*height*4),prev=new Uint8Array(line);
  let offset=0;
  for(let y=0;y<height;y++){
    const filter=inflated[offset++],row=new Uint8Array(line);
    if(filter>4)throw new Error('emoji_png_filter');
    for(let x=0;x<line;x++){
      const v=inflated[offset++],a=x>=bpp?row[x-bpp]:0,
        b=prev[x],c=x>=bpp?prev[x-bpp]:0;
      let predict=0;
      if(filter===1)predict=a;
      if(filter===2)predict=b;
      if(filter===3)predict=Math.floor((a+b)/2);
      if(filter===4){
        const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
        predict=pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      }
      row[x]=(v+predict)&255;
    }
    for(let x=0;x<width;x++){
      const src=x*bpp,dst=(y*width+x)*4;
      if(type===6){pixels.set(row.subarray(src,src+4),dst);}
      else if(type===2){pixels.set(rgba(row[src],row[src+1],row[src+2],255),dst);}
      else{
        const n=row[src],j=n*3;
        if(!palette||j+2>=palette.length)throw new Error('emoji_png_palette');
        pixels.set(rgba(palette[j],palette[j+1],palette[j+2],alpha?.[n]??255),dst);
      }
    }
    prev.set(row);
  }
  return {width,height,pixels};
}
export function emojiFilename(value) {
  if(typeof value!=='string'||[...value].length>16||!/\p{Extended_Pictographic}/u.test(value))return null;
  const parts=Array.from(value).map(c=>c.codePointAt(0)).filter(cp=>cp!==0xfe0f&&cp!==0xfe0e);
  if(!parts.length||parts.length>12)return null;
  return 'emoji_u'+parts.map(n=>n.toString(16)).join('_')+'.png';
}
// Not every Noto emoji ships as a PNG: for example 💧 (U+1F4A7) is a
// valid Unicode emoji, but the Noto png/128 directory has no matching PNG.
// Fall back to the independent open Twemoji set (CC-BY 4.0), and finally
// render a small built-in vector-like glyph so the stamp zone is NEVER blank.
export function twemojiFilename(value) {
  if (!emojiFilename(value)) return null;
  const parts=Array.from(value).map(ch=>ch.codePointAt(0))
    .filter(cp=>cp!==0xfe0f&&cp!==0xfe0e);
  return parts.map(n=>n.toString(16)).join('-')+'.png';
}
async function emojiImage(url) {
  try {
    const res=await fetch(url,{signal:AbortSignal.timeout(4000),redirect:'error'});
    if(!res.ok||Number(res.headers.get('content-length')||0)>350000)return null;
    const buf=new Uint8Array(await res.arrayBuffer());
    if(buf.length>350000)return null;
    return await decodeEmojiPng(buf);
  } catch { return null; }
}
// Small local safety net; 💧 is important for cafés, car washes and water
// businesses. All other unavailable emojis use a neutral gold star instead of
// an empty blue panel. The full emoji still appears when a source is reachable.
export function fallbackEmoji(value) {
  const n=64, pixels=new Uint8Array(n*n*4);
  const droplet=value.includes('💧');
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const X=x+.5-32,Y=y+.5;
    let inside=false;
    if(droplet){
      const extent=Y<38?Math.max(0,(Y-6)*.65):Math.sqrt(Math.max(0,20*20-(Y-38)**2));
      inside=Y>=6 && Y<58 && Math.abs(X)<extent;
    }else {
      const angle=Math.atan2(Y-32,X);
      const radius=Math.hypot(X,Y-32);
      const wave=.5+.5*Math.cos(5*(angle+Math.PI/2));
      inside=radius<11+14*wave;
    }
    if(!inside)continue;
    const i=(y*n+x)*4;
    if(droplet){
      pixels[i]=x<32?24:53;
      pixels[i+1]=x<32?121:162;
      pixels[i+2]=235;
    }else {
      pixels[i]=245;pixels[i+1]=194;pixels[i+2]=59;
    }
    pixels[i+3]=255;
  }
  return {width:n,height:n,pixels};
}
const memo=new Map();
export async function notoEmoji(value) {
  const name=emojiFilename(value);if(!name)return null;
  if(!memo.has(name)){
    memo.set(name,(async()=>{
      const noto='https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/'+name;
      const first=await emojiImage(noto);
      if(first)return first;
      const twitterFile=twemojiFilename(value);
      if(twitterFile){
        const twemoji='https://raw.githubusercontent.com/jdecked/twemoji/main/assets/72x72/'+twitterFile;
        const second=await emojiImage(twemoji);
        if(second)return second;
      }
      return fallbackEmoji(value);
    })());
  }
  return memo.get(name);
}
export function compositeEmoji(target,width,height,cx,cy,size,icon,completed) {
  if(!icon || !Number.isInteger(width)||!Number.isInteger(height))return;
  const ratio=Math.min(size/icon.width,size/icon.height);
  const w=Math.max(1,Math.floor(icon.width*ratio)),h=Math.max(1,Math.floor(icon.height*ratio));
  const x0=Math.round(cx-w/2),y0=Math.round(cy-h/2);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=x0+x,dy=y0+y;
    if(dx<0||dy<0||dx>=width||dy>=height)continue;
    const sx=Math.min(icon.width-1,Math.floor(x/ratio)),sy=Math.min(icon.height-1,Math.floor(y/ratio));
    const si=4*(sy*icon.width+sx),di=4*(dy*width+dx);
    const srcA=icon.pixels[si+3]/255*(completed?1:.22),inv=1-srcA;
    const gray=Math.round(.2126*icon.pixels[si]+.7152*icon.pixels[si+1]+.0722*icon.pixels[si+2]);
    for(let k=0;k<3;k++){
      const value=completed?icon.pixels[si+k]:gray;
      target[di+k]=Math.round(target[di+k]*inv+value*srcA);
    }
    target[di+3]=255;
  }
}
