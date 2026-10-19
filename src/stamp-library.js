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
export function stampById(id) { return typeof id === 'string' ? BY_ID.get(id) || null : null; }
export function stampImageUrl(id) { return stampById(id) ? '/assets/stamps/'+id+'.png' : ''; }
function normalizeSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
export function filterStamps(query) {
  const q=normalizeSearch(query);
  return q ? STAMP_LIBRARY.filter(x=>normalizeSearch(x.label+' '+x.tags).includes(q)) : STAMP_LIBRARY;
}
export function makeStampLibraryPicker(React) {
  const h=React.createElement;
  return function StampLibraryPicker({value,onChange,includeRewardStar=false}) {
    const [search,setSearch]=React.useState('');
    return h('div',{'data-stamp-library':true,style:{display:'flex',flexDirection:'column',gap:12}},
      h('label',{style:{fontSize:14,fontWeight:700}},'Choisir un tampon PNG'),
      h('input',{type:'search',value:search,onChange:e=>setSearch(e.target.value),placeholder:'Rechercher : burger, coiffeur, sushi…','aria-label':'Rechercher un tampon',style:{width:'100%',height:42,borderRadius:10,border:'1px solid #D4D1C9',padding:'0 12px',fontSize:14}}),
      h('div',{role:'group','aria-label':'Catalogue des tampons PNG',style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(82px,1fr))',gap:8,maxHeight:288,overflowY:'auto',padding:'2px'}},
        ...(includeRewardStar && (!search || normalizeSearch('étoile récompense par défaut star').includes(normalizeSearch(search))) ? [{id:'reward-star',label:'Étoile (actuelle)',tags:'étoile star'}] : []).concat(filterStamps(search)).map(item=>h('button',{key:item.id,type:'button',title:item.label,'aria-label':item.label,'aria-pressed':value===item.id,onClick:()=>onChange(item.id),style:{border:value===item.id?'2px solid #2448F0':'1px solid #E4E1DA',borderRadius:12,background:value===item.id?'#EEF2FF':'#FFFFFF',minHeight:98,padding:'7px 4px',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,cursor:'pointer'}},
          h('img',{src:item.id==='reward-star'?'/assets/stamps/reward-star.png':stampImageUrl(item.id),alt:'',loading:'lazy',width:52,height:52,style:{objectFit:'contain',display:'block'}}),
          h('span',{style:{fontSize:11,fontWeight:value===item.id?800:550,lineHeight:1.2,color:'#252A33',textAlign:'center'}},item.label)))),
      h('small',{style:{color:'#5E636B'}},'Passage validé : image en couleur. Passage restant : la même image en gris, atténuée.'));
  };
}
