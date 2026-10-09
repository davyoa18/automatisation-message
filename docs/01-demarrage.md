# Démarrer

Ce dépôt contient le moteur complet des DM Instagram de YD Studio : l'IA (Nova), le moteur qui reçoit et envoie les messages, la base de données, le cockpit de l'équipe, la prospection assistée et le serveur MCP.

## Essayer l'IA tout de suite, sans rien installer

Le **Labo Nova** fait répondre Nova avec le prompt de production, dans Claude, sur ton forfait : https://claude.ai/artifact/BFT3Pjiq2m8MEDcKbLg54k

- 9 prospects simulés (fondatrice qui a levé des fonds, coach, étudiant sans budget, commerçant qui trouve ça cher, démarcheur, petit malin qui essaie de piéger l'IA…), ou « Jouer moi-même ».
- La fiche, l'étape, le score et la fenêtre de 24 h d'Instagram se mettent à jour en direct.
- « Le prospect ne répond pas » simule les relances (+3 h, puis +21 h).
- « Comparer avec Opus 5.5 » montre la réponse de l'autre modèle sur le même message.
- Les boutons « Juste » / « À revoir » et « Enregistrer l'essai » gardent tes retours : Claude les relit pour corriger le prompt.

## Lancer le cockpit en local (données fictives)

Prérequis : Node.js 22.

```bash
npm install
npm run demo
```

Puis ouvrir http://localhost:3999/cockpit : tableau de bord, conversations, prospects, ébauches illustrées et bac à sable, sur des données d'exemple. Rien n'est envoyé sur Instagram.

## Discuter avec Nova dans le terminal

Avec une clé API Claude (https://console.anthropic.com, différente de l'abonnement Claude.ai) :

```bash
ANTHROPIC_API_KEY=sk-ant-… npm run simulate
```

## Les commandes utiles

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run dev` | Lance le moteur en développement (base locale PGlite) |
| `npm run demo` | Cockpit avec des données fictives, sans clé ni Instagram |
| `npm run simulate` | Conversation avec Nova dans le terminal (clé API requise) |
| `npm run doctor` | Vérifie une installation : base, IA, Instagram, URL publique, rendu des ébauches, alertes |
| `npm run ig:setup` | Branche le compte Instagram : webhooks et questions d'accueil (`-- --check` pour vérifier) |
| `npm run prospects:scan` | Lance la recherche de prospects du jour |
| `npm run studio:import -- https://yd-studio.fr` | Importe le contenu du site dans la base de connaissances (`studio/90-site.md`) |
| `npm run labo:build` | Reconstruit la page du Labo après une modification des prompts |
| `npm run mcp` | Serveur MCP local (pour Claude Desktop ou Claude Code) |
| `npm test` | Lance les tests automatiques |

## Où est quoi

| Dossier | Contenu |
| --- | --- |
| `studio/` | Ce que Nova sait du studio : offre, prix, process, cible, objections, ton. **À relire en priorité.** |
| `prompts/` | Les master prompts : conversation (pendant), relance, analyse (après), prospection et accroche (avant), ébauche |
| `src/ai/` | L'agent conversationnel, ses outils, le score et la fiche prospect |
| `src/engine/` | Le moteur : file de tâches, rythme d'envoi, fenêtre de 24 h, relances, planification |
| `src/instagram/` | L'adaptateur de l'API officielle Instagram (webhooks et envoi) |
| `src/web/` | Le cockpit de l'équipe et les routes HTTP |
| `src/mcp/` | Le serveur MCP |
| `src/prospects/` | La prospection assistée (registre des entreprises, flux d'actualité) |
| `src/ebauche/` | Le générateur d'ébauches (brief puis écrans iPhone rendus en image) |
| `labo/` | Le Labo Nova (page de test de l'IA) |
| `evals/` | Les cas de test de l'IA, les réponses des trois modèles et le jugement à l'aveugle |
| `docs/` | Cette documentation |

## La suite

1. [Connecter Instagram](02-connexion-instagram.md)
2. [Déployer le moteur](03-deploiement.md)
3. [Utiliser le cockpit au quotidien](04-utilisation.md)
4. [L'IA et ses coûts](05-ia-et-couts.md)
5. [Les règles d'Instagram, l'AI Act et le RGPD](06-regles-et-conformite.md)
6. [La stratégie Instagram pour faire venir les prospects en DM](07-strategie-instagram.md)
