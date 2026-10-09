# Utiliser le moteur au quotidien

## Ce qui se passe quand quelqu'un écrit au studio

1. Le message arrive par webhook. Si la personne écrit en plusieurs bulles, le moteur attend quelques secondes pour tout lire d'un coup.
2. Nova lit la conversation, la fiche du prospect et le contexte (source, heure, étape), met la fiche à jour, puis répond en une à trois bulles courtes, avec l'indicateur « en train d'écrire » et des délais de frappe naturels.
3. Dès que le projet est clair et le budget validé (au moins 5 000 € au total, même en plusieurs fois), Nova lance l'ébauche (Opus 5.5 conçoit 3 écrans iPhone de l'app du prospect) et propose l'appel de 10 minutes.
4. L'équipe reçoit une alerte à chaque moment clé : budget validé, ébauche lancée, rendez-vous demandé, humain demandé.
5. Si la personne ne répond plus, Nova relance au plus deux fois (après 3 h, puis 21 h), et seulement si c'est utile et dans la fenêtre de 24 h d'Instagram.
6. 30 minutes après le dernier échange, le moteur résume la conversation pour l'équipe et prépare une relance manuelle prête à copier.

## Le cockpit (`/cockpit`)

| Page | À quoi elle sert |
| --- | --- |
| **Tableau de bord** | Les chiffres de la semaine, les prospects chauds, les rendez-vous à confirmer, les coûts d'IA |
| **Conversations** | Chaque échange avec sa fiche, son score et son résumé. On peut écrire au nom de l'équipe, mettre l'IA en pause, changer l'étape, effacer les données d'un contact, noter une réponse de Nova |
| **Prospects** | La liste du jour de la prospection assistée, avec le score et l'accroche rédigée par l'IA |
| **Ébauches** | Les ébauches générées, en image, prêtes à montrer pendant l'appel |
| **Bac à sable** | Discuter avec Nova comme un prospect, avec la vraie base de données |
| **Réglages** | Les mots-clés de commentaire (« APP », « MAQUETTE », « DEVIS ») et le message privé envoyé en réponse |

## Reprendre une conversation à la main

Il suffit de répondre depuis l'app Instagram du studio : le moteur reconnaît que c'est un humain et met Nova en pause sur cette conversation pendant 12 heures (`HUMAN_TAKEOVER_PAUSE_HOURS`). On peut aussi écrire depuis le cockpit, ou mettre l'IA en pause d'un clic.

Nova passe elle-même la main quand la personne demande un humain, négocie le prix, se plaint, ou pose une question bloquante qu'elle ne sait pas traiter.

## La prospection assistée

Chaque matin à 7 h 30, le moteur repère des prospects dans des sources publiques : entreprises créées récemment en France (registre officiel des entreprises) et actualité des levées de fonds (flux RSS à choisir dans `PROSPECTS_RSS`). L'IA leur donne un score et rédige une accroche personnalisée.

L'envoi reste humain : un membre de l'équipe ouvre le profil Instagram, s'abonne s'il le souhaite, et envoie l'accroche depuis l'app (en l'adaptant). Quand le prospect répond, Nova prend le relais avec tout le contexte. C'est ce qui permet de prospecter sans risque pour le compte (voir [les règles](06-regles-et-conformite.md)).

On peut aussi ajouter un prospect à la main (cockpit ou MCP).

## Le Labo Nova

https://claude.ai/artifact/BFT3Pjiq2m8MEDcKbLg54k

Pour tester une idée de formulation, vérifier un cas délicat ou former un nouveau membre de l'équipe. Chaque avis (« Juste », « À revoir » avec un commentaire) et chaque essai enregistré est conservé avec la version du prompt : il suffit de demander à Claude de « relire les avis du Labo » pour qu'il corrige le prompt en conséquence.

## Piloter le moteur depuis Claude (MCP)

Le moteur expose ses données à Claude par le protocole MCP. On peut alors demander, depuis Claude Desktop ou Claude Code : « Quels sont les leads chauds cette semaine ? », « Résume la conversation avec @maternia.app », « Prépare les relances manuelles du jour », « Ajoute ce prospect ».

Outils disponibles : `leads_chauds`, `rechercher_conversations`, `lire_conversation`, `statistiques`, `prospects_a_contacter`, `ajouter_prospect`, `marquer_prospect`, `changer_etape`, `pause_ia`, `envoyer_message_equipe`, `tester_ia`, `relances_manuelles`.

Deux façons de le brancher :

- **En local** (Claude Desktop ou Claude Code sur la machine qui a accès à la base) : `npm run mcp`.
- **À distance** : renseigner `MCP_TOKEN`, puis ajouter le serveur `https://moteur.yd-studio.fr/mcp` avec l'en-tête `Authorization: Bearer <MCP_TOKEN>`.

## Ajuster l'IA

| Pour changer… | Modifier |
| --- | --- |
| Ce que Nova sait du studio (offre, prix, délais, process) | `studio/*.md` et `studio/studio.json` |
| La façon dont Nova mène la conversation | `prompts/conversation.md` |
| Les relances, l'analyse, l'accroche, l'ébauche | `prompts/*.md` |
| Le nom de l'assistante, le budget minimum | `studio/studio.json` ou `ASSISTANT_NAME` dans `.env` |
| Le rythme des relances | `RELANCES` (par défaut `3h,21h`) |

Après une modification : `npm test`, puis `npm run labo:build` et republier le Labo pour tester la nouvelle version.
