# Publication DPA Cards sur l'App Store — préparation iOS

> Branche préparatoire uniquement : **aucune version iOS signée ou soumise à Apple à ce stade**. La production Cloudflare Pages, Supabase et Apple/Google Wallet ne sont pas modifiées.

## Architecture retenue

- Application Vite existante embarquée avec **Capacitor 8** dans un conteneur iOS ; ne pas utiliser `server.url` pointant vers le site public en production.
- Même backend Supabase et mêmes données/comptes que `https://cards.digitalprojectagency.fr`.
- Identifiant iOS proposé : `fr.digitalprojectagency.cards` (à enregistrer dans Apple Developer / App Store Connect avant la première distribution, puis à conserver).
- L'app iOS est destinée aux **commerçants** pour administrer la fidélité et scanner des cartes ; les pages publiques `/join/:slug` restent sur le domaine HTTPS.

## Préparer le projet natif (macOS + Xcode)

Sur une copie du dépôt :

```sh
npm ci
npm install @capacitor/core@^8 @capacitor/ios@^8
npm install -D @capacitor/cli@^8
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

Les commandes `npm install` mettent à jour `package.json` et `package-lock.json`. **Versionner les deux ensemble** avec le dossier `ios/` généré avant publication. Capacitor 8 nécessite Xcode 26 ou plus récent. Le site continue d'être déployé séparément sur Cloudflare Pages.

### Réglages Xcode indispensables

1. Dans **App > Signing & Capabilities**, sélectionner l'Apple Developer Team, identifier le Bundle ID, activer la signature automatique.
2. Dans `ios/App/App/Info.plist`, ajouter `NSCameraUsageDescription` = `DPA Cards utilise la caméra pour scanner les QR codes des cartes de fidélité des clients.` (le scanner utilise `getUserMedia`).
3. Vérifier `CFBundleDisplayName` (DPA Cards), icône iOS **1024 × 1024** sans transparence et écrans de lancement.
4. Vérifier sur iPhone réel : connexion/retour e-mail, scan caméra, création client, affichage du compte, permissions et parcours Wallet.
5. Archiver (`Product > Archive`) puis distribuer via **App Store Connect > Upload** ; installer d'abord la build via **TestFlight**.

Un runner macOS distant peut compiler le projet si l'on n'a pas de Mac, mais il faut toujours configurer la signature Apple et fournir une build iOS signée pour TestFlight et l'App Store.

## Points bloquants AVANT soumission

- **Paiements (priorité critique)** : `index.html` intègre l'inscription commerçant, les offres, Stripe Checkout, le paiement de design et un portail de facturation. Il faut décider et implémenter un parcours iOS conforme aux règles App Review 3.1 : potentiellement une app compagnon de gestion des comptes existants, sans achat ni bouton invitant à acheter à l'extérieur (section 3.1.3(f)), ou une intégration d'achats intégrés si exigée. Éviter tout Stripe Checkout visible ou lancé dans la version native tant que le cas n'a pas été tranché. La conformité finale relève d'Apple.
- **Retour des liens d'authentification** : `src/backend.js` utilise `window.location.origin` pour les e-mails Supabase (confirmation de compte, mot de passe, changement d'e-mail). Dans un conteneur natif cela peut être `capacitor://localhost` : ne pas diffuser sans redirection explicite vers HTTPS, lien universel et vérification de la session native.
- **Fonctionnalité minimale (règle 4.2)** : l'application ne doit pas être une simple reproduction d'un site dans une WebView. Démontrer l'usage professionnel mobile, le lecteur caméra, la gestion concrète de la fidélité ; vérifier les parcours sur appareil.
- **Autorisations réseau/CORS** : vérifier l'origine native `capacitor://localhost` contre les Edge Functions et le chargement des polices/icônes externes.
- **Vie privée** : vérifier la page `https://cards.digitalprojectagency.fr/confidentialite`, déclarations App Privacy (données clients, commerçants, caméra, prestataires) et les mentions de confidentialité dans l'app. La suppression de compte existe déjà via `wallet/delete-account` : tester tout le parcours.
- **Apple Wallet** : le service de création de pass reste côté Supabase, sans changement. Tester l'ouverture du `.pkpass` et les liens Google Wallet depuis la WebView sur un iPhone réel ; si nécessaire, ouvrir ces liens dans un navigateur système ou via un plugin natif plutôt que de supposer le même comportement que Safari.

## Création dans App Store Connect

1. Créer l'identifiant App ID / Bundle ID dans **Certificates, Identifiers & Profiles**.
2. Dans **App Store Connect > Apps > + > New App** : nom `DPA Cards`, plateforme iOS, langue principale français, Bundle ID identique, SKU libre (ex. `DPA-CARDS-IOS`).
3. Préparer les captures iPhone de la **vraie app**, description, mots-clés, catégorie, URL assistance, URL confidentialité et formulaires réglementaires/âge/confidentialité.
4. Fournir un compte de démonstration fonctionnel (avec accès au tableau de bord) et des notes de vérification décrivant l'utilisation du scanner/Wallet.
5. Charger la build, vérifier dans TestFlight, corriger les problèmes puis **Add for Review > Submit for Review**.

Références :
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://developer.apple.com/app-store/review/guidelines/fr/
- https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app
- https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/
