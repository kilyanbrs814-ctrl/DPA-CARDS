# Import du logo lors de la création d'un commerce

## Incident et correction — 26 octobre 2026

Les imports PNG recadrés étaient refusés par la politique INSERT du bucket
`program-assets` pour un propriétaire possédant plusieurs commerces. Les journaux
Storage confirmaient `new row violates row-level security policy`. Le commerce
concerné appartenait bien à l'utilisateur et son programme était en brouillon.

La lecture de `merchant_members` conserve volontairement une vue limitée au
commerce historique pour les clients sans en-tête `x-dpa-web-profiles`. Le stockage
n'utilise pas cet en-tête, contrairement aux requêtes REST de l'interface web.
Une sous-requête de la politique Storage ne voyait donc pas le second commerce.

La migration `20261026220410_fix_program_asset_profile_scope.sql` remplace ces
sous-requêtes par une fonction privée à droits du propriétaire, bornée à
`auth.uid()`. Elle vérifie l'appartenance effective, le rôle propriétaire pour les
écritures, la correspondance des dossiers commerce/programme et le statut brouillon.
Elle refuse toujours la suppression d'une image actuellement référencée. Aucune
politique UPDATE n'est ajoutée ; les programmes validés restent verrouillés.
La visibilité historique des adhésions et les règles des autres buckets restent
inchangées. Aucun logo existant ni programme personnalisé n'est modifié.

L'interface distingue désormais un refus d'accès au stockage d'une erreur inconnue.

## Vérifications

- `npm run test:onboarding-logo` : reproduction SQL de l'échec avant migration,
  réussite après migration sans en-tête web, isolation entre propriétaires,
  refus pour employé/anonyme, dossiers incohérents, autres buckets et cartes
  validées ; protection du logo courant et absence d'autorisation UPDATE.
- Le test navigateur exerce le véritable client Supabase, avec serveur intercepté
  et identifiants factices : sélection, recadrage PNG 660 × 660, refus explicite,
  nouvel essai réussi, mise à jour du bon programme, aperçu et remplacement mobile.
  Ce test ne prétend pas réaliser un téléversement réseau en production.
- `npm run test:profiles`, `npm run build`, `npm run test:static` réussis.
- Migration appliquée en production ; insertion Storage testée avec les droits
  authentifiés du propriétaire concerné, sans en-tête web, dans une transaction
  annulée ensuite. Aucun fichier ni enregistrement de test conservé.

Les tests navigateur utilisent des réponses contrôlées ; un nouvel import réel
par le propriétaire reste la confirmation finale de son parcours connecté.
