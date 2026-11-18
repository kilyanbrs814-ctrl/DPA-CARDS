import { forwardAdminAuthToPage, isNativeIOS, listenForAdminDeepLinks } from './native-admin-link.js';

if (isNativeIOS()) {
  listenForAdminDeepLinks(forwardAdminAuthToPage);
  document.querySelectorAll('[data-dpa-web-only], dpa-install-app, link[rel="manifest"]').forEach(node => node.remove());
  const bundledPages = new Map([
    ['/', '/landing.html'],
    ['/connexion', '/connexion.html'],
    ['/mentions-legales', '/mentions-legales.html'],
    ['/confidentialite', '/confidentialite.html'],
    ['/cgv', '/cgv.html'],
  ]);
  for (const link of document.querySelectorAll('a[href]')) {
    const localPage = bundledPages.get(link.getAttribute('href'));
    if (localPage) link.href = localPage;
  }
}
