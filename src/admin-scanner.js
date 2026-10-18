import { makeCameraView,requestCamera,parseCode,canUseCamera } from './scanner.js';

// Administrator scanner: actual QR detection plus authorized server lookup.
// For real customers the admin can inspect the card; the merchant scanner
// remains the only place where real paid balances are credited.
export function makeAdminScanner(React,api){
  const h=React.createElement,CameraView=makeCameraView(React);
  const cardBox={background:'#FFFFFF',border:'1px solid #E4E1DA',borderRadius:18,padding:20};
  const action=(label,fn,dark=false,disabled=false)=>h('button',{type:'button',disabled,onClick:fn,
    style:{borderRadius:12,minHeight:46,border:dark?'none':'1.5px solid #D4D1C9',background:dark?'#2448F0':'#FFFFFF',color:dark?'#FFFFFF':'#1C1F24',fontWeight:700,padding:'0 16px',cursor:disabled?'not-allowed':'pointer'}},label);
  return function AdminScanner(){
    const [code,setCode]=React.useState(''),[result,setResult]=React.useState(null),[status,setStatus]=React.useState(''),[loading,setLoading]=React.useState(false),[stream,setStream]=React.useState(null);
    const current=React.useRef(null),lock=React.useRef(false);
    const stop=()=>{
      const old=current.current;current.current=null;
      if(old)for(const t of old.getTracks())t.stop();
      setStream(null);
    };
    React.useEffect(()=>()=>{if(current.current)for(const t of current.current.getTracks())t.stop();},[]);
    const lookup=async input=>{
      if(lock.current)return false;
      const parsed=parseCode(input);
      if(!['qr','demo'].includes(parsed.kind)){setStatus('Présentez un QR code DPA Cards (DPA1 ou DPA_TEST).');return false;}
      lock.current=true;setLoading(true);setResult(null);setStatus('');
      try{const response=await api.lookup(parsed.code);setCode(parsed.code);setResult(response);stop();setStatus('Carte identifiée.');return true;}
      catch(e){setStatus(e.code==='card_not_found'?'Carte introuvable.':e.code==='merchant_forbidden'?'Ce commerce ne fait pas partie de vos accès.':'Lecture impossible. Vérifiez le QR et réessayez.');return false;}
      finally{lock.current=false;setLoading(false);}
    };
    const start=async()=>{
      setResult(null);setStatus('');
      if(!canUseCamera()){setStatus('Caméra indisponible : saisissez ou collez le QR code.');return;}
      try{stop();const media=await requestCamera();current.current=media;setStream(media);}
      catch{setStatus('Autorisez la caméra dans votre navigateur, ou collez le contenu du QR code.');}
    };
    const addTest=async()=>{
      if(!result||result.kind!=='test'||loading)return;
      setLoading(true);
      try{const t=result.card;const next=await api.addTest(t.code,t.progress);
        setResult({kind:'test',card:{...t,progress:next.test?.progress??t.progress+1}});
        setStatus('Tampon test ajouté.');}
      catch(e){setStatus(e.code==='test_progress_changed'?'La carte a changé : rescanez-la.':'Le tampon test n’a pas pu être ajouté.');}
      finally{setLoading(false);}
    };
    const c=result?.card;
    return h('section',{style:{display:'flex',flexDirection:'column',gap:18},'data-admin-scanner':true},
      h('div',null,h('h1',{style:{fontSize:34,fontWeight:800,margin:'0 0 6px'}},'Scanner une carte'),
        h('p',{style:{margin:0,color:'#5E636B',fontSize:15}},'Scannez le QR code d’un client ou d’une carte test depuis l’administration DPA Cards.')),
      h('div',{style:cardBox},
        h('div',{style:{display:'flex',gap:10,flexWrap:'wrap'}},
          action(stream?'Redémarrer la caméra':'Ouvrir la caméra',start,true,loading),
          stream&&action('Arrêter la caméra',stop,false,loading)),
        stream&&h('div',{style:{marginTop:16,position:'relative',height:280,maxWidth:500,background:'#171C2A',borderRadius:16,overflow:'hidden'}},
          h(CameraView,{stream,onCode:text=>{lookup(text);return true;},onDecodeError:()=>setStatus('Impossible de lire ce QR avec la caméra : copiez-le ci-dessous.'),onEnded:()=>setStream(null)})),
        h('form',{onSubmit:e=>{e.preventDefault();lookup(code);},style:{marginTop:18,display:'flex',flexWrap:'wrap',alignItems:'end',gap:10}},
          h('label',{style:{display:'flex',flex:'1 1 300px',flexDirection:'column',gap:7,fontWeight:700}},'QR code DPA1 / DPA_TEST',
            h('input',{type:'text',value:code,onChange:e=>setCode(e.target.value),autoComplete:'off',placeholder:'DPA1:… ou DPA_TEST:…',
              style:{height:48,width:'100%',boxSizing:'border-box',border:'1.5px solid #D4D1C9',borderRadius:10,padding:'0 12px',fontSize:15}})),
          action(loading?'Recherche…':'Rechercher',()=>lookup(code),true,loading)),
        status&&h('p',{role:'status',style:{color:'#2448F0',margin:'12px 0 0'}},status)),
      c&&h('div',{style:cardBox},
        h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}},
          h('h2',{style:{margin:0,fontSize:22}},result.kind==='test'?'Carte de démonstration':'Carte client · '+c.merchant),
          h('span',{style:{background:'#EEF1FF',color:'#2448F0',padding:'6px 12px',borderRadius:99,fontWeight:700}},result.kind==='test'?'TEST':'CARTE RÉELLE')),
        h('p',{style:{fontSize:17,fontWeight:700}},result.kind==='test'?c.name:c.name+' · '+c.number),
        h('p',{style:{fontSize:18,margin:'10px 0'}},'Progression : '+c.progress+' / '+c.goal),
        result.kind==='test'
          ? action('Ajouter un tampon test',addTest,true,loading||c.progress>=c.goal)
          : h('p',{style:{fontSize:14,color:'#5E636B',lineHeight:1.5}},'Carte réelle identifiée : l’ajout de passages se fait dans le scanner du commerce, avec les droits du commerçant.')));
  };
}
