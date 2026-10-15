// Small transparent lettering-only overlay, prepared in the browser at save time.
// A separate PNG lets Apple strip stamps remain dynamic without paying for browser
// fonts/canvas on every Supabase Edge Function pass request.
const REWARD_SIZE={width:315,height:26,scale:2};
const color=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:'#FFFFFF';
function lightness(v){
  const h=color(v).slice(1);
  const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)
    .map(n=>n<.04045?n/12.92:((n+.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
}
function contrast(a,b){const x=lightness(a),y=lightness(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function rewardLabelColor(design){
  const manual=design.apple?.rewardTextColor;
  if(/^#[0-9a-f]{6}$/i.test(manual||''))return manual;
  const bg=color(design.apple?.colors?.secondary||design.colors?.secondary||'#2448F0');
  const preferred=color(design.apple?.colors?.text||design.colors?.text||'#FFFFFF');
  return contrast(bg,preferred)>=4.5?preferred:
    contrast(bg,'#FFFFFF')>=contrast(bg,'#1C1F24')?'#FFFFFF':'#1C1F24';
}
export async function createRewardLabel(design){
  const size=REWARD_SIZE;
  const canvas=document.createElement('canvas');
  canvas.width=size.width*size.scale;canvas.height=size.height*size.scale;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Impossible de générer le texte de récompense.');
  ctx.scale(size.scale,size.scale);
  const value=String(design.apple?.rewardText||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,64);
  if(!value)throw new Error('Indiquez un texte de récompense.');
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=rewardLabelColor(design);
  // Platform-system font; sizing computed here, never during pass signing.
  let fontSize=17;
  const font=px=>{ctx.font=`700 ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Arial, sans-serif`;};
  while(fontSize>11){font(fontSize);if(ctx.measureText(value).width<=size.width-10)break;fontSize--;}
  font(fontSize);
  let rendered=value;
  while(rendered.length>1&&ctx.measureText(rendered).width>size.width-10)
    rendered=rendered.slice(0,-1).trimEnd();
  if(rendered!==value)rendered=rendered.replace(/…?$/,'')+'…';
  ctx.fillText(rendered,size.width/2,size.height/2,size.width-10);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob||blob.size>2097152)throw new Error('Image de récompense trop lourde.');
  return blob;
}
