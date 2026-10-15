// High-quality, dependency-free resampling of transparent merchant logos for PassKit.
// Downscaling with nearest-neighbour produced jagged small lettering and fuzzy round
// emblems on iPhone; this uses scale-aware Lanczos3 in premultiplied-alpha space.
// Transparent whitespace is trimmed, but opaque/white designs remain untouched.
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
function lanczos(x) {
  x=Math.abs(x);
  if (x<1e-8) return 1;
  if (x>=3) return 0;
  return 3*Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x);
}
function filterWeights(sourceSize,destSize) {
  const ratio=destSize/sourceSize,zoom=Math.min(1,ratio),radius=3/zoom;
  return Array.from({length:destSize},(_,d)=>{
    const center=(d+0.5)/ratio-0.5;
    const pairs=[];let sum=0;
    for(let s=Math.max(0,Math.ceil(center-radius));s<=Math.min(sourceSize-1,Math.floor(center+radius));s++){
      const weight=lanczos((s-center)*zoom);
      if(Math.abs(weight)<1e-12)continue;
      pairs.push([s,weight]);sum+=weight;
    }
    if(Math.abs(sum)<1e-12)return [[clamp(Math.round(center),0,sourceSize-1),1]];
    return pairs.map(([s,w])=>[s,w/sum]);
  });
}
// Returns a RGBA bitmap already letterboxed for the requested PassKit logo frame.
export function resizeAppleLogo(source,frameW,frameH) {
  const {width:srcW,height:srcH,pixels:src}=source;
  if(!Number.isInteger(frameW)||!Number.isInteger(frameH)||frameW<1||frameH<1||frameW>1000||frameH>600)
    throw new Error('invalid_logo_frame');
  const output=new Uint8Array(frameW*frameH*4);
  let x0=srcW,y0=srcH,x1=-1,y1=-1;
  for(let y=0;y<srcH;y++)for(let x=0;x<srcW;x++){
    if(src[(y*srcW+x)*4+3]<=5)continue;
    x0=Math.min(x0,x);x1=Math.max(x1,x);
    y0=Math.min(y0,y);y1=Math.max(y1,y);
  }
  if(x1<x0)return output;
  const cropW=x1-x0+1,cropH=y1-y0+1;
  const ratio=Math.min(frameW/cropW,frameH/cropH);
  const w=Math.max(1,Math.min(frameW,Math.round(cropW*ratio)));
  const h=Math.max(1,Math.min(frameH,Math.round(cropH*ratio)));
  const wx=filterWeights(cropW,w),wy=filterWeights(cropH,h);
  // All colour channels are premultiplied by alpha (0..1), including both passes.
  // Prevents dark/white fringe pixels from bleeding into transparent logos.
  const row=new Float64Array(cropH*w*4);
  for(let y=0;y<cropH;y++)for(let x=0;x<w;x++){
    const dest=(y*w+x)*4;
    for(const [sx,weight] of wx[x]){
      const pos=((y+y0)*srcW+(sx+x0))*4;
      const alpha=src[pos+3]/255;
      row[dest]  +=src[pos]*alpha*weight;
      row[dest+1]+=src[pos+1]*alpha*weight;
      row[dest+2]+=src[pos+2]*alpha*weight;
      row[dest+3]+=alpha*weight;
    }
  }
  const yOffset=Math.floor((frameH-h)/2);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let r=0,g=0,b=0,a=0;
    for(const [sy,weight] of wy[y]){
      const pos=(sy*w+x)*4;
      r+=row[pos]*weight;g+=row[pos+1]*weight;
      b+=row[pos+2]*weight;a+=row[pos+3]*weight;
    }
    const alpha=clamp(a,0,1);
    const target=((y+yOffset)*frameW+x)*4;
    if(alpha<=1/255)continue;
    // Clamp premultiplied RGB before unpremultiplying to eliminate ringing halos.
    output[target]=Math.round(clamp(r,0,alpha*255)/alpha);
    output[target+1]=Math.round(clamp(g,0,alpha*255)/alpha);
    output[target+2]=Math.round(clamp(b,0,alpha*255)/alpha);
    output[target+3]=Math.round(alpha*255);
  }
  return output;
}
