# Suivi des ventes — reprise du 12 octobre 2026

## État de livraison

Code préparé sur `codex/durable-sales-commissions`, depuis `88eac9c`.
Aucune migration appliquée au projet distant et aucune fonction Edge publiée par cette reprise.
Ne pas fusionner pour publication avant la validation intégrée décrite ci-dessous.

## Audit et reprise

Le clone initial était propre. Aucune modification non commitée de Claude n'était disponible dans cet espace, aucune PR de reprise ouverte. La cause de son blocage n'a donc pas pu être établie. Le module commercial et les quatre migrations de suivi existants ont été réutilisés, ainsi que leur dernière redéfinition dans `prepaid_commitment`.

Lecture de la base `fiuffxchvjcghcvfaout` : aucune règle de commission, aucun paiement dans `sales_payments`, aucune commission, aucun versement. Un commerce, Barber Factory (`610f3c83-f1f1-4ffb-8622-e75a147e2b2a`, créé le 5 octobre 2026), sans attribution ni ligne de création admin. Cela ne prouve pas son apporteur : aucune attribution historique automatique n'est effectuée.

Le code de la fonction billing déployée (version 8) correspondait au commit de départ, hors saut de ligne final. Les migrations listées en base incluaient `prepaid_commitment`.

Le compte Stripe accessible, `digitalprojectagency.fr`, était TEST uniquement. Les cinq prix DPA actifs sont `tax_behavior=inclusive` ; les dix factures consultées avaient `automatic_tax.enabled=false` et aucune taxe collectée dans `total_taxes`. La base reste le montant encaissé (`amount_paid`), remises déjà comprises, sans déduction de frais Stripe ni coûts. Aucune conversion arbitraire vers HT n'est ajoutée. Ces lectures ne prouvent rien sur une configuration Stripe LIVE inaccessible.

## Modifications

- `supabase/migrations/20261012134759_sales_durable_commissions.sql` : attribution à l'insertion du commerce, transaction commune avec la création admin, demandes idempotentes, alias de direction vers Kilyan, snapshots du bénéficiaire par encaissement, règles spécifiques 70 % initial/récurrent pour Maël et Zak sans limite de durée, suppression de la restriction « une commission initiale par commerce », refunds reçus avant la facture, principal des contestations, séparation TEST/LIVE, corrections motivées sur les seuls futurs encaissements, protection des références de virements, agrégats complets, prévisualisation/réconciliation historique.
- `supabase/functions/wallet/index.ts` : acteur issu de `requireAdmin`, RPC transactionnel, clé stable de création, récupération d'un utilisateur Auth créé par la même demande via `app_metadata` protégé, pas de suppression d'utilisateur après un timeout ambigu, programme brouillon quand la carte est différée, mode du dashboard.
- `supabase/functions/billing/index.ts` : relecture des factures et charges Stripe, mode explicite, synchronization des remboursements, principal des mouvements de contestation hors frais, rattrapage de la facture de création de carte, événements de fonds contestés.
- `src/card-designer.js` : « Le commerçant terminera lui-même sa carte », activé par défaut. Les champs objectif/récompense ne bloquent plus cette création. Le programme reste un brouillon ; paiement, accès et validation suivent les règles existantes.
- `src/sales.js` : Global / Mes ventes / Zak / Maël, LIVE par défaut et TEST séparé, CA des cinq catégories et total, solde cumulé distinct, anomalies historiques, suppression des anciens messages excluant prepaid, virements avec référence obligatoire, texte de correction d'attribution conforme.
- `tests/`, scripts npm et `.github/workflows/sales-verification.yml` : tests reproductibles en isolation.

Aucun changement aux prix, offres, CGV, permissions admin de Maël/Zak ou au design général.

## Calculs et historique

Le montant d'une commission est arrondi au centime sur 70 % du montant encaissé restant. Le bénéficiaire, la règle et son snapshot sont conservés. Les paiements prepaid sont traités une seule fois à leur date d'encaissement, sans créer douze commissions mensuelles.

Les remboursements sont cumulatifs et idempotents. Les contestations utilisent le principal effectivement retiré/réintégré dans les balance transactions Stripe, sans les frais. Le total retranché de la base est plafonné au montant du paiement ; un doublon d'événement n'est pas une seconde déduction. Une commission déjà versée reste intacte ; l'écart devient une régularisation ouverte pouvant être compensée au versement suivant.

Une correction de commercial nécessite la direction et un motif. Les encaissements déjà payés gardent leur bénéficiaire. Les anciennes lignes dont le mode TEST/LIVE est inconnu restent en anomalie : ne jamais déduire leur mode de l'environnement actuel.

Pour réconcilier des paiements historiques, appeler côté service autorisé `sales_reconcile_preview(actor, ids)`, examiner le JSON (bénéficiaire, mode, base, montant potentiel à 70 %, commissions existantes), puis `sales_reconcile_history(actor, ids, preview, reason)` avec exactement cette prévisualisation. Un changement entretemps ou un mode inconnu bloque l'opération. Les attributions ambiguës doivent être résolues avec une preuve avant cette opération. Aucun rattrapage n'était nécessaire dans le registre observé (zéro paiement).

