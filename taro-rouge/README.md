# Taro rouge

La version hardcore de Taro, la mascotte de Talkana : même tanuki, même sweat orange, mais visage rouge et sourcils froncés en permanence.

Aperçu jouable : https://claude.ai/artifact/Jnnf77QhpDYFkfq559gw4Y

## Les animations (`livrable/`)

| Fichier | Cadre | Images | Ce qu'il fait |
| --- | --- | --- | --- |
| `taro_rouge_attente.json` | 1254 | 120, boucle | Il attend en ruminant : souffle lourd, « hmpf » avec deux bouffées par le nez, tic du sourcil, clignement, oreille qui claque |
| `taro_rouge_crie.json` | 1672 | 81 | Grande inspiration, puis il hurle : tête qui grossit, yeux plissés, traits de cri, veine, il reprend son souffle dents serrées |
| `taro_rouge_pleure.json` | 1672 | 105 | Il pleure de rage : lèvre qui tremble, cinq sanglots, ruisseaux de larmes, gouttes projetées, il renifle et se refâche |
| `taro_rouge_explose.json` | 1672 | 113 | La colère monte, yeux fous, trois sauts rageurs avec impacts, jets de vapeur par les oreilles, puis il halète |
| `taro_rouge_reactions.json` | 1672 | 301 | Les trois réactions dans un seul fichier, segments en marqueurs (`crie 0→80`, `pleure 82→186`, `explose 188→300`) |

Même mécanique que les réactions actuelles de l'app : l'attente occupe, dans le cadre 1672, la sous-fenêtre de 75 % décalée de 12,5 % à gauche et 25 % en haut. Chaque réaction part de la pose de repos et y revient, on peut donc la lancer à tout moment de la boucle.

Format bodymovin 5.7, images PNG intégrées, compatible lottie-web et lottie-ios.

## Comment c'est fabriqué

1. **Pièces complètes** (`construit.py`, `exporte.py`) : les pièces de l'idle d'origine étaient coupées là où elles étaient cachées. Elles sont reconstruites entières (oreilles séparées, menton et cou, queue prolongée, dos de capuche), chaque bord visible encré.
2. **Visage** (`tete.py`, `visage.py`, `production.py`) : sourcils et bouche d'origine effacés, rougeur (normale et rage), patchs d'yeux (base, plissés, mi-clos, clos, serrés, fous). Résultat dans `final/`.
3. **Lottie** (`taro_rig.py`, `traits.py`, `effets.py`, `anims.py`, `build.py`) : squelette, sourcils et bouches vectoriels qui se déforment, effets de manga, et les quatre animations.
4. **Contrôle** (`controle.py`, `stress.py`, `qa.py`) : chaque image rendue est vérifiée (aucun bord découpé, aucun trou), plus un test du squelette en poses extrêmes.

Pour regénérer les Lottie après une retouche d'animation : `python3 build.py` (Python 3 avec numpy, scipy, opencv, Pillow). Pour rendre des images : `node render.js livrable/taro_rouge_crie.json sortie/ all 600` (lottie-web et playwright-core).

Les étapes 1 et 2 relisent les pièces d'origine extraites de l'idle de Talkana (`tanuki_idle`), dans un dossier `pieces/` non versionné.
