# Notifications Wallet — état du déploiement

L'application iOS DPA Cards reste inchangée. Les nouveautés concernent
**exclusivement le site web et les passes Apple/Google Wallet des clients**.

## Google Wallet

Le site existant utilise `wallet/notify`, l'API Google
`loyaltyObject.addMessage` et `TEXT_AND_NOTIFY`. La réponse `sent`
signifie **accepté par Google**, pas « vu par le client ».
Limite Google : au maximum 3 messages avec notification par carte sur 24 h.
Les messages sans notification restent possibles.

## Apple Wallet — mises à jour automatiques

Le nouveau `.pkpass` réel contient :
- `webServiceURL` = `https://fiuffxchvjcghcvfaout.supabase.co/functions/v1/apple-pass`
- `authenticationToken` stable HMAC (secret de signature existant, jamais public)
- `serialNumber` inchangé : UUID de la carte d'origine
- `changeMessage` sur les champs de fidélité, sans toucher au design / QR

Le service `apple-pass` implémente les endpoints officiels PassKit
(enregistrement, désenregistrement, liste de versions et téléchargement signé).
Les appareils enregistrés et leurs jetons APNs sont stockés dans des tables
service_role uniquement. Un déclencheur SQL incrémente la version après chaque
passage, remise ou correction. `pg_net`/cron réessaient les mises à jour.

**Anciennes cartes Apple** : les passes signés avant cette fonctionnalité n'ont
pas `webServiceURL`. Le client doit les retirer puis les rajouter **une fois**
pour activer les futures mises à jour et enregistrer son appareil.

**APNs** : la documentation Apple prescrit de signer l'envoi des notifications
de mise à jour avec le certificat du Pass Type ID. Le worker essaie d'abord ce
certificat via le client TLS de Deno, si le runtime le permet. Un transport
alternatif accepte `APPLE_APNS_KEY_ID` et `APPLE_APNS_PRIVATE_KEY_PEM` (clé
APNs .p8), mais **ce transport doit être vérifié sur une vraie carte Apple**
avant toute promesse de livraison. Les secrets restent dans Supabase :
aucune clé dans ce dépôt, dans le navigateur ou dans le chat.

Le signal APNs contient `{}` seulement : l'iPhone récupère ensuite le pass
entièrement régénéré et signé. L'affichage d'une bannière reste décidé par iOS.

## Campagnes web Apple / Google / Les deux

Le tableau de bord permet de cibler un segment ou des clients précis.
La sélection Apple est fondée exclusivement sur les enregistrements PassKit,
pas sur de simples téléchargements .pkpass. Pour préserver Google, la campagne
« Les deux » crée deux envois indépendants et deux lignes d'historique.
Un échec Apple ne retire pas les messages Google effectivement acceptés.

Les appels Apple refusent l'envoi avant configuration du transport APNs. Les
résultats « Apple en file » sont distincts des messages « Google acceptés ».

La **programmation future** des campagnes reste non implémentée et n'est pas
présentée comme disponible en production.

## Vérification indispensable avant déclaration de fonctionnement total

1. Depuis un iPhone réel, ajouter une nouvelle carte client Apple Wallet signée.
2. Vérifier qu'une ligne apparaît dans `apple_wallet_registrations`.
3. Ajouter un passage à cette carte côté commerçant.
4. Confirmer que le push APNs est accepté (pas seulement mis en file),
   puis que Wallet recharge la carte et les tampons sans réinstallation.
5. Envoyer un message de test depuis la page Notifications et vérifier
   séparément Apple et Google.
6. Vérifier que le commerçant A ne voit jamais les cartes ni envois du B.

Une compilation GitHub verte et un statut Edge Function ACTIVE ne remplacent
**pas** ce test réel sur appareil.
