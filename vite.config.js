import { defineConfig } from 'vite';

// Same rules as vercel.json, for `vite` and `vite preview`: /join/<slug> is served by index.html,
// the legal pages by their own HTML file. Every other path keeps the MPA behaviour.
const joinRoute = {
  name: 'dpa-join-route',
  configureServer(server) { server.middlewares.use(rewriteJoin); },
  configurePreviewServer(server) { server.middlewares.use(rewriteJoin); },
};
function rewriteJoin(req, res, next) {
  const url = req.url || '';
  const legal = /^\/(mentions-legales|confidentialite)\/?(\?|$)/.exec(url);
  if (/^\/join\/[^/?#]+\/?(\?|$)/.test(url)) req.url = '/index.html';
  else if (legal) req.url = '/' + legal[1] + '.html';
  next();
}

export default defineConfig({
  root: '.',
  appType: 'mpa',
  publicDir: 'public',
  plugins: [joinRoute],
  server: { port: 5173, strictPort: false, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
        mentions: 'mentions-legales.html',
        confidentialite: 'confidentialite.html',
      },
    },
  },
});
