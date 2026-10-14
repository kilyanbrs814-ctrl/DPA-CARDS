# Migration DPA Cards : Vercel → Cloudflare Pages + cards.digitalprojectagency.fr

**Statut : préparation uniquement.** Ne modifiez ni les DNS Infomaniak ni les secrets Supabase en production avant la validation de la préproduction. Cette migration ne déplace pas la base de données : Supabase continue à fournir Auth, Postgres, Storage, Edge Functions (billing, wallet, apple-pass). Le projet Vite est hébergé en statique.

## 1. Création de l'hébergement (action du propriétaire)

1. Créez/ouvrez un compte Cloudflare, puis **Workers & Pages > Create application > Pages > Connect to Git**.
2. Autorisez l'accès GitHub au dépôt `kilyanbrs814-ctrl/DPA-CARDS`.
3. Choisissez `main` comme branche de production **après validation et fusion de la PR migration**.
4. Configurer : **Framework preset** Vite ou None ; **build** `npm run build` ; **output directory** `dist` ; **root directory** `/`.
5. **Build environment variables** (publishables, jamais un secret serveur) :
   - `VITE_SUPABASE_URL` = `https://fiuffxchvjcghcvfaout.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = clé **publishable** récupérée dans le projet Supabase (ne jamais utiliser la clé secret/service_role)
   - `NODE_VERSION` = `22.16.0` ou version 22.x récente compatible avec Vite 7.
6. Déployez, notez la véritable URL `<projet>.pages.dev`. **Ne fabriquez pas cette valeur.**

**Architecture :** aucun backend HTTP Vercel utilisé par les routes du site. `public/_redirects` contient les rewrites Cloudflare Pages (200, sans changement d'URL). Les Edge Functions Supabase ne sont pas déplacées.

## 2. Tests avant la bascule DNS

Testez l'URL `*.pages.dev` réelle, sans lancer d'inscriptions payantes inutiles :
- `/` (connexion + ressources JS/CSS/images)
- `/admin.html` (connexion admin)
- `/join/<slug-existant>` (écran d'inscription public ; pas de formulaire soumis en production sans accord)
- `/mentions-legales`, `/confidentialite`, `/cgv`
- `/subscription/success`, `/subscription/cancel`, `/design/success`, `/design/cancel` : seulement le routage et la page (ne pas inventer de `session_id`)
- composants graphiques, scanner QR / accès caméra sur HTTPS, dimensions mobile.
Le script `npm run test:static` vérifie localement les fichiers de sortie et les règles de routage.

## 3. Domaine personnalisé / Infomaniak (après tests)

Sur Cloudflare Pages : **Custom domains > Set up a domain > cards.digitalprojectagency.fr**.

Chez Infomaniak : Gestionnaire de domaines > `digitalprojectagency.fr` > Zone DNS :
- **Type** : `CNAME`
- **Nom / hôte** : `cards` (ou nom complet selon l'interface)
- **Cible** : **URL `<projet>.pages.dev` exactement indiquée par Cloudflare**, et non une valeur supposée.
- Aucun changement des serveurs de noms `nsany1.infomaniak.com` / `nsany2.infomaniak.com` requis pour ce **sous-domaine**.
- Ne pas toucher aux enregistrements `@`, `www`, MX, SPF, DKIM, DMARC : le domaine principal peut continuer à héberger un autre site et les e-mails.

Vérifier HTTPS et certificat TLS sur `https://cards.digitalprojectagency.fr`.

L'ajout du domaine depuis Cloudflare est obligatoire **avant** de se contenter du CNAME. Une entrée DNS seule peut échouer.

## 4. Supabase Auth (bascule coordonnée)

Dans Supabase > Authentication > URL Configuration :
- **Site URL** : `https://cards.digitalprojectagency.fr`.
- **Redirect URLs** : ajouter `https://cards.digitalprojectagency.fr/**`, notamment `/` et `/admin.html` pour les e-mails de connexion, activation et mot de passe oublié.
- Garder éventuellement les anciennes URLs pendant une période de transition, puis les retirer.
- Ne pas modifier les clés ni les données existantes.

