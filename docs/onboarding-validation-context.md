# Validation : programme existant invisible — 26 octobre 2026

Le message « Créez d'abord votre programme de fidélité » pouvait apparaître au
clic sur « Valider ma carte » pour le second commerce d'un propriétaire.
Le programme existait. La fonction Wallet sélectionnait correctement l'appartenance
avec `x-merchant-id`, puis créait un client PostgREST authentifié sans l'option
de vue `x-dpa-web-profiles`. La politique SELECT de `merchant_members` conservait
alors seulement le commerce historique, rendant invisible le nouveau programme
aux sous-requêtes RLS de `programs`.

`walletUserHeaders()` transmet désormais ensemble la sélection explicite et
la vue web pour les requêtes PostgREST internes. Sans sélection, le comportement
historique reste identique. L'identité authentifiée, les règles RLS et les
vérifications d'appartenance/propriétaire restent actives ; aucune lecture avec
la clé privilégiée ne remplace la lecture du programme par le client utilisateur.
La correction bénéficie aussi aux lectures des liens Apple/Google du commerce
explicitement sélectionné. Une erreur de requête en base n'est plus transformée
en absence de programme.

Vérifications :

- `test:wallet-context` exécute les fonctions réelles d'authentification et
  de finalisation extraites du code publié ; sélection des en-têtes, validation
  sans tampons, refus employé/autre compte, programme réellement absent et
  erreur de requête distincte.
- Le test de migration des profils utilise PostgreSQL/PGlite et les véritables
  migrations RLS : programme du second commerce invisible avant transmission
  complète, visible après ; autre compte toujours refusé et ancienne vue iPhone
  conservée sans sélection explicite.
- En production, même vérification sous le rôle authentifié du propriétaire
  concerné dans une transaction annulée : exactement zéro programme avant et un
  après. Aucun programme ni design modifié par ce contrôle.
- Tests des profils, options de tampons et import/recadrage/finalisation navigateur
  réussis, ainsi que la vérification des types de la fonction Wallet.

Déploiement ciblé : `wallet` version 72. Seuls son point d'entrée et le module
de contexte commerçant changent ; les dépendances d'images de la version 71
sont conservées. Aucune migration, publication Apple ni modification de carte
existante n'est requise.

La lecture réelle sous RLS est vérifiée ; le clic complet depuis la session du
propriétaire reste à confirmer par son nouvel essai. Les appels Google externes
des tests de finalisation sont simulés et ne certifient pas un ajout sur téléphone.
