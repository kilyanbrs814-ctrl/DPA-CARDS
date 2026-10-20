# DPA Cards — réponses App Privacy préparées

Statut : réponses préparées à partir du code et de la politique actuels ; questionnaire de types de données NON publié. La page web App Store Connect reste nécessaire.

App : 6823642562 — fr.digitalprojectagency.cards — iOS 1.0.

## Réponses

Collecte de données : oui. Suivi publicitaire (tracking au sens Apple) : non.

Pour chaque type déclaré ci-dessous : finalité « Fonctionnalités de l’app » ; données liées à l’identité du compte ; pas de suivi publicitaire.

| Type Apple | Données présentes dans l’app |
| --- | --- |
| Nom | Prénom/nom du commerçant et des clients inscrits |
| Adresse e-mail | Connexion, compte commerçant, e-mail facultatif des clients |
| Numéro de téléphone | Coordonnées du commerçant |
| Adresse physique | Adresse facultative du commerce |
| Identifiant utilisateur | Compte, commerce, client, numéro de carte et identifiants de fidélité |
| Photos ou vidéos | Logos et visuels importés pour les cartes |
| Autres contenus utilisateur | Paramètres du programme, textes de récompense, motifs de correction, messages Wallet |
| Historique des achats | Passages et récompenses enregistrés dans le programme de fidélité ; aucune donnée bancaire saisie dans iOS |
| Interaction avec le produit | Historique des opérations de fidélité effectuées par le commerçant |

La caméra sert au décodage local des QR codes. Le flux vidéo du scanner n’est pas enregistré ou envoyé : ne pas le déclarer comme collecte de vidéo. Distinguer ce flux des logos/visuels effectivement importés et stockés.

Pas d’accès au carnet d’adresses, à la géolocalisation, au microphone, ni d’identifiant publicitaire. Les champs prénom/e-mail des clients ne sont pas une lecture du carnet d’adresses du téléphone. Les transactions et la création payante de commerces sont exclues de l’app compagnon iOS.

## Sources de l’audit

- src/backend.js : authentification, toMerchant/toClient, exports, stockage des logos, événements, notifications.
- index.html : parcours compagnon iOS, formulaires, client, scanner et historique.
- confidentialite.html : catégories et finalités déjà annoncées, décodage caméra local, absence de traceur publicitaire.
- package.json et workflow iOS : conteneur Capacitor et dépendances.
- https://developer.apple.com/app-store/app-privacy-details/

## Âge et contenus

Absence de contenus violents/sexuels, jeux de hasard, concours, réseau social, messagerie utilisateur et publicité. Références peu fréquentes au tabac/vape : les tampons vape et e-liquide sont effectivement présents dans la bibliothèque. Aucun contournement de l’âge calculé par Apple.

Contenus tiers : oui (notamment ressources graphiques et visuels fournis par les commerces). La déclaration a été demandée par le propriétaire le 20 octobre 2026 ; elle ne constitue pas une vérification indépendante des licences de chaque visuel importé.
