const form = document.querySelector('[data-dpa-contact-form]');

if (form) {
  const status = form.querySelector('[data-dpa-contact-status]');
  const button = form.querySelector('button[type="submit"]');
  const fields = form.querySelector('fieldset');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let busy = false;
  let requestId = crypto.randomUUID();
  let submittedDraft = '';

  const edited = event => {
    event.target.setCustomValidity?.('');
    status.textContent = '';
    delete status.dataset.state;
  };
  form.addEventListener('input', edited);
  form.addEventListener('change', edited);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    const draft = JSON.stringify(values);
    if (draft !== submittedDraft) {
      requestId = crypto.randomUUID();
      submittedDraft = draft;
    }
    const body = { ...values, requestId };
    busy = true;
    fields.disabled = true;
    button.disabled = true;
    button.textContent = 'Envoi en cours…';
    form.setAttribute('aria-busy', 'true');
    status.textContent = '';
    delete status.dataset.state;

    try {
      if (!url || !key) throw new Error('contact_unavailable');
      const response = await fetch(url + '/functions/v1/public-contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        const error = new Error(result.error || 'contact_unavailable');
        error.fields = result.fields;
        throw error;
      }
      form.reset();
      requestId = crypto.randomUUID();
      submittedDraft = '';
      status.dataset.state = 'success';
      status.textContent = 'Votre message a bien été envoyé. Nous vous répondrons par e-mail.';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message === 'contact_rate_limited'
        ? 'Vous avez envoyé plusieurs demandes récemment. Patientez quelques minutes ou contactez-nous par e-mail.'
        : error.message === 'invalid_contact_request'
          ? 'Vérifiez les champs du formulaire. Votre message est conservé.'
          : 'L’envoi n’a pas abouti. Votre message est conservé. Réessayez ou contactez-nous par e-mail.';
      if (Array.isArray(error.fields)) {
        for (const name of error.fields) {
          const field = form.elements.namedItem(name);
          field?.setCustomValidity?.('Vérifiez ce champ.');
        }
      }
    } finally {
      busy = false;
      fields.disabled = false;
      button.disabled = false;
      button.textContent = 'Envoyer mon message';
      form.removeAttribute('aria-busy');
      status.focus({ preventScroll: true });
    }
  });
}
