import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { defineConfig } from 'vite';

const hasLanding = existsSync(new URL('./landing.html', import.meta.url));
const release = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'));
let revision = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA;
if (!revision) { try { revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(); } catch { revision = 'local'; } }
const buildInfo = {...release, revision, appVersion:process.env.DPA_MARKETING_VERSION || release.appVersion,
  iosBuild:process.env.DPA_IOS_BUILD_NUMBER || null};
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
      const shared = [
        {tag:'script',attrs:{type:'module',src:'/src/build-info.js'}},
        {tag:'script',attrs:{type:'module',src:'/src/native-navigation.js'}},
      ];
      if (basename(filename) !== 'landing.html') return shared;
      return [...shared,
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
  generateBundle() { this.emitFile({type:'asset',fileName:'release.json',source:JSON.stringify(buildInfo,null,2)}); },
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
  define: {__DPA_BUILD__:JSON.stringify(buildInfo)},
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
