import { decodePng } from '../_shared/png.js';
import { notoEmoji, compositeEmoji } from './emoji-art.js';
// Lightweight, dependency-free PNG for native Apple store-card strips.
// Avoid native/WASM image dependencies in the Edge Function: the test-pass route
// must be able to cold-start even if no real-card artwork is requested.
function rgb(value, fallback) {
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
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
// Minimal emoji banner used by BOTH signed Apple test and customer passes.
// The strip is only the rectangular stamp region from the admin designer;
// logo, number, counters and QR remain native Wallet fields.
/** @param {{width:number,height:number,pixels:Uint8Array}|null} customIcon */
export async function makeEmojiCardStrip(stamps, colors, progress, goal, mode, scale=1, customIcon=null) {
  if (![1,2].includes(scale)) throw new Error('invalid_strip_scale');
  const width=375*scale,height=144*scale,pixels=new Uint8Array(width*height*4);
  const primary=rgb(colors?.primary,'#1C1F24');
  const secondary=rgb(colors?.secondary,'#2448F0');
  const done=Math.max(0,Number(progress)||0),target=Math.max(1,Math.round(Number(goal)||10));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixel(pixels,width,x,y,primary);
  // Softly rounded rectangle with margin as in the admin preview.
  const margin=16*scale,top=3*scale,radius=15*scale;
  const right=width-margin,bottom=height-3*scale;
  for(let y=top;y<bottom;y++)for(let x=margin;x<right;x++) {
    const cornerX=x<margin+radius?margin+radius:x>=right-radius?right-radius:x;
    const cornerY=y<top+radius?top+radius:y>=bottom-radius?bottom-radius:y;
    if((x-cornerX)**2+(y-cornerY)**2 <= radius*radius)pixel(pixels,width,x,y,secondary);
  }
  if(mode==='points'||target>30) {
    const x0=70*scale,w=235*scale,y0=66*scale,h=14*scale;
    const fraction=Math.min(1,done/target);
    const ink=rgb(stamps?.filled,'#F2C94C'),empty=rgb(stamps?.empty,'#FFFFFF');
    for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)
      pixel(pixels,width,x,y,x-x0<w*fraction?ink:empty);
  } else {
    const n=Math.min(target,20),rows=n<=6?1:n<=14?2:3,per=Math.ceil(n/rows);
    const icon=customIcon || (stamps?.emoji?await notoEmoji(stamps.emoji):null);
    // OneCup-style 5 + 5 layout: visibly larger emojis. Compute in 1x
    // logical pixels FIRST so strip@2x scales sprites instead of shrinking them.
    const gap=rows<=2?11:7;
    const maxSize=rows===1?54:rows===2?50:34;
    const logicalSize=Math.max(12,Math.min(maxSize,Math.floor((315-(per-1)*gap)/per)));
    const size=logicalSize*scale;
    const rowGap=(rows===3?40:rows===2?58:0)*scale;
    const cx=width/2,cy=height/2;
    for(let i=0;i<n;i++){
      const row=Math.floor(i/per),col=i%per,rowCount=Math.min(per,n-row*per);
      const x=Math.round(cx+(col-(rowCount-1)/2)*(size+gap*scale));
      const y=Math.round(cy+(row-(rows-1)/2)*rowGap);
      if(icon)compositeEmoji(pixels,width,height,x,y,size,icon,i<done);
    }
  }
  return demoPng(width,height,pixels);
}

