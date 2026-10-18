// Deterministically prepare bounded, transparent DPA stamp PNGs at build time.
// Originals stay untouched in design-source; 256x256 output is safe for
// Supabase decodePng(maxDimension:512) and fast enough in the stamp picker.
// pngjs@5 is already pinned in package-lock (explicit dev dependency).
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
const source='design-source/stamps-original',target='public/assets/stamps';
const ids=['tacos-2','wok','vape','cheveux-bruns','e-liquide','cadeau'];
mkdirSync(target,{recursive:true});
for(const id of ids) {
  const src=PNG.sync.read(readFileSync(join(source,id+'.png')),{checkCRC:true});
  if(src.width<32||src.height<32||src.width>4096||src.height>4096)throw Error('unexpected stamp dimensions: '+id);
  const w=256,h=256,dst=new PNG({width:w,height:h});
  const px=src.data, ow=src.width,oh=src.height;
  // Interpolate alpha in premultiplied space to avoid dark fringes on clear PNGs.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=(x+.5)*ow/w-.5,sy=(y+.5)*oh/h-.5;
    const x0=Math.max(0,Math.floor(sx)),x1=Math.min(ow-1,Math.max(0,Math.floor(sx)+1));
    const y0=Math.max(0,Math.floor(sy)),y1=Math.min(oh-1,Math.max(0,Math.floor(sy)+1));
    const fx=Math.max(0,Math.min(1,sx-x0)),fy=Math.max(0,Math.min(1,sy-y0));
    const samples=[[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]];
    let alpha=0,r=0,g=0,b=0;
    for(const [ix,iy,weight] of samples){
      const i=(iy*ow+ix)*4,a=px[i+3]/255*weight;
      alpha+=a;r+=px[i]*a;g+=px[i+1]*a;b+=px[i+2]*a;
    }
    const j=(y*w+x)*4;
    dst.data[j]=alpha?Math.round(r/alpha):0;
    dst.data[j+1]=alpha?Math.round(g/alpha):0;
    dst.data[j+2]=alpha?Math.round(b/alpha):0;
    dst.data[j+3]=Math.round(alpha*255);
  }
  const bytes=PNG.sync.write(dst,{colorType:6,inputColorType:6,deflateLevel:9});
  if(bytes.byteLength>2_000_000)throw Error('stamp exceeds server limit: '+id);
  writeFileSync(join(target,id+'.png'),bytes);
  console.log('Prepared stamp',id,bytes.length);
}
