(() => {
  if (location.protocol === 'capacitor:') return;

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const windows = /Windows NT/.test(navigator.userAgent);
  if (ios || windows) {
    customElements.define('dpa-install-app', class extends HTMLElement {
      connectedCallback() {
        const link = document.createElement('a');
        link.className = 'dpa-install-action';
        link.href = '/telecharger.html';
        link.textContent = 'Télécharger l’application';
        this.replaceChildren(link);
      }
    });
    return;
  }

  const desktop = matchMedia('(min-width: 1024px) and (any-pointer: fine)');
  const standalone = matchMedia('(display-mode: standalone)');
  const edge = /\bEdg\//.test(navigator.userAgent);
  const chrome = /\bChrome\//.test(navigator.userAgent) && !/\b(?:OPR|Vivaldi)\//.test(navigator.userAgent);
  const label = 'Installer l’application';
  const controls = new Set();
  let installPrompt;
  let installing = false;
  let installed = false;

  function refresh() {
    controls.forEach(control => control.refresh());
  }

  function showInstructions() {
    const dialog = document.createElement('dialog');
    dialog.className = 'dpa-install-help';
    dialog.setAttribute('aria-label', label);
    const title = document.createElement('h2');
    title.textContent = label;
    const steps = document.createElement('p');
    steps.textContent = edge
      ? 'Dans Edge, ouvre le menu ⋯, puis Autres outils, Applications et Installer ce site en tant qu’application.'
      : 'Dans Chrome, ouvre le menu ⋮, puis Caster, enregistrer et partager et Installer la page en tant qu’appli.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fermer';
    close.className = 'dpa-install-action';
    close.addEventListener('click', () => dialog.close());
    dialog.append(title, steps, close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  async function install() {
    if (installing) return;
    if (!installPrompt) {
      showInstructions();
      return;
    }

    const prompt = installPrompt;
    installPrompt = null;
    installing = true;
    refresh();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') installed = true;
    } catch {
      showInstructions();
    } finally {
      installing = false;
      refresh();
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    if (!desktop.matches) return;
    event.preventDefault();
    installPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    refresh();
  });
  desktop.addEventListener('change', refresh);
  standalone.addEventListener('change', refresh);

  customElements.define('dpa-install-app', class extends HTMLElement {
    connectedCallback() {
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'dpa-install-action';
      this.button.textContent = label;
      this.button.addEventListener('click', install);
      this.replaceChildren(this.button);
      controls.add(this);
      this.refresh();
    }

    disconnectedCallback() {
      controls.delete(this);
    }

    refresh() {
      this.hidden = !desktop.matches || standalone.matches || installed || !(edge || chrome || installPrompt);
      this.button.disabled = installing;
    }
  });
})();
