import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
const token=process.env.GH_TOKEN,repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA;
if(!token||repo!=='kilyanbrs814-ctrl/DPA-CARDS'||!sha)throw new Error('Unexpected repository context');
async function api(route,method='GET',body){
 const r=await fetch('https://api.github.com/repos/'+repo+route,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw new Error(method+' '+route+' '+r.status+' '+await r.text());
 return r.status===204?null:r.json();
}
const folder='app-store-output',manifest=JSON.parse(fs.readFileSync(folder+'/manifest.json','utf8'));
if(manifest.files.length!==11)throw new Error('Expected 5 iPhone and 6 iPad screenshots');
const branch='generated/app-store-captures';
let head;
try{head=await api('/git/ref/heads/'+branch);}catch(e){if(!String(e).includes('404'))throw e;const created=await api('/git/refs','POST',{ref:'refs/heads/'+branch,sha});head={object:created.object};}
const parent=head.object.sha,commit=await api('/git/commits/'+parent),tree=[];
for(const item of manifest.files){
 for(const relative of [item.file,item.ocr]){
  const blob=await api('/git/blobs','POST',{content:fs.readFileSync(path.join(folder,relative)).toString('base64'),encoding:'base64'});
  tree.push({path:'app-store/captures/'+relative,mode:'100644',type:'blob',sha:blob.sha});
 }
 const preview=item.file.replace(/\.png$/,'.jpg'),target=path.join(folder,'previews',preview);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 cp.execFileSync('sips',['-Z','720','-s','format','jpeg',path.join(folder,item.file),'--out',target],{stdio:'ignore'});
 const blob=await api('/git/blobs','POST',{content:fs.readFileSync(target).toString('base64'),encoding:'base64'});
 tree.push({path:'app-store/captures/previews/'+preview,mode:'100644',type:'blob',sha:blob.sha});
}
const blob=await api('/git/blobs','POST',{content:JSON.stringify(manifest,null,2),encoding:'utf-8'});
tree.push({path:'app-store/captures/manifest.json',mode:'100644',type:'blob',sha:blob.sha});
const t=await api('/git/trees','POST',{base_tree:commit.tree.sha,tree});
const c=await api('/git/commits','POST',{message:'Capture native DPA Cards iPhone and iPad screens',tree:t.sha,parents:[parent]});
await api('/git/refs/heads/'+branch,'PATCH',{sha:c.sha,force:false});
console.log('Captures committed: '+c.sha);
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Native App Store captures\n\n11 screenshots generated from the current native interface with fictional review data.\n\nhttps://github.com/'+repo+'/tree/'+c.sha+'/app-store/captures\n');