/** @param {{width:number,height:number,pixels:Uint8Array}|null} customIcon */
export async function makeRealStrip(brand, balance, goal, scale = 1, customIcon=null) {
  if (![1, 2].includes(scale)) throw new Error('invalid_strip_scale');
  if(brand.emoji || brand.stamp || brand.libraryId) return makeEmojiCardStrip(brand.stamps,brand,balance,goal,brand.mode||'passages',scale,customIcon);
  const width = 375 * scale, height = 123 * scale;
  const pixels = new Uint8Array(width * height * 4);
  const primary = rgb(brand.primary, '#2448F0');
  const secondary = rgb(brand.secondary, '#2448F0');
  const accent = rgb(brand.stamps?.filled || brand.accent, '#F2C94C');
  const empty = rgb(brand.stamps?.empty, '#FFFFFF');
  // A restrained branded two-tone band. Native Wallet fields remain legible.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isRight = x >= width * .5;
      const v = isRight ? secondary : primary;
      pixel(pixels, width, x, y, v);
    }
  }
  // Stamps on right half, driven by the REAL card's balance rather than editor demo data.
  const maxStamps = Math.max(1, Math.min(10, Math.floor(Number(goal) || 10)));
  const done = clamp(Math.floor(Math.max(0, Number(balance) || 0) / Math.max(1, Number(goal) || 1) * maxStamps), 0, maxStamps);
  const columns = Math.min(maxStamps, 5), rows = Math.ceil(maxStamps / columns);
  const dX = 31 * scale, dY = (rows === 1 ? 0 : 43 * scale);
  const center = 285 * scale;
  const bitmap = brand.emoji ? await notoEmoji(brand.emoji) : null;
  for (let i = 0; i < maxStamps; i++) {
    const col = i % columns, row = Math.floor(i / columns);
    const x = Math.round(center + (col - (columns - 1) / 2) * dX);
    const y = Math.round(height / 2 + (row - (rows - 1) / 2) * dY);
    if (brand.emoji) {
      // With an emoji choice, never fall back to round stamps. A missing
      // open-source asset leaves a clean strip and native text fields intact.
      if (bitmap) compositeEmoji(pixels,width,height,x,y,25*scale,bitmap,i<done);
    } else {
      circle(pixels, width, height, x, y, 12 * scale, i < done ? accent : empty);
      if (i >= done) circle(pixels, width, height, x, y, 9 * scale, secondary);
    }
  }
  // PNG RGBA8, unfiltered scanlines, compressed with standard Web CompressionStream.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanline = y * (1 + width * 4);
    raw[scanline] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), scanline + 1);
  }
  const packed = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
  ).arrayBuffer());
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])),
    chunk('IDAT', packed),
    chunk('IEND', new Uint8Array()),
  ]);
}


// DEMONSTRATION PASSES ONLY. These graphics are generated directly from the
// card designer's saved config (not the default DPA logo). Native PassKit lays
// the progress primary field *over* the strip, so stamps sit on the right half.
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
const colorFromDemo = (config, key, fallback) =>
  rgb(config?.apple?.colors?.[key] || config?.colors?.[key], fallback);
