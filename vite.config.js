import { defineConfig } from 'vite';

// The app is the imported Claude Design document: an <x-dc> template plus its
// logic script, rendered by dc-runtime (public/support.js). Vite only needs to
// serve it and copy public/ verbatim — there is nothing to bundle, and the
// template must not be rewritten, so HTML asset handling stays out of the way.
export default defineConfig({
  root: '.',
  // The app navigates by internal state, not URLs, so it needs no SPA history
  // fallback. Disabling it means a genuinely missing file returns 404 instead
  // of silently serving index.html with a 200.
  appType: 'mpa',
  publicDir: 'public',
  server: { port: 5173, strictPort: false, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
