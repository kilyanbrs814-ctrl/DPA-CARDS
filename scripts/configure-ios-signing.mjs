import {readFileSync,writeFileSync} from 'node:fs';
export function configureAppProfile(project,profile){
 if(!profile||/[\r\n]/.test(profile))throw Error('Missing or invalid app provisioning profile name');
 let count=0;
 const result=project.replace(/buildSettings = \{([\s\S]*?)\};/g,(all,settings)=>{
   if(!/PRODUCT_BUNDLE_IDENTIFIER\s*=/.test(settings))return all;
   count++;
   const cleaned=settings.replace(/\n\s*(?:PROVISIONING_PROFILE_SPECIFIER|CODE_SIGN_STYLE|DEVELOPMENT_TEAM|CODE_SIGN_IDENTITY)\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^;]*);/g,'');
   return 'buildSettings = {'+cleaned.trimEnd()+'\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = '+JSON.stringify(profile)+';\n\t\t\t\tCODE_SIGN_STYLE = Manual;\n\t\t\t\tDEVELOPMENT_TEAM = HDK7R3283T;\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";\n\t\t\t};';
 });
 if(count!==2)throw Error('Expected exactly two App target build configurations; found '+count);
 return result;
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').pop())){
 const file=process.argv[2];if(!file)throw Error('Provide the App project.pbxproj path');
 writeFileSync(file,configureAppProfile(readFileSync(file,'utf8'),process.env.IOS_PROFILE_NAME));
 console.log('Provisioning profile configured only on the App target.');
}
