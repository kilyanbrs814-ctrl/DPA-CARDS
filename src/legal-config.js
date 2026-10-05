// DPA Cards — legal information, single source of truth.
//
// Every legal page reads these values from here; never copy them elsewhere.
// "À RENSEIGNER" marks information that is not known yet: it must be provided
// by the company, never guessed.

export const TODO = 'À RENSEIGNER';

export const LEGAL = {
  TRADE_NAME: 'DPA Cards',
  // Brand of the publisher, as used by the company.
  PUBLISHER_BRAND: 'DigitalProjectAgency',
  LEGAL_NAME: 'Kilyan Bouras', // entrepreneur individuel exerçant sous le nom commercial DigitalProjectAgency
  LEGAL_FORM: 'Entrepreneur individuel — micro-entreprise',
  LEGAL_ADDRESS: TODO,       // adresse du siège
  SIREN: '104 064 621',
  SIRET: '104 064 621 00014',
  VAT_NUMBER: 'TVA non applicable, article 293 B du CGI',
  PUBLICATION_DIRECTOR: 'Kilyan Bouras',
  CONTACT_EMAIL: 'contact@digitalprojectagency.fr', // contact public, aussi utilisé pour les demandes RGPD
  CONTACT_PHONE: TODO,

  SITE_URL: 'https://dpa-cards.vercel.app',
  HOST_NAME: 'Vercel Inc.',
  HOST_ADDRESS: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis',
  HOST_URL: 'https://vercel.com',

  // Conditions générales de vente : pas encore de page. Renseigner l’URL (ex. '/cgv') quand elle existe ;
  // le lien « Voir les conditions » de la page d’abonnement s’active alors automatiquement.
  CGV_URL: null,

  // Région du projet Supabase où sont stockées les données (voir le tableau de bord Supabase).
  DATA_REGION: TODO,
  LAST_UPDATE: '4 octobre 2026',
};
