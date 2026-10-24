# Synchronisation des tampons Google Drive → DPA Cards

**Dossier Google Drive privé :** https://drive.google.com/drive/folders/1vSy2iXweuL8325u4a8-5mLlCdBj0_c3-

## État
Le 24 octobre 2026, le catalogue dynamique, la passerelle Supabase `stamp-sync`, les rendus Apple Wallet et Google Wallet, le stockage et le script Google Apps Script ont été préparés et déployés. **La synchronisation automatique n’est pas encore active** : le propriétaire doit autoriser le script dans son compte Google et enregistrer la clé de connexion. Le catalogue ne contient encore aucun tampon importé. Il y a actuellement 43 PNG dans le dossier.

## Mise en service : intervention du propriétaire du Drive
1. Aller sur **https://script.google.com** connecté avec le compte propriétaire du dossier.
2. Créer un projet Apps Script, nommé `DPA Cards — Tampons Drive`.
3. Ouvrir `integrations/google-drive-stamps/Code.gs` dans ce dépôt et copier son contenu dans le fichier `Code.gs` du projet Apps Script.
4. Ouvrir **Supabase → SQL Editor** dans le projet DPA Cards et exécuter uniquement la lecture suivante :
   ```sql
   select token from app_private.drive_stamp_sync_connection where id = true;
   ```
   **Ne jamais transmettre cette valeur dans une conversation, un ticket ou GitHub** ; elle permet d’importer des images dans le catalogue DPA Cards.
5. Dans Apps Script : **Paramètres du projet → Propriétés de script → Ajouter une propriété**. Nom `DPA_STAMP_TOKEN` ; valeur = la clé de 64 caractères récupérée via SQL.
6. Dans l’éditeur Apps Script, sélectionner la fonction `installerSynchronisation`, cliquer sur **Exécuter**, et accepter les autorisations Google Drive et appels externes Google Apps Script. Cela installe un déclencheur **toutes les cinq minutes** et démarre la première synchronisation.
7. Vérifier **Exécutions** dans Apps Script. Le premier passage importe au maximum 8 images ; les suivants importent le reste. Les images doivent apparaître dans **Administration → Générateur de cartes → Choisir un tampon PNG** après actualisation, ou après la prochaine vérification automatique de la bibliothèque (cinq minutes).
8. Vérifier avec Supabase SQL :
   ```sql
   select id,label,imported_at from public.drive_stamp_catalog order by imported_at desc limit 50;
   ```
   Si aucun résultat n'apparaît après plusieurs exécutions, relever le message d'erreur Apps Script sans copier la clé secrète.

## Ce qui est automatique après activation
- Le script vérifie les PNG du dossier toutes les cinq minutes.
- Il transfère au plus huit nouvelles images ou images modifiées par exécution. Une image déjà transférée avec la même date est ignorée ; les échecs sont retentés.
- Le serveur vérifie la clé secrète, le format PNG (au plus 4 Mo et 2048 pixels sur chaque côté), redimensionne au maximum à 512 × 512 pixels et stocke le tampon dans `program-assets/stamp-library/gd-<driveFileId>.png`.
- Les données publiques de catalogue sont accessibles par `GET /functions/v1/stamp-sync/catalog`, mais la base de données et la route `POST /import` ne sont pas librement modifiables.
- Les moteurs Wallet savent rendre les nouveaux IDs `gd-...`, mais les cartes existantes gardent les images déjà enregistrées dans leur design.
- Les suppressions ou déplacements dans Drive **ne suppriment pas automatiquement** les tampons déjà synchronisés, pour ne pas casser les cartes existantes.
- Le dossier Google Drive n'est **pas rendu public**. Seules les images PNG explicitement transférées vers le catalogue deviennent accessibles publiquement à l’aide d’une URL d'image ; elles sont destinées à figurer sur des cartes publiques.
- L'accès aux données d’autres fichiers Drive n’est ni demandé ni transmis à DPA Cards.

## Architecture
- Migration Supabase `drive_stamp_sync_catalog` : table `public.drive_stamp_catalog` et table secrète `app_private.drive_stamp_sync_connection` (clé générée côté SQL), fonction `public.verify_drive_stamp_sync` accessible uniquement au service serveur.
- Edge Function `supabase/functions/stamp-sync/index.ts` : `GET catalog` anonyme en lecture et `POST import` réservé au jeton.
- Les moteurs existants `wallet` et `apple-pass` utilisent `supabase/functions/_shared/stamp-library.js`, qui garde les anciennes références statiques et ajoute le préfixe dynamique `gd-`.
- Frontend `src/stamp-library.js` : galerie intégrant les nouveaux IDs et rafraîchissement périodique.
- Script indépendant : `integrations/google-drive-stamps/Code.gs`. Les accès au Drive sont octroyés uniquement par son propriétaire.

## Sécurité, vérifications et limites
- Vérifié : token invalide refusé par la fonction SQL, aucun privilège `EXECUTE` public pour la vérification, aucun `SELECT` table publique par les visiteurs, Supabase functions actives, Vercel en production READY.
- Non vérifié tant que le script n’est pas autorisé : transfert réel d’un PNG, encodage du fichier, liste enrichie, rendu complet sur iPhone Apple Wallet/Google Wallet.
- Les scripts Google Apps Script ont des quotas et délais d'exécution imposés par Google. En cas de très gros arrivage d’images, la première synchronisation nécessitera plusieurs passages.
- Les secrets ne doivent jamais être placés dans les sources versionnées. La présence d'une connexion Google Drive dans ChatGPT ne fournit pas un jeton Google au site DPA Cards.
- Préférence design maintenue : **aucune flèche décorative dans les boutons**.
