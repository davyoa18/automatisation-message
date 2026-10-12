# Reprise : Taro rouge (« Taro hardcore »)

Fiche à lire en premier dans une nouvelle conversation.

## Où en est le projet

- **Animation : terminée.**
  - Six animations Lottie dans `livrable/` :
    - `attente` : boucle ;
    - `crie`, `pleure`, `explose` : réactions ;
    - `bascule` : Taro normal → rouge ;
    - `calme` : rouge → normal.
  - `taro_rouge_reactions.json` regroupe les cinq réactions. Ses marqueurs : crie 0→80, pleure 82→186, explose 188→300, bascule 302→362, calme 364→420.
  - Cadres : 1254 × 1254 pour l'attente, 1672 × 1672 pour les réactions. Dans le cadre 1672, l'attente occupe une sous-fenêtre de 75 % décalée de (12,5 %, 25 %).
- **Contrôles.**
  - 532 images rendues : 0 bord découpé, rien ne touche le cadre (9 px de marge minimale).
  - Plusieurs revues image par image : plus aucun défaut bloquant.
  - Restent des accrocs de 2 à 3 px, visibles seulement en zoom fort : petite pointe au bout de l'ourlet du short quand le pied est levé, fente de 1 px à l'entrejambe au coup de pied le plus haut de `pleure`.
- **À voir.**
  - `video/taro_rouge_parcours.mp4` : parcours complet.
  - `page/index.html` : page de présentation, à ouvrir dans un navigateur. Elle contient le tableau phrase → réaction proposé.

## Prochaine étape : brancher dans Talkana

1. Ajouter les fichiers de `livrable/` dans l'app (React Native / Expo, `lottie-react-native`).
2. Bouton « Taro hardcore » (après paiement) : jouer `bascule`, puis rester sur `attente` en mode rouge.
3. À chaque phrase de Taro, jouer la réaction qui lui correspond (segment lu dans les marqueurs), puis revenir à `attente`.
   - Une seule réaction par phrase.
   - Jamais deux fois la même réaction d'affilée.
   - Une phrase qui arrive pendant une réaction attend qu'elle finisse.
4. Quitter le mode hardcore : jouer `calme`, puis revenir au Taro normal.
5. Les détails sont dans `README.md`, section « Notes pour le branchement ».

## Refaire les fichiers après une retouche

Python 3 (numpy, scipy, opencv, Pillow), plus Node avec lottie-web et playwright-core pour le rendu.

- `python3 tete_sans_traits.py` : refait la tête normale sans traits, utilisée par la bascule et le retour au calme.
- `python3 retouche_queue.py` : refait la queue, son bouchon, sa bande d'encre et l'ombre de la joue. Remettre d'abord `rig/queue.png` d'origine.
- `python3 export_corps.py` : refait les pièces du corps.
  - `python3 corps/test_repos.py` vérifie que le repos reste fidèle au dessin.
- `SORTIE=livrable python3 build.py` : refait les Lottie.
- `node render.js livrable/taro_rouge_crie.json sortie/ all 600` : rend les images d'une animation.
- `python3 qa.py …` puis `python3 qa_trous.py` : contrôles sur `out/qa/`.

## SSH Vibecode (VS Code, Remote-SSH)

- Hôte `vibecode`.
- HostName `01a08ad0-4be9-70b6-aebb-3d00b0eb8a00.vibecodeapp.io`.
- Utilisateur `vibecode`, port 2222 : à confirmer dans Vibecode.
- Clé privée dans `~/.ssh/vibecode_cloud`, uniquement sur l'ordinateur. Ne jamais la coller dans une conversation.
