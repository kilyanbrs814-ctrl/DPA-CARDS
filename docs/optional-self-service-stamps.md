# Choix avec ou sans tampons — 26 octobre 2026

La création d'une carte self-service propose « Avec tampons » et « Sans tampons ».
Avec tampons, aucune illustration n'apparaît avant un choix explicite ; après le
choix, le dixième emplacement reste le cadeau. Sans tampons, le catalogue et la
zone illustrée disparaissent ; le compteur, le logo, le commerce, le membre, la
récompense et le QR restent présents. Revenir à « Avec tampons » conserve la
sélection en cours. Le téléchargement du vrai logo reste disponible.

La nouvelle colonne nullable `programs.self_service_show_stamps` est enregistrée
par la finalisation propriétaire existante. `false` implique un identifiant de
tampon nul ; `true` conserve la validation du catalogue. Les anciennes requêtes
sans ce paramètre gardent le comportement précédent. Aucun UPDATE de cette
colonne n'est accordé au navigateur. La migration ne modifie aucune valeur des
anciens programmes : `NULL` préserve leur présentation. Les designs administrateur
`card_design` restent prioritaires dans tous les rendus.

Le modèle effectif alimente les aperçus de création, accueil et carte prête.
Le pass Apple explicitement sans tampons est de type `generic` : compteur en
en-tête, membre et récompense, QR, aucun bandeau ni numéro/titre du programme
sur la face avant. Les références internes restent au dos. Les anciens passes
génériques conservent leur disposition historique.

Google utilise un modèle natif avec membre/récompense et compteur réel, sans
hero de tampons ni numéro affiché. Le compteur textuel est actualisé lors de la
synchronisation, avec le solde natif. Le nom interne du programme est remplacé
dans les métadonnées Google par le commerce pour ce nouveau mode uniquement.
La position de l'en-tête/logo, les espacements et la hauteur restent contrôlés
par Wallet : l'aperçu centré de création n'est pas une garantie de placement
identique sur téléphone. Référence :
https://developers.google.com/wallet/retail/loyalty-cards/resources/template

Vérifications réussies :

- choix et validation, migration avec valeurs existantes conservées et refus
  d'écriture directe du nouveau champ ;
- modèle Apple réel sans bandeau, avec progression et identité réelles ;
- modèle Google et mises à jour du compteur ;
- aperçus Apple/Google, bascule aller-retour, mobile et accueil ;
- client Supabase réel avec réponses interceptées : import/recadrage de logo,
  finalisation envoyant bien `show_stamps:false, stamp_id:null`, retour vers l'offre ;
- tests de profils, récupération Wallet, rendu Apple existant et catalogue de
  tampons après préparation des images ; compilation et contrôle statique ;
- vérification des types des deux fonctions.

Déploiement : migration appliquée, aucun programme existant changé et champ non
modifiable directement par le navigateur. `apple-pass` version 57 et `wallet`
version 71 : leurs dépendances d'images respectives ont été reprises à l'identique
depuis les versions en production, car certaines diffèrent du dépôt. Les versions
publiées sont comparées aux sources attendues. L'API publique continue de répondre
avec le champ de visibilité ; la finalisation anonyme reste refusée.

Les tests navigateur interceptent le serveur. Aucun ajout sur appareil physique
ni création d'une classe Google réelle pour un nouveau commerce sans tampons
n'est certifié par cette livraison ; le rendu exact doit être confirmé sur les
téléphones. Les règles de fidélité, droits et paiements restent inchangés.
