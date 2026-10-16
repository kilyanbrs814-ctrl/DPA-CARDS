# Signature et premier envoi sur TestFlight (Windows + GitHub Actions)

État : **le workflow simulateur a réussi le 16 octobre 2026** :
https://github.com/kilyanbrs814-ctrl/DPA-CARDS/actions/runs/38915975696

Le workflow de distribution signée est `.github/workflows/ios-testflight.yml`, **manuel et non exécuté**. L'application est enregistrée dans App Store Connect avec `fr.digitalprojectagency.cards` (Apple Team ID `HDK7R3283T`).

## 1. Créer le certificat Apple Distribution

Depuis un terminal **local** Windows équipé d'OpenSSL (Git Bash ou autre), dans un dossier privé non synchronisé :

```sh
openssl req -new -newkey rsa:2048 -nodes -keyout dpa-ios-private.key -out dpa-ios.csr -subj "/CN=DPA Cards Apple Distribution/C=FR"
```

- Dans Apple Developer : **Certificates, Identifiers & Profiles > Certificates > + > Apple Distribution**.
- Fournir `dpa-ios.csr`, puis télécharger le certificat `.cer`.
- Conserver **la clé privée locale**, ne jamais la partager par e-mail, dans le chat ou dans GitHub.
- Convertir le certificat téléchargé en PEM puis en P12 protégé par un mot de passe unique :

```sh
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey dpa-ios-private.key -in distribution.pem -out dpa-distribution.p12
```

> Le certificat de distribution de l'application est distinct du certificat Apple Wallet Pass Type ID existant. **Ne pas modifier les clés Wallet existantes.**

## 2. Créer le profil App Store Connect

Dans Apple Developer > **Profiles > + > Distribution > App Store Connect** :
- App ID : `DPA Cards - fr.digitalprojectagency.cards`.
- Certificat : le certificat **Apple Distribution** créé à l'étape 1.
- Nom de profil conseillé : `DPA Cards App Store`.
- Télécharger le fichier `.mobileprovision`.

Documentation Apple : https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile

## 3. Créer une clé API App Store Connect

Dans https://appstoreconnect.apple.com/ > **Utilisateurs et accès > Intégrations > App Store Connect API**, demander l'accès si nécessaire puis créer une **clé d'équipe** avec rôle autorisant l'envoi de builds (ex. App Manager), télécharger `AuthKey_XXXXXXXXXX.p8` **une seule fois** et noter la **Key ID** et l'**Issuer ID**. Ne jamais envoyer la clé dans une conversation.

Documentation Apple : https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api

## 4. Configurer les secrets GitHub Actions

Accéder à https://github.com/kilyanbrs814-ctrl/DPA-CARDS/settings/secrets/actions puis **New repository secret**.

| Secret | Valeur |
|---|---|
| `IOS_DISTRIBUTION_P12_BASE64` | base64 du fichier `dpa-distribution.p12` |
| `IOS_DISTRIBUTION_P12_PASSWORD` | mot de passe défini à la création du P12 |
| `IOS_APPSTORE_PROFILE_BASE64` | base64 du `.mobileprovision` |
| `ASC_API_KEY_P8_BASE64` | base64 du fichier `.p8` |
| `ASC_API_KEY_ID` | Key ID de la clé d'API |
| `ASC_API_ISSUER_ID` | Issuer ID de l'API |

Dans PowerShell Windows, pour convertir **un fichier local** en base64 :

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Chemin\Vers\Fichier.p12"))
```

Remplacer le chemin pour le profil puis la clé `.p8`. Copier les valeurs **dans GitHub Secrets uniquement**, jamais dans le code source ni dans une conversation.

## 5. Envoyer une build (une fois les problèmes fonctionnels vérifiés)

1. Fusionner la PR iOS **uniquement après révision** des changements et déploiement CORS du Wallet en production. Jusqu'à la fusion, le workflow de distribution n'apparaîtra pas forcément dans le sélecteur de la branche par défaut.
2. Dans GitHub > Actions > **Upload signed iOS build to TestFlight** > **Run workflow**. Cette action est manuelle et explicitement demandée par l'utilisateur ; il n'y a **pas d'envoi automatique sur chaque commit**.
3. Vérifier les logs. L'IPA archivée et signée est automatiquement téléversée sur App Store Connect si tout fonctionne.
4. Attendre le traitement Apple, puis ajouter un testeur interne dans TestFlight.
5. Sur l'iPhone réel, vérifier caméra, sessions, comptes, permissions, push natifs éventuellement, liens externes et opérations cartes. **La compilation simulateur ne valide pas ces comportements.**

## Points d'attention avant l'App Store

- iOS gratuit de gestion pour des comptes préexistants, sans achat ni lien d'achat (Apple Review Guidelines 3.1.3(f)). L'éligibilité finale reste à l'appréciation d'Apple.
- La version du site web conserve Stripe ; aucun abonnement n'est vendu dans l'app native.
- Le compte iOS utilise Supabase comme avant. Les liens d'e-mail s'ouvrent sur l'origine HTTPS du site web.
- `capacitor://localhost` doit être autorisé sur les fonctions Edge Wallet **déployées** ; le code est préparé sur la branche, mais ne modifie pas la production tant que le déploiement n'a pas été effectué.
- Une icône App Store 1024 × 1024 non transparente doit remplacer celle de base générée par Capacitor avant la soumission.
- Renseigner l'URL de confidentialité, les déclarations de données collectées et les identifiants de démonstration pour l'examen Apple.
- GitHub Actions macOS peut consommer des minutes de facturation selon la visibilité du dépôt et le plan GitHub.
