# Profils de commerces — web et backend

**Périmètre décidé : site web uniquement.** L’ajout et l’activation d’un commerce, le changement entre profils, les devis et les paiements restent sur `https://cards.digitalprojectagency.fr`. La version iPhone n’affiche aucun sélecteur multi-commerce, aucun ajout de commerce et aucun paiement. La facturation Stripe existante est inchangée pour un commerce. L’ajout à une période annuelle prépayée reste facturé au prorata du temps restant, sans changer sa date de fin ni ajouter de renouvellement automatique.

## Architecture vérifiée

- Base de travail : `main`, commit `901275b0c36232b908777110e9096958aa0e9241`.
- Interface réellement exécutée : logique DC/React de `index.html`, API Vite dans `src/backend.js`, hébergement statique Cloudflare Pages.
- Supabase de référence : `fiuffxchvjcghcvfaout`, PostgreSQL 17. Les colonnes, les fonctions d’inscription et les politiques existantes ont été inspectées en lecture seule.
- Facturation : fonction `billing` déployée en version 11, Stripe SDK 17.7.0/API 2025-02-24.acacia, Checkout puis abonnement mensuel ; variante annuelle `prepaid_purchases`, sans abonnement Stripe ni renouvellement automatique.
- Le code déployé de `billing` a été comparé à `main`. La différence antérieure porte sur le paiement du design avec accès manuel ; cette correction de `main` est conservée.
- Wallet : identifiants, slugs, cartes distribuées et chemins de rendu inchangés. Les appels commerçants reçoivent un contexte explicite validé par le serveur.
- Les sources historiques compilées par le workflow TestFlight sont sur `feat/ios-app-store-preparation`. Ce workflow garde une référence explicite à cette branche et n’intègre donc pas automatiquement la PR multi-profils. Un workflow **distinct de simulateur non signé**, `.github/workflows/ios-profile-simulator.yml`, valide la préparation iOS de la PR sans publication. L’ancien build iOS utilise `merchant_members.maybeSingle()` et des lectures sans filtre explicite. La migration limite donc les droits SELECT de `merchant_members` au commerce principal **en l’absence du marqueur web `x-dpa-web-profiles: 1`**. Ce filtrage se propage aux lectures métier protégées par membership ; le navigateur web envoie le marqueur, puis `x-merchant-id` pour ses actions. Les RPC et fonctions Edge conservent leur repli sur le commerce principal. **Une validation sur la build iOS réellement distribuée est obligatoire avant la migration production ; le test DB seul ne suffit pas.**

## Modèle et isolation

`merchant_billing_accounts` rattache les commerces d’un propriétaire au commerce principal portant son abonnement existant. Les tables métier restent rattachées à leur `merchant_id`. Aucune donnée client, carte, URL ou identité Wallet n’est déplacée.

`merchant_activations` contient seulement les activations confirmées. La migration reprend les commerces ayant une preuve d’activation (paiement, abonnement, accès manuel ou clientèle existante) avec une entrée historique sans nouveau prélèvement. Les brouillons ne sont pas comptabilisés.

Les champs de facturation et les activations sont en lecture seule pour les clients. Création par RPC idempotente, contrôle du propriétaire en base, verrou par compte, RLS sur toutes les nouvelles tables. Les clés étrangères composites métier existantes sont conservées.

Le client transmet `x-merchant-id`. Les fonctions Edge revérifient l’appartenance ; les RPC d’inscription, recherche de carte et demandes de design résolvent le même contexte. Le registre refuse une opération sur une carte d’un autre profil sélectionné, même lorsque l’utilisateur est membre des deux commerces. Les clients anciens ayant une seule appartenance continuent à fonctionner ; une requête ambiguë avec plusieurs appartenances est refusée.

Le choix est stocké sous `dpa.profile.<user-id>` sur chaque appareil. À l’ouverture, ce choix est validé contre les appartenances courantes. Le changement recharge entièrement le document sans déconnexion : anciens formulaires, cache React, caméra et callbacks tardifs sont détruits. Les requêtes déjà envoyées gardent le contexte de leur commerce d’origine.

## Facturation

