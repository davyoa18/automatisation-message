# L'IA et ses coûts

## Trois moments, trois modèles

| Moment | Ce que fait l'IA | Modèle | Pourquoi |
| --- | --- | --- | --- |
| **Avant** | Score des prospects repérés | Haiku 5.5 | Tâche simple et répétée : le moins cher suffit |
| **Avant** | Accroche personnalisée (envoyée à la main) | Sonnet 5.5 | Il faut un vrai sens du ton |
| **Pendant** | La conversation en DM (Nova) | Sonnet 5.5 | Même qualité qu'Opus sur nos tests, pour moitié prix |
| **Pendant** | L'ébauche de l'app (brief et 3 écrans iPhone) | Opus 5.5 | Le moment qui impressionne le prospect : on met le meilleur |
| **Pendant** | Les relances | Sonnet 5.5 | Même voix que la conversation |
| **Après** | Résumé, température, prochaine action, relance manuelle | Haiku 5.5 | Synthèse pour l'équipe, à faible coût |

Chaque modèle se change dans `.env` (`AI_MODEL_CONVERSATION`, `AI_MODEL_EBAUCHE`, `AI_MODEL_ANALYSE`, `AI_MODEL_PROSPECTION`).

## Sonnet suffit-il ? Le test à l'aveugle

Les trois modèles ont répondu aux 14 mêmes moments de conversation (premier contact après un commentaire, prix demandé d'emblée, budget insuffisant, budget validé après une levée de fonds, « tu es un robot ? », tentative de détournement, demande d'arrêt, démarchage, prospect anglophone…). Un juge (Opus 5.5) a noté chaque réponse sur 10 **sans savoir quel modèle l'avait écrite**, avec une grille fixe : règles respectées, justesse commerciale, ton, outils bien utilisés.

| Modèle | Score | Fautes graves |
| --- | --- | --- |
| Opus 5.5 | 124 / 140 | aucune |
| **Sonnet 5.5** | **123 / 140** | aucune |
| Haiku 5.5 | 118 / 140 | aucune |

Sonnet et Opus obtiennent la même note sur 13 cas sur 14. Le seul écart (l'objection « 5 000 €, ça me fait peur ») venait d'une zone floue du prompt, corrigée depuis. Haiku reste correct mais oublie plus souvent des détails (présentation en IA, repère de prix incomplet).

**Décision : Sonnet 5.5 pour la conversation.** Le juge a aussi relevé 16 faiblesses du prompt ; toutes ont été corrigées dans la version 2 (`prompts/conversation.md`). Le détail est dans `evals/jugement.json`, les réponses brutes dans `evals/sorties-*.json`, et la version testée du prompt dans `evals/historique/`.

Pour comparer soi-même : le bouton « Comparer avec Opus 5.5 » du [Labo Nova](https://claude.ai/artifact/BFT3Pjiq2m8MEDcKbLg54k) fait répondre l'autre modèle au même message.

## Ce que ça coûte

Tarifs utilisés (dollars par million de jetons, grille Anthropic d'octobre 2026, dans `src/ai/models.ts`) :

| Modèle | Entrée | Sortie | Lecture du cache |
| --- | --- | --- | --- |
| Opus 5.5 | 4 | 20 | 0,20 |
| Sonnet 5.5 | 2 | 10 | 0,20 |
| Haiku 5.5 | 0,10 | 0,50 | 0,01 |

Le prompt maître et les définitions d'outils (environ 8 000 jetons) sont mis en cache une heure : à chaque réponse, on ne paie que la lecture du cache, la conversation et la réponse.

| Poste | Estimation |
| --- | --- |
| Une réponse de Nova (Sonnet) | environ 0,015 $ |
| Une conversation complète (8 échanges, 2 relances, analyse) | **0,13 à 0,18 $** (le double avec Opus, environ 0,01 $ avec Haiku) |
| Une ébauche (Opus : brief puis 3 écrans) | 0,40 à 0,70 $, seulement pour les prospects au budget validé |
| Le score d'un prospect (Haiku) | moins de 0,001 $ |
| Une accroche (Sonnet) | environ 0,01 $ |

Exemple pour un mois : 300 conversations, 40 ébauches, 1 500 prospects scorés et 300 accroches, soit **environ 70 $ par mois**. Ramené à la capacité du studio (4 à 5 projets par mois), c'est une quinzaine de dollars par projet signé.

Pour comparer avec l'estimation de départ (0,25 à 0,50 € par conversation complète avec Opus) : la conversation passe à environ 0,15 $ avec Sonnet, et Opus reste réservé aux ébauches.

## Garder les coûts sous contrôle

- Le cockpit affiche le coût de l'IA sur 7 et 30 jours ; chaque appel est enregistré avec son coût (table `llm_usage`).
- `AI_MONTHLY_BUDGET_USD` (150 $ par défaut) déclenche une alerte quand le mois dépasse ce montant.
- Un plafond de dépense se règle aussi dans la console Anthropic.
- Une conversation est limitée à 40 réponses de l'IA (`MAX_AI_TURNS_PER_CONVERSATION`) : au-delà, l'équipe prend le relais.
- Si un modèle est saturé, l'API bascule automatiquement sur un modèle de secours (`AI_SERVER_FALLBACK=true`) plutôt que de laisser le prospect sans réponse.

## Comment l'IA est guidée

- **La base de connaissances** (`studio/`) : ce que Nova sait du studio, et la liste de ce qu'elle ne doit jamais affirmer (Android, maintenance, propriété du code, remise…).
- **Le prompt maître** (`prompts/conversation.md`) : mission, 8 règles absolues, style d'écriture DM, déroulé en 6 étapes, cas particuliers.
- **Les outils** : Nova met à jour la fiche, lance l'ébauche, propose et note le rendez-vous, passe la main, clôt, désinscrit. Le moteur applique des garde-fous que le modèle ne peut pas contourner : pas d'ébauche ni d'appel sans budget validé, pas de message hors de la fenêtre de 24 h, présentation en IA ajoutée si le modèle l'oublie, repli vers un humain si le modèle refuse ou répond de travers.
- **Le contexte** : à chaque réponse, le moteur ajoute l'heure, la source de la conversation, la fiche, l'étape et ce qui reste à découvrir.
