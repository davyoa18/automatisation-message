# Connecter Instagram

## À quoi sert l'API Instagram, concrètement

Instagram ne s'automatise pas « en SSH » ni avec un identifiant et un mot de passe : la seule voie autorisée est l'**API officielle de Meta**, en HTTPS. Le moteur l'utilise pour :

- **recevoir** en temps réel (webhooks) les DM, les réponses aux stories, les mentions, les commentaires sous vos posts, les clics sur les questions d'accueil et les arrivées depuis une publicité ;
- **répondre** en DM pendant les 24 h qui suivent le dernier message de la personne, avec l'indicateur « en train d'écrire », des bulles courtes et des réponses rapides ;
- **envoyer un DM en réponse à un commentaire** (« Écris APP en commentaire ») : un seul message privé par commentaire, dans les 7 jours ;
- **lire le profil public** de la personne qui écrit (nom, nombre d'abonnés, si elle suit le compte) pour adapter la conversation ;
- **configurer les questions d'accueil** affichées quand quelqu'un ouvre une conversation avec le studio.

Ce que l'API ne permet pas, et que le moteur ne fait donc pas : envoyer un premier message à quelqu'un qui n'a jamais écrit, suivre ou liker des comptes, lire les abonnés d'un autre compte. Ces actions restent manuelles (voir [la stratégie](07-strategie-instagram.md) et [les règles](06-regles-et-conformite.md)).

## Ce qu'il faut

- Le compte Instagram du studio en **compte professionnel** (Entreprise ou Créateur).
- Un compte développeur Meta (gratuit) : https://developers.facebook.com
- Le moteur déployé sur une adresse HTTPS publique, par exemple `https://moteur.yd-studio.fr` (voir [déploiement](03-deploiement.md)).
- Une page « Politique de confidentialité » en ligne (par exemple `https://yd-studio.fr/confidentialite`), exigée par Meta pour passer l'app en production.

**Sécurité.** Le mot de passe Instagram ne se donne à personne, ni dans un chat ni à une IA : la connexion se fait uniquement sur le site de Meta, et le moteur ne reçoit qu'un jeton d'accès révocable. Activez la double authentification sur le compte Instagram et sur le compte Meta.

## Étapes

### 1. Autoriser l'accès aux messages

Dans l'app Instagram du studio : **Paramètres → Messages et réponses aux stories → Contrôles des messages → Outils connectés → Autoriser l'accès aux messages**. Sans ce réglage, l'API ne voit pas les DM.

### 2. Créer l'app Meta

1. https://developers.facebook.com → **Mes apps → Créer une app**, type **Entreprise**.
2. Ajouter le produit **Instagram**, puis ouvrir **API setup with Instagram business login**.
3. Dans **Generate access tokens**, ajouter le compte du studio : la connexion s'ouvre sur le site d'Instagram. Copier l'**identifiant du compte** (`IG_ACCOUNT_ID`) et le **jeton** (`IG_ACCESS_TOKEN`). Ce jeton dure 60 jours : le moteur le renouvelle seul chaque semaine.
4. **Paramètres de l'app → Général** : copier la **clé secrète** (`IG_APP_SECRET`). Elle sert à vérifier que chaque webhook vient bien de Meta.

Permissions utilisées : `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.

### 3. Brancher les webhooks

1. Choisir une chaîne aléatoire pour `IG_VERIFY_TOKEN` (par exemple `openssl rand -hex 16`) et la mettre dans le `.env` du moteur.
2. Dans la section **Webhooks** de l'app : URL de rappel `https://moteur.yd-studio.fr/webhooks/instagram`, jeton de vérification = `IG_VERIFY_TOKEN`, puis **Vérifier et enregistrer**.
3. S'abonner aux champs : `messages`, `messaging_postbacks`, `messaging_referrals`, `messaging_seen`, `message_reactions` (parfois nommé `messaging_reactions`) et `comments`.
4. Sur le serveur : `npm run ig:setup` abonne le compte aux webhooks et installe les questions d'accueil ; `npm run ig:setup -- --check` vérifie le tout.

### 4. Passer l'app en mode « Live »

Meta n'envoie les webhooks qu'aux apps en mode **Live**. Il faut renseigner l'URL de la politique de confidentialité et une URL d'instructions de suppression des données (une section de la même page suffit).

### 5. Tester à blanc, puis en vrai

1. Laisser `DRY_RUN=true` : le moteur reçoit tout, prépare les réponses, mais n'envoie rien. Envoyer « Bonjour » au studio **depuis un compte extérieur**, qui n'a aucun rôle dans l'app Meta (le compte perso d'un proche), et vérifier que la conversation apparaît dans le cockpit avec la réponse prévue.
2. Passer `DRY_RUN=false`, redémarrer, refaire le test : Nova répond pour de vrai.
3. Tester un commentaire « APP » sous un post : le DM automatique doit partir.

### 6. Si les messages des comptes extérieurs n'arrivent pas

D'après la documentation de Meta, une app qui ne sert que le compte de son propriétaire peut fonctionner avec l'accès **Standard**. Si, en mode Live, les messages des comptes extérieurs n'arrivent toujours pas, demander l'**accès Advanced** pour `instagram_business_manage_messages` (et `instagram_business_manage_comments`) :

- **Vérification d'entreprise** de YD Studio dans le Business Manager (Kbis ou équivalent).
- **App Review** : une vidéo de 1 à 2 minutes qui montre un DM reçu, la réponse de Nova (qui se présente comme une IA) et le cockpit où l'équipe peut reprendre la main ; une description de l'usage. Texte proposé :

> YD Studio uses this app to answer the direct messages its own Instagram professional account receives about mobile app projects. An AI assistant, clearly introduced as an AI, replies within Instagram's 24-hour messaging window, qualifies the request and books a call with the team. Team members monitor every conversation in an internal dashboard and can take over at any time. The app never sends unsolicited messages and only acts on the studio's own account.

Compter quelques jours à deux semaines selon Meta.

## Variables à renseigner

| Variable | Où la trouver |
| --- | --- |
| `IG_ACCOUNT_ID` | App Meta → Instagram → API setup → Generate access tokens |
| `IG_ACCESS_TOKEN` | Même endroit (jeton longue durée) |
| `IG_APP_SECRET` | Paramètres de l'app → Général → Clé secrète |
| `IG_VERIFY_TOKEN` | Chaîne aléatoire de votre choix, recopiée dans la section Webhooks |
| `IG_HUMAN_AGENT_TAG` | Laisser `false` ; `true` seulement si Meta a validé la fonction « Human Agent » (réponses humaines jusqu'à 7 jours) |

## Sources

- [Instagram Platform, vue d'ensemble (niveaux d'accès Standard et Advanced)](https://developers.facebook.com/docs/instagram-platform/overview)
- [Créer une app Instagram](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)
- [Webhooks Instagram](https://developers.facebook.com/documentation/instagram-platform/webhooks.md)
- [API de messagerie avec Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [App Review pour l'API Instagram](https://developers.facebook.com/docs/instagram-platform/app-review)
