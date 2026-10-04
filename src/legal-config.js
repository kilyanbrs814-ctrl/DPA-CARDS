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
  LEGAL_NAME: TODO,          // dénomination sociale exacte
  LEGAL_FORM: TODO,          // forme juridique (EI, SAS, SASU…) et capital le cas échéant
  LEGAL_ADDRESS: TODO,       // adresse du siège
  SIRET: TODO,
  VAT_NUMBER: TODO,          // n° de TVA intracommunautaire, si assujetti
  PUBLICATION_DIRECTOR: TODO, // responsable de la publication (nom et prénom)
  CONTACT_EMAIL: TODO,       // adresse de contact publique, aussi utilisée pour les demandes RGPD
  CONTACT_PHONE: TODO,

  SITE_URL: 'https://dpa-cards.vercel.app',
  HOST_NAME: 'Vercel Inc.',
  HOST_ADDRESS: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis',
  HOST_URL: 'https://vercel.com',

  // Région du projet Supabase où sont stockées les données (voir le tableau de bord Supabase).
  DATA_REGION: TODO,
  LAST_UPDATE: '4 octobre 2026',
};
