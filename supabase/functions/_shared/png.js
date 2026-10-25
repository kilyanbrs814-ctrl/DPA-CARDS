// Strict bounded PNG decoder shared by upload validation and Apple rendering.
// Browser uploads are normalized to RGBA8 before storage; legacy RGB/indexed PNGs also work.
// Table lookup preserves the PNG CRC while avoiding eight bitwise rounds per byte.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
// Rendering uses the same immutable bytes for validation and both header sizes.
// Weak keys release pixels with the request; no cross-card/path cache can go stale.
const decodedImages = new WeakMap();
export function decodePngOnce(source) {
  let pending = decodedImages.get(source);
  if (!pending) {
    pending = decodePng(source);
    decodedImages.set(source, pending);
    pending.catch(() => decodedImages.delete(source));
  }
  return pending;
}
const sig = [137,80,78,71,13,10,26,10];
const rgba = (r,g,b,a) => [r,g,b,a];
const readInt = (bytes, offset) => new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);
function concat(chunks) {
  const length=chunks.reduce((n,v)=>n+v.length,0);
  const out=new Uint8Array(length);let off=0;
  for(const chunk of chunks){out.set(chunk,off);off+=chunk.length;}
  return out;
}
export async function decodePng(source, limits = {}) {
  // Local program logos may be larger than remote Noto images. Callers must
  // explicitly raise limits; public emoji URLs still use strict defaults.
  const maxBytes = limits.maxBytes ?? 2097152;
  const maxDimension = limits.maxDimension ?? 2048;
  const bin = source instanceof Uint8Array ? source : new Uint8Array(source);
  if(bin.length<60 || bin.length>maxBytes || sig.some((b,i)=>bin[i]!==b))throw new Error('emoji_png_invalid');
  let ended=false, seenHeader=false;
  let width=0,height=0,type=0,depth=0,interlace=0,palette=null,alpha=null;
  const idat=[];
  for(let off=8;off+12<=bin.length;){
    const len=readInt(bin,off), name=String.fromCharCode(...bin.subarray(off+4,off+8));
    if(len>maxBytes || off+len+12>bin.length)throw new Error('emoji_png_chunk');
    if(crc32(bin.subarray(off+4,off+8+len))!==readInt(bin,off+8+len))throw new Error('png_crc');
    if(!seenHeader && name!=='IHDR')throw new Error('png_header');
    const data=bin.subarray(off+8,off+8+len);
    if(name==='IHDR') {
      if(seenHeader||len!==13)throw new Error('png_header');
      seenHeader=true;
      if(data[10]!==0||data[11]!==0)throw new Error('png_format');
      width=readInt(data,0);height=readInt(data,4);depth=data[8];type=data[9];interlace=data[12];
      if(width<1||height<1||width>maxDimension||height>maxDimension||depth!==8||interlace!==0||![2,3,6].includes(type))throw new Error('emoji_png_format');
    }
    if(name==='PLTE')palette=data;
    if(name==='tRNS')alpha=data;
    if(name==='IDAT')idat.push(data);
    off+=len+12;
    if(name==='IEND'){if(len!==0||off!==bin.length)throw new Error('png_end');ended=true;break;}
  }
  if(!ended||!width||!height||!idat.length)throw new Error('emoji_png_missing');
  const bpp=type===6?4:type===2?3:1, line=width*bpp;
  const reader=new Blob([concat(idat)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts=[];let total=0;
  try { while(true){const {value,done}=await reader.read();if(done)break;
    total+=value.length;if(total>height*(line+1))throw new Error('png_inflate_limit');parts.push(value);
  }} finally { await reader.cancel(); }
  const inflated=concat(parts);
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
    if(type===6) pixels.set(row,y*width*4);
    else for(let x=0;x<width;x++){
      const src=x*bpp,dst=(y*width+x)*4;
      if(type===6){pixels.set(row.subarray(src,src+4),dst);}
      else if(type===2){const transparent=alpha?.length===6 && row[src]===alpha[1] && row[src+1]===alpha[3] && row[src+2]===alpha[5];pixels.set(rgba(row[src],row[src+1],row[src+2],transparent?0:255),dst);}
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
