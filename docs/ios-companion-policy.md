# DPA Cards iOS — mode compagnon sans achats

Décision produit du 18 octobre 2026 : **toutes les inscriptions, créations de commerces, activations, changements d'offre et transactions sont réalisés sur le site web**. L'application iOS gratuite est réservée à l'utilisation des comptes commerçants dont l'accès est déjà activé.

## Parcours fonctionnel

- Le site conserve Stripe, la création de comptes, les profils multi-commerces et les tarifs approuvés. Aucun prix, abonnement existant, frais d'activation ni échéance ne change.
- L'application iOS propose la connexion et la récupération du mot de passe. Elle ne propose ni inscription, ni configuration initiale d'un commerce, ni achat intégré, ni Stripe Checkout, ni lien incitant à acheter sur le web.
- Un commerçant connecté ayant un accès actif peut utiliser les fonctions de fidélité et choisir parmi ses profils existants. Le sélecteur ne propose ni création ni activation.
- Un compte ou un commerce sans droit d'accès confirmé affiche « Espace non actif », une vérification de l'accès et le contact support. La navigation native refuse l'accès aux écrans d'abonnement, d'inscription commerçant et de commande de design.
- Les commandes de création graphique payantes, le portail Stripe et la gestion de la résiliation restent sur le web. Les demandes déjà créées peuvent être consultées dans l'app sans invitation à payer.
- Toute autorisation d'accès continue à être confirmée par le backend ; une URL de retour Stripe ou un drapeau local ne débloque jamais l'accès.

## Apple

Apple App Review Guideline 3.1.3(f) prévoit une exception aux achats intégrés pour les apps gratuites compagnons d'un outil web payant **sans achat ni appel à acheter ailleurs dans l'app**. Référence : https://developer.apple.com/app-store/review/guidelines/#business

Ce positionnement est soumis à l'approbation d'App Review et ne garantit pas l'acceptation d'Apple. Il n'exige pas la création de produits StoreKit pour ce parcours compagnon.

### Notes pour l'équipe App Review

« DPA Cards is a free companion app for merchants who already have an active DPA Cards web account. It provides loyalty card management, customer scanning, and access to existing merchant workspaces. The iOS app does not offer account purchases, new subscriptions, paid commerce activation, Stripe checkout or links directing users to external purchase methods. Reviewers can use an existing active test merchant account provided separately via App Store Connect. »

## Portes de livraison

- Ces changements résident dans la PR #39 `feat/merchant-profiles`, **non fusionnée et non déployée** à la date de la décision.
- Le workflow TestFlight historique compile `feat/ios-app-store-preparation` (branche distincte) ; ce code compagnon ne sera pas distribué tant que les branches et la chaîne de publication n'auront pas été intégrées correctement.
- Un ancien build iOS effectue `merchant_members.maybeSingle()` et des requêtes non filtrées. Avant d'activer plusieurs commerces en production, assurer sa compatibilité ou exiger une mise à jour de l'app, puis tester sur appareil.
- Avant publication : tests du compte payé, inactif/expiré, multi-commerce, récupération du mot de passe, revue de toutes les entrées de paiement, intégration staging du backend et validation TestFlight/App Review.

La branche web conserve tout le parcours commercial ; ce document décrit seulement la séparation d'expérience de l'app native.
