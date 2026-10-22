# Règles visuelles DPA Cards — décision produit du 22 octobre 2026

## Flèches et boutons (interdiction explicite)
- **Aucune flèche décorative dans les boutons, cartes cliquables, CTA, formulaires ni e-mails.** Ne pas ajouter de symboles →, ←, &rarr;, de chevrons décoratifs, ou d'icônes de type `arrow_forward`, `arrow_back`, `chevron_right` pour inciter à cliquer.
- Les boutons portent un **libellé explicite** (ex. « Créer mon mot de passe », « Scanner une carte », « Retour »), **sans flèche**.
- Sur le site web, l'administration, les e-mails transactionnels, les gabarits Supabase Auth et les versions iOS futures, appliquer cette même règle. Pour les anciennes interfaces uniquement, ne pas laisser de bouton sans libellé lorsque l'icône disparaît.
- Les flèches qui expriment une **progression chiffrée ou temporelle** dans une donnée informative ne sont pas des boutons, et peuvent être conservées.

## Apparence des e-mails
- Les e-mails DPA Cards ont par défaut **un fond clair, une surface blanche et des textes sombres**, avec boutons violets.
- Ne **pas forcer le mode sombre** dans les modèles HTML : laisser le client mail gérer son apparence selon le thème du téléphone.
- Ne pas confondre couleurs du site et couleurs des e-mails ; les modèles de confirmation, récupération et invitation doivent être cohérents.
- Tester les futurs e-mails sur Gmail mobile en modes clair/sombre.

Cette règle est une préférence produit durable et prioritaire pour les prochaines modifications.
