# DPA Cards — projet local

Import local du projet Claude Design **DPA Cards**
(`7fa48349-c620-424d-b2fb-d9a614015ecf`, fichier `DPA Cards.dc.html`).

## Démarrer

```
npm.cmd run dev
```

Puis ouvrir le lien affiché dans le terminal (`http://localhost:5173/`).
Les dépendances sont déjà installées.

```
npm.cmd run build     # build de production -> dist/
npm.cmd run preview   # sert dist/
```

## Comment c'est construit

Le projet Claude Design n'est pas du HTML classique : c'est un document `<x-dc>`
(template avec `sc-if` / `sc-for` / `{{ }}`) accompagné d'un script de logique
`<script type="text/x-dc" data-dc-script>`, compilé en React à l'exécution par
le runtime `dc-runtime` (`support.js`).

Pour garantir un rendu identique à la maquette, le template et le script de
logique sont **reproduits à l'octet près** ; rien n'a été réécrit ni reporté
dans un autre framework.

| Fichier | Rôle |
|---|---|
| `index.html` | Point d'entrée à la racine `/`. Contient le bloc `<x-dc>` et le script de logique, copiés tels quels depuis `DPA Cards.dc.html`. |
| `public/LoyaltyCard.dc.html` | Composant carte de fidélité, importé par le template. |
| `public/support.js` | Le runtime `dc-runtime` du projet, inchangé. |
| `public/assets/dpa-cards-logo.png` | Le logo. |
| `public/vendor/react*.js` | React / ReactDOM 18.3.1 UMD, servis localement. |
| `design-source/` | Les fichiers source importés, conservés pour référence. |
| `vite.config.js` | Vite sert la page et recopie `public/` ; aucun bundling du template. |

Deux écarts volontaires par rapport au fichier source, aucun visuel :

1. React est chargé depuis `public/vendor/` au lieu d'unpkg.com. `support.js`
   ne télécharge React que si `window.React` est absent ; en le définissant
   d'abord, l'application démarre sans appel réseau. La version est identique
   (18.3.1), celle que le runtime aurait récupérée.
2. `src="assets/..."` est devenu `src="/assets/..."` (4 occurrences) pour que
   le chemin résolve depuis la racine du serveur.

Les parties de `support.js` propres à l'environnement de prévisualisation
(`postMessage` vers la fenêtre parente, passerelles de l'éditeur
`__dcAnnotatedTemplate` / `__dcSetProps`) se désactivent d'elles-mêmes hors
iframe (`if (window.parent === window) return;`). Elles ont donc été laissées
telles quelles plutôt que retirées : supprimer du code du runtime aurait été un
risque de régression sans bénéfice.

Les polices et icônes (Hanken Grotesk, IBM Plex Mono, Material Symbols Rounded)
restent chargées depuis Google Fonts, exactement comme dans la maquette. Ce ne
sont pas des liens liés à une session Claude Design, mais le **premier
affichage demande une connexion internet** ; sans réseau, la mise en page tient
mais les icônes Material n'apparaissent pas.

## Ressources

Toutes les ressources sont locales. Rien ne dépend d'une session Claude Design.

### Logo

Le fichier fourni (1536x1024) plaçait le mot-logo dans une large zone
transparente. Comme la maquette l'affiche en `height:44px`, cette marge l'aurait
rendu nettement plus petit et décentré. Il a donc été recadré sur son contenu,
avec 8 px de marge pour conserver le halo violet : **1331x618**, soit
pratiquement les dimensions de l'asset d'origine (1330x615). Les proportions du
logo sont inchangées ; il se rend en 95x44 px, comme prévu.

Il apparaît sur l'écran de connexion, dans les écrans publics et dans la barre
supérieure mobile (`height:34px`).

### Carte de fidélité BASH

Ce n'est pas une image. C'est un composant séparé, `LoyaltyCard.dc.html`, que le
template appelle six fois via `<dc-import name="LoyaltyCard">`. Le runtime va le
chercher en `./LoyaltyCard.dc.html` ; tant que le fichier manquait, il
journalisait `[dc-runtime] sibling fetch for "LoyaltyCard" failed` et laissait un
emplacement vide. Le composant a été récupéré entier depuis le projet Claude
Design et placé dans `public/`.

