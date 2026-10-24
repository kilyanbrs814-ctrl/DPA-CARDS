// Images PNG du catalogue DPA Cards : seules ces 33 références sont autorisées.
// Les couleurs originales marquent les passages effectués, la version grisée les passages restants.
export const STAMP_LIBRARY = [
  {
    "id": "pizza",
    "label": "Pizza",
    "tags": "pizzeria pizzéria restaurant"
  },
  {
    "id": "baguette",
    "label": "Baguette",
    "tags": "boulangerie pain"
  },
  {
    "id": "glace",
    "label": "Glace",
    "tags": "glacier sorbet"
  },
  {
    "id": "donut",
    "label": "Donut",
    "tags": "donuts pâtisserie"
  },
  {
    "id": "riz-crousty",
    "label": "Riz crousty",
    "tags": "riz poulet chicken fast food"
  },
  {
    "id": "ciseaux",
    "label": "Ciseaux",
    "tags": "coiffure femme salon"
  },
  {
    "id": "fleuriste",
    "label": "Bouquet",
    "tags": "fleurs fleuriste"
  },
  {
    "id": "barber",
    "label": "Enseigne barber",
    "tags": "barbier homme coiffeur"
  },
  {
    "id": "burger",
    "label": "Burger",
    "tags": "hamburger snack fast food"
  },
  {
    "id": "the",
    "label": "Thé",
    "tags": "tea salon boisson"
  },
  {
    "id": "carwash",
    "label": "Lavage auto",
    "tags": "voiture station auto nettoyage"
  },
  {
    "id": "spa",
    "label": "Spa",
    "tags": "massage bien être esthétique"
  },
  {
    "id": "vernis",
    "label": "Vernis",
    "tags": "ongles onglerie manucure"
  },
  {
    "id": "patte",
    "label": "Patte",
    "tags": "chat chien animal"
  },
  {
    "id": "fitness",
    "label": "Fitness",
    "tags": "sport haltère gym"
  },
  {
    "id": "poulet",
    "label": "Poulet frit",
    "tags": "fried chicken tenders crousty"
  },
  {
    "id": "bubble-tea",
    "label": "Bubble tea",
    "tags": "boba boisson perles"
  },
  {
    "id": "tacos",
    "label": "Tacos",
    "tags": "mexicain restaurant"
  },
  {
    "id": "kebab",
    "label": "Kebab",
    "tags": "wrap sandwich durum"
  },
  {
    "id": "sushi",
    "label": "Sushi",
    "tags": "japonais restaurant"
  },
  {
    "id": "crepe",
    "label": "Crêpe",
    "tags": "creperie chocolat"
  },
  {
    "id": "croissant",
    "label": "Croissant",
    "tags": "boulangerie viennoiserie"
  },
  {
    "id": "cafe",
    "label": "Café",
    "tags": "coffee boisson"
  },
  {
    "id": "milkshake",
    "label": "Milkshake",
    "tags": "boisson dessert fraise"
  },
  {
    "id": "cookie",
    "label": "Cookie",
    "tags": "biscuit pâtisserie"
  },
  {
    "id": "maquillage",
    "label": "Rouge à lèvres",
    "tags": "beauté maquillage"
  },
  {
    "id": "sneaker",
    "label": "Sneaker",
    "tags": "basket chaussure"
  },
  {
    "id": "shopping",
    "label": "Shopping",
    "tags": "sac boutique"
  },
  {
    "id": "bijouterie",
    "label": "Bague",
    "tags": "bijoux or bijouterie"
  },
  {
    "id": "vetements",
    "label": "Vêtements",
    "tags": "tshirt textile mode"
  },
  {
    "id": "telephonie",
    "label": "Téléphonie",
    "tags": "smartphone magasin téléphone"
  },
  {
    "id": "pneumatique",
    "label": "Pneu",
    "tags": "roue automobile garage"
  },
  {
    "id": "animalerie",
    "label": "Os",
    "tags": "chien animaux animalerie"
  },
  {"id":"tacos-2","label":"Tacos 2","tags":"tacos fast food snack"},
  {"id":"wok","label":"Wok","tags":"wok asiatique nouilles restaurant"},
  {"id":"vape","label":"Vape","tags":"vapoteuse e-cigarette"},
  {"id":"cheveux-bruns","label":"Cheveux bruns","tags":"cheveux coiffure salon brushing"},
  {"id":"e-liquide","label":"E-liquide","tags":"flacon liquide vape"},
  {"id":"cadeau","label":"Cadeau","tags":"gift récompense cadeau anniversaire"}
];
const BY_ID = new Map(STAMP_LIBRARY.map(stamp=>[stamp.id,stamp]));
const DRIVE_ID = /^gd-[A-Za-z0-9_-]{10,120}$/;
const DYNAMIC_BASE=(import.meta.env?.VITE_SUPABASE_URL||'')+'/storage/v1/object/public/program-assets/stamp-library/';
export function stampById(id) { return typeof id === 'string' ? BY_ID.get(id) || null : null; }
export function stampImageUrl(id) { return stampById(id) ? '/assets/stamps/'+id+'.png' : DRIVE_ID.test(String(id||'')) ? DYNAMIC_BASE+id+'.png' : ''; }
function normalizeSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
export function filterStamps(query) {
  const q=normalizeSearch(query);
  return q ? STAMP_LIBRARY.filter(x=>normalizeSearch(x.label+' '+x.tags).includes(q)) : STAMP_LIBRARY;
}
// The original 39 shipped icons remain valid for existing cards. Imported Drive images
// may represent the same stamp under its original filename (not always its UI label).
// These aliases describe exact known duplicates, not broad substring matches: all
// distinct burger/bun variations must remain available.
function matchKey(value) {
  return normalizeSearch(value).replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();
}
const STATIC_MATCH_KEYS=new Map(STAMP_LIBRARY.flatMap(item=>[
  [matchKey(item.id),item.id],[matchKey(item.label),item.id],
]));
const DRIVE_FILENAME_ALIASES=new Map(Object.entries({
  donuts:'donut',crousty:'riz-crousty',fleurs:'fleuriste',
  suhis:'sushi',chaussure:'sneaker',bague:'bijouterie',
  teeshirt:'vetements',telephone:'telephonie',pneu:'pneumatique',
  os:'animalerie','icone de cheveux bruns brillants en 3d':'cheveux-bruns',
}));
// One visible choice per stamp. Prefer the Drive version when there is no
// existing selection, so freshly updated artwork stays selectable. An older
// already-selected static or imported ID always stays visible and unchanged.
export function mergedStampCatalog(imported=[],selectedId='') {
  const catalog=STAMP_LIBRARY.slice();
  const staticSlots=new Map(STAMP_LIBRARY.map((item,i)=>[item.id,i]));
  const driveSlots=new Map();
  for(const item of imported){
    if(!item || !DRIVE_ID.test(String(item.id||'')) || typeof item.label!=='string')continue;
    const key=matchKey(item.label);
    if(!key)continue;
    const match=STATIC_MATCH_KEYS.get(key)||DRIVE_FILENAME_ALIASES.get(key);
    const slot=staticSlots.get(match);
    if(slot!==undefined) {
      const previous=catalog[slot];
      if(previous.id===selectedId && item.id!==selectedId)continue;
      if(previous.id===match || item.id===selectedId)catalog[slot]=item;
      continue;
    }
    const existing=driveSlots.get(key);
    if(existing===undefined){driveSlots.set(key,catalog.length);catalog.push(item);}
    else if(item.id===selectedId)catalog[existing]=item;
  }
  return catalog;
}
export function makeStampLibraryPicker(React) {
  const h=React.createElement;
  return function StampLibraryPicker({value,onChange,includeRewardStar=false}) {
    const [search,setSearch]=React.useState('');
    const [synced,setSynced]=React.useState([]);
    React.useEffect(()=>{
      let live=true;
      const load=async()=>{
        try {
          const r=await fetch((import.meta.env?.VITE_SUPABASE_URL||'')+'/functions/v1/stamp-sync/catalog');
          if(!r.ok)throw new Error('catalog_not_available');
          const data=await r.json();
          if(live)setSynced((data.items||[]).filter(x=>DRIVE_ID.test(String(x.id||''))&&typeof x.label==='string'&&x.label.length<=100));
        }catch {if(live)setSynced([]);}
      };
      load();const poll=setInterval(load,300000);return ()=>{live=false;clearInterval(poll);};
    },[]);
    const candidates=mergedStampCatalog(synced,value);
    return h('div',{'data-stamp-library':true,style:{display:'flex',flexDirection:'column',gap:12}},
      h('label',{style:{fontSize:14,fontWeight:700}},'Choisir un tampon PNG'),
      h('input',{type:'search',value:search,onChange:e=>setSearch(e.target.value),placeholder:'Rechercher : burger, coiffeur, sushi…','aria-label':'Rechercher un tampon',style:{width:'100%',height:42,borderRadius:10,border:'1px solid #D4D1C9',padding:'0 12px',fontSize:14}}),
      h('div',{role:'group','aria-label':'Catalogue des tampons PNG',style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(82px,1fr))',gap:8,maxHeight:288,overflowY:'auto',padding:'2px'}},
        ...(includeRewardStar && (!search || normalizeSearch('étoile récompense par défaut star').includes(normalizeSearch(search))) ? [{id:'reward-star',label:'Étoile (actuelle)',tags:'étoile star'}] : []).concat(search?candidates.filter(x=>normalizeSearch(x.label+' '+(x.tags||'')).includes(normalizeSearch(search))):candidates).map(item=>h('button',{key:item.id,type:'button',title:item.label,'aria-label':item.label,'aria-pressed':value===item.id,onClick:()=>onChange(item.id),style:{border:value===item.id?'2px solid #2448F0':'1px solid #E4E1DA',borderRadius:12,background:value===item.id?'#EEF2FF':'#FFFFFF',minHeight:98,padding:'7px 4px',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,cursor:'pointer'}},
          h('img',{src:item.id==='reward-star'?'/assets/stamps/reward-star.png':stampImageUrl(item.id),alt:'',loading:'lazy',width:52,height:52,style:{objectFit:'contain',display:'block'}}),
          h('span',{style:{fontSize:11,fontWeight:value===item.id?800:550,lineHeight:1.2,color:'#252A33',textAlign:'center'}},item.label)))),
      h('small',{style:{color:'#5E636B'}},'Passage validé : image en couleur. Passage restant : la même image en gris, atténuée.'));
  };
}
