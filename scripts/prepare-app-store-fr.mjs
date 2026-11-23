import {appStoreApi as api} from './app-store-api.mjs';
const app=process.env.APP_STORE_APP_ID;
const locale='fr-FR', version=process.env.MARKETING_VERSION||'1.3';
const versions=await api('/apps/'+app+'/appStoreVersions?filter[platform]=IOS&limit=100');
let draft=versions.data.find(item=>item.attributes.versionString===version);
if (!draft) {
  const editable=versions.data.find(item=>['PREPARE_FOR_SUBMISSION','DEVELOPER_REJECTED','REJECTED'].includes(item.attributes.appStoreState));
  if (editable) {
    const updated=await api('/appStoreVersions/'+editable.id,'PATCH',{type:'appStoreVersions',id:editable.id,attributes:{versionString:version}});
    draft=updated.data;
  }
}
if (!draft) {
  const created=await api('/appStoreVersions','POST',{type:'appStoreVersions',attributes:{platform:'IOS',versionString:version,releaseType:'MANUAL'},relationships:{app:{data:{type:'apps',id:app}}}});
  draft=created.data;
}
const infos=await api('/apps/'+app+'/appInfos?limit=20');
const info=infos.data.find(item=>item.attributes.appStoreState==='PREPARE_FOR_SUBMISSION')||infos.data[0];
if (!info) throw new Error('App information unavailable');
const appLocales=await api('/appInfos/'+info.id+'/appInfoLocalizations?limit=50');
const frenchInfo=appLocales.data.find(item=>item.attributes.locale===locale);
if (!frenchInfo) await api('/appInfoLocalizations','POST',{type:'appInfoLocalizations',attributes:{locale,name:'DPA Cards',subtitle:'La fidélité de vos clients'},relationships:{appInfo:{data:{type:'appInfos',id:info.id}}}});
await api('/apps/'+app,'PATCH',{type:'apps',id:app,attributes:{primaryLocale:locale}});
const attributes={
  description:'Gérez la fidélité de votre commerce depuis votre iPhone ou iPad.\n\n• Retrouvez vos clients et leurs cartes de fidélité.\n• Scannez les QR codes et validez les passages en caisse.\n• Suivez les tampons, les points et les récompenses.\n• Consultez votre programme Apple Wallet et Google Wallet.\n• Gérez plusieurs commerces depuis un seul compte.\n• Échangez avec DPA Cards depuis la rubrique Support.\n• Découvrez les outils grâce au guide de démarrage.\n\nDPA Cards est une application compagnon gratuite destinée aux commerçants disposant d’un compte DPA Cards actif. Une connexion Internet est nécessaire.',
  whatsNew:'Cette mise à jour ajoute le guide de démarrage, la messagerie Support et les tableaux de bord animés. Les logos suivent le thème clair ou sombre, et la navigation entre les rubriques a été améliorée.',
  keywords:'fidélité,commerce,carte,wallet,clients,tampons,points,récompenses,scanner',
  supportUrl:'https://cards.digitalprojectagency.fr/#contact',
  marketingUrl:'https://cards.digitalprojectagency.fr/',
};
const localizations=await api('/appStoreVersions/'+draft.id+'/appStoreVersionLocalizations?limit=50');
const french=localizations.data.find(item=>item.attributes.locale===locale);
if (french) await api('/appStoreVersionLocalizations/'+french.id,'PATCH',{type:'appStoreVersionLocalizations',id:french.id,attributes});
else await api('/appStoreVersionLocalizations','POST',{type:'appStoreVersionLocalizations',attributes:{locale,...attributes},relationships:{appStoreVersion:{data:{type:'appStoreVersions',id:draft.id}}}});
const appCheck=await api('/apps/'+app+'?fields[apps]=primaryLocale');
if (appCheck.data.attributes.primaryLocale!==locale) throw new Error('French primary language was not saved');
console.log('Fiche française enregistrée pour DPA Cards '+version+'.');
