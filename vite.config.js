import { defineConfig } from 'vite';

// /join/<slug> is the public sign-up page, served by index.html. Same single rule as
// vercel.json, for `vite` and `vite preview`; every other path keeps the MPA behaviour.
const joinRoute = {
  name: 'dpa-join-route',
  configureServer(server) { server.middlewares.use(rewriteJoin); },
  configurePreviewServer(server) { server.middlewares.use(rewriteJoin); },
};
function rewriteJoin(req, res, next) {
  if (/^\/join\/[^/?#]+\/?(\?|$)/.test(req.url || '')) req.url = '/index.html';
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
      },
    },
  },
});
