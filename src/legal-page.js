// Public legal pages (/mentions-legales, /confidentialite): fills every
// [data-legal="KEY"] element from the single legal configuration.
import { LEGAL, TODO } from './legal-config.js';
import './legal-page.css';

for (const el of document.querySelectorAll('[data-legal]')) {
  const key = el.getAttribute('data-legal');
  const value = LEGAL[key] ?? TODO;
  if (el.tagName === 'A' && el.hasAttribute('data-legal-mail')) {
    if (value === TODO) { el.removeAttribute('href'); } else { el.href = 'mailto:' + value; }
  }
  el.textContent = value;
  if (value === TODO) el.classList.add('todo');
}
