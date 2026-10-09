# Les règles d'Instagram, l'AI Act et le RGPD

Le moteur est construit pour que le compte du studio ne prenne aucun risque. Cette page explique ce qu'il fait, ce qu'il refuse de faire, et pourquoi.

## Ce que le moteur fait, et dans quelles limites

| Action | Règle d'Instagram | Ce que fait le moteur |
| --- | --- | --- |
| Répondre à un DM | Message automatique autorisé dans les **24 h** qui suivent le dernier message de la personne | Garde une marge de 10 minutes ; aucune relance ne part si elle tombe hors fenêtre |
| Relancer | Même fenêtre de 24 h | Au plus 2 relances (après 3 h, puis 21 h), seulement si l'IA les juge utiles |
| Répondre après 24 h | Seulement un humain, jusqu'à 7 jours, avec l'étiquette « Human Agent » validée par Meta | L'équipe répond depuis l'app ; le cockpit prépare une relance manuelle |
| DM après un commentaire | **Un seul** message privé par commentaire, dans les 7 jours | Un message par commentaire, jamais deux |
| Premier message à un inconnu | Interdit par l'API | Jamais automatique : l'IA rédige l'accroche, un humain l'envoie |

## Ce que le moteur refuse de faire

### Les abonnements et les DM automatiques à des inconnus

Les conditions d'utilisation d'Instagram interdisent d'automatiser des actions (abonnements, likes, messages) sans autorisation, et l'API officielle ne le permet pas. Les outils qui le font se connectent avec le mot de passe du compte et imitent un téléphone : Instagram les détecte, bloque les actions, puis restreint ou supprime le compte. Pour un studio dont le compte est la vitrine, le risque n'en vaut pas la peine.

Ce qui est fait à la place : la [prospection assistée](04-utilisation.md#la-prospection-assistée) prépare chaque jour une liste de prospects et des accroches personnalisées, et un humain les envoie depuis l'app, à un rythme normal (une vingtaine par jour au plus, espacés). Dès qu'un prospect répond, la conversation entre dans le cadre autorisé et Nova prend le relais.

### Se faire passer pour un humain

La demande initiale était un comportement « 100 % humain ». Le moteur a bien un **rythme humain** : il attend que la personne ait fini d'écrire, « lit », affiche l'indicateur de saisie, tape à une vitesse réaliste, découpe ses réponses en bulles courtes, et annule une bulle si la personne écrit entre-temps.

En revanche, Nova **dit qu'elle est une IA** dès son premier message, et le moteur l'ajoute si le modèle l'oublie. C'est une obligation légale : l'article 50 de l'AI Act, applicable depuis le 2 août 2026, impose d'informer les personnes qu'elles échangent avec une IA. C'est aussi un choix commercial cohérent avec une offre haut de gamme : les prospects découvrent un studio qui maîtrise l'IA, et l'équipe suit chaque échange et peut reprendre la main à tout moment.

## Le RGPD

| Sujet | Ce qui est en place | Ce qu'il reste à faire |
| --- | --- | --- |
| Base légale | Mesures précontractuelles à la demande de la personne (elle écrit au studio) ; intérêt légitime pour la prospection B2B | Mentionner ces traitements dans la politique de confidentialité |
| Information | Nova se présente comme l'IA du studio | Ajouter au site une section « Messages Instagram et IA » (traitement, durée, droits, sous-traitants) |
| Minimisation | Nova ne demande l'email que pour l'invitation, jamais de données sensibles | — |
| Opposition | « Stop », « arrête », etc. coupent tout message automatique ; Nova appelle `desinscrire` sur une demande formulée autrement | — |
| Effacement | Bouton « Effacer » dans le cockpit (contact, messages, fiche) | Traiter les demandes sous un mois |
| Conservation | — | Règle de la CNIL pour un prospect : 3 ans au plus à compter de la collecte ou du dernier contact venant de lui ; supprimer ou anonymiser au-delà |
| Sous-traitants | Anthropic (IA, API : les données ne servent pas à entraîner les modèles par défaut), Meta, l'hébergeur | Signer ou accepter les accords de traitement (DPA) de chacun |
| Prospection | Uniquement des données professionnelles publiques (registre officiel des entreprises, actualité) | Proposer l'opposition dès le premier message |
| Sécurité | Secrets dans `.env`, cockpit protégé par mot de passe, webhooks signés vérifiés, MCP par jeton | Double authentification sur Instagram, Meta, l'hébergeur et la console Anthropic |

## Avant de passer en production

- [ ] Politique de confidentialité à jour sur le site (section messages Instagram et IA)
- [ ] App Meta en mode Live, testée depuis un compte extérieur
- [ ] Une semaine en `DRY_RUN=true` à relire les réponses dans le cockpit
- [ ] Alertes Telegram ou email reçues par l'équipe
- [ ] Plafond de dépense réglé dans la console Anthropic
- [ ] Double authentification partout
- [ ] Sauvegarde quotidienne de la base

## Sources

- [AI Act, règlement (UE) 2024/1689, article 50](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- [CNIL : durée de conservation des données de prospects (3 ans à compter de la collecte ou du dernier contact venant du prospect ; fiche du secteur de l'assurance, même règle que le référentiel « gestion commerciale »)](https://www.cnil.fr/les-durees-de-conservation-des-donnees-du-secteur-de-lassurance)
- [Instagram : Conditions d'utilisation](https://help.instagram.com/581066165581870)
- [Meta : API de messagerie Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
