# Tampons obligatoires et opacité — 27 octobre 2026

Cette décision remplace le choix facultatif de la livraison précédente : dans
la création d'une nouvelle carte self-service, le choix « Sans tampons » est
retiré. Un tampon doit être choisi pour valider. Le serveur refuse également
`show_stamps:false`, notamment depuis un ancien onglet encore ouvert.

Le curseur « Opacité des tampons non acquis » règle de 0 à 100 % la visibilité
des tampons en attente, cadeau final compris. Les tampons acquis restent en
couleur et opaques. Les aperçus restent sans tampons avant le choix explicite
d'une illustration, conformément à la règle précédente. Le dixième emplacement
reste le cadeau. Le vrai logo est toujours importable.

`programs.self_service_inactive_opacity` est un entier nullable, contraint entre
0 et 100. La finalisation propriétaire enregistre cette valeur avec le tampon
et `self_service_show_stamps:true`. Aucun UPDATE direct du nouveau champ n'est
accordé au navigateur. Une ancienne requête sans opacité garde 32 % ; les
valeurs nulles existantes conservent le rendu antérieur. Aucun programme existant
n'est modifié par la migration. Les anciens programmes validés sans tampons et
les designs avancés conservent leur lecture historique ; il s'agit du retrait
d'un choix de création, pas d'une migration des cartes déjà distribuées.

La configuration est lue par la création, Ma carte, la page publique, le modèle
Apple et les bandeaux natifs Apple/Google. Le modèle avancé `card_design` garde
ses propres réglages. L'opacité est enregistrée lors de la validation, comme
le choix du tampon. Les droits multi-commerces corrigés précédemment restent
actifs.

Contrôles réussis : sélection obligatoire et refus serveur du mode sans tampons ;
validation entière avec opacité 67 % ; migration, bornes 0/100 et refus des
valeurs incorrectes ; modèles et pixels réellement générés pour les deux Wallets,
tampons acquis inchangés ; curseur navigateur, Apple/Google, 0/67/100 %, mobile
et accueil ; vrai client Supabase intercepté pour import/recadrage et contenu de
la requête finale ; tests de profils, contexte propriétaire, Apple existant,
compilation, contrôle statique et types des deux fonctions.

Production : migration appliquée, aucun ancien programme modifié ; Wallet
version 73 et Apple version 58 actives et comparées aux sources attendues.
Toutes les dépendances d'images de chaque fonction ont été conservées depuis
leurs versions réellement déployées. L'API publique renvoie le champ d'opacité,
et la finalisation anonyme reste refusée. Aucun ajout sur téléphone physique
n'est certifié ; les tailles et espacements natifs de Wallet restent imposés.

Migration : `20261026230713_self_service_stamp_opacity.sql` (horodatage UTC du
26 octobre ; livraison le 27 octobre, heure de Paris).
