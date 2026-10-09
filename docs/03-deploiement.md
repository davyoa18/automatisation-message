# Déployer le moteur

Le moteur doit tourner en permanence sur une adresse HTTPS publique : Meta y envoie les webhooks, et les relances partent à heure fixe. Pas besoin de n8n : la file de tâches, les relances et la planification sont dans le moteur.

## Option recommandée : un petit serveur avec Docker (5 à 10 € par mois)

Un VPS Linux en Europe suffit (par exemple Scaleway ou OVH en France, Hetzner en Allemagne), avec 2 Go de mémoire. Le fichier `docker-compose.yml` lance trois services : le moteur, Postgres 17 et Caddy, qui gère le certificat HTTPS tout seul.

### 1. Le domaine

Créer un enregistrement DNS de type A : `moteur.yd-studio.fr` → adresse IP du serveur.

### 2. Le serveur

```bash
# Ubuntu 24.04
curl -fsSL https://get.docker.com | sh
git clone https://github.com/davyoa18/automatisation-message.git   # dépôt privé : clé de déploiement ou jeton GitHub
cd automatisation-message
cp .env.example .env
nano .env    # remplir (voir le tableau ci-dessous)
```

Ajouter aussi dans `.env` :

```bash
DOMAINE=moteur.yd-studio.fr
POSTGRES_PASSWORD=une-longue-chaine-aleatoire   # openssl rand -hex 24
```

### 3. Le lancement

```bash
docker compose up -d --build
docker compose exec moteur node dist/scripts/doctor.js          # diagnostic complet
docker compose exec moteur node dist/src/instagram/setup-cli.js # webhooks + questions d'accueil
```

Le cockpit est alors sur `https://moteur.yd-studio.fr/cockpit`.

Commencer avec `DRY_RUN=true` (rien n'est envoyé sur Instagram), vérifier les premières conversations dans le cockpit, puis passer à `DRY_RUN=false` et relancer `docker compose up -d`.

### 4. Au quotidien

| Besoin | Commande |
| --- | --- |
| Voir les journaux | `docker compose logs -f moteur` |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Sauvegarder la base | `docker compose exec postgres pg_dump -U moteur moteur \| gzip > sauvegarde-$(date +%F).sql.gz` |
| Relancer après un changement de `.env` | `docker compose up -d` |

Programmer la sauvegarde chaque nuit avec `crontab -e`, et copier les fichiers hors du serveur (stockage objet, ou disque de l'équipe).

Faire tourner **une seule instance** du moteur : c'est elle qui garantit qu'un prospect ne reçoit jamais deux réponses en parallèle. Une mise à jour ou un redémarrage est sans risque : les tâches en cours sont rendues à la file et reprennent au démarrage suivant.

## Option sans serveur à gérer : Railway ou Render

1. Créer un service à partir du dépôt GitHub : le `Dockerfile` est détecté.
2. Ajouter une base Postgres (Railway, Neon ou Supabase) et renseigner `DATABASE_URL`.
3. Renseigner les autres variables, puis brancher le domaine `moteur.yd-studio.fr`.

Compter 5 à 25 € par mois selon l'hébergeur.

## Les variables d'environnement

Toutes sont décrites dans `.env.example`. Les secrets ne vont que dans `.env` (jamais dans Git).

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | oui | `https://moteur.yd-studio.fr` |
| `ANTHROPIC_API_KEY` | oui | Clé API Claude (console.anthropic.com), avec un plafond de dépense |
| `IG_ACCOUNT_ID`, `IG_ACCESS_TOKEN`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN` | oui | Voir [Connecter Instagram](02-connexion-instagram.md) |
| `COCKPIT_PASSWORD`, `SESSION_SECRET` | oui | Accès au cockpit ; `SESSION_SECRET` = 32 caractères aléatoires (`openssl rand -hex 32`) |
| `BOOKING_URL` | conseillé | Lien Calendly ou Cal.com de l'appel de 10 min ; sans lui, Nova propose des créneaux que l'équipe confirme |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | conseillé | Alertes instantanées (budget validé, rendez-vous, relais humain) |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` | facultatif | Alertes par email |
| `NOTIFY_WEBHOOK_URL` | facultatif | Alertes vers Slack, Discord, Make ou n8n |
| `MCP_TOKEN` | facultatif | Active l'accès MCP par HTTP (`/mcp`) |
| `DRY_RUN` | — | `true` pour tout recevoir sans rien envoyer |

### Créer le bot Telegram des alertes (5 minutes)

1. Dans Telegram, écrire à **@BotFather** : `/newbot`, choisir un nom. Copier le jeton → `TELEGRAM_BOT_TOKEN`.
2. Créer un groupe avec l'équipe, y ajouter le bot, écrire un message dans le groupe.
3. Ouvrir `https://api.telegram.org/bot<JETON>/getUpdates` : le `chat.id` du groupe (nombre négatif) → `TELEGRAM_CHAT_ID`.
4. Vérifier : `docker compose exec moteur node dist/scripts/doctor.js --notif` envoie une alerte de test.

## Ce que coûte l'infrastructure

| Poste | Coût mensuel |
| --- | --- |
| Serveur (moteur + base + HTTPS) | 5 à 10 € |
| API Instagram | gratuit |
| IA (Claude) | voir [L'IA et ses coûts](05-ia-et-couts.md), environ 0,15 $ par conversation |
| Alertes Telegram | gratuit |
