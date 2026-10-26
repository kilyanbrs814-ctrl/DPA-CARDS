# Remettre une carte client dans Wallet

Dans **Clients → fiche du client**, le bloc **Remettre la carte sur le téléphone**
est disponible sur PC et mobile pour un commerce ayant accès à son espace.
Le commerçant choisit **iPhone · Apple Wallet** ou **Android · Google Wallet** :
le lien d’ajout et son QR code apparaissent, avec **Copier le lien** et
**Ouvrir sur cet appareil**. Aucun lien n’est envoyé automatiquement.

Ce sont les points d’entrée authentifiés existants `wallet/apple-link` et
`wallet/save-link`. Ils vérifient la session, l’appartenance au commerce,
l’espace sélectionné, la carte et l’accès du commerce. Aucun nouveau point
d’entrée public, aucune migration et aucune modification des droits.

La récupération transmet l’identifiant de la carte déjà enregistrée : elle ne
passe pas par l’inscription et ne remet pas les tampons à zéro. Le QR présenté
dans ce bloc encode le lien d’installation ; le QR personnel contenu dans la
carte reste celui servant en caisse.

Les liens ne sont générés qu’après choix du téléphone. Les changements d’onglet
réutilisent les demandes en cours et les résultats pour ne pas émettre plusieurs
liens Apple concurrents. Un changement de client ou de commerce efface les
résultats affichés ; une réponse tardive n’est pas présentée sur la fiche suivante.
Une erreur peut être retentée. Le lien Apple est valable sept jours et un nouveau
lien remplace le précédent, conformément au fonctionnement serveur existant.

Validation : tests des QR avec décodage réel, réutilisation de la même carte,
refus des erreurs d’autorisation et des URL non HTTPS ; scénario navigateur
PC/mobile (copie, changement de plateforme en cours de chargement, changement
de client, erreur puis reprise, absence d’accès). Les tests navigateur utilisent
des liens fictifs et bloquent les requêtes Supabase. Les deux routes de production
ont été vérifiées sans session : réponse 401. Aucun tampon ou client réel n’a
été modifié pour ces validations. L’installation après suppression dans les
applications Apple/Google sur appareil physique reste à confirmer.
