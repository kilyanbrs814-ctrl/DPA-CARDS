// Public legal pages (/mentions-legales, /confidentialite, /cgv): fills every
// [data-legal="KEY"] element from the single legal configuration.
// [data-legal-optional]: when the value is not known yet, the enclosing
// [data-legal-row] (or the element itself) is hidden instead of showing "À RENSEIGNER".
import { LEGAL, TODO } from './legal-config.js';
import './legal-page.css';

for (const el of document.querySelectorAll('[data-legal]')) {
  const key = el.getAttribute('data-legal');
  const value = LEGAL[key] ?? TODO;
  if (el.hasAttribute('data-legal-optional') && (value === TODO || !value)) {
    (el.closest('[data-legal-row]') || el).remove();
    continue;
  }
  if (el.tagName === 'A' && el.hasAttribute('data-legal-mail')) {
    if (value === TODO) { el.removeAttribute('href'); } else { el.href = 'mailto:' + value; }
  }
  el.textContent = value;
  if (value === TODO) el.classList.add('todo');
}
