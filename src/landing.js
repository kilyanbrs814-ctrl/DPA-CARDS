import QRCode from 'qrcode';
// Vitrine publique DPA Cards : les comportements que le HTML seul ne couvre pas.
// Le formulaire de contact reste indépendant du compte commerçant.
import './landing-contact.js';

// 0. Les deux téléphones du premier écran suivent légèrement le pointeur. Le
//    flottement reste une animation CSS sur l'élément intérieur ; ce script ne
//    touche qu'aux variables du conteneur, de sorte que les deux mouvements se
//    composent. Au repos, les variables sont retirées et la transition longue
//    du CSS ramène les appareils à leur place.
const hero = document.querySelector('[data-dpa-hero]');
const telephones = hero ? [...hero.querySelectorAll('.dpa-l-phone')] : [];
const mouvementReduit = matchMedia('(prefers-reduced-motion: reduce)');
const pointeurPrecis = matchMedia('(hover: hover) and (pointer: fine)');

if (telephones.length && !mouvementReduit.matches && pointeurPrecis.matches) {
  const AMPLITUDE_X = 14;   // px
  const AMPLITUDE_Y = 10;   // px
  const INCLINAISON = 1.6;  // degrés
  let image = 0;

  const repos = () => {
    delete hero.dataset.dpaPointeur;
    for (const telephone of telephones) {
      telephone.style.removeProperty('--dpa-l-px');
      telephone.style.removeProperty('--dpa-l-py');
      telephone.style.removeProperty('--dpa-l-rot');
    }
  };

  hero.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || image) return;
    const { clientX, clientY } = event;
    image = requestAnimationFrame(() => {
      image = 0;
      const zone = hero.getBoundingClientRect();
      // −1 à gauche et en haut, +1 à droite et en bas.
      const x = Math.max(-1, Math.min(1, ((clientX - zone.left) / zone.width) * 2 - 1));
      const y = Math.max(-1, Math.min(1, ((clientY - zone.top) / zone.height) * 2 - 1));
      hero.dataset.dpaPointeur = '';
      telephones.forEach((telephone, rang) => {
        // Les deux appareils partent en sens inverse : l'écart entre eux se
        // creuse et se referme, ce qui se lit comme de la profondeur.
        const sens = rang === 0 ? 1 : -1;
        telephone.style.setProperty('--dpa-l-px', (x * AMPLITUDE_X * sens).toFixed(1) + 'px');
        telephone.style.setProperty('--dpa-l-py', (y * AMPLITUDE_Y * sens).toFixed(1) + 'px');
        telephone.style.setProperty('--dpa-l-rot', (x * INCLINAISON * sens).toFixed(2) + 'deg');
      });
    });
  });

  hero.addEventListener('pointerleave', repos);
  mouvementReduit.addEventListener('change', event => { if (event.matches) repos(); });
}

// 1. Le menu des sections sur mobile se referme dès qu'une ancre est suivie,
//    sinon le panneau reste ouvert par-dessus la section visée.
const menu = document.querySelector('[data-dpa-landing-menu]');
if (menu) {
  menu.addEventListener('click', event => {
    if (event.target.closest('a[href^="#"]')) menu.open = false;
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
}

// 2. La section lue marque son lien de navigation. Le repère reste purement
//    visuel : les ancres fonctionnent sans ce script.
const links = [...document.querySelectorAll('.dpa-l-nav a[href^="#"]')];
const sections = links
  .map(link => ({ link, section: document.getElementById(link.hash.slice(1)) }))
  .filter(entry => entry.section);

if (sections.length && 'IntersectionObserver' in window) {
  let current = null;
  const mark = entry => {
    if (current === entry) return;
    if (current) current.link.removeAttribute('aria-current');
    current = entry;
    if (current) current.link.setAttribute('aria-current', 'true');
  };
  const seen = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const record of entries) {
      if (record.isIntersecting) seen.add(record.target);
      else seen.delete(record.target);
    }
    mark(sections.find(entry => seen.has(entry.section)) || null);
  }, { rootMargin: '-45% 0px -45% 0px' });
  for (const entry of sections) observer.observe(entry.section);
}

// 3. Le choix du mode met à jour les deux aperçus de la démonstration.
//    Les soldes illustrent la même opération avant et après le scan :
//    un passage ajouté, ou sept points pour un achat de sept euros.
const demo = document.querySelector('[data-dpa-loyalty-demo]');
if (demo) {
  const card = demo.querySelector('.dpa-l-card');
  const buttons = [...demo.querySelectorAll('[data-dpa-demo-mode]')];
  const modes = {
    passages: {
      unit: 'PASSAGES', balance: '6/10', cardBalance: '6 passages sur 10',
      scanBalance: '7', scanUnit: 'passages',
      remaining: 'Encore 3 passages avant la récompense', added: 'Passage ajouté',
      description: 'Le scan affiche le client et son solde ; c’est vous qui validez le passage. Votre liste de clients garde l’historique, signale les récompenses disponibles et permet de corriger un passage ajouté par erreur.'
    },
    points: {
      unit: 'POINTS', balance: '68/100', cardBalance: '68 points sur 100, 1 euro dépensé donne 1 point',
      scanBalance: '75', scanUnit: 'points',
      remaining: 'Encore 25 points avant la récompense', added: '7 points ajoutés',
      description: 'Le scan affiche le client et son solde ; c’est vous qui validez les points. Votre liste de clients garde l’historique, signale les récompenses disponibles et permet de corriger des points ajoutés par erreur.'
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.dpaDemoMode;
      const preview = modes[mode];
      if (!preview) return;

      for (const option of buttons) {
        const selected = option === button;
        option.classList.toggle('is-on', selected);
        option.setAttribute('aria-pressed', String(selected));
      }
      for (const panel of demo.querySelectorAll('[data-dpa-demo-panel]')) {
        panel.hidden = panel.dataset.dpaDemoPanel !== mode;
      }
      for (const [field, value] of Object.entries(preview)) {
        const attribute = {
          unit: 'unit', balance: 'balance', scanBalance: 'scan-balance',
          scanUnit: 'scan-unit', remaining: 'remaining', added: 'added',
          description: 'scan-description'
        }[field];
        if (attribute) demo.querySelector(`[data-dpa-demo-${attribute}]`).textContent = value;
      }
      card.setAttribute('aria-label', `Carte de démonstration : Boulangerie du Marché, ${preview.cardBalance}, récompense une viennoiserie offerte, membre Camille D., carte DPA-DEMO-4821-7390.`);
    });
  }
}

const visitButton = document.querySelector('[data-dpa-try-visit]');
const visitStatus = document.querySelector('[data-dpa-visit-status]');
let visits = 6;

visitButton?.addEventListener('click', () => {
  if (visits === 10) {
    visits = 6;
    visitButton.textContent = 'Ajouter un passage test';
  } else {
    visits += 1;
  }
  visitStatus.textContent = visits + ' passages sur 10' + (visits === 10 ? ' · Une viennoiserie offerte !' : '');
  if (visits === 10) visitButton.textContent = 'Recommencer';
});

const demoQr = document.querySelector('[data-dpa-demo-qr]');
if (demoQr) {
  QRCode.toString('https://cards.digitalprojectagency.fr/demo.html', {type:'svg',width:184,margin:2})
    .then(svg => { demoQr.innerHTML = svg; })
    .catch(() => { demoQr.textContent = 'Ouvrez cards.digitalprojectagency.fr/demo.html sur votre téléphone.'; });
}
