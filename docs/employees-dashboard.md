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
