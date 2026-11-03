export function merchantMfa(auth, qrDataUrl) {
  const result = async promise => {
    const {data, error} = await promise;
    if (error) throw error;
    return data;
  };
  return {
    async status(accessToken) {
      const level = await result(auth.mfa.getAuthenticatorAssuranceLevel(accessToken));
      if (!level.currentLevel) throw new Error('Session indisponible.');
      if (level.currentLevel === 'aal2' || level.nextLevel !== 'aal2') {
        return {active: level.currentLevel === 'aal2'};
      }
      const factors = await result(auth.mfa.listFactors());
      return {required: true, factors: factors.totp};
    },
    async enroll() {
      const factor = await result(auth.mfa.enroll({factorType: 'totp', issuer: 'DPA Cards'}));
      try {
        return {id: factor.id, qr: await qrDataUrl(factor.totp.uri), secret: factor.totp.secret};
      } catch (error) {
        await auth.mfa.unenroll({factorId: factor.id});
        throw error;
      }
    },
    verify: (factorId, code) => result(auth.mfa.challengeAndVerify({factorId, code})),
    cancel: factorId => result(auth.mfa.unenroll({factorId})),
  };
}

export function makeMerchantMfaPanel(React) {
  const h = React.createElement;
  return function MerchantMfaPanel({api, challenge, onVerified, onSignOut, onDismiss}) {
    const dialog = React.useRef(null);
    const titleId = React.useId();
    const isReminder = Boolean(onDismiss);
    React.useLayoutEffect(() => {
      const element = dialog.current;
      if (!element) return;
      element.showModal();
      return () => element.close();
    }, [isReminder]);
    const [setup, setSetup] = React.useState(null);
    const [choice, setChoice] = React.useState('');
    const [code, setCode] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const running = React.useRef(false);
    const factors = challenge?.factors || [];
    const factorId = setup?.id || choice || factors[0]?.id;
    const run = async (action, message) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError('');
      try { await action(); }
      catch { setError(message); }
      finally { running.current = false; setBusy(false); }
    };
    const button = (label, click) => h('button', {
      type: 'button', disabled: busy, onClick: click, className: 'dpa-mfa-button',
    }, label);
    const verify = event => {
      event.preventDefault();
      if (!factorId || !/^\d{6}$/.test(code)) return;
      return run(async () => {
        await api.verify(factorId, code);
        setCode('');
        setSetup(null);
        await onVerified();
      }, 'Le code est incorrect, expiré ou la connexion a échoué. Réessayez avec un nouveau code.');
    };
    const cancelSetup = async () => {
      await api.cancel(setup.id);
      setSetup(null);
      setCode('');
    };
    const dismiss = () => {
      if (running.current) return;
      if (setup) void api.cancel(setup.id).catch(() => {});
      onDismiss();
    };
    const container = isReminder ? {
      ref: dialog, className: 'dpa-mfa-panel dpa-mfa-dialog', 'aria-labelledby': titleId,
      onCancel: event => { event.preventDefault(); dismiss(); },
    } : {className: 'dpa-mfa-panel', 'aria-labelledby': titleId};
    return h(isReminder ? 'dialog' : 'section', container,
      isReminder && h('button', {type: 'button', className: 'dpa-mfa-close',
        'aria-label': 'Fermer le rappel de sécurité', disabled: busy, onClick: dismiss}, '×'),
      isReminder && h('img', {src: '/assets/dpa-cards-logo.png', className: 'dpa-mfa-logo', alt: 'DPA Cards'}),
      h('h2', {id: titleId}, challenge ? 'Vérifiez votre connexion' : 'Protégez votre compte'),
      h('p', null, challenge
        ? 'Saisissez le code généré par votre application d’authentification.'
        : 'Nous vous recommandons fortement la double authentification pour protéger votre compte et les données de vos clients. Elle ajoute un code généré par une application sur votre téléphone lors de la connexion.'),
      isReminder && !setup && h('p', {className: 'dpa-mfa-warning'},
        'Sans cette protection, une personne qui accède à vos identifiants ou à votre lien de connexion peut accéder à votre compte. Vous pouvez fermer ce rappel et activer la protection plus tard.'),
      error && h('p', {role: 'alert'}, error),
      !challenge && !setup && button('Activer la double authentification',
        () => run(async () => setSetup(await api.enroll()), 'Impossible de commencer la configuration. Réessayez.')),
      setup && h(React.Fragment, null,
        h('p', null, 'Scannez ce QR code avec votre application d’authentification ou saisissez la clé manuellement.'),
        h('img', {src: setup.qr, width: 160, height: 160, alt: 'QR code de configuration'}),
        h('details', null, h('summary', null, 'Afficher la clé de configuration'), h('code', null, setup.secret))),
      factors.length > 1 && h('label', null, 'Application d’authentification',
        h('select', {value: factorId, onChange: event => { setChoice(event.target.value); setCode(''); }},
          ...factors.map((factor, index) => h('option', {value: factor.id, key: factor.id},
            factor.friendly_name || 'Application ' + (index + 1))))),
      (challenge || setup) && factorId && h('form', {onSubmit: verify},
        h('label', null, 'Code à 6 chiffres', h('input', {
          type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6, required: true,
          value: code, onChange: event => setCode(event.target.value.replace(/\D/g, '')),
        })),
        h('button', {type: 'submit', className: 'dpa-mfa-button', disabled: busy || code.length !== 6},
          setup ? 'Confirmer l’activation' : 'Vérifier le code')),
      challenge && !factorId && h('p', {role: 'alert'}, 'Aucune application de codes utilisable. Contactez l’assistance.'),
      setup && button('Annuler la configuration', () => run(cancelSetup, 'Impossible d’annuler la configuration. Réessayez.')),
      challenge && onSignOut && button('Se déconnecter', onSignOut));
  };
}
