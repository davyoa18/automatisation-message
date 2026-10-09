# Faire venir les bons prospects en DM

Le moteur transforme les conversations en rendez-vous. Il faut donc des conversations : cette page est le plan pour les déclencher, sans DM automatique à des inconnus.

## La cible n°1

Des fondateurs et fondatrices en France qui lancent un business dont le cœur est une app mobile, avec au moins 5 000 € à investir (même en plusieurs fois). Les profils qui ont le plus souvent ce budget :

- une personne qui a déjà une activité rentable ou une audience (créatrice, coach, marque, commerce) et veut son app ;
- un fondateur qui vient d'obtenir un financement : prêt d'honneur, bourse, pré-seed ou seed ;
- un salarié qui se lance avec son épargne ;
- une startup qui doit sortir son app vite (démo investisseurs, salon, lancement).

Le détail, et ce qui exclut un prospect, est dans `studio/04-cible.md`.

## L'offre qui fait écrire : l'ébauche gratuite

Le studio a un argument que peu d'agences peuvent proposer : une **première ébauche de l'app du prospect**, préparée pendant la conversation et montrée en 10 minutes de visio. C'est l'appel à l'action de tout le reste :

> « Écris APP en commentaire (ou en DM) : on te prépare une première ébauche de ton app, offerte. »

## Les points d'entrée, du plus rentable au plus large

### 1. Le profil

- Bio : ce que fait le studio + l'appel à l'action. Par exemple : « Apps iOS natives, de l'idée à l'App Store en 21 jours · Écris APP pour une ébauche de ton app ».
- Stories à la une : réalisations, « 21 jours » (le process), « Prix » (à partir de 5 000 €, en plusieurs fois), « Ébauche » (des exemples).
- Les questions d'accueil (installées par `npm run ig:setup`) s'affichent quand quelqu'un ouvre une conversation : « J'ai une idée d'app », « Combien coûte une app ? », « En combien de temps ? », « Parler à l'équipe ».

### 2. Les contenus qui déclenchent des DM

Trois formats par semaine suffisent pour commencer :

| Format | Exemple | Appel à l'action |
| --- | --- | --- |
| Reel « coulisses » | Une app de l'idée à l'App Store en 21 jours, en 30 secondes | Commente APP |
| Carrousel « prix » | Combien coûte vraiment une app en 2026, et ce qui fait varier le prix | Commente DEVIS |
| Avant / après | L'ébauche, puis l'app livrée | Commente MAQUETTE |

Chaque commentaire avec le mot-clé déclenche un DM privé automatique (règles dans **Cockpit → Réglages**), et Nova enchaîne dès que la personne répond.

### 3. Les stories

Un sticker question par semaine : « Ton idée d'app en une phrase ? ». Chaque réponse arrive en DM et Nova la reprend.

### 4. La publicité « Envoyer un message »

Une campagne Meta avec l'objectif **Engagement → Messages**, qui ouvre directement une conversation avec Nova :

- ciblage : France, 25 à 45 ans, centres d'intérêt entrepreneuriat, création d'entreprise, startup, levée de fonds ;
- créa : le Reel « coulisses », et la promesse de l'ébauche ;
- budget de test : 10 à 20 € par jour pendant deux semaines, puis on garde ce qui produit des budgets validés (visibles dans le cockpit).

Le moteur reconnaît les conversations venues d'une publicité et l'indique à Nova, qui adapte son accueil.

### 5. Les partenaires

Incubateurs et réseaux de financement (French Tech, Initiative France, Réseau Entreprendre, incubateurs d'écoles), experts-comptables de startups, coachs business : un lien vers le DM du studio dans leurs ressources, contre l'ébauche offerte à leurs membres.

### 6. La prospection assistée, faite par un humain

Chaque matin, le cockpit propose une liste : entreprises créées récemment et levées de fonds annoncées, avec un score et une accroche rédigée par l'IA.

Une personne de l'équipe, 20 minutes par jour :

1. ouvre le profil Instagram du prospect et s'y intéresse vraiment (une réaction à une story, un commentaire utile) ;
2. envoie l'accroche depuis l'app, en l'adaptant, une vingtaine par jour au plus, espacées dans la journée ;
3. clique sur « J'ai envoyé le message » dans le cockpit (le prospect passe dans « Contactés »).

Quand le prospect répond, Nova reprend avec tout le contexte de la fiche.

## Le rythme et les chiffres à suivre

Le studio prend 4 à 5 projets par mois. En ordre de grandeur, il faut :

| Étape | Objectif mensuel |
| --- | --- |
| Conversations entrantes | 80 à 120 |
| Budgets validés | 20 à 30 |
| Appels réalisés | 15 à 20 |
| Projets signés | 4 à 5 |

Le bilan du lundi matin (Telegram ou email) donne ces chiffres chaque semaine : conversations, budgets validés, ébauches, rendez-vous, taux de qualification, coût de l'IA.

## Améliorer Nova chaque semaine

1. Lire 5 conversations dans le cockpit et noter les réponses de Nova (« Juste » / « À revoir »).
2. Tester dans le [Labo Nova](https://claude.ai/artifact/BFT3Pjiq2m8MEDcKbLg54k) les cas qui posent problème, et enregistrer les essais.
3. Demander à Claude de relire les avis et de corriger le prompt ; vérifier dans le Labo, puis déployer.
