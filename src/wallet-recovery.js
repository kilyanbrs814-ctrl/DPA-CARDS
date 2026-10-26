import QRCode from 'qrcode';

// Reissue installation links for an existing card. The existing authenticated
// endpoints enforce membership, selected workspace, card ownership and access.
export async function createRecoveryLink(api, cardId, platform) {
  if (!cardId || !['apple','google'].includes(platform)) throw new Error('invalid_card');
  const result=platform==='apple' ? await api.appleWalletLink(cardId) : await api.walletLink(cardId);
  const url=new URL(result?.url || '');
  if (url.protocol!=='https:') throw new Error('wallet_unavailable');
  const qr=await QRCode.toDataURL(url.href,{margin:2,width:256,errorCorrectionLevel:'M'});
  return {url:url.href,qr,platform};
}

export function makeWalletRecoveryPanel(React) {
  const h=React.createElement;
  const button={minHeight:44,padding:'10px 12px',border:'1px solid #D4D1C9',borderRadius:12,
    background:'#FFFFFF',color:'#2448F0',fontSize:14,fontWeight:700,cursor:'pointer'};
  return function WalletRecoveryPanel({api,cardId,merchantId}) {
    const [platform,setPlatform]=React.useState(null),[links,setLinks]=React.useState({});
    const [loading,setLoading]=React.useState(false),[error,setError]=React.useState('');
    const [copied,setCopied]=React.useState(false),[copyError,setCopyError]=React.useState('');
    const sequence=React.useRef(0);
    const requests=React.useRef({});
    React.useEffect(()=>{
      sequence.current++;requests.current={};setPlatform(null);setLinks({});setLoading(false);setError('');setCopied(false);setCopyError('');
      return ()=>{sequence.current++;};
    },[cardId,merchantId]);
    const load=async target=>{
      const request=++sequence.current;
      setPlatform(target);setError('');setCopied(false);setCopyError('');
      if(links[target]){setLoading(false);return;}
      setLoading(true);
      // Switching platforms or double clicking must not issue competing Apple
      // tokens: a new token replaces the previous link on the server.
      const pending=requests.current[target] || (requests.current[target]=createRecoveryLink(api,cardId,target));
      try {
        const result=await pending;
        if(request!==sequence.current)return;
        setLinks(previous=>({...previous,[target]:result}));setLoading(false);
      } catch(e) {
        if(requests.current[target]===pending)delete requests.current[target];
        if(request!==sequence.current)return;
        setLoading(false);setError(api.errorMessage(e));
      }
    };
    const result=links[platform],name=platform==='google'?'Google Wallet':'Apple Wallet';
    const copy=async()=>{
      const request=sequence.current;setCopied(false);setCopyError('');
      try {await navigator.clipboard.writeText(result.url);if(request===sequence.current)setCopied(true);}
      catch {if(request===sequence.current)setCopyError('Copie impossible. Sélectionnez le lien ci-dessous pour le copier.');}
    };
    return h('section',{'aria-label':'Récupérer la carte du client','data-wallet-recovery':true,
      style:{marginTop:18,padding:16,border:'1px solid #E4E1DA',borderRadius:16,background:'#F8F7F4',
        display:'flex',flexDirection:'column',gap:12,textAlign:'left',minWidth:0}},
      h('h3',{style:{margin:0,fontSize:17,lineHeight:1.3}},'Remettre la carte sur le téléphone'),
      h('p',{style:{margin:0,fontSize:13,color:'#4A4E55',lineHeight:1.5}},
        'Le client a supprimé sa carte ? Choisissez son téléphone pour retrouver le lien et le QR code. Sa carte et ses tampons sont conservés.'),
      h('div',{role:'group','aria-label':'Téléphone du client',style:{display:'flex',gap:8,flexWrap:'wrap'}},
        ...[['apple','iPhone · Apple Wallet'],['google','Android · Google Wallet']].map(([key,label])=>h('button',{
          key,type:'button','aria-pressed':platform===key,onClick:()=>load(key),
          style:{...button,flex:'1 1 100%',borderColor:platform===key?'#2448F0':'#D4D1C9',background:platform===key?'#EEF1FF':'#FFFFFF'}},label))),
      loading&&h('div',{role:'status',style:{fontSize:14}},'Préparation du lien…'),
      error&&h('div',null,h('p',{role:'alert',style:{margin:'0 0 10px',color:'#B42318',fontSize:13}},error),
        h('button',{type:'button',onClick:()=>load(platform),style:button},'Réessayer')),
      result&&!loading&&!error&&h(React.Fragment,null,
        h('p',{style:{margin:0,fontSize:13,lineHeight:1.5}},'Faites scanner ce QR code par le client ou envoyez-lui le lien pour ajouter sa carte à '+name+'.'),
        h('img',{src:result.qr,alt:'QR code pour remettre la carte dans '+name,width:208,height:208,
          style:{alignSelf:'center',width:208,maxWidth:'100%',height:'auto',borderRadius:10,background:'#FFFFFF'}}),
        h('label',{style:{display:'flex',flexDirection:'column',gap:6,fontSize:12,fontWeight:600}},'Lien de récupération '+name,
          h('input',{readOnly:true,value:result.url,onFocus:e=>e.currentTarget.select(),
            style:{width:'100%',boxSizing:'border-box',height:44,padding:'0 10px',border:'1px solid #D4D1C9',borderRadius:10,fontSize:12,background:'#FFFFFF',minWidth:0}})),
        h('button',{type:'button',onClick:copy,style:{...button,background:'#2448F0',color:'#FFFFFF',borderColor:'#2448F0'}},'Copier le lien'),
        copied&&h('div',{role:'status',style:{fontSize:13,color:'#17583A'}},'Lien copié.'),
        copyError&&h('div',{role:'alert',style:{fontSize:13,color:'#B42318'}},copyError),
        h('a',{href:result.url,target:'_blank',rel:'noopener noreferrer',style:{fontSize:13,color:'#2448F0',textAlign:'center',padding:8}},'Ouvrir sur cet appareil'),
        platform==='apple'&&h('p',{style:{fontSize:12,color:'#5E636B',margin:0,lineHeight:1.4}},'Lien Apple valable 7 jours. Un nouveau lien Apple remplace le précédent.')));
  };
}
