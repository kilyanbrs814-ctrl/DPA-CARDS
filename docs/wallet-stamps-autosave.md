# Générateur de cartes — tampons séparés et sauvegarde automatique (23 octobre 2026)

## Comportement demandé
- Dans l'interface d'administration DPA Cards, les réglages **taille** et **espacement des tampons** sont indépendants pour **Apple Wallet** et **Google Wallet**.
- Dans le générateur, sélectionner l'onglet Apple ou Google affiche les deux curseurs propres à cette plateforme, de 50 % à 120 % (100 % = rendu historique).
- Toute modification de carte test (nom, images importées, logos, couleurs, tampons, typographie, choix de plateforme et paramètres de preview) est enregistrée automatiquement environ **850 ms après la dernière modification**. Un upload attend sa fin avant que l'enregistrement ne soit déclenché.
- Le bouton « Enregistrer la carte test » demeure disponible pour une sauvegarde ou une nouvelle tentative manuelle. Une erreur d'enregistrement est visible et n'entraîne pas de boucle de requêtes.
- Les cartes de commerce réelles conservent le comportement explicite : brouillon puis validation par un administrateur. L'auto-enregistrement ne les concerne pas.

## Schéma
Les dimensions sont sauvegardées dans `config.apple.stampSize`, `config.apple.stampSpacing`, `config.google.stampSize` et `config.google.stampSpacing`. La base utilise toujours le champ JSONB `config` de `card_designs` et de `test_card_designs` : aucune migration de colonnes n'est nécessaire.

Compatibilité : les anciens designs sans les nouveaux champs reprennent `stamps.size` / `stamps.spacing` et, si ces valeurs sont absentes, utilisent 100 %. Aucun ancien pass ne doit changer d'apparence par défaut.

## Rendu réel
- Google Wallet : `supabase/functions/wallet/google-strip.js` lit les propriétés Google ; `cleanDesign` de `wallet/index.ts` autorise ces propriétés en respectant les bornes.
- Apple Wallet réel : `supabase/functions/apple-pass/real-card.js` intègre les propriétés Apple au raster de tampon ; les cartes test Apple utilisent le même principe dans `real-strip.js`.
- Prévisualisation navigateur : `src/card-designer.js` applique les propriétés de la plateforme active dans `effective(design, platform)`.
- Les changements de design d'une carte test **ne déclenchent pas** une nouvelle écriture Google Wallet ou Apple Wallet chez les clients à chaque glissement. La sauvegarde du design est automatique ; la génération et l'ajout réel au Wallet restent les actions existantes.

## Sécurité et limites
- L'auto-enregistrement passe par les routes administrateur `admin-test-card-save` / `admin-test-card-upload`, qui vérifient les autorisations, nettoient la configuration et ne créent pas de passages clients.
- Si une modification intervient pendant la requête, elle est conservée et enregistrée dans un second passage ; une ancienne réponse ne remplace pas un design plus récent.
- La requête est retardée de 850 ms pour éviter les sauvegardes à chaque lettre / mouvement de curseur.
- Les options n'ont pas d'effet sur les cartes en mode points, comme les réglages de tampon historiques.
- Les rendus Wallet natifs restent soumis aux contraintes Apple/Google : tester les vrais passes sur téléphone avant de juger l'apparence finale.
- Aucun bouton fléché nouveau n'a été introduit, conformément aux règles DPA Cards.

## Livraison et vérifications
- Code GitHub, site Vercel production et fonctions Supabase `wallet` v65 et `apple-pass` v49 déployés.
- Tests de non-régression pour compatibilité et séparation ajoutés à `scripts/check-real-apple-strip.test.mjs`.
- **Test manuel avec compte administrateur réel et installation Wallet non effectué depuis cet échange.** Le déploiement ne constitue pas une validation d'affichage iOS/Android.