- Mensuel : nombre de commerces activés × 2 000 centimes. Aucune limite à dix.
- Activation : 5 000, 3 000, 2 500, 2 000 centimes, puis 1 500 centimes par commerce à partir du cinquième, pour les deux formules.
- Les anciens abonnements conservent leur prix jusqu’à un ajout accepté. Aucun traitement de masse ne les modifie.
- Le récapitulatif est calculé côté serveur : compte actuel/après ajout, montant réel actuel, nouveau total, différence, activation unique, effet, prorata et paiement immédiat. Une case de confirmation est obligatoire avant Checkout.
- Mensuel : le serveur prévisualise le prorata chez Stripe et conserve `create_prorations`, soit facturation du prorata sur la prochaine facture. L’activation seule est payée immédiatement. Le serveur remplace l’article existant et sa quantité, sans créer un autre abonnement ni prolonger l’engagement.
- Annuel prépayé : complément = différence mensuelle × nombre de mois de la période × durée restante / durée totale réelle. Arrondi au centime. Le complément et l’activation sont payés immédiatement. Le compte passe, par exemple, à une référence de 40 €/mois pour deux commerces. La date de fin et l’absence de renouvellement automatique sont conservées.
- À la prochaine souscription annuelle, le montant couvre tous les commerces confirmés ; aucune nouvelle activation n’est due pour les commerces déjà activés.
- Le récapitulatif de facturation annuelle distingue le paiement initial des compléments déjà payés pendant la période et affiche le total payé.
- La création graphique optionnelle reste une prestation séparée, aux conditions existantes.

## Reprise et cohérence

`merchant_profile_operations` conserve le devis accepté, le rang, les montants, la session et le paiement Stripe. Une seule opération est ouverte par compte, y compris depuis deux appareils. Le rang est attribué sous verrou ; il est confirmé seulement après paiement et mise à jour effective de l’abonnement ou du prépaiement.

Les sessions et mises à jour utilisent des clés d’idempotence. La métadonnée `profile_operation` est écrite dans la même requête Stripe que la modification d’article : une reprise après interruption reconnaît une modification déjà appliquée. Les webhooks signés et `/billing/profile-resume` exécutent la même confirmation. Les doubles notifications ne créent pas de deuxième activation.

L’annulation libère le compte seulement après expiration certaine de la session Stripe ; une session déjà payée est traitée. Une opération payée interrompue reste dans un état reprenable. Si le contrat a été modifié indépendamment et rend impossible l’application aux conditions acceptées, le paiement de cet ajout est remboursé entièrement avec une clé d’idempotence ; le rang n’est pas consommé et le brouillon est conservé.

`merchant_initial_checkouts` protège aussi le parcours initial contre les ouvertures répétées. La ligne d’abonnement est réservée avant l’ouverture de Checkout ; une réponse tardive ne peut pas écraser un abonnement activé par webhook. La reprise retrouve les sessions par métadonnée plutôt que de recréer une charge après expiration de la clé Stripe.

Les configurations non standard (remises, taxes automatiques, plusieurs articles, échéancier externe, collecte manuelle, suspension ou résiliation programmée) sont refusées avant un nouvel ajout ; elles nécessitent une adaptation explicitement vérifiée. Le montant accepté ne peut pas être remplacé silencieusement.

Aucune suppression de commerce n’est ajoutée. L’ancienne suppression de compte avec plusieurs commerces est dirigée vers le support, pour éviter de supprimer une connexion en laissant des abonnements ou des données partiellement nettoyés.

## Validation

Commandes reproductibles depuis le dépôt :

```sh
npm ci
npm run build
npm run test:profiles
npm run test:profiles-ui
npm run test:static
npm run test:apple
npm run test:real-apple
npm run test:apple-strip
npm run test:emoji
npm run test:png
npm run test:png-ui
deno check --node-modules-dir=auto supabase/functions/wallet/index.ts supabase/functions/apple-pass/index.ts supabase/functions/billing/index.ts
```

Les tests de profils couvrent la grille au-delà de dix, les cumuls, le prorata annuel avec tarif historique, les droits en PostgreSQL isolé/PGlite, l’absence d’activation des brouillons, la sélection locale, les scans d’un autre profil, le réemploi du Checkout, les notifications concurrentes, la reprise après interruption et le remboursement compensatoire. Le test navigateur vérifie l’en-tête, le sélecteur, l’accès à l’ajout, le vidage des données au début du parcours et la confirmation avant paiement ; captures mobile et desktop dans `test-results/`.

