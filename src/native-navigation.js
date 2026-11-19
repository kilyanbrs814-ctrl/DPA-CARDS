const pages = new Map([
  ['/', '/index.html'],
  ['/connexion', '/connexion.html'],
  ['/admin', '/admin.html'],
  ['/mentions-legales', '/mentions-legales.html'],
  ['/confidentialite', '/confidentialite.html'],
  ['/cgv', '/cgv.html'],
]);

// Custom URL schemes have a null origin: compare protocol AND host explicitly.
export function bundledPageHref(href, location) {
  if (location.protocol !== 'capacitor:' || !href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, location.href);
    if (url.protocol !== location.protocol || url.host !== location.host) return null;
    const page = pages.get(url.pathname);
    return page ? page + url.search + url.hash : null;
  } catch { return null; }
}

if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') {
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download')) return;
    const page = bundledPageHref(link.getAttribute('href'), window.location);
    if (page) { event.preventDefault(); window.location.assign(page); }
  });
}
