export const PRODUCTION_SITE = 'https://cards.digitalprojectagency.fr';
// capacitor://localhost is the packaged app, never a shareable HTTP address.
export function publicSiteUrl(location) {
  return /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? location.origin : PRODUCTION_SITE;
}
