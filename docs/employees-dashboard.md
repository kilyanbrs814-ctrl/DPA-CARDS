# DPA Cards — Espace Employés (22 octobre 2026)

## Parcours
- Sur l'accueil du **propriétaire** : encart « Employés » sous « Ma carte », disponible sur desktop et mobile web.
- Bouton « Ajouter un employé » : prénom + e-mail, invitation sécurisée Resend, définition du mot de passe par le destinataire.
- Liste « Invitations en attente » : compte lié au commerce mais **aucune connexion depuis son invitation**.
- Liste « Employés inscrits » : compte ayant **ouvert une session après invitation**, cliquable pour consulter ses statistiques.
- Accès aux listes et aux chiffres **réservé au propriétaire du commerce sélectionné**. Les employés sont uniquement membres de leur commerce, sans facturation supplémentaire.

## Indicateurs
1. **Scans validés** : nombre d'événements de passage validés à partir de l'écran Scanner depuis le déploiement du suivi (pas le nombre de QR lus sans validation).
2. **Cartes uniques scannées** : cartes distinctes associées à ces scans validés.
3. **Passages validés** : événements `card_events.type='visit'` non corrigés, liés à `created_by` de l'employé. Inclut le scan et les ajouts depuis une fiche client.
4. **Clients ajoutés** : `customers.created_by` correspond à l'employé. Les inscriptions publiques ne lui sont pas attribuées.
5. **Clients récurrents** : clients ayant **au moins deux journées différentes** de visites non corrigées validées par le **même employé**, dates calculées Europe/Paris. Pas de lien avec les réservations Planity.

## Modèle technique
- `employee_invitations` : dernier envoi par commerce/utilisateur (e-mail, prénom, date). Accès uniquement serveur, RLS activée.
- `employee_scan_validations` : correspondance 1:1 entre `card_events.id` et un scan ayant donné lieu à validation, avec identité de l'utilisateur. RLS activée, écriture strictement contrôlée.
- `add_visit_recorded` : nouveau RPC, source `scan` ou `client`; enveloppe la logique existante de fidélité sans en modifier les validations.
- `merchant-team/list` : endpoint serveur protégé par JWT et par appartenance avec rôle propriétaire, agrégation des compteurs isolée au commerce sélectionné.
- `merchant-team/invite` : enregistre désormais la trace de l'invitation après confirmation d'envoi Resend.
- Les anciennes applications utilisant encore `add_visit` restent opérationnelles ; elles n'alimentent pas la catégorie « Scans validés ».

## Limites de données et tests
- Aucune intégration Planity pour le moment ; un client récurrent signifie « servi / validé par le même employé » et non « a expressément choisi ce coiffeur sur Planity ».
- Les scans historiques ne peuvent pas être rétro-attribués au scanner ; les anciens passages restent attribuables grâce à `card_events.created_by`.
- L'employé invité et déjà titulaire d'un compte doit se reconnecter après l'envoi pour passer de « en attente » à « inscrit ».
- Vérifier le parcours réel mobile web et la prochaine compilation de l'application iOS ; une livraison web ne met pas à jour un binaire iOS déjà distribué.

## Règles visuelles
Aucune flèche dans les boutons, comme demandé par le projet : `docs/visual-design-rules.md`.


## Gestion d’une invitation en attente (22 octobre 2026)
- Le propriétaire clique sur une ligne de **« Invitations en attente »** pour ouvrir le panneau « Gérer une invitation ».
- **Renvoyer l’e-mail** : génère un nouveau lien sécurisé avec Supabase Auth, l’envoie via Resend au destinataire existant et actualise la date de l’invitation.
- **Changer l’adresse e-mail** : saisie et validation d'une nouvelle adresse ; génération d'un lien pour ce destinataire ; rattachement du nouveau compte au même commerce uniquement ; envoi réussi requis avant le retrait de l’ancien rattachement.
- **Supprimer l’invitation** : double validation avec message explicite ; retire l’accès au commerce et la trace de l’invitation, **sans supprimer** le compte Auth ni les appartenances à d’autres commerces.
- Le serveur impose un **JWT valide**, le **rôle owner** dans le commerce sélectionné et vérifie que l’employé n’a pas activé son invitation. Les liens privés restent sur le serveur et ne sont jamais envoyés au navigateur.
- Les vues mobile et desktop ont les mêmes actions, **sans icônes de flèche**.
- Après chaque modification, l’interface actualise la liste. Un compte déjà activé n'est plus modifiable depuis cette fenêtre.
- Déploiements GitHub, Vercel production et Supabase Edge Function vérifiés. **Le parcours de bout en bout avec un compte propriétaire connecté et un destinataire réel reste à tester** avant de déclarer l'envoi et le changement d’adresse validés en conditions réelles.


