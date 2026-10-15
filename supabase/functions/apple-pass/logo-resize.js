// Fast transparent PNG resizing for Apple Wallet header logos.
// Production Edge Functions have strict CPU limits, so avoid convolution kernels,
// large float buffers, WASM and a third @3x encode during on-demand signing.
// 4x4 stratified coverage samples + bilinear interpolation smooth downscaled text.
// Colour is alpha-premultiplied to prevent tinted fringes on dark wallet cards.
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
export function resizeAppleLogo(source,frameW,frameH) {
  const {width:sw,height:sh,pixels:src}=source;
  if(!Number.isInteger(frameW)||!Number.isInteger(frameH)||frameW<1||frameH<1||frameW>1000||frameH>600)
    throw new Error('invalid_logo_frame');
  const output=new Uint8Array(frameW*frameH*4);
  let minX=sw,minY=sh,maxX=-1,maxY=-1;
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
    if(src[(y*sw+x)*4+3]<=5)continue;
    if(x<minX)minX=x;if(x>maxX)maxX=x;
    if(y<minY)minY=y;if(y>maxY)maxY=y;
  }
  if(maxX<minX)return output;
  const cw=maxX-minX+1,ch=maxY-minY+1;
  const scale=Math.min(frameW/cw,frameH/ch);
  const w=Math.max(1,Math.min(frameW,Math.round(cw*scale)));
  const h=Math.max(1,Math.min(frameH,Math.round(ch*scale)));
  const left=0,top=Math.floor((frameH-h)/2);
  // Oversample downsizing to avoid losing fine letters. Only 2x2 for near-1:1.
  const samples=scale<0.6?4:2;
  const inv=1/(samples*samples);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      let ar=0,ag=0,ab=0,aa=0;
      for(let v=0;v<samples;v++){
        const sy=minY+(y+(v+0.5)/samples)*ch/h-0.5;
        const fy=clamp(sy,0,sh-1),y0=Math.floor(fy),y1=Math.min(sh-1,y0+1),dy=fy-y0;
        for(let u=0;u<samples;u++){
          const sx=minX+(x+(u+0.5)/samples)*cw/w-0.5;
          const fx=clamp(sx,0,sw-1),x0=Math.floor(fx),x1=Math.min(sw-1,x0+1),dx=fx-x0;
          const a0=(y0*sw+x0)*4,b0=(y0*sw+x1)*4,c0=(y1*sw+x0)*4,d0=(y1*sw+x1)*4;
          const w0=(1-dx)*(1-dy)*inv,w1=dx*(1-dy)*inv,w2=(1-dx)*dy*inv,w3=dx*dy*inv;
          const aw0=w0*src[a0+3]/255,aw1=w1*src[b0+3]/255;
          const aw2=w2*src[c0+3]/255,aw3=w3*src[d0+3]/255;
          aa+=aw0+aw1+aw2+aw3;
          ar+=src[a0]*aw0+src[b0]*aw1+src[c0]*aw2+src[d0]*aw3;
          ag+=src[a0+1]*aw0+src[b0+1]*aw1+src[c0+1]*aw2+src[d0+1]*aw3;
          ab+=src[a0+2]*aw0+src[b0+2]*aw1+src[c0+2]*aw2+src[d0+2]*aw3;
        }
      }
      const dest=((top+y)*frameW+left+x)*4;
      const alpha=clamp(aa,0,1);
      if(alpha<1/255)continue;
      output[dest]=Math.round(clamp(ar/alpha,0,255));
      output[dest+1]=Math.round(clamp(ag/alpha,0,255));
      output[dest+2]=Math.round(clamp(ab/alpha,0,255));
      output[dest+3]=Math.round(alpha*255);
    }
  }
  return output;
}
