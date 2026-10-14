# Apple Wallet — configuration et statistiques

## Ce qui est implémenté

- Inscription publique : le client obtient un lien pour recevoir un **.pkpass signé** (quand les secrets Apple sont configurés), indépendant de Google Wallet.
- Espace commerçant : téléchargement du même type de pass pour une carte existante, avec contrôle des droits.
- Générateur admin : « Ajouter à Apple Wallet » produit un **pass de démonstration** isolé (QR `DPA_TEST`, aucune carte/client/transaction réels). Pour comparer le rendu, utiliser une carte test enregistrée.
- Tableau de bord admin : compte le nombre de **cartes clientes distinctes dont un .pkpass signé a été généré et servi par notre fonction**, par commerce et globalement ; cartes tests exclues. Les cartes présentes sur Google et Apple sont comptées dans « deux plateformes » et ne gonflent pas « sans Wallet ».
- Les liens sont opaques, hachés en base, à expiration limitée (7 jours pour les clients, 15 minutes pour les tests).

**Important :** ces chiffres ne représentent PAS des installations confirmées. Un utilisateur peut télécharger le fichier sans l'ajouter dans Wallet. Le suivi fiable des installations et les mises à jour automatiques de solde nécessitent une implémentation du web service PassKit (enregistrement des appareils) et des notifications APNs. Le solde du premier .pkpass est une capture au moment du téléchargement.

## Étape obligatoire pour rendre les boutons fonctionnels

Apple Team ID : `HDK7R3283T`. Pass Type ID du certificat validé sur iPhone : `pass.fr.digitalprojectagency.cards`.

Dans **Supabase > Project Settings > Edge Functions > Secrets**, créer :
- `APPLE_PASS_CERT_PEM` : **contenu complet** du certificat Pass Type en PEM, avec ses lignes `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`.
- `APPLE_PASS_PRIVATE_KEY_PEM` : **contenu complet** de la clé privée correspondante au certificat, avec les lignes `-----BEGIN PRIVATE KEY-----` ou `-----BEGIN RSA PRIVATE KEY-----`.

Ces deux valeurs vont **uniquement** dans les secrets Supabase. Ne jamais les mettre dans GitHub, dans Cloudflare Pages, dans une variable `VITE_*`, ni dans un message de chat.

Exemple Windows PowerShell pour convertir le certificat DER déjà émis :
```powershell
& "C:\Program Files\OpenSSL-Win64\bin\openssl.exe" x509 -inform DER -in "$HOME\DPA-Wallet\pass.cer" -out "$HOME\DPA-Wallet\pass.pem"
```
Puis coller intégralement les contenus locaux `pass.pem` et `dpa-wallet.key` **dans leurs champs respectifs de Supabase**.

Le certificat Apple WWDR G4 est chargé par la fonction serveur depuis le site Apple, pour la signature de la première carte. L'URL Supabase de `apple-pass` est publique pour permettre une ouverture par l'app Wallet, mais **le token aléatoire expire et ne peut être généré que par une inscription valide, un commerçant autorisé, ou un admin pour une carte test**.

## Déploiement contrôlé

Les migrations suivantes doivent être appliquées avant de déployer les fonctions :
- `20261014234000_apple_wallet_links.sql`
- `20261015001700_apple_wallet_metrics_test_links.sql`

Edge Functions :
- `wallet` (routes existantes + `apple-link`, `admin-test-card-apple`) : conserver `verify_jwt=false` puisque chaque route vérifie elle-même la session, une clé interne, ou la signature webhook selon le cas.
- `apple-pass` (GET `?token=...`) : `verify_jwt=false` indispensable pour que l'application Wallet puisse récupérer le pass ; l'accès est contrôlé par le token opaque limité en durée.
- `billing` inchangée.

Checklist de test : créer une carte test dans l'admin, la sauvegarder, cliquer « Ajouter à Apple Wallet », ouvrir sur un iPhone et vérifier son QR `DPA_TEST`. Vérifier que l'indicateur admin reste inchangé. Ensuite sur un commerce avec abonnement valide et design validé, inscrire un vrai client et télécharger son .pkpass ; l'indicateur « Apple » doit augmenter d'une unité après actualisation de l'admin, même si le client télécharge plusieurs fois. Vérifier Google Wallet indépendamment.

Ne pas publier comme terminé tant qu'un vrai .pkpass généré côté serveur n'a pas été installé/testé sur iPhone.
