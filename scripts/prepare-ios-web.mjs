import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Capacitor always boots the merchant shell, which restores Auth before deciding
// whether a signed-out merchant should see the bundled landing.
const entry = new URL('../dist/index.html', import.meta.url);
const merchant = new URL('../dist/connexion.html', import.meta.url);
const landing = new URL('../dist/landing.html', import.meta.url);
let html = readFileSync(merchant, 'utf8');
if (existsSync(landing)) {
  html = html.replace('</head>', '<meta name="dpa-native-landing"></head>');
}
writeFileSync(entry, html);
