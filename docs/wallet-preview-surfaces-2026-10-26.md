# Aperçus Wallet et inscription depuis l’accueil — 26 octobre 2026

Le bloc d’inscription PC réutilise `enroll_customer`, son identifiant de requête,
le consentement et les droits `add_clients`. Aucun solde n’est écrit depuis le
navigateur. Le formulaire est masqué sans accès et réinitialisé après retour de
la carte créée. Le QR et le lien visent la page publique du commerce actif.

`prepareProgramPreview` adapte en lecture seule le programme effectif aux aperçus.
Un design administrateur conserve ses paramètres Apple et Google. Sans design
avancé, les nouveaux programmes avec tampon utilisent le catalogue enregistré et
le cadeau au dixième emplacement ; les anciens programmes self-service sans
tampon conservent leur disposition native générique. Aucun programme existant
n’est migré ni réenregistré par cette correction.

Accueil, fiche client, page « Votre carte est prête » et créateur utilisent ces
données communes. Les données individuelles disponibles (nom, progression,
numéro, QR personnel) sont passées séparément au rendu. Avant création d’une
carte, la zone QR est un emplacement neutre. Aucun tampon ni cadeau n’est affiché
avant le choix explicite du tampon à l’étape 3 ; ce choix actualise les deux aperçus. L’import
du vrai logo demeure disponible ; « LOGO » est uniquement un remplacement visuel.

Les aperçus de création de compte masquent le titre du programme et le numéro de
carte pour ne conserver que les renseignements membre/récompense. Leur hauteur
s’adapte au contenu restant. L’en-tête Google de cet aperçu de personnalisation
centre le logo et place le commerce en dessous. Ce choix de présentation est
limité au créateur : Google contrôle l’en-tête natif des passes et sa position
ne peut pas être librement réorganisée par le template de fidélité.

Le point d’entrée public renvoie désormais `design_mode` et
`self_service_stamp_id`. L’inscription idempotente relit la progression du registre
de la carte résolue côté serveur. Elle n’accepte aucun identifiant de carte
supplémentaire fourni par le navigateur. Les contrôles de slug et d’accès restent
en place. Aucune migration, aucun changement de tarif, aucune modification des
fonctions de signature Apple ni des objets Wallet installés.

## Validation

- Compilation Vite et contrôles d’hébergement statique.
- Tests de rendu sans mutation, logo, cadeau, progression et compatibilité des
  anciens designs ; scénario navigateur PC/mobile avec backend simulé sans
  écriture en production, consentement et permissions négatives.
- Tests métier profils, isolation/RLS et facturation, tests PNG/Apple/Google ;
  vérification TypeScript de la fonction wallet.
- Les anciens scénarios `png-designer.spec.mjs` contiennent des sélecteurs Apple
  devenus obsolètes avant cette correction. Le premier échec (3 `filled-png`
  attendus, 0 trouvés) est reproduit sur la révision d’origine `ed96fd5`.

## Limites natives

Les aperçus HTML suivent la configuration et les données, mais Apple et Google
contrôlent la police, le placement des champs, les troncatures et les espacements.
Google affiche le bandeau de tampons sous le QR et les modules de renseignements
dans sa propre interface. Une similitude au pixel et une installation sur appareil
ne sont pas certifiées par ces tests navigateur. Aucun test physique iPhone ou
Android n’a été réalisé pour cette livraison.

Les fichiers de la fonction wallet actuellement déployés ont été récupérés avant
modification. Certaines dépendances d’images en production diffèrent du dépôt :
elles doivent être conservées lors du déploiement de cette seule fonction, sans
redéploiement global des générateurs ni écrasement des corrections de production.
