import {deflateSync} from 'node:zlib';
import {crc32} from '../../supabase/functions/_shared/png.js';
export function fixture(w=80,h=40,color=[220,70,20,255]) {
 const u=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const chunk=(name,data)=>{const d=Buffer.concat([Buffer.from(name),data]);return Buffer.concat([u(data.length),d,u(crc32(d))]);};
 const raw=Buffer.alloc(h*(1+w*4));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x>=w/4&&x<3*w/4&&y>=h/4&&y<3*h/4)raw.set(color,y*(1+w*4)+1+x*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',Buffer.concat([u(w),u(h),Buffer.from([8,6,0,0,0])])),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
