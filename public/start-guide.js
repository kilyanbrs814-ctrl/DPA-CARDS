(() => {
  const steps = [
    ['card', 'Configurez votre carte', 'Depuis Ma carte, retrouvez votre programme et choisissez la récompense.'],
    ['invite', 'Affichez votre QR au comptoir', 'Dans Inviter mes clients, récupérez le QR d’inscription à imprimer ou à partager.'],
    ['scan', 'Validez un passage', 'Ouvrez le scanner, scannez le QR personnel du client et confirmez son passage.'],
  ];
  document.addEventListener('click', event => {
    const launch = event.target.closest?.('[data-dpa-guide-start]');
    if (!launch || document.querySelector('.dpa-guide-panel')) return;
    const panel = document.createElement('dialog');
    panel.className = 'dpa-guide-panel';
    panel.setAttribute('aria-labelledby', 'dpa-guide-title');
    panel.innerHTML = '<p data-progress></p><h2 id="dpa-guide-title" tabindex="-1"></h2><p data-description></p><div><button type="button" data-close>Fermer</button><button type="button" data-back>Précédent</button><button type="button" data-next>Suivant</button></div>';
    document.body.append(panel);
    const title = panel.querySelector('h2');
    const back = panel.querySelector('[data-back]');
    const next = panel.querySelector('[data-next]');
    let step = 0;
    let highlight;
    function render() {
      highlight?.classList.remove('dpa-guide-highlight');
      const [key, heading, copy] = steps[step];
      highlight = [...document.querySelectorAll('[data-dpa-guide="' + key + '"]')].find(element => element.getClientRects().length);
      highlight?.classList.add('dpa-guide-highlight');
      highlight?.scrollIntoView({block:'center'});
      panel.querySelector('[data-progress]').textContent = 'Étape ' + (step + 1) + ' sur ' + steps.length;
      panel.querySelector('[data-description]').textContent = copy;
      title.textContent = heading;
      back.disabled = step === 0;
      next.textContent = step === steps.length - 1 ? 'Terminer' : 'Suivant';
      title.focus({preventScroll:true});
    }
    back.onclick = () => { step -= 1; render(); };
    next.onclick = () => {
      if (step === steps.length - 1) panel.close();
      else { step += 1; render(); }
    };
    panel.querySelector('[data-close]').onclick = () => panel.close();
    panel.addEventListener('close', () => {
      highlight?.classList.remove('dpa-guide-highlight');
      panel.remove();
      launch.focus();
    }, {once:true});
    panel.showModal();
    render();
  });
})();
