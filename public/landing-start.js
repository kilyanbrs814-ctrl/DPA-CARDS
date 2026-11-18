(() => {
  if (location.protocol === 'capacitor:') {
    document.documentElement.classList.add('dpa-native-ios');
    return;
  }

  // Forward links sent before the landing page replaced the merchant root.
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const authTypes = ['recovery', 'invite', 'signup', 'magiclink', 'email_change', 'email'];
  const authFields = ['access_token', 'refresh_token', 'code', 'token_hash', 'error_code', 'error_description'];
  const hasAuthReturn = [query, fragment].some(params =>
    authTypes.includes(params.get('type')) || authFields.some(field => params.has(field))
  );
  if (hasAuthReturn || query.has('profile_payment')) {
    location.replace('/connexion' + location.search + location.hash);
  }
})();
