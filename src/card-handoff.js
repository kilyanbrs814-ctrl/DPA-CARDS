import {createRecoveryLink} from './wallet-recovery.js';

// Installation links belong to the card just enrolled. This panel never enrolls
// a customer, opens a Wallet on the merchant's device or changes the balance.
export function makeCardHandoffPanel(React) {
  const h=React.createElement;
  return function CardHandoffPanel({api,cardId,merchantId}) {
    const [entries,setEntries]=React.useState({});
    const [copyMessage,setCopyMessage]=React.useState(null);
    const version=React.useRef(0),requests=React.useRef({});
    const load=(platform,current=version.current)=>{
      if(requests.current[platform])return;
      setEntries(previous=>({...previous,[platform]:{loading:true}}));
      const pending=createRecoveryLink(api,cardId,platform);
      requests.current[platform]=pending;
      pending.then(result=>{
        if(current===version.current)setEntries(previous=>({...previous,[platform]:{result}}));
      }).catch(error=>{
        if(current===version.current)setEntries(previous=>({...previous,[platform]:{error:api.errorMessage(error)}}));
      }).finally(()=>{if(requests.current[platform]===pending)delete requests.current[platform];});
    };
    React.useEffect(()=>{
      const current=++version.current;
      requests.current={};setEntries({});setCopyMessage(null);
      load('apple',current);load('google',current);
      return()=>{version.current++;};
    },[api,cardId,merchantId]);
    const copy=async(platform,url)=>{
      const current=version.current;
      try {
        if(!navigator.clipboard?.writeText)throw new Error('clipboard_unavailable');
        await navigator.clipboard.writeText(url);
        if(current===version.current)setCopyMessage({platform,text:'Lien copié.',error:false});
      } catch {
        if(current===version.current)setCopyMessage({platform,text:'Copie impossible. Faites scanner le QR code.',error:true});
      }
    };
    return h('div',{className:'dpa-card-handoff','aria-label':'QR codes pour installer la carte du client'},
      ...[['apple','iPhone','Apple Wallet'],['google','Android','Google Wallet']].map(([platform,phone,wallet])=>{
        const entry=entries[platform]||{loading:true};
        return h('section',{key:platform,className:'dpa-glass-surface dpa-card-handoff-option','aria-label':phone+' · '+wallet},
          h('h3',null,phone),h('p',null,wallet),
          entry.loading&&h('div',{role:'status',className:'dpa-card-handoff-loading'},'Préparation du QR code…'),
          entry.error&&h(React.Fragment,null,
            h('p',{role:'alert'},entry.error),
            h('button',{type:'button',onClick:()=>load(platform)},'Réessayer pour '+phone)),
          entry.result&&h(React.Fragment,null,
            h('div',{'data-dpa-artwork':'','data-dpa-theme-qr':'',className:'dpa-card-handoff-qr'},
              h('img',{src:entry.result.qr,alt:'QR code pour ajouter la carte à '+wallet,width:240,height:240})),
            h('button',{type:'button',onClick:()=>copy(platform,entry.result.url)},'Copier le lien '+phone)),
          copyMessage?.platform===platform&&h('p',{role:copyMessage.error?'alert':'status'},copyMessage.text));
      }));
  };
}
