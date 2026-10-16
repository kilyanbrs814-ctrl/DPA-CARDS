# DPA Cards — connexion administrateur dans l'application iPhone

## Méthode fiable sur iOS : code à 6 chiffres (depuis la prochaine version)

Le lien reçu par e-mail pouvait ouvrir DPA Cards sans transporter correctement la session
du navigateur Safari vers WKWebView. L'écran admin natif propose désormais une
authentification **entièrement dans l'application** :

1. Saisir l'adresse administrateur et cliquer **Recevoir mon code**.
2. Copier les **6 chiffres** figurant dans l'e-mail de connexion (ne pas cliquer sur le lien).
3. Revenir dans DPA Cards et valider le code. `supabase.auth.verifyOtp({ email, token, type: 'email' })`
   crée la session admin locale `dpa-admin-auth`.
4. L'accès au dashboard continue de dépendre de `admin_users` et des vérifications côté serveur.

**Prérequis à configurer manuellement une seule fois dans Supabase :**
- https://supabase.com/dashboard/project/fiuffxchvjcghcvfaout/auth/templates
- **Magic Link > Content** : conserver intégralement le contenu existant (et `{{ .ConfirmationURL }}`), ajouter :

```html
<p>Votre code de connexion DPA Cards : <strong>{{ .Token }}</strong></p>
```

- Enregistrer. `{{ .Token }}` est la variable Supabase prévue pour l'OTP à six chiffres.
- Ce changement de texte d'e-mail ne touche pas au fonctionnement des pass Apple Wallet/Google Wallet
  ni au flux d'authentification du site public.


## Pourquoi la version 1.0.0 (build 2) ouvrait Safari

`src/admin-backend.js` envoyait systématiquement les liens Supabase OTP vers
`https://cards.digitalprojectagency.fr/admin.html`. L'authentification se terminait dans Safari, dans un stockage de session distinct de celui de l'application iOS.

## Correctif pour le prochain build iOS

- Sur iOS uniquement, les e-mails admin utilisent `emailRedirectTo: 'dpacards://auth/admin'`.
- Le projet Xcode enregistre `dpacards` dans `CFBundleURLTypes`.
- Le plugin officiel `@capacitor/app@8` intercepte `appUrlOpen` et `getLaunchUrl` (application ouverte ou fermée).
- Depuis l'écran commerçant, la redirection charge la page native `/admin.html`.
- Le code de session est traité par le client Supabase admin, **séparé du client commerçant** (`dpa-admin-auth`).
- L'autorisation reste vérifiée côté serveur via `admin_users`; les URLs non reconnues sont ignorées.
- Le site Web conserve son ancienne redirection HTTPS.

## Configuration Auth obligatoire dans Supabase (manuelle, une fois)

1. Ouvrir https://supabase.com/dashboard/project/fiuffxchvjcghcvfaout/auth/url-configuration
2. Sous **Redirect URLs**, ajouter l'URL exacte : `dpacards://auth/admin`
3. Enregistrer, sans supprimer l'URL du site web ni changer **Site URL**.
4. Vérifier que le modèle d'e-mail *Magic Link* emploie la variable Supabase `{{ .ConfirmationURL }}` (la configuration par défaut). Avec un modèle personnalisé, les paramètres `redirect_to` doivent être respectés.

Référence officielle : https://supabase.com/docs/guides/auth/redirect-urls

Sans ce réglage, Supabase renvoie parfois vers l'URL Web autorisée à la place du schéma iOS.

## Autorisation réseau

La fonction Edge `wallet` de Supabase a été déployée en version 51 avec
**seulement l'ajout** de `capacitor://localhost` aux origines autorisées.
Aucune logique de carte Wallet ni aucun contrôle d'autorisation n'a été modifié.

## Validation et TestFlight

- iOS simulateur : https://github.com/kilyanbrs814-ctrl/DPA-CARDS/actions/runs/38933227480 — ✅ compilation réussie, six tests d'URL natif validés.
- Le **build 2 existant n'est pas corrigé** : déclencher une **nouvelle** exécution `Upload signed iOS build to TestFlight` une fois l'URL enregistrée.
- Ajouter le nouveau build au groupe de test interne et mettre à jour l'app sur l'iPhone.
- Sur l'écran initial, choisir **Accès administrateur** puis demander le lien.
- Le lien peut ouvrir brièvement Safari pour vérifier le jeton Supabase, puis doit basculer automatiquement vers DPA Cards et afficher la page admin.
- Si un lien antérieur redirige vers Safari, demander un **nouveau** lien depuis la version mise à jour.

Ne jamais partager les URL de retour complètes contenant `access_token`/`refresh_token` : elles donnent accès à une session.