Les rapports de période rattachent le remboursement au paiement initial, tandis qu'une régularisation après versement est datée de son calcul. Les soldes cumulés comprennent tous les impayés. Les 30 % restants ne sont pas un bénéfice net.

## Vérifications et limites

- `npm run test:sales` : 21 groupes réussis sur PostgreSQL embarqué PGlite, en appliquant toutes les migrations. Auth, Storage et les extensions externes sont remplacés par un socle local explicite ; aucun appel réseau, compte réel ou e-mail.
- `npm run test:billing-ledger` : exécute la fonction `recordInvoice` réelle avec transport Stripe simulé et vraie base isolée. Cinq catégories, 70 %, réexécution, événements tardifs, remboursement et rejet du mauvais mode. Ce n'est pas un paiement Stripe externe.
- `npm run test:sales-ui` : interactions React/JSDOM des variantes 375 et 1440 px, filtres, modes, formulaire différé, clé stable de nouvelle tentative. Aucune affirmation de rendu pixel.
- `npm run build` : réussi ; `git diff --check` : propre.
- TypeScript des deux fonctions Edge : vérifié localement avec TypeScript 5.9.3, Stripe 17.7.0 et Supabase JS 2.117.2, imports npm adaptés dans une copie temporaire et déclaration Deno minimale. Le `deno check` natif n'a pas abouti à cause de l'accès réseau au registre.
- `npm run test:sales-browser` : scénario Playwright fourni. Le lancement Chromium local était bloqué par `socket() failed: Operation not permitted`. Les screenshots et le test visuel ne sont pas validés localement. Le workflow GitHub le relance dans un runner dédié.
- Parcours Auth → application isolée → vrai Stripe Checkout TEST → webhook signé → dashboard : reste à exécuter. Aucun paiement Stripe, TEST ou LIVE, n'a été créé pendant cette reprise. Les factures Stripe existantes ont seulement été lues.

## Opérations restantes avant publication

1. Créer/utiliser un projet Supabase de recette isolé et une preview branchée dessus. Configurer ses trois administrateurs comme dans le workflow validé, ses secrets Stripe TEST et son webhook propre. Ne pas brancher une preview modifiée sur la base de production actuelle.
2. Appliquer les migrations en recette, puis déployer `wallet` et `billing` de cette branche. Conserver leur vérification de session interne et la configuration `verify_jwt` actuelle. Déployer le frontend contre cette base.
3. Ajouter au webhook de recette les événements déjà utilisés plus `charge.dispute.updated`, `charge.dispute.funds_withdrawn` et `charge.dispute.funds_reinstated`. Ne pas retirer ses événements existants. Vérifier des signatures incorrectes et un événement d'autre mode : refus.
4. Exécuter le parcours complet Stripe TEST et le scénario Playwright sur mobile/desktop ; inclure un remboursement et un renvoi d'événement. Vérifier qu'aucun e-mail ne vise un destinataire réel et que LIVE reste inchangé.
5. Une fois la publication autorisée, relire le diff de migrations réellement en production, sauvegarder, appliquer uniquement la nouvelle migration puis publier les deux fonctions Edge et le frontend de façon coordonnée. Entre migration et publication de billing, les anciens webhooks sans mode explicite échouent volontairement : les rejouer après publication. L'ancienne création admin échoue également plutôt que créer sans attribution. Prévoir cette courte interruption, ou déployer en fenêtre contrôlée.
6. Vérifier les quatre règles (deux commerciaux × initial/récurrent), le compte direction, le mode Stripe réel et les abonnements du webhook. Ne pas changer le mode des paiements historiques sans preuve Stripe.
7. Vérifier en production avec des lectures et des parcours sans achat réel : étiquettes, totaux, mode LIVE, historique. Ne pas lancer de faux clients en production. Ne pas attribuer Barber Factory sans clarification.

Ne pas simplement revenir à l'ancien billing après migration : sa signature de remboursement n'a pas le paramètre de mode requis. Privilégier une correction en avant ou un plan de retour coordonné.

## Où cliquer après publication

- Créer un commerce : administration → Générateur de cartes → Ajouter un client. Laisser « Le commerçant terminera lui-même sa carte » coché, ou le décocher pour préparer le programme. L'envoi d'accès reste un bouton explicite.
- Suivi direction : `/admin.html#commerciaux` avec `contact@digitalprojectagency.fr` → Global / Mes ventes / Zak / Maël. Choisir période et LIVE/TEST.
- Détail : Commerçants → ouvrir la fiche, avec son suivi commercial.
- Versement : Relevé et versements → mois et commercial → Valider les commissions → Marquer comme payé → date, référence et confirmation. Le montant est celui du relevé sélectionné, reports et régularisations compris. Aucun transfert bancaire n'est déclenché.
