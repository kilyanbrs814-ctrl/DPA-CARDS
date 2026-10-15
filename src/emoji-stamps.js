// A searchable native-Unicode emoji picker for the DPA admin card designer.
// Uses the lightweight Apache-2.0 emoji-picker-element and the French dataset,
// loaded on demand, never at app startup. No proprietary Apple/Samsung image packs.
// If the optional CDN is offline, the curated list and direct emoji entry still work.
const QUICK = [
  ['🍔','burger hamburger sandwich snack fast food nourriture'],
  ['🍕','pizza pizzéria food tranche'],['🍟','frites french fries pommes'],
  ['🌮','tacos mexicain food'],['🌯','burrito wraps sandwich'],
  ['🍗','poulet chicken tenders'],['🥪','sandwich toast pain'],
  ['🥙','kebab pain sandwich'],['🍣','sushi poisson japonais'],
  ['🍜','nouilles ramen asiatique'],['🍝','pâtes spaghetti pasta'],
  ['🍚','riz rice'],['🥗','salade salad légumes'],['🥐','croissant boulangerie viennoiserie'],
  ['🥖','baguette pain bakery boulangerie'],['🍞','pain bread'],
  ['🥨','bretzel'],['🍩','donut doughnut'],['🧁','cupcake gâteau'],
  ['🍰','gâteau pâtisserie cake'],['🎂','anniversaire birthday cake'],
  ['🍪','cookie biscuit'],['🍫','chocolat chocolate'],['🍦','glace ice cream'],
  ['🍨','crème glacée icecream'],['🍧','sorbet glace'],['🍿','popcorn cinéma'],
  ['☕','café coffee boisson'],['🥤','soda boisson gobelet'],
  ['🧋','bubble tea thé boba'],['🍵','thé matcha tea'],
  ['🧃','jus fruit juice'],['🥛','lait milk'],['💧','eau water'],
  ['🍓','fraise strawberry'],['🍎','pomme apple'],['🍋','citron lemon'],
  ['🍉','pastèque watermelon'],['🍒','cerise cherry'],['🍌','banane banana'],
  ['🍍','ananas pineapple'],['🥑','avocat avocado'],['🫒','olive olives'],
  ['💅','onglerie ongle vernis beauté nails manucure'],
  ['💇','coiffure coiffeur hair haircut salon'],['💈','barbier barbershop'],
  ['✂️','ciseaux coiffeur haircut scissors'],['💄','rouge à lèvres maquillage lipstick'],
  ['💋','bisou beauté lèvres kiss'],['🪮','peigne coiffure comb'],
  ['🧴','soin crème lotion beauté'],['🧼','savon soap'],['🛁','spa bain beauté'],
  ['🧖','spa détente wellness'],['🪞','miroir mirror beauty'],
  ['🧖‍♀️','spa femme relaxation'],['🌸','fleur floral flower'],
  ['🌹','rose fleur'],['🌻','tournesol sunflower'],
  ['💐','bouquet fleurs flower'],['🌷','tulipe fleur'],
  ['🚗','voiture car automobile garage'],['🚕','taxi voiture'],
  ['🚙','véhicule suv voiture'],['🏎️','sport car voiture racing'],
  ['🛞','pneu roue wheel garage'],['🧽','éponge sponge lavage nettoyage carwash'],
  ['🧹','balai nettoyage clean'],['🫧','bulles lavage bubbles savon'],
  ['🛠️','outils réparation garage tools'],['🔧','clé outil réparation wrench'],
  ['🚲','vélo bicycle bike'],['🛵','scooter moto'],['✈️','avion voyage travel'],
  ['🏨','hôtel hotel chambre'],['🛎️','service réception bell hotel'],
  ['🛏️','lit hôtel bed'],['🏖️','plage beach vacances'],
  ['🛍️','shopping sac achats boutique bag'],['👗','robe mode vêtements fashion'],
  ['👕','tshirt vêtements fashion'],['👟','basket chaussure shoes'],
  ['🧢','casquette cap'],['👜','sac handbag'],['💍','bague bijoux ring'],
  ['⌚','montre watch'],['💎','diamant diamant luxe diamond'],
  ['🎁','cadeau gift récompense reward'],['🎀','ruban bow cadeau'],
  ['🎟️','ticket billet voucher'],['🏷️','étiquette prix tag'],
  ['🪙','pièce coin récompense'],['💰','argent money'],['🏆','coupe trophée prize'],
  ['🥇','médaille or gold'],['⭐','étoile star'],['🌟','étoile brilliante sparkle'],
  ['✨','paillettes sparkle stars'],['💖','coeur brillant heart'],
  ['❤️','coeur heart amour'],['😍','visage amour love'],
  ['😊','sourire smile'],['👍','pouce like oui'],
  ['👌','ok parfait'],['✅','coche check validé'],['🔥','feu fire'],
  ['⚡','éclair energy'],['👑','couronne royal crown'],
  ['🎯','cible objectif target'],['🎉','fête celebration party'],
  ['🎈','ballon fête balloon'],['🎵','musique music note'],
  ['🎬','cinéma movie film'],['🎮','jeu vidéo gaming'],
  ['⚽','football foot soccer'],['🏀','basketball ballon basket'],
  ['🏋️','fitness sport gym'],['🧘','yoga meditation'],
  ['🐱','chat cat animal'],['🐶','chien dog animal'],
  ['🐾','patte animal paw'],['🦋','papillon butterfly'],
  ['🐝','abeille bee'],['🐟','poisson fish'],
  ['🌞','soleil sun'],['🌙','lune moon'],['🌈','arc en ciel rainbow'],
  ['🍀','chance trèfle lucky clover'],['🌿','plante nature leaf'],
  ['🎨','art palette peinture'],['📚','livres book'],
  ['🖊️','stylo pen'],['📸','photo appareil photo camera'],
  ['💻','ordinateur computer'],['📱','téléphone phone smartphone']
];
export const DEFAULT_STAMP_EMOJI = '⭐';
export const QUICK_EMOJIS = QUICK;
const RE_EMOJI = /\p{Extended_Pictographic}/u;
export function normalizeStampEmoji(value) {
  if (typeof value !== 'string') return '';
  const emoji = value.trim();
  if (!emoji || [...emoji].length > 16 || !RE_EMOJI.test(emoji)) return '';
  return emoji;
}
function normalizeSearch(input) {
  return String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
export function filterQuickEmojis(input, limit = 70) {
  const needle = normalizeSearch(input);
  return QUICK.filter(([emoji,tags]) => !needle || normalizeSearch(tags).includes(needle) || emoji===input).slice(0,limit);
}
let loading = null;
function loadFullPicker() {
  if (!loading) {
    const source = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.29.1/index.js';
    loading = import(/* @vite-ignore */ source).catch(e => { loading=null; throw e; });
  }
  return loading;
}
export function makeEmojiPicker(React) {
  const { useState, useEffect, useRef } = React, h = React.createElement;
  return function EmojiPicker({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const ref = useRef(null);
    useEffect(() => {
      if (!open || !ref.current) return;
      let active = true, picker = null;
      setStatus('Chargement du catalogue complet…');
      loadFullPicker().then(() => {
        if (!active || !ref.current) return;
        picker = document.createElement('emoji-picker');
        picker.setAttribute('locale','fr');
        picker.setAttribute('data-source','https://cdn.jsdelivr.net/npm/emoji-picker-element-data@1.8.0/fr/emojibase/data.json');
        picker.style.cssText = 'width:100%;max-width:380px;--emoji-size:1.65rem;';
        picker.addEventListener('emoji-click', onPick);
        ref.current.appendChild(picker);
        setStatus('');
      }).catch(() => { if(active) setStatus('Catalogue complet indisponible. Recherche rapide ou saisie directe ci-dessous.'); });
      function onPick(event) {
        const next = normalizeStampEmoji(event.detail?.unicode || event.detail?.emoji?.unicode);
        if (next) { onChange(next); setOpen(false); }
      }
      return () => {
        active = false;
        if (picker) { picker.removeEventListener('emoji-click', onPick); picker.remove(); }
      };
    }, [open, onChange]);
    const quick = filterQuickEmojis(search,80);
    return h('div', {'data-emoji-picker':true,style:{display:'flex',flexDirection:'column',gap:9}},
      h('div',{style:{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}},
        h('button',{type:'button',onClick:()=>setOpen(v=>!v),'aria-expanded':open,style:{display:'flex',alignItems:'center',gap:9,minHeight:44,padding:'7px 14px',border:'1px solid #D4D1C9',borderRadius:12,background:'#FFFFFF',cursor:'pointer',fontWeight:650}},
          h('span',{style:{fontSize:26,fontFamily:"'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"}},value||DEFAULT_STAMP_EMOJI),
          open?'Fermer les emojis':'Rechercher un emoji'),
        h('label',{style:{flex:'1 1 145px',display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'#5E636B'}},'Coller un emoji',
          h('input',{value:value||'',maxLength:28,'aria-label':'Emoji personnalisé',onChange:e=>{const x=normalizeStampEmoji(e.target.value);if(x)onChange(x);},placeholder:'🍔',style:{border:'1px solid #D4D1C9',borderRadius:10,padding:'8px 12px',fontSize:24,width:'100%',boxSizing:'border-box'}}))),
      open?h('div',{style:{padding:12,border:'1px solid #E4E1DA',borderRadius:12,background:'#F8F7F4',display:'flex',flexDirection:'column',gap:9}},
        h('input',{value:search,onChange:e=>setSearch(e.target.value),placeholder:'Rechercher : burger, coiffure, café…','aria-label':'Rechercher parmi les emojis courants',style:{width:'100%',boxSizing:'border-box',height:42,border:'1px solid #D4D1C9',borderRadius:10,padding:'0 12px'}}),
        h('div',{role:'group','aria-label':'Emojis populaires',style:{display:'flex',flexWrap:'wrap',gap:5,maxHeight:154,overflowY:'auto'}},
          ...quick.map(([emoji,tags])=>h('button',{key:emoji,type:'button',title:tags,'aria-label':tags.split(' ').slice(0,4).join(' '),onClick:()=>{onChange(emoji);setOpen(false);},style:{background:'#FFFFFF',border:'1px solid #E4E1DA',borderRadius:9,fontSize:24,minWidth:40,minHeight:40,cursor:'pointer'}},emoji))),
        h('div',{ref,style:{maxHeight:380,overflow:'auto'}}),
        status?h('small',{role:'status',style:{color:'#5E636B'}},status):null):null,
      h('small',{style:{color:'#5E636B',lineHeight:1.4}},'Les emojis sont des caractères Unicode : l’aperçu utilise ceux du téléphone. Les images des passes Wallet peuvent différer selon la plateforme.'));
  };
}