Contrôle Stripe réalisé uniquement en mode test dans le compte `digitalprojectagency.fr` : client synthétique sans e-mail, article à 24,90 €, prévisualisation du remplacement par 2 × 20 €, prorata de 15,10 € au début de période, puis mise à jour du même abonnement et du même article à 40 €/mois. Aucune facture immédiate supplémentaire lors de la modification. L’abonnement de test a ensuite été annulé. Les tests Stripe via connecteur utilisent l’API du connecteur ; le parcours des fonctions Edge n’a pas été déployé dans un projet de staging pour un test complet Checkout → webhook → Supabase.

Sous Windows, le test de signature utilise OpenSSL fourni avec Git dans `usr/bin` ; ajouter ce répertoire au PATH du processus de test si nécessaire. La correction d’import URL rend le test de signature portable sur Windows. L’annotation JSDoc du panneau Google corrige uniquement son typage Deno ; aucun pixel ni code de rendu n’est modifié.

## Déploiement à effectuer

1. Préparer un projet Supabase et des clés Stripe de test ; ne jamais tester des prélèvements réels. Exécuter la nouvelle migration dans cet environnement, vérifier les conseillers de sécurité et tester les endpoints réels avec les webhooks Stripe.
2. Configurer les nouveaux prix de test avec `node scripts/stripe-setup.mjs --key-file <fichier-local-hors-depot>`. Vérifier 50 € d’activation initiale et 20 €/mois par unité pour les deux formules. Les identifiants Stripe ne sont pas codés en dur. Conserver les prix des abonnements déjà souscrits ; le script ne modifie pas leurs contrats.
3. Vérifier les secrets existants : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, configurations de portail, `DPA_SITE_URL`, `WALLET_ALLOWED_ORIGINS`, secrets Wallet. Inclure les origines de prévisualisation utilisées. Aucun secret nouveau n’est inclus dans le frontend.
4. Après validation de staging, appliquer **uniquement** `20261018110452_merchant_profiles.sql` en production dans une fenêtre de maintenance du site. Le schéma réel contient des migrations historiques sous des identifiants différents du dépôt : ne pas rejouer aveuglément toute l’histoire avec `db push`.
5. Configurer les nouveaux prix en production, puis déployer ensemble les fonctions `billing` et `wallet` et le build statique Cloudflare Pages. Une prévisualisation utilisant l’ancienne base ne peut pas tester le multi-profils.
6. Contrôler une connexion existante, les droits administrateur, les liens `/join/<slug>`, les cartes Wallet et un ajout en mode test avant d’ouvrir le parcours de production. Surveiller les opérations `accepted`/`paid` et les erreurs webhook ; reprendre par `profile-resume` en cas d’interruption.

État de cette livraison : sources, migration et tests préparés ; aucune migration, configuration de prix, fonction ou page du site de production n’a été publiée. Aucun build iOS nécessaire pour cette livraison web. Une éventuelle prise en charge native des comptes multi-profils fera l’objet d’un travail et d’une distribution distincts.


## Périmètre iPhone

Aucun changement d’application iOS n’est demandé ni livré pour cette fonction. Le site affiche le sélecteur et l’ajout ; l’interface native ne les affiche pas. La migration protège les anciennes requêtes sans sélection explicite de commerce. Avant déploiement du backend, vérifier la compatibilité d’une version iPhone actuellement installée, et pas seulement un simulateur. Les achats restent exclusivement sur le site, conformément à [la politique de l’application compagnon](ios-companion-policy.md).


## État des vérifications de production au 18 octobre 2026

La base de production a six commerces et six appartenances au moment du contrôle. Les changements de schéma multi-commerce ne sont pas appliqués. La connexion Stripe accessible aux outils est **en mode test seulement**, sans accès confirmé aux prix et clés live. Déployer `billing` avec les nouveaux endpoints sans pouvoir tester les prix live et le parcours Checkout complet risquerait de rendre les achats indisponibles. **Ne pas fusionner ou activer en production sans staging, vérification du connecteur Stripe live et test de compatibilité iPhone.**
