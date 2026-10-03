import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  appType: 'mpa',
  publicDir: 'public',
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