Son apparence vient de ses données (`P0` dans le script de logique) : fond
`#F6A9C9`, accent `#A9DDF7`, rayon 16 px, ombre
`0 12px 32px rgba(20,22,28,0.14)`, programme « Club BASH », unité « PASSAGES »,
récompense « 1 burger offert ».

Emplacements, tels que définis par la maquette :

| Écran | Desktop | Mobile |
|---|---|---|
| Accueil, encart « Ma carte » | oui | non |
| Fiche client | oui | oui |
| Inscription publique (`join`) | oui | oui |
| Onboarding | oui | oui |
| Brouillon Wallet | oui | oui |

La carte n'apparaît pas sur l'accueil mobile : dans la maquette, ce bloc est
dans une branche `<sc-if value="{{ isDesk }}">`. Sur mobile, elle s'affiche sur
la fiche client.

## Supabase (mode réel)

Projet `fiuffxchvjcghcvfaout`. Le formulaire de connexion, l'inscription, le
mot de passe oublié, l'onboarding, les clients, les passages, les récompenses,
les corrections, la carte et les réglages du commerce utilisent Supabase.

| Fichier | Rôle |
|---|---|
| `.env.local` | URL du projet et clé **publishable** (jamais de clé secrète ni `service_role`). Modèle : `.env.example`. |
| `src/backend.js` | Client Supabase, bundlé par Vite, transmis au script de logique via `window.dpaReady`. |
| `supabase/migrations/20261002204418_loyalty_core.sql` | Schéma appliqué : tables, RLS, droits, fonctions. |

Le script de logique de `index.html` garde le code de la maquette : chaque
action passe par Supabase quand un commerçant est connecté (`state.live`), et
par le code d'origine en mode démonstration (`state.demo`).

Principes de la base :

- `merchants`, `merchant_members` (rôles), `programs`, `customers`, `cards`,
  `card_events` (historique en ajout seul). RLS sur toutes les tables, aucun
  droit pour `anon`, droits colonne par colonne pour `authenticated`.
- Un commerçant n'accède qu'à son commerce. Les clés étrangères composites
  empêchent d'associer un client, une carte ou un programme de commerces
  différents. Les rôles ne viennent jamais des métadonnées utilisateur.
- Les soldes ne sont jamais écrits par le navigateur : un déclencheur calcule
  le solde, la séquence, l'auteur et la date de chaque événement, verrouille la
  carte, refuse les soldes négatifs et une deuxième correction du même passage.
- `add_visit`, `redeem_reward`, `correct_event`, `enroll_customer` et
  `create_merchant` sont idempotentes : le site envoie un identifiant de
  requête conservé jusqu'à la réponse, un double clic ou une nouvelle tentative
  réseau ne compte qu'une fois.
- Toutes les fonctions sont `SECURITY INVOKER` : elles s'exécutent avec les
  droits et les règles RLS de l'utilisateur connecté.

« Inscrire sur ce téléphone » inscrit le client **depuis la session du
commerçant**. L'inscription publique passe par une vraie URL, voir ci-dessous.

## Inscription publique (`/join/<slug>`)

URL permanente par commerce : `https://dpa-cards.vercel.app/join/<slug>`, où
`<slug>` est `merchants.slug` (unique, non modifiable par le commerçant). Les
nouveaux commerces reçoivent le nom en minuscules sans séparateur
(BASH → `bash`, Napolit'Hein → `napolithein`, 24 caractères max, suffixe
`-xxxx` en cas de doublon) ; les slugs existants sont conservés.

- « Inviter mes clients » : le QR code, « Copier le lien », « Voir la page
  d'inscription » et « Télécharger le QR code » utilisent la même chaîne
  `<origine du site>/join/<slug>`.
- Routage : `vercel.json` réécrit uniquement `/join/:slug` vers `index.html` (même
  règle dans `vite.config.js` pour `vite` / `vite preview`). `admin.html` et le
  reste du site ne sont pas concernés. Sous `/join/`, `window.__resources` pointe le
  composant carte vers `/LoyaltyCard.dc.html`.
- Aucune session : la page appelle l'Edge Function `wallet` —
  `POST /wallet/public-program` (champs publics du programme) et
  `POST /wallet/join` (inscription puis lien « Ajouter à Google Wallet »). Seul le
  slug est envoyé ; commerce et programme sont résolus côté serveur.