const paint = (pixels, width, height, x, y, color) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  pixel(pixels, width, x, y, color);
};
function line(pixels, width, height, x1, y1, x2, y2, thickness, color) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  for (let step = 0; step <= Math.ceil(length * 2); step++) {
    const t = step / Math.max(1, Math.ceil(length * 2));
    const x = Math.round(x1 + (x2 - x1) * t), y = Math.round(y1 + (y2 - y1) * t);
    circle(pixels, width, height, x, y, thickness, color);
  }
}
// Same two rows of 5 as the test designer where goal is 10.
/** @param {{width:number,height:number,pixels:Uint8Array}|null} customIcon */
export async function makeDemoStrip(config, scale = 1, customIcon=null) {
  if (![1, 2].includes(scale)) throw new Error('invalid_demo_strip_scale');
  if(config?.stamps?.emoji || customIcon) {
    const pv=config.preview||{};
    return makeEmojiCardStrip(config.stamps, {
      primary:config?.apple?.colors?.primary || config?.colors?.primary,
      secondary:config?.apple?.colors?.secondary || config?.colors?.secondary,
    },pv.progress,pv.goal,pv.mode,scale,customIcon);
  }
  const width = 375 * scale, height = 144 * scale;
  const pixels = new Uint8Array(width * height * 4);
  const primary = colorFromDemo(config, 'primary', '#1C1F24');
  const secondary = colorFromDemo(config, 'secondary', '#2448F0');
  const filled = rgb(config?.stamps?.filled, '#F2C94C');
  const empty = rgb(config?.stamps?.empty, '#FFFFFF');
  const preview = config?.preview || {};
  const goal = Math.max(1, Math.round(Number(preview.goal) || 10));
  const done = clamp(Math.round(Number(preview.progress) || 0), 0, goal);
  // Gentle left-blue to right-dark gradient, like the Apple preview in DPA Cards.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = clamp((x / width) * .90 + (y / height) * .12, 0, 1);
    paint(pixels, width, height, x, y, secondary.map((v,i) => Math.round(v * (1-t) + primary[i] * t)));
  }
  if (preview.mode === 'points' || goal > 30) {
    const frac = Math.min(1, done / goal), x1 = 190 * scale, barW = 165 * scale, yy = 70 * scale;
    for(let y=yy-7*scale;y<yy+7*scale;y++) for(let x=x1;x<x1+barW;x++)
      paint(pixels,width,height,x,y,x-x1 < barW*frac ? filled : empty);
    return demoPng(width,height,pixels);
  }
  // Saved emoji choice: draw actual Unicode emoji artwork, rather than circles.
  // Noto image assets are open source. For missing assets leave the native
  // text fallback; do not render unrelated geometric tampons.
  const emojiChoice = config?.stamps?.emoji;
  const emojiImage = emojiChoice ? await notoEmoji(emojiChoice) : null;
  if (emojiChoice) {
    const visible = Math.min(goal, 15), rows = visible <= 6 ? 1 : visible <= 14 ? 2 : 3;
    const columns = Math.ceil(visible/rows);
    const gapX = columns>1?Math.min(32,160/(columns-1)):0;
    const gapY = rows===1?0:rows===2?47:35;
    for(let i=0;i<visible;i++){
      const row=Math.floor(i/columns),col=i%columns,nCols=Math.min(columns,visible-row*columns);
      const x=Math.round((281+(col-(nCols-1)/2)*gapX)*scale);
      const y=Math.round((73+(row-(rows-1)/2)*gapY)*scale);
      if(emojiImage)compositeEmoji(pixels,width,height,x,y,25*scale,emojiImage,i<done);
    }
    return demoPng(width,height,pixels);
  }
  // Keep primary-field text readable on the left (Apple places it over strip).
  const visible = Math.min(goal, 15);
  const rows = visible <= 6 ? 1 : visible <= 14 ? 2 : 3;
  const columns = Math.ceil(visible / rows);
  const size = Math.min(13, 73 / Math.max(1, columns));
  const gapX = columns > 1 ? Math.min(32, 160 / (columns - 1)) : 0;
  const gapY = rows === 1 ? 0 : rows === 2 ? 47 : 35;
  const centerX = 281, centerY = 73;
  for (let i = 0; i < visible; i++) {
    const row = Math.floor(i / columns), col = i % columns;
    const nCols = Math.min(columns, visible - row * columns);
    const cx = Math.round((centerX + (col - (nCols - 1)/2)*gapX)*scale);
    const cy = Math.round((centerY + (row - (rows - 1)/2)*gapY)*scale);
    const rr = Math.max(5, size) * scale;
    if (i < done) {
      circle(pixels,width,height,cx,cy,rr,filled);
      if (config?.stamps?.icon === 'check') {
        line(pixels,width,height,cx-5*scale,cy,cx-1*scale,cy+4*scale,1.3*scale,primary);
        line(pixels,width,height,cx-1*scale,cy+4*scale,cx+6*scale,cy-5*scale,1.3*scale,primary);
      }
    } else {
      circle(pixels,width,height,cx,cy,rr,empty);
      circle(pixels,width,height,cx,cy,rr-2.4*scale,primary);
    }
  }
  return demoPng(width,height,pixels);
}
// Bitmap font for a discreet identity fallback in Apple Wallet. The sample
// test card has no uploaded logo and is expected to show a yellow CT tile.
const glyphs = {
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  J:['00111','00010','00010','00010','10010','10010','01100'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  Q:['01110','10001','10001','10001','10101','10010','01101'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','10101','01010'],
  X:['10001','10001','01010','00100','01010','10001','10001'],
  Y:['10001','10001','01010','00100','00100','00100','00100'],
  Z:['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
};
export async function makeDemoLogo(name, accent='#F2C94C', scale=1, kind='logo') {
  if (![1,2].includes(scale) || !['logo','icon'].includes(kind)) throw new Error('invalid_demo_logo');
  const width=(kind==='icon'?29:160)*scale, height=(kind==='icon'?29:50)*scale;
  const pixels=new Uint8Array(width*height*4);
  const bg=rgb(accent,'#F2C94C'), fg=rgb('#1C1F24','#1C1F24');
  const words=String(name||'DPA').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const letters=(words.length>1?words.map(w=>w[0]).join(''):words[0]||'DPA').slice(0,2);
  const side=(kind==='icon'?29:48)*scale, radius=8*scale;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const dx=Math.max(radius-x,x-(side-radius-1),0),dy=Math.max(radius-y,y-(side-radius-1),0);
    if(dx*dx+dy*dy <= radius*radius) paint(pixels,width,height,x,y,bg);
  }
  const step=(kind==='icon'?2:4)*scale, count=letters.length;
  const startX=Math.round((side-(count*5+(count-1))*step)/2);
  const startY=Math.round((side-7*step)/2);
  for(let n=0;n<count;n++){
    const g=glyphs[letters[n]]||glyphs.C;
    for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(g[y][x]==='1')
      for(let yy=0;yy<step;yy++)for(let xx=0;xx<step;xx++)
        paint(pixels,width,height,startX+n*6*step+x*step+xx,startY+y*step+yy,fg);
  }
  return demoPng(width,height,pixels);
}


// Apple header: uploaded PNG only, contained inside the native 160 x 50pt area.
// Native logoText is omitted. Missing logos leave a transparent header image.
/** @param {string} _name
 * @param {string} _accent
 * @param {string} _background
 * @param {Uint8Array | null} logoBytes
 * @param {number} scale
 */
export async function makeAppleHeaderLogo(_name, _accent='#F2C94C', _background='#1C1F24', logoBytes=null, scale=1) {
  if (![1,2].includes(scale)) throw new Error('invalid_header_scale');
  const width=160*scale,height=50*scale,pixels=new Uint8Array(width*height*4);
  if(logoBytes) {
    const src=await decodePng(logoBytes);
    const ratio=Math.min(width/src.width,height/src.height);
    const w=Math.max(1,Math.round(src.width*ratio)),h=Math.max(1,Math.round(src.height*ratio));
    const top=Math.floor((height-h)/2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const sx=Math.min(src.width-1,Math.floor(x/ratio)),sy=Math.min(src.height-1,Math.floor(y/ratio));
      pixels.set(src.pixels.subarray((sy*src.width+sx)*4,(sy*src.width+sx)*4+4),((top+y)*width+x)*4);
    }
  }
  // Transparent when absent: no initials, tile, merchant name, or empty logoText.
  return demoPng(width,height,pixels);
}

// Google Wallet LoyaltyObject heroImage: open-license emoji stamps for THIS
// card's current balance. Text, rewards and QR stay native Google Wallet fields.
// Requires a 5:4 image (1032x812) and no PII inside the generated PNG.
export async function makeGoogleStampHero(d, progress, goal, mode='passages', customIcon=null) {
  const width=1032,height=812;
  const pixels=new Uint8Array(width*height*4);
  const primary=rgb(d?.google?.colors?.primary||d?.colors?.primary,'#1C1F24');
  const secondary=rgb(d?.google?.colors?.secondary||d?.colors?.secondary,'#2448F0');
  const done=Math.max(0,Math.floor(Number(progress)||0)),target=Math.max(1,Math.floor(Number(goal)||10));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const gradient=Math.max(0,Math.min(1,.22+.76*(x/width)));
    pixel(pixels,width,x,y,secondary.map((v,k)=>Math.round(v*(1-gradient)+primary[k]*gradient)));
  }
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
  for(let i=0;i<n;i++){
    const row=Math.floor(i/cols),col=i%cols;
    const rowCount=Math.min(cols,n-row*cols);
    const spaceX=rows===1?152:cols>5?115:154;
    const x=Math.round(width/2+(col-(rowCount-1)/2)*spaceX);
    const spaceY=rows===1?0:rows===2?235:192;
    const y=Math.round(height/2+(row-(rows-1)/2)*spaceY);
    if(bitmap)compositeEmoji(pixels,width,height,x,y,130,bitmap,i<done);
  }
  return demoPng(width,height,pixels);
}
