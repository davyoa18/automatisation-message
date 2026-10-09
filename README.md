# automatisation-message

Moteur maison d'automatisation des DM Instagram : une IA qui accueille, qualifie et relance les personnes intéressées par une application, sans ManyChat et dans les règles d'Instagram.

> **Statut : cadrage.** Questionnaire en cours (65 questions, réponses lisibles par Claude) : https://claude.ai/artifact/KvscPJYpqortLYZGGroG1f

## Ce que fait le système

- **Moteur entrant.** Commentaire → DM, réponses aux stories, lien direct vers les DM (bio, QR code), questions d'accueil, publicités « Envoyer un message ». L'IA répond en quelques secondes, 24 h/24.
- **Moteur sortant assisté.** Repérage et score de prospects à partir de sources publiques et légales. L'IA rédige une accroche personnalisée, envoyée à la main, puis prend le relais quand le prospect répond.
- **Moteur de suivi.** Mémoire par contact, récupération de l'email ou d'un rendez-vous pendant la fenêtre de 24 h, relances dans les règles, contenus de réactivation.
- **Cockpit.** Prospects chauds, conversations en cours, reprise en main, liste du jour, alertes.

Trois master prompts pilotent l'IA : **avant** (recherche, score, accroche), **pendant** (découverte, budget, estimation, maquette, rendez-vous) et **après** (résumé, score, prochaine action, brouillons de relance).

## Règles non négociables

1. API officielle de Meta uniquement : pas de connexion par mot de passe, pas de scraping, pas de premier message automatique à un inconnu.
2. Messages automatiques seulement dans les fenêtres autorisées : 24 h après le dernier message du prospect, et un seul message privé par commentaire, dans les 7 jours.
3. L'IA se présente comme une IA (AI Act, article 50, applicable depuis le 2 août 2026) et passe la main à un humain dès qu'on le lui demande.
4. RGPD : données professionnelles uniquement, droit d'opposition dans chaque échange, durée de conservation définie.

## Architecture cible (à confirmer après le questionnaire)

```
Instagram (webhooks) ──► API du moteur ──► Claude (API Anthropic) + master prompts
                              │
                              ├── Base de données : contacts, conversations, scores, fenêtres de 24 h
                              ├── File de tâches : relances dans la fenêtre, rendu des maquettes
                              └── Cockpit web + alertes
```

- Stack proposée : TypeScript et Postgres sur un petit serveur toujours allumé. Le code vit dans ce dépôt ; pas de n8n au cœur du moteur.
- Une tâche planifiée Claude Code relit chaque semaine les conversations et propose des améliorations des master prompts.

## Feuille de route

1. Cadrage : questionnaire, offres, cible n°1, ton de l'IA.
2. Configuration Meta : compte professionnel, app développeur, webhooks, test avec un vrai compte externe.
3. Moteur entrant, master prompt « pendant » et base de données.
4. Cockpit, alertes et relances.
5. Maquette instantanée, moteur sortant assisté, revue hebdomadaire.