## Autorisations personnalisées des employés — 22 octobre 2026
- Dans « Employés inscrits », le propriétaire ouvre la fiche d'un collaborateur. Sous les statistiques, cinq autorisations sont présentées avec état **Autorisé/Bloqué** et bouton **Enregistrer les autorisations**.
- Capacités : `scan` (scanner et créditer les passages), `add_clients` (ajouter des clients côté commerçant), `rewards` (remettre des récompenses), `corrections` (corriger des visites) et `notifications` (créer, modifier et envoyer les notifications Apple/Google Wallet).
- Chaque paramètre est **spécifique à un employé ET à un commerce**. Seul un propriétaire du commerce peut les modifier. Le contrôle est fait dans `merchant-team/permissions` sur un JWT de session vérifié ; le navigateur ne peut pas modifier directement la colonne.
- Les membres `owner` conservent tous les droits. Les employés déjà inscrits ont conservé leurs autorisations existantes (toutes vraies lors de la migration). Les **nouveaux invités** démarrent avec l'accès scanner seul ; le propriétaire peut ensuite cocher les autres fonctions.
- La base stocke ces droits dans `merchant_members.permissions`, avec vérification `app_private.member_can(merchant_id, capability)`, politiques RLS adaptées sur `customers`, `cards` et `notifications`, et trigger `card_events_staff_permission` sur les événements de fidélité.
- Les routes de distribution privilégiées `wallet/notify` et `apple-pass/notify` contrôlent elles-mêmes l’autorisation `notifications` avant toute création d'envoi. Les refus sont effectifs même via une requête API directe.
- L'interface web masque les accès refusés, et les actions protégées restent bloquées côté serveur. Les paramètres de commerce, de design et de facturation restent réservés aux propriétaires.
- **Limite** : le QR code public de souscription client demeure ouvert au public indépendamment des autorisations internes du personnel. Les permissions régulent l'ajout depuis le compte employé, pas les inscriptions faites volontairement par les clients eux-mêmes.
- **Tests réalisés** : simulation PostgreSQL d'un employé sans autorisation, tentative d'ajout de passage rejetée avec `employee_permission_denied`, transaction annulée ; vérification du maintien des droits existants après rollback. La sauvegarde réelle depuis un navigateur commerçant et la livraison iOS sont encore à valider.
- **Déploiement** : `merchant-team` v9, `wallet` v64, `apple-pass` v48 actifs dans Supabase. Page web mise à jour via GitHub/Vercel.
- Règle design conservée : aucun bouton fléché.


## Réglages du compte employé — lecture seule (22 octobre 2026)
- Un membre ayant le rôle `staff` ne peut **rien modifier dans les réglages du commerce**.
- Le menu « Réglages » n'affiche pas « Page d'inscription publique », « Profil du responsable » ni « Mon abonnement » pour un employé. La rubrique « Sécurité et mot de passe » (avec export des données et suppression de compte) est également retirée de ce menu pour éviter les éditions dans les réglages du commerce.
- « Informations du commerce » reste accessible **en lecture seule** (nom, activité, adresse), sans champ modifiable et sans bouton Enregistrer. « Aide et contact » reste disponible.
- Même en appelant directement la navigation interne, un employé est renvoyé hors des écrans propriétaires (fiche de programme/carte, éditeur de la page d'inscription, facturation ou paramètres personnels du responsable). `saveSection`, `saveSectionLive`, `saveCard`, `saveRegistration` et `exportData` disposent aussi de gardes frontend.
- Les politiques RLS existantes de `merchants` et `programs` exigent déjà `role='owner'` pour les mises à jour : **le frontend n'est pas le mécanisme d'autorisation**.
- La page publique d'inscription demeure accessible aux clients depuis son URL publique : masquer son accès dans les réglages employés ne doit pas rendre ce lien inaccessible aux clients.
- Le parcours d'invitation des clients et les actions opérationnelles de fidélité restent soumis aux cinq autorisations choisies par le propriétaire.
- Pour modifier leur mot de passe personnel hors de ces réglages, les employés conservent la récupération via la page de connexion.
- **Livraison** : web déployé. Application iOS installée à reconstruire pour refléter les menus. Test interactif avec une session employé réelle encore à confirmer.
