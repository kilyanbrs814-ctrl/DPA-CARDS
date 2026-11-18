import { copyFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defineConfig } from 'vite';

const hasLanding = existsSync(new URL('./landing.html', import.meta.url));
const merchantRoute = /^\/(?:connexion(?:\.html)?|join\/[^/]+|(?:subscription|design)\/(?:success|cancel))\/?$/;
const staticPage = /^\/(admin|mentions-legales|confidentialite|cgv|activation-result)\/?$/;

function serveRoutes(merchant, landing) {
  return (req, _res, next) => {
    const { pathname, search } = new URL(req.url || '/', 'http://localhost');
    const page = staticPage.exec(pathname)?.[1];
    if (merchantRoute.test(pathname)) req.url = merchant + search;
    else if (page) req.url = '/' + page + '.html' + search;
    else if (landing && pathname === '/') req.url = landing + search;
    next();
  };
}

const entries = {
  name: 'dpa-entrypoints',
  configureServer(server) {
    server.middlewares.use(serveRoutes('/index.html', hasLanding && '/landing.html'));
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveRoutes('/connexion.html'));
  },
  transformIndexHtml: {
    order: 'pre',
    handler(_html, { filename }) {
      if (basename(filename) !== 'landing.html') return [];
      return [
        {tag: 'meta', attrs: {name: 'referrer', content: 'no-referrer'}, injectTo: 'head-prepend'},
        {tag: 'script', attrs: {src: '/landing-start.js'}, injectTo: 'head-prepend'},
        {tag: 'style', children: 'html.dpa-native-ios [data-dpa-web-only], html.dpa-native-ios dpa-install-app { display:none!important }', injectTo: 'head-prepend'},
        {tag: 'link', attrs: {rel: 'manifest', href: '/manifest.webmanifest'}},
        {tag: 'link', attrs: {rel: 'stylesheet', href: '/install-app.css'}},
        {tag: 'script', attrs: {src: '/install-app.js', defer: true}},
        {tag: 'script', attrs: {type: 'module', src: '/src/native-landing.js'}},
      ];
    },
  },
  writeBundle({ dir }) {
    const app = join(dir, 'index.html');
    copyFileSync(app, join(dir, 'connexion.html'));
    if (hasLanding) copyFileSync(join(dir, 'landing.html'), app);
  },
};

export default defineConfig({
  root: '.',
  appType: 'mpa',
  publicDir: 'public',
  plugins: [entries],
  server: { port: 5173, strictPort: false, open: false, allowedHosts: ['terminal.local'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: 'index.html',
        ...(hasLanding ? { landing: 'landing.html' } : {}),
        admin: 'admin.html',
        activationResult: 'activation-result.html',
        mentions: 'mentions-legales.html',
        confidentialite: 'confidentialite.html',
        cgv: 'cgv.html',
      },
    },
  },
});
