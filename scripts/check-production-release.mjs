import assert from 'node:assert/strict';
const origin='https://cards.digitalprojectagency.fr';
const expected=process.env.GITHUB_SHA;
const deadline=Date.now()+10*60*1000;
let current;
while(Date.now()<deadline) {
  try {
    const response=await fetch(origin+'/release.json?revision='+expected,{cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(response.ok) {
      current=await response.json();
      if(current.revision===expected) break;
    }
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,20000));
}
assert.equal(current?.revision,expected,'Production is still serving another commit');
for(const [path,magic] of [['DPA-Cards-Windows.exe','MZ'],['Guide-DPA-Cards-mobile.pdf','%PDF']]) {
  const response=await fetch(origin+'/downloads/'+path,{headers:{range:'bytes=0-7'},signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,path+' is unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0,magic.length)).toString(),magic,path+' has invalid content');
}
const page=await fetch(origin+'/?revision='+expected,{signal:AbortSignal.timeout(30000)});
const html=await page.text();
assert.ok(html.includes('data-dpa-demo-qr'));
const merchant=await fetch(origin+'/connexion?revision='+expected,{signal:AbortSignal.timeout(30000)});
assert.ok((await merchant.text()).includes('data-dpa-guide-start'));
console.log('Site public '+current.appVersion+' · '+current.releaseId+' · '+current.revision.slice(0,8)+' vérifié, téléchargements disponibles.');
