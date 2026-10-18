const money=c=>(c/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const date=v=>new Date(v).toLocaleString('fr-FR',{dateStyle:'long',timeStyle:'short'});

export function makeProfileControls(React) {
 const h=React.createElement;
 const button={minHeight:46,padding:'10px 16px',border:'1px solid #D4D1C9',borderRadius:12,background:'#FFF',fontWeight:700};
 const primary={...button,background:'#2448F0',color:'#FFF',borderColor:'#2448F0'};
 return function ProfileControls({api,profiles,merchant,busy,onAdd,needsActivation,onActivated,initialChoice,onInitialDone,native=false}) {
  const [open,setOpen]=React.useState(false),[operation,setOperation]=React.useState(null),[quote,setQuote]=React.useState(null);
  const [working,setWorking]=React.useState(false),[error,setError]=React.useState(''),[confirmed,setConfirmed]=React.useState(false);
  const dialog=React.useRef(null),trigger=React.useRef(null);
  const [initial,setInitial]=React.useState(null);
  const run=async fn=>{if(working)return;setWorking(true);setError('');try{await fn();}catch(e){setError(api.errorMessage(e));}finally{setWorking(false);}};
  React.useEffect(()=>{
   if(native)return;
   if(initialChoice){setOpen(true);setInitial(initialChoice);setOperation(null);setConfirmed(false);
    if(native){setError('Cette application est réservée aux commerces déjà actifs.');return;}
    run(async()=>{const r=await api.billing.initialQuote(initialChoice.plan,initialChoice.billing);setQuote(r.quote);});}
  },[initialChoice]);
  React.useEffect(()=>{if(open){dialog.current?.focus();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;trigger.current?.focus();};}},[open]);
  // A return URL never grants access: resume asks the server to retrieve Stripe.
  React.useEffect(()=>{
   if(!native&&needsActivation && new URLSearchParams(location.search).has('profile_payment')){
    setOpen(true);run(async()=>{const r=await api.billing.profileResume();
     if(r.operation?.status==='complete'){history.replaceState(null,'','/');onActivated();return;}
     if(r.operation?.status==='cancelled'){setError(r.operation.stripe_refund_id?'Le paiement a été remboursé car votre facturation a changé. Actualisez le récapitulatif pour reprendre.':'Ce parcours de paiement a expiré. Vous pouvez reprendre l’activation.');return;}
     if(r.operation){setOperation(r.operation);setQuote(r.operation.quote);} });
   }
  },[merchant.id]);
  const close=()=>{if(working)return;setOpen(false);setQuote(null);setOperation(null);setInitial(null);setConfirmed(false);onInitialDone?.();};
  const getQuote=()=>{setOpen(true);setConfirmed(false);setInitial(null);if(native){setError('Achats intégrés Apple non configurés : ce parcours ne lance pas Stripe sur iPhone.');return;}run(async()=>{
   const r=await api.billing.profileQuote();setOperation(r.operation);setQuote(r.operation.quote);
  });};
  const pay=()=>{if(native){setError('Paiement Apple indisponible : aucun paiement Stripe n’est lancé dans l’app.');return;}return run(async()=>{
   if(!confirmed)return;
   const r=initial?await api.billing.checkout(initial.plan,initial.billing,quote):await api.billing.profileAccept(operation.id);
   if(r.operation?.status==='complete'){close();onActivated();return;}
   if(r.operation?.status==='cancelled'){setQuote(null);setOperation(null);setError('Le paiement a été remboursé car votre facturation a changé. Actualisez les montants pour reprendre.');return;}
   if(r.url)location.assign(r.url);
  });};
  const trap=e=>{
   if(e.key==='Escape'){e.preventDefault();close();}
   if(e.key==='Tab'){
    const nodes=dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]');
    const first=nodes[0],last=nodes[nodes.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  };
  const rows=quote?[
   ['Commerces facturés',`${quote.current_count} → ${quote.new_count}`],
   ['Activation unique du commerce',money(quote.activation_cents)],
   ['Montant mensuel actuel réel',money(quote.current_monthly_cents)],
   ['Nouveau total mensuel',money(quote.new_monthly_cents)],
   ['Différence mensuelle',money(quote.monthly_difference_cents)],
   ['Date d’effet',date(quote.effective_at)],
   ['Prorata',money(quote.proration_cents)+(quote.proration_collection==='next_invoice'?' · sur la prochaine facture':quote.proration_collection==='after_trial'?' · 15 jours d’essai, puis prorata jusqu’au 1er du mois':' · inclus au paiement immédiat')],
   ...(quote.access_end?[['Période prépayée conservée',`Jusqu’au ${date(quote.access_end)}`],['Renouvellement','Aucun renouvellement automatique']]:[]),
   ['À payer immédiatement',money(quote.immediate_cents)]
  ]:[];
  return h('div',{className:'dpa-profile-controls'},
   h('div',{style:{minWidth:0}},h('div',{style:{fontSize:12,color:'#5E636B'}},'Commerce actif'),h('strong',{style:{overflowWrap:'anywhere'}},merchant.business)),
   (!native||profiles.length>1)&&h('button',{ref:trigger,type:'button',style:button,disabled:busy||working,onClick:()=>{if(!native&&profiles.length===1&&merchant.id&&profiles[0].role==='owner'){onAdd();return;}setOpen(true);setError('');}},profiles.length>1?'Changer de profil':'Ajouter un profil'),
   !native&&needsActivation&&h('button',{type:'button',style:primary,disabled:busy||working,onClick:getQuote},'Activer ce commerce'),
   open&&h('div',{className:'dpa-profile-overlay',onClick:e=>{if(e.target===e.currentTarget)close();}},
    h('section',{ref:dialog,role:'dialog','aria-modal':true,'aria-labelledby':'profile-dialog-title',tabIndex:-1,onKeyDown:trap,className:'dpa-profile-dialog'},
     h('h2',{id:'profile-dialog-title',style:{margin:0,fontSize:24}},quote?'Confirmer les montants':'Vos commerces'),
     error&&h('p',{role:'alert',style:{color:'#B42318'}},error),
     working&&h('p',{role:'status'},'Vérification en cours…'),
     !quote&&!initial&&h(React.Fragment,null,
      ...profiles.map(p=>h('button',{key:p.id,type:'button',disabled:working||busy,'aria-current':p.id===merchant.id?'true':undefined,
       style:{...button,display:'flex',alignItems:'center',gap:12,textAlign:'left',borderColor:p.id===merchant.id?'#2448F0':'#D4D1C9'},
       onClick:()=>p.id!==merchant.id&&api.switchProfile(p.id)},p.logo&&h('img',{src:p.logo,alt:'',width:36,height:36,style:{objectFit:'contain',borderRadius:8}}),
       h('span',{style:{flex:1}},p.name),p.id===merchant.id&&h('span',{style:{color:'#2448F0'}},'Actif'))),
      !native&&merchant.id&&profiles.some(p=>p.id===merchant.id&&p.role==='owner')&&h('button',{type:'button',style:primary,disabled:working||busy,onClick:()=>{close();onAdd();}},'Ajouter un profil')),
     quote&&h(React.Fragment,null,
      h('dl',{style:{margin:0}},...rows.map(([k,v])=>h('div',{key:k,style:{display:'flex',justifyContent:'space-between',gap:16,padding:'12px 0',borderBottom:'1px solid #E4E1DA',flexWrap:'wrap'}},h('dt',null,k),h('dd',{style:{margin:0,fontWeight:700}},v)))),
      h('p',{style:{fontSize:14,color:'#5E636B',lineHeight:1.5}},'20 €/mois par commerce, sans remise dégressive. Les frais d’activation sont uniques et identiques avec ou sans engagement. Les modalités d’engagement existantes sont conservées.'),
      h('label',{style:{display:'flex',gap:12,alignItems:'flex-start',lineHeight:1.5}},h('input',{type:'checkbox',checked:confirmed,disabled:working,onChange:e=>setConfirmed(e.target.checked),style:{width:22,height:22,flexShrink:0}}),'Je confirme les montants ci-dessus et la modification de ma facturation.'),
      h('button',{type:'button',style:primary,disabled:native||!confirmed||working,onClick:pay},native?'Paiement Apple non disponible':'Confirmer et continuer vers le paiement'),
      !initial&&h('button',{type:'button',style:button,disabled:working,onClick:()=>run(async()=>{const r=await api.billing.profileCancel();if(r.operation?.status==='complete')onActivated();else{setOperation(null);setQuote(null);setConfirmed(false);}})},'Annuler ce parcours de paiement')),
     h('button',{type:'button',style:button,disabled:working,onClick:close},'Fermer'))));
 };
}
