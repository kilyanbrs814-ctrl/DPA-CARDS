# DPA Cards — Tampons emoji sur Apple Wallet et Google Wallet

## Architecture

Les cartes sont inspirées de la **disposition** des références OneCup, mais gardent
leur propre identité DPA Cards et l'identité du commerce. Aucun logo OneCup ni
élément propriétaire n'est réutilisé.

Dans le générateur admin, choisir **Tampons → Rechercher un emoji** et rechercher
en français ou en anglais. Le navigateur affiche les glyphes natifs de l'appareil,
avec le même emoji désaturé et à 22 % d'opacité pour les tampons restants. Le
sélecteur complet français utilise le composant libre [emoji-picker-element](https://github.com/nolanlawson/emoji-picker-element)
(Apache-2.0), chargé à la demande depuis jsDelivr, et inclut une recherche rapide
hors ligne ainsi que la saisie directe si le réseau ou IndexedDB est indisponible.

Un seul champ optionnel, `stamps.emoji`, est sauvegardé dans la configuration
JSONB déjà existante. Les anciens designs sans emoji ne changent pas et aucune
migration de base de données n'est nécessaire.

## Rendu réellement ajouté aux Wallet

- **Apple Wallet** : les images `strip.png` et `strip@2x.png` de cartes test
  et clients affichent des tampons emoji couleur / gris produits côté serveur.
  Le QR code reste natif, `DPA_TEST:` sur une démo et `DPA1:` sur une carte
  client réelle. Aucun effet sur les données commerciales ou commissions.
- **Google Wallet** : chaque LoyaltyObject muni d'un design emoji peut recevoir
  une `heroImage` à l'URL HMAC-signée `/wallet/stamp-board/…`. Le worker
  actualise l'URL en même temps que le solde. Les métadonnées client, le QR
  et la récompense restent des champs natifs Google. La bannière est sans nom,
  numéro de client ni QR personnel.
- **Pas de promesse pixel-perfect** : les champs natifs et le QR sont placés
  par Apple ou Google, pas par le générateur HTML. Les images sont une zone
  centrale de progression.

## Propriété intellectuelle des emoji

Les images des tampons sont recherchées d'abord dans le projet libre
[Google Noto Emoji](https://github.com/googlefonts/noto-emoji). Lorsqu'un
pictogramme ne figure pas dans son catalogue PNG (notamment 💧), le serveur
essaie [Twemoji, par Twitter et les contributeurs](https://github.com/jdecked/twemoji)
sous [licence CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
La source de Twemoji doit être créditée lorsqu'elle est utilisée. Si les deux
catalogues sont inaccessibles, une petite illustration locale de secours est
créée : goutte 💧 dessinée localement, ou étoile générique pour d'autres emojis.
Les ressources
PNG ordinaires sont sous licence Apache-2.0 ; consultez
[la licence et les exceptions](https://github.com/googlefonts/noto-emoji#license).
Copyright Google LLC / contributeurs Noto Emoji.

**Il ne s'agit pas des images propriétaires Apple ou Samsung.** Leur récupération
et redistribution ne sont pas autorisées ici. Les aperçus texte utilisent les
emojis natifs du téléphone, tandis que les **bandeaux PNG générés** utilisent Noto
sur les deux plateformes pour un rendu durable et licite.

Les assets Noto proviennent uniquement de l'URL codée en dur
`https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/emoji_u….png`.
Le nom du fichier est limité à des codepoints Unicode emoji validés ; les
images PNG sont décodées dans le serveur sans bibliothèque native ni WASM.
Si le téléchargement échoue, les champs de fidélité et QR continuent à être
générés, et les emplacements de tampons ne restent plus vides. Le rendu
d'un emoji dessiné en secours peut être légèrement différent de son aperçu
dans le navigateur.

## Sécurité et flux de données

Les URLs publiques Google d'image ont une signature HMAC (clé conservée côté
Supabase) fondée sur un UUID de carte. L'URL ne comporte aucun token QR ni
aucune information personnelle. Une lecture directe d'une URL sans signature
correcte renvoie 404. La réponse ne contient que l'arrière-plan et les tampons.

L'objectif, la progression et les couleurs viennent du design validé et des
événements réels de la carte. Le mode test prend exclusivement son
`test_card_designs.config.preview`; il ne modifie aucune donnée réelle.

## Vérifications de sortie

1. Rechercher `burger`, `coiffure`, `onglerie`, `pâtisserie` dans l'admin.
2. Vérifier que les grilles affichent `N` emojis, les `P` premiers en
   couleur et les `N-P` suivants en gris.
3. Enregistrer/recharger : l'emoji choisi doit rester sélectionné.
4. Installer sur iPhone une **nouvelle** carte test Apple avec emoji sélectionné.
5. Ajouter la même carte test à Google Wallet sur Android : vérifier le bandeau
   personnel ainsi que le QR/les champs Google inchangés.
6. Valider et installer un design réel, puis mettre à jour le solde : la bannière
   Google doit utiliser la nouvelle URL révisionnée après le sync worker.
7. Vérifier un design ancien sans emoji : aucune régression Google/Apple.
8. Contrôler les logs Edge, et supprimer toute exposition accidentelle de
   clés, QR secrets ou données privées.

Note : les mises à jour Apple sur les cartes déjà installées nécessitent encore
le service PassKit de registration/APNs qui n'est pas couvert ici.
