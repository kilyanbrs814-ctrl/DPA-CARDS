const hex=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toUpperCase():fallback;
const luminance=c=>{const a=c.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
export function registrationPage(program={}) {
 const raw=program.registrationPage||{},bg=hex(raw.bg,hex(program.bg,'#FFFFFF')),auto=luminance(bg)>.179?'#1C1F24':'#FFFFFF';
 const chosen=hex(raw.fg,auto),ratio=(Math.max(luminance(bg),luminance(chosen))+.05)/(Math.min(luminance(bg),luminance(chosen))+.05);
 return {title:String(raw.title||'').trim().slice(0,120)||'Rejoignez le '+(program.name||'club fidélité'),description:String(raw.description||'').trim().slice(0,400),bg,fg:ratio>=4.5?chosen:auto,button:hex(raw.button,'#1C1F24')};
}
export function registrationPayload(raw={}) {
 return {title:String(raw.title||'').trim().slice(0,120),description:String(raw.description||'').trim().slice(0,400),bg:hex(raw.bg,'#FFFFFF'),fg:hex(raw.fg,'#1C1F24'),button:hex(raw.button,'#1C1F24')};
}
