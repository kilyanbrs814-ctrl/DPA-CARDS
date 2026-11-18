// Vitrine publique DPA Cards : les deux comportements que le HTML seul ne couvre pas.
// Aucune donnée client, aucun appel réseau, aucune dépendance au compte commerçant.

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