- Base : `public_enroll` (migration `20261004085048_public_join`), exécutable par
  `service_role` uniquement, idempotente par identifiant de requête, limitée à
  100 inscriptions publiques par commerce et par 10 minutes. Le déclencheur du
  registre n'accepte une écriture sans session que pour un événement `join` écrit
  par `service_role`. anon et authenticated n'ont aucun droit nouveau.
- Slug inconnu : page « Programme de fidélité introuvable ». Design en attente
  (`pending_dpa`) : la carte est créée, Google Wallet indique « bientôt disponible ».

## Mode démonstration

Le bouton « Explorer la démo » ouvre le commerce fictif BASH, sans aucun appel
à Supabase. La maquette y annonce elle-même ses limites (« Historique fictif :
aucune notification réelle n'est envoyée depuis ce prototype », « Boutons de
démonstration : aucune carte n'est installée »). Rien n'y est persisté.

Le scan simulé (choix de la carte présentée, faux viseur) n'existe qu'en mode
démonstration : connecté, aucune fausse lecture ne peut créditer un passage. On
retrouve la carte par son numéro (PC), par la recherche (mobile) ou depuis la
fiche client.

Pas encore intégrés : lecture réelle par caméra, notifications, Apple Wallet,
import de logo.

## Google Wallet

Émetteur `3388000000023141157`, compte de service
`dpa-cards-wallet@dpa-cards.iam.gserviceaccount.com`.

| Élément | Rôle |
|---|---|
| `supabase/functions/wallet/` | Edge Function `wallet` (déployée sans `verify_jwt`, chaque route s'authentifie). |
| `supabase/migrations/20261003071635_wallet_google_sync.sql` | `wallet_classes`, `wallet_passes`, file de synchronisation, déclencheur, tâche `pg_cron`. |
| Secrets Edge Functions | `GOOGLE_WALLET_SA_B64` (clé JSON en base64), `GOOGLE_WALLET_ISSUER_ID`. Jamais dans le dépôt ni dans `VITE_*`. |

- `POST /wallet/save-link` : session du commerçant obligatoire. Seul l'identifiant de
  carte est envoyé ; la carte est lue avec la session (RLS) puis l'appartenance au
  commerce est revérifiée. Crée ou réutilise la classe du programme
  (`<émetteur>.dpa-prog-<programme>`) et l'objet de la carte
  (`<émetteur>.dpa-card-<carte>`), puis signe le lien « Ajouter à Google Wallet ».
- `POST /wallet/sync` : appelé par `pg_net` après chaque événement de fidélité et
  par `pg_cron` chaque minute, protégé par un secret généré dans Vault. Pousse
  toujours le dernier solde du registre, sous un bail par carte ; `synced_seq` ne
  recule jamais ; en cas d'échec Google, nouvel essai avec délai croissant.
- `GET /wallet/logo.png` : logo public HTTPS utilisé par les classes.

La classe `bash_test_v1` créée dans la console reste en `draft` et n'est pas utilisée.

## Abonnement Stripe

Parcours : compte → onboarding → programme → page « Choisissez votre offre » → Stripe → `/subscription/success`
→ tableau de bord. Sans abonnement `trialing` ou `active`, tous les écrans du tableau de bord mènent à la page
d’offres (contrôle dans l’app) et les actions serveur du tableau de bord (notifications, lien Google Wallet)
répondent `402 subscription_required`. Non concernés : admin, `/join/:slug`, pages légales.

| Offre | Mise en place | Abonnement | Engagement |
|---|---|---|---|
| `no_commitment` | 49,00 € | 24,90 €/mois | aucun |
| `commitment` | 29,00 € | 19,90 €/mois | 12 mois |

Les montants sont définis à un seul endroit côté serveur (`PRICES` dans `supabase/functions/billing/index.ts`) :
l’Edge Function retrouve les prix Stripe par `lookup_key` et vérifie leur montant ; un prix absent ou d’un autre
montant rend la facturation indisponible (`503 billing_not_configured`) plutôt que de débiter un mauvais montant.
Les montants affichés (`PLAN_UI` dans `index.html`, `cgv.html`) doivent rester identiques.

La page « Choisissez votre offre » propose « Choisir mon offre plus tard » : le commerçant accède alors au tableau
de bord en mode verrouillé.

**Pourquoi deux étapes.** Stripe Checkout ne permet pas de combiner un essai gratuit et une date d’ancrage
(`billing_cycle_anchor`) ; l’API Subscriptions, si. Donc :

1. `POST /billing/checkout { plan }` crée une session Checkout `mode=payment` : les frais de mise en place sont
   débités tout de suite et la carte est enregistrée (`setup_future_usage=off_session`, facture créée).
2. Au retour (`POST /billing/verify`, qui interroge Stripe) ou par le webhook `checkout.session.completed`, le
   serveur crée l’abonnement : `trial_end` = +15 jours, `billing_cycle_anchor` = 1er du mois suivant la fin de
   l’essai à 00:00 (Paris), `proration_behavior=create_prorations`. Stripe facture alors 0 € pendant l’essai,
   le prorata de la fin de l’essai jusqu’au 1er, puis le mois complet chaque 1er. Clé d’idempotence = session.
3. `POST /billing/webhook` (signature Stripe vérifiée) synchronise `public.subscriptions` :
   `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`,
   `invoice.paid|payment_failed|finalized`.

Engagement 12 mois : `commitment_start` = date de souscription, `commitment_end` = 1er cycle complet + 12 mois
(enregistrés dans Supabase et dans les métadonnées Stripe). Stripe ne bloque pas une résiliation : DPA Cards le fait.
`POST /billing/cancel` refuse (`409 commitment_active`) pendant l’engagement et enregistre
`cancel_requested_at` ; sans engagement, résiliation en fin de période. Le portail Stripe
(`POST /billing/portal`) utilise une configuration sans résiliation pendant l’engagement.

Paramètres → « Mon abonnement » : offre, prix, statut, fin d’essai, prochaine facturation, engagement, carte,
factures (`POST /billing/summary`, lu chez Stripe), « Gérer mon abonnement » (portail), « Résilier ».

**Secrets Edge Functions** (jamais dans le dépôt ni dans `VITE_*`) : `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIG_DEFAULT`, `STRIPE_PORTAL_CONFIG_COMMITMENT` (les anciens
`STRIPE_PRICE_*` ne sont plus lus). `node scripts/stripe-setup.mjs --key-file <fichier> [--out <secrets.env>]`
crée ou retrouve les produits, les prix (`lookup_key` `dpa_setup_no_commitment`, `dpa_monthly_no_commitment`,
`dpa_setup_commitment`, `dpa_monthly_commitment`, `dpa_custom_design`), le webhook et les configurations du
portail ; quand un montant change, le nouveau prix reprend la `lookup_key` et les anciens prix sont archivés (les
abonnements existants continuent sur leur prix). `--out` écrit le fichier à pousser avec
`supabase secrets set --env-file`. Mode test par défaut ; une clé live exige `--live`.
Migration : `20261005093513_subscriptions`. CGV : `CGV_URL` dans `src/legal-config.js` (vide pour l’instant).

## Mode verrouillé et création de carte payante

**Sans abonnement `trialing`/`active`**, le tableau de bord reste accessible (accueil, profil, commerce, carte,
paramètres, abonnement) avec un bandeau « Votre compte n’est pas encore activé. ». Inviter mes clients, page
d’inscription côté commerçant, clients, scanner, notifications affichent un écran verrouillé ; le QR code et le lien
d’inscription ne sont pas générés. Côté serveur (migration `20261005130000_paid_access_design`) :
`app_private.require_active` lève `subscription_required` (SQLSTATE `PT402` → HTTP 402) dans le déclencheur du
registre (passages, récompenses, corrections, inscriptions y compris publiques), `enroll_customer` et `lookup_card` ;
les politiques d’insertion `customers`, `cards`, `notifications` l’exigent aussi ; l’Edge Function `wallet` répond
402 (notifications, lien Google Wallet) et ferme la page publique (`403 program_unavailable`). Restent possibles :
suppression d’un client, suppression du compte, export.

**« Confier le design à DPA Cards » — 29,90 € TTC, paiement unique** (lookup_key `dpa_custom_design`).
`submit_design_request` crée la demande en `pending_payment` (fichiers + brief). Le design se paie **après**
l’offre : sans abonnement `trialing`/`active`, le commerçant est envoyé sur la page d’offres et
`POST /billing/design-checkout` répond `402 subscription_required`. Une fois l’offre payée, `/subscription/success`
propose « Payer mon design — 29,90 € » ; si l’offre est reportée (« Choisir mon offre plus tard »), aucun paiement de
design n’est demandé et l’accueil affiche un rappel « Demande de design en attente » (bouton « Choisir mon offre »,
puis « Payer mon design » une fois l’abonnement actif). Tant qu’elle n’est pas payée, le commerçant peut changer d’avis (« Je préfère personnaliser ma carte moi-même », avec confirmation) : `POST /billing/design-cancel` expire d’abord les sessions Checkout ouvertes de la demande, puis la passe en `cancelled` ; le programme reste en brouillon et l’étape « Ma carte » rouvre en personnalisation manuelle. Une demande payée (`submitted`, `in_progress`, `delivered`) est refusée (`409 design_not_cancellable`) ; l’abonnement n’est pas concerné. `POST /billing/design-checkout` ouvre Stripe Checkout
(`metadata.type = custom_design`), puis `/design/success`
(`POST /billing/design-verify`, vérifié chez Stripe) ou le webhook `checkout.session.completed` appellent
`design_mark_paid` : la demande passe en `submitted` (payée), le programme en `pending_dpa`, et une alerte e-mail
part une seule fois vers `contact@digitalprojectagency.fr`. Ce paiement n’active pas l’abonnement (et inversement).
Admin : compteur « Designs à traiter » (payées `submitted`/`in_progress`), liste « Demandes de design » avec liens
signés, actions `submitted → in_progress → delivered` (`design_set_status`) ; « livré » valide le programme (déposer
les visuels sur le programme avant) et le commerçant voit « Votre design est prêt. ».

**E-mails** (`supabase/functions/_shared/email.ts`, API Resend) : à configurer en secrets Edge Functions
`RESEND_API_KEY`, `EMAIL_FROM` (expéditeur vérifié), facultatif `DESIGN_ALERT_EMAIL`. Tant qu’ils manquent, rien
n’est envoyé et `design_requests.notify_error = email_not_configured` est visible dans l’admin.

## Administration (`/admin.html`)

Connexion par lien magique, réservée aux e-mails de `admin_users`. Les données viennent uniquement de
l’Edge Function `wallet` : `POST /admin-overview` (KPI + liste des commerces) et `POST /admin-merchant`
`{ merchant_id }` (fiche : propriétaire, programme, clients, cartes, activité récente). Chaque appel vérifie
côté serveur la session, l’e-mail confirmé et sa présence dans `admin_users` ; les agrégats viennent des
fonctions SQL `admin_overview` / `admin_merchant_detail` (migration `20261004190429_admin_dashboard`),
exécutables par `service_role` uniquement. Lecture seule ; « Exporter » produit un CSV de la liste.

**Générateur de cartes** (onglet de l’admin, `#generateur`, `src/card-designer.js`). Un projet de design par
programme, décliné en deux dispositions : **Apple Wallet** (rectangle complet, coins arrondis uniquement : en-tête
logo / nom / progression, grand visuel avec les tampons, 3 colonnes client / récompense / récompenses dispo, QR
centré sur fond blanc) et **Google Wallet** (logo rond, pastille de progression, visuel arrondi, tampons sous le
visuel, lignes d’informations, QR). Le design (couleurs, logo, images, tampons, police, ajustements par
plateforme) est commun, chaque plateforme peut surcharger ses couleurs et son affichage. Le nom du client, la
progression, les récompenses et le QR code (vrai QR `DPA1:` vectoriel) ne font jamais partie du design : l’éditeur
utilise des données de démonstration. Routes `wallet` (admin, même contrôle `admin_users`) :
`admin-card-designer` (projet d’un commerce ou d’une demande payée), `admin-card-upload` (URL d’envoi signée vers
`program-assets/<commerce>/<programme>/designer/`), `admin-card-save` (brouillon dans `card_designs`, programme
inchangé), `admin-card-validate` (applique le design : `programs.card_design` sans les données de démonstration,
`bg`/`accent`, et `logo_path`/`hero_path` si les images respectent les règles Google Wallet). La validation ne
change ni la règle de fidélité ni le statut de la demande de design (« Marquer comme livré » reste séparé).
Migration `20261006180155_card_designer`.

**Design validé sur les vraies cartes.** `programs.card_design` pilote le rendu : accueil, fiche client, écran
« Ma carte » (onglets Apple / Google) et carte affichée après inscription sur `/join` (layout Google sur Android,
Apple ailleurs) utilisent `FitCard` de `src/card-designer.js` avec les données de la carte (nom, solde, récompenses
disponibles = solde ÷ objectif, numéro, QR `DPA1:<qr_token>`). `card_design` absent : `LoyaltyCard` habituelle ;
incomplet ou image introuvable : couleurs, logo et couverture du programme. Google Wallet : à la validation,
la classe existante du programme est relue puis remplacée (même id, `PUT`) avec `issuerName`, `programName`,
`programLogo`, `heroImage`, `hexBackgroundColor` (couleur Google du design), `accountNameLabel`, `accountIdLabel` ;
les objets clients (id, QR, numéro, nom, solde, messages) ne sont pas touchés et héritent du branding de la
classe. Une nouvelle classe est créée directement avec ce branding. L’état est suivi dans
`card_designs.google_sync_status` (`synced`, `no_class`, `error` + message) ; en cas d’erreur le design reste
validé et l’admin peut relancer (`POST /wallet/admin-card-google-sync`). Migration `20261006182755_card_design_google_sync`.

## Pages légales et données personnelles

- Pages publiques `/mentions-legales` et `/confidentialite` (`mentions-legales.html`, `confidentialite.html`),
  réécrites par `vercel.json` et `vite.config.js` (règles ciblées, pas de réécriture globale).
- Informations légales : **uniquement** dans `src/legal-config.js` ; les valeurs « À RENSEIGNER » restent à fournir.
- Liens légaux : pied de page connexion / inscription, page Paramètres, page `/join` (consentement + pied de page).
- Aucun cookie ni traceur : seul le stockage local technique (session, « Se souvenir de moi », mode scanner) ; pas de bannière.
- `POST /wallet/delete-customer` `{ card_id }` : propriétaire uniquement, carte vérifiée dans son commerce ; supprime le client
  (cascade : cartes, historique, wallet_passes, deliveries) puis désactive l’objet Google (INACTIVE, sans bloquer).
- `POST /wallet/delete-account` `{ confirm: "SUPPRIMER" }` : propriétaire uniquement (staff → 403). Supprime le commerce
  (cascade sur toutes les tables liées), ses fichiers des buckets `program-assets` / `design-requests`, désactive les objets
  Google, puis supprime le compte Auth du propriétaire. Les comptes staff perdent seulement leur accès.
- Export : Paramètres → Sécurité → « Exporter mes données » (JSON lu avec la session du commerçant, RLS ; sans identifiants internes).

## Notifications Google Wallet

Onglet Notifications, mode connecté : envoi immédiat, Google Wallet uniquement (Apple Wallet et
la programmation viendront plus tard ; « Programmer » est marqué « bientôt disponible »).

- `POST /wallet/notify` (Edge Function `wallet`, session commerçant obligatoire). Payload :
  `{ title, body, audience: "all"|"reward"|"near"|"inactive"|"selected", card_ids?, notify?, kind?, draft_id? }`.
  Le commerce vient de la session ; chaque `card_id` est vérifié (une carte étrangère refuse tout
  l’envoi) ; les `google_object_id` sont lus dans `wallet_passes`, jamais reçus du navigateur.
- Google : `loyaltyObject/{id}/addMessage` avec `messageType: "TEXT_AND_NOTIFY"` (ou `"TEXT"` si
  « Prévenir le client » est décoché), identifiant de message = identifiant de la campagne.
  Réponse : `{ status, targeted, sent, failed, quotaExceeded, noWallet }`.
- Tables `notifications` (campagne, statut `draft|sending|sent|partial|failed`, compteurs) et
  `notification_deliveries` (une ligne par carte : `sent|failed|quota_exceeded|no_wallet`).
  Migration `20261004111252_notifications`. Le commerçant lit ses lignes et gère ses brouillons
  (RLS) ; tout le reste est écrit par l’Edge Function.
- Limite Google : 3 messages avec notification par pass sur 24 h. Un dépassement est compté en
  `quota_exceeded` sans faire échouer la campagne (`partial`).

## Scanner (mode connecté)

Le QR d'une carte contient `DPA1:<qr_token>` (UUID opaque de `cards.qr_token`, aucune
donnée personnelle) : c'est le même sur Google Wallet et sur la carte affichée par le
site. Douchette, caméra et clavier passent tous par `lookup_card` (RPC Supabase,
`SECURITY INVOKER` + filtre explicite sur le commerce connecté) : une carte d'un
autre commerce n'est jamais trouvée.

- **PC / caisse** (système de bureau, même tactile, démo comprise) : jamais de caméra,
  ni demande d'autorisation. Trois méthodes sur le même écran :
  1. *Scanner avec le lecteur QR* : champ `#pos-reader` focalisé automatiquement, vidé
     après chaque lecture ; la page capte aussi les frappes rapides + Entrée quand le
     focus est ailleurs, et un Entrée de douchette n'active jamais un bouton. Lecteur
     réglé en QWERTY sur un poste AZERTY : pris en charge (touches physiques).
  2. *Saisir le numéro de carte* : numéro complet ou 4 derniers chiffres, erreurs
     affichées sous le champ.
  3. *Rechercher un client* : prénom, nom ou numéro, parmi les clients du commerce.
  Après un passage ou une récompense, retour automatique à « Lecteur prêt » s'il ne
  reste rien à faire. En démo sur PC, « Simuler un scan » reste disponible.
- **Téléphone / tablette** : la caméra arrière (`facingMode: environment`) est demandée
  à l'ouverture du scanner, jamais au chargement du site. Lecture par BarcodeDetector
  s'il gère `qr_code`, sinon jsQR chargé à la demande (iPhone Safari). Premier QR lu =
  scanner verrouillé et caméra coupée ; au retour, le même QR est ignoré 3 s après la
  reprise du flux. États : autorisation en attente, refusée (Réessayer), indisponible
  (HTTPS / navigateur), aucun appareil photo, ouverture impossible, flux interrompu.
  Les pistes vidéo sont arrêtées quand un client s'ouvre, en quittant le scanner, à la
  déconnexion, à l'ouverture de la saisie manuelle et quand la page passe en arrière-plan.
  Saisie du numéro et recherche client en secours. La caméra exige HTTPS (ou `localhost`).
- Forcer un mode sur un appareil : ouvrir l'application avec `?scanner=pos` ou
  `?scanner=camera` (mémorisé sur l'appareil).

## Création de la carte (onboarding, étape 3)

Le programme est créé à la fin de l'étape 2 avec un visuel neutre (`design_status = 'draft'`).
L'étape 3 propose deux choix :

- **Personnaliser ma carte** : nom du commerce et du programme, logo (obligatoire,
  recadré en PNG 660 × 660, affiché en cercle par Google), couverture facultative
  (JPEG 1032 × 812, format « hero » de Google Wallet) et couleur de fond (seule
  couleur prise en charge par les cartes de fidélité Google Wallet). Le brouillon est
  enregistré au fil de la saisie. « Valider ma carte » appelle
  `POST /wallet/finalize-design` : le serveur relit les fichiers (format, poids,
  dimensions), verrouille le design puis crée la classe Google du programme.
- **Confier le design à DPA Cards** : logo, références, couleurs, description et
  contact, enregistrés dans `design_requests` (statut `submitted`), fichiers dans le
  bucket privé `design-requests`. Le programme passe en `pending_dpa` : aucune classe
  Google ni lien d'ajout tant que le design n'est pas livré.

Après validation, un déclencheur refuse toute modification du visuel par un
commerçant (nom du programme, couleurs, logo, couverture), quel que soit l'appareil.
Les images publiques sont dans le bucket `program-assets` (PNG/JPEG, 2 Mo maximum),
écriture réservée au propriétaire du commerce et seulement en brouillon.

### Retrouver les demandes sur mesure

Il n'existe pas encore d'espace administrateur. Dans le dashboard Supabase :
Table Editor → `design_requests` (filtrer `status = submitted`), fichiers dans
Storage → `design-requests` → `<merchant_id>/<request_id>/`. Pour livrer un design :
déposer le logo et la couverture dans `program-assets/<merchant_id>/<program_id>/`,
renseigner `logo_path`, `hero_path`, `bg`, `name`, passer le programme en
`validated` et la demande en `delivered` (service role ou SQL) ; la classe Google
est créée au premier ajout d'une carte client.

Mettre à jour la clé : `supabase secrets set --env-file <fichier hors projet>` puis
supprimer le fichier. Redéployer : `supabase functions deploy wallet --no-verify-jwt --use-api`.
