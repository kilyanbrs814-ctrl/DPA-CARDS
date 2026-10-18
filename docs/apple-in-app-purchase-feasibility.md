# Achats intégrés iPhone — étude de faisabilité et portes de livraison
Date : 18 octobre 2026. Cette note complète `docs/merchant-profiles.md` ; **aucun changement de prix ni d'engagement n'est approuvé ici**.

## État vérifié

- PR #39 : `feat/merchant-profiles`, uniquement le web, la migration et le backend Stripe préparés à l'origine.
- Sources du build iOS : `feat/ios-app-store-preparation` (Capacitor 8, `capacitor.config.json`, scripts Swift de configuration et workflows GitHub). La branche diverge de `feat/merchant-profiles` : **ne pas remplacer directement l'une par l'autre**. Le workflow `ios-testflight.yml` présent sur la PR réalise toujours un checkout **fixé** sur `feat/ios-app-store-preparation`, et non sur la tête de la PR.
- L'application actuelle utilise une WebView et **n'a pas de pont StoreKit**. L'affichage des profils iPhone a été rétabli dans la PR, sans publication native.
- Supabase accessible : `fiuffxchvjcghcvfaout` **production uniquement**. La migration `20261018110452_merchant_profiles.sql` n'y figure pas ; fonction `billing` v11. Aucun environnement de staging permettant le cycle réel Checkout → webhook → Supabase ni Sandbox Apple n'a été identifié dans les outils.
- Un iOS existant utilise `merchant_members...maybeSingle()` dans `src/workspace-identity.js` et charge certaines tables sans filtrage de commerce. Il **peut encore échouer ou mélanger des lignes** après l'ajout d'un deuxième commerce. Le repli sur le commerce principal ajouté dans les RPC et Edge Functions protège ces seuls accès ; **cela ne suffit pas à certifier la compatibilité de cet ancien build**. L'activation multi-commerce doit rester bloquée en production jusqu'au protocole de migration de ces clients.

## Contrat commercial inchangé

- Mensuel : **20 € × nombre de commerces actifs** (1:20, 2:40, 3:60, 5:100, 10:200). Aucun plafond à dix.
- Activation, prix unique *du nouveau commerce* : rangs 1/2/3/4 : 50/30/25/20 €, puis 15 € à partir du cinquième ; toutes plateformes et toutes formules. L'historique confirmé ne se rachète jamais.
- Annuel prépayé web : supplément d'abonnement au prorata du temps restant **plus** activation du nouveau commerce ; fin inchangée, **sans renouvellement automatique**. Exemple 2 commerces : 480 €/12 mois pour la prochaine période complète. Design optionnel inchangé.

## Mécanismes officiels Apple et différences non résolues

1. **Abonnement mensuel** : l'abonnement à renouvellement automatique StoreKit appartient à un **groupe** de produits. Un groupe n'autorise qu'un abonnement actif par acheteur ; chaque taille de forfait est normalement un produit/niveau prédéfini, et **non une ligne à quantité Stripe pilotée par le serveur**. L'upgrade Apple est immédiat avec remboursement du reste selon Apple et nouvelle date de renouvellement ; les downgrades peuvent être différés. On ne peut donc pas garantir le même prorata ni la même échéance que Stripe.
2. **Quantités Apple** : la fonctionnalité *multiseat* annoncée en 2026 concerne le partage d'abonnements entre sièges/utilisateurs et son déploiement, **pas automatiquement un compteur de commerces DPA Cards**. Elle ne valide pas la facturation illimitée de commerces. Ne créer aucune limite arbitraire à dix ; pour un nombre quelconque, il faut vérifier capacité/approbation produit et stratégie réelle, puis configurer les produits nécessaires.
3. **Activation unique** : un produit intégré consommable à prix fixe correspondant au rang d'activation peut être racheté lors d'un nouveau commerce ; un non-consommable classique n'est achetable qu'une seule fois par identifiant produit. Le serveur doit réserver le rang, lier la transaction au commerce et prouver chaque activation une seule fois. Les deux achats (abonnement + activation) ne sont **pas atomiques** : conserver l'achat vérifié et reprendre l'autre sans jamais le refaire payer.
4. **Annuel prépayé sans renouvellement** : StoreKit possède un produit de type abonnement **non renouvelable**, mais ne fournit pas de `amount` arbitraire à facturer au centime près pour le complément proratisé en cours d'année. Les prix des achats intégrés sont déterminés dans App Store Connect. Les upgrades de produits renouvelables ne reproduisent pas cette formule. **Ne pas créer un renouvellement automatique annuel ni arrondir secrètement un complément.**
5. **Achats croisés** : un abonnement Apple ne peut pas augmenter directement la quantité d'un abonnement Stripe, et inversement. Un compte financé par Stripe ne peut pas ajouter un commerce depuis l'iPhone avec un nouvel abonnement Apple sans risquer deux contrats ; pour le compte Apple côté web, augmenter Stripe déclencherait le même problème. **Aucune solution fidèle à toutes les règles et aux deux lieux de paiement n'est démontrée.** Une migration planifiée entre fournisseurs (avec date et prix annoncés) ou une restriction de paiement sur la plateforme du contrat courant doit être soumise à validation commerciale/Apple.
6. **App Review** : service logiciel accessible dans l'app ; vérifier les sections 3.1.1 et 3.1.3(b)/(c)/(f) selon le parcours exact. Le fait de servir des commerçants ne rend pas automatiquement chaque transaction exemptée d'achats intégrés.