Dans Supabase > Edge Functions > Secrets :
- `DPA_SITE_URL=https://cards.digitalprojectagency.fr`
- `WALLET_ALLOWED_ORIGINS=https://cards.digitalprojectagency.fr` (inclure `http://localhost:5173` uniquement si nécessaire au développement).
- Si `WALLET_ALLOWED_ORIGINS` existait déjà, **remplacer sa valeur**, ne pas laisser l'ancien domaine seul.

Après ce paramétrage, déployer les fonctions `wallet` et `billing` depuis les fichiers modifiés de cette branche. **Ne pas le faire avant d'avoir un hôte opérationnel et les redirect URLs Auth correctes.** Les secrets de signature Google Wallet / Apple Wallet / Stripe et Resend restent côté Supabase, jamais dans Cloudflare Pages.

## 5. Stripe, Google Wallet, Apple Wallet et e-mails

- Stripe Checkout (setup, abonnement, design) choisit l'origine autorisée et renvoie vers `/subscription/success` ou `/design/success`. Testez un paiement **en mode test** et le retour sur le nouveau domaine.
- Le webhook Stripe reste `https://fiuffxchvjcghcvfaout.supabase.co/functions/v1/billing/webhook`. **Ne le réinitialisez pas juste pour cette migration.**
- Google Wallet : les URL de retour/ `origins` du JWT dépendent de `WALLET_ALLOWED_ORIGINS`. Tester l'ajout à Google Wallet.
- Apple Wallet : l'identifiant de certificat `pass.fr.digitalprojectagency.cards` ne dépend pas du domaine ; le `.pkpass` peut continuer à être signé dans Supabase. **La mise à jour automatique des cartes Apple n'est pas encore implémentée** ; la migration de domaine ne l'ajoute pas.
- Resend : `contact@digitalprojectagency.fr` et les domaines d'expédition ne changent pas. Tester un vrai e-mail d'invitation commerçant, avec le lien pointant vers `cards.digitalprojectagency.fr`.

## 6. Déploiement définitif, retrait de Vercel et anciens QR

1. Préparer Cloudflare + sa version de préproduction, vérifier tous les chemins.
2. Préparer les modifications Supabase Auth et les secrets, puis déployer les fonctions au moment prévu.
3. Basculer le CNAME Infomaniak vers la cible `*.pages.dev` **réelle**.
4. Test fonctionnel complet : connexion commerçant/admin, inscription publique, QR, scan, points, design, paiement Stripe **test**, Google Wallet, Apple Wallet si configuré, e-mails, mentions légales.
5. Vérifier que les nouveaux QR d'inscription contiennent **`cards.digitalprojectagency.fr/join/<slug>`**.
6. **Attention aux QR déjà imprimés** avec `dpa-cards.vercel.app` : si vous supprimez totalement le projet Vercel, ils cesseront de fonctionner. Prévoir soit une période transitoire avec une redirection HTTP 301, soit le remplacement des QR avant résiliation.
7. Une fois les anciens liens traités et les tests réussis, déconnecter le dépôt puis supprimer le projet Vercel si souhaité. **Ne pas supprimer Supabase ni Stripe.**

## 7. Retour arrière en cas de problème

Avant résiliation de Vercel, conserver ses réglages et la valeur DNS existante. En cas de problème : remettre le DNS `cards` précédent (s'il existait), restaurer les réglages Supabase Auth et `WALLET_ALLOWED_ORIGINS` précédents, puis redéployer les précédentes versions connues des fonctions `wallet` et `billing`. La base de données n'est pas recréée et les paiements Stripe n'ont pas à être reprovisionnés.

## Suivi

- [x] Routes statiques Cloudflare Pages préparées
- [x] Site canonique du QR d'inscription modifié
- [x] Origines et liens e-mail dans les Edge Functions préparés
- [x] Mentions d'hébergement adaptées dans le code
- [ ] Compte Cloudflare Pages connecté au GitHub (action du propriétaire)
- [ ] Preview Pages vérifiée
- [ ] Variables de build Cloudflare définies
- [ ] URL Auth et secrets Supabase modifiés au moment du basculement
- [ ] Domaine Cloudflare déclaré, CNAME Infomaniak ajouté
- [ ] Tests réels de bout en bout réussis
- [ ] Anciens QR gérés et Vercel retiré