Documentation officielle vérifiée :
- https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information/
- https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-purchase-options-for-auto-renewable-subscriptions
- https://developer.apple.com/help/app-store-connect/manage-subscriptions/create-non-renewing-subscriptions
- https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-pricing-for-auto-renewable-subscriptions/
- https://developer.apple.com/app-store/review/guidelines/fr/
- https://developer.apple.com/documentation/appstoreservernotifications/receiving-app-store-server-notifications
- https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info

## Schéma d'intégration à compléter avant d'activer un achat

- Créer/valider dans **App Store Connect > DPA Cards > Monétisation > Abonnements / Achats intégrés** : groupe d'abonnements, plans mensuels de taille adaptée (sans plafond de commerces contractuel), activation consommable 50/30/25/20/15 € si compatible avec l'examen Apple, et éventuels produits non renouvelables annuels. Les prix publics en EUR, la TVA et les périodes d'engagement doivent être confirmés. **Aucun produit Apple n'est déclaré configuré à ce jour.**
- Capacitor : ajouter un pont StoreKit 2 natif (ou un plugin maintenu audité) et l'interface de devis Apple. Acheter seulement après devis affichant somme unique, somme récurrente, renouvellement, fournisseur, prochaine date et confirmation. `appAccountToken` doit être lié à l'UUID serveur de l'utilisateur.
- Supabase : table distincte d'événements Apple avec contraintes uniques `environment + transaction_id` et `original_transaction_id`, lien `account_id / merchant_id / product_id / provider`. Traitement transactionnel/idempotent. JWT reçu du client **non suffisant** : vérifier JWS cryptographique et/ou App Store Server API avec environnement, bundle ID et produit. Ne jamais exposer la clé Apple dans l'app. Préserver le ledger Stripe actuel.
- Endpoint serveur Notifications V2 Apple : vérifier `signedPayload` et les contenus JWS, dédupliquer par `notificationUUID`, gérer achats, changements, renouvellements, remboursements/révocations, expirations, retards, notifications répétées et état courant. Restaurer à partir des preuves Apple, non de l'état local seul.
- Parcours en deux achats : journal persistant `pending / payment_1_verified / payment_2_verified / active / refunded` ; le premier achat reçu reste enregistré même si le suivant est annulé. Reconcilier sur redémarrage, proposer finalisation ou remboursement/assistance sans double débit.
- `merchant_billing_accounts.billing_provider` géré sur serveur avec transitions explicites et dates. Ne jamais ouvrir un deuxième abonnement Stripe/Apple pour satisfaire un ajout. Le commerce existant conserve son ID, ses cartes et ses droits, y compris Wallet.
- Tester notifications Sandbox à l'URL *staging*, fixtures de doublons, restauration, remboursement, attente et coupure réseau. Tester aussi les anciens builds installés sur vrai iPhone **avant** toute migration production.
- Test web restant : Checkout **réel mode test** → webhook signé → Supabase staging → commerce actif et ajout 2e/3e profil ; aucun prélèvement réel.

## Décisions commerciales à valider AVANT toute mise en vente Apple

**Option A** : garder exactement les règles web/Stripe, permettre la consultation et le changement de commerce sur les deux plateformes, et exiger que les ajouts payants d'un contrat Stripe soient réglés via Stripe (non vendables directement dans iOS tant qu'Apple n'a pas validé une exception ou un parcours). Ne satisfait donc **pas** l'objectif d'achat universel dans l'app.

**Option B** : prévoir une migration contractuelle explicite à l'échéance Stripe ou Apple vers un seul fournisseur, avec affichage des montants et des périodes avant confirmation. Les ajouts iOS peuvent attendre la migration ; un ajout immédiat universel n'est pas garanti. L'annuel Apple et son complément au prorata demandent encore une validation.

**Option C** : adopter pour les nouveaux abonnés Apple une grille de produits et une règle de changement d'offre adaptées à StoreKit (éventuelles nouvelles dates / proratas), **en indiquant clairement les différences**. Cela constitue un changement de règles et nécessite l'approbation du propriétaire et des tests App Review ; impossible à appliquer en silence.

**Garde-fou actuel** : la PR rend le sélecteur visible dans la WebView iOS, mais empêche délibérément la création de paiement Stripe via le nouveau panneau natif et refuse le choix d'un plan natif tant que StoreKit n'est pas prêt. Ne pas présenter cela comme une implémentation de l'IAP ; ne pas déclencher TestFlight ni déployer la migration en production dans cet état.

## Statut de livraison

Modification de code et CI dans la PR en brouillon ; **zéro produit Apple configuré confirmé, zéro transaction Sandbox exécutée, zéro migration Supabase production, zéro déploiement commun, zéro nouvelle IPA TestFlight**. Le simulateur/TestFlight de la branche iOS séparée et leurs anciens résultats ne prouvent pas la présence de ces changements sur iPhone.
