# Taro rouge

La version hardcore de Taro, la mascotte de Talkana : même tanuki, même sweat orange, mais visage rouge et sourcils froncés en permanence.

Aperçu jouable, avec une démo du parcours dans l'app : https://claude.ai/artifact/Jnnf77QhpDYFkfq559gw4Y

## Les animations (`livrable/`)

| Fichier | Cadre | Images | Ce qu'il fait |
| --- | --- | --- | --- |
| `taro_rouge_attente.json` | 1254 | 120, boucle | Il attend en ruminant : souffle lourd, « hmpf » avec deux bouffées par le nez, tic du sourcil, clignement, oreille qui claque |
| `taro_rouge_crie.json` | 1672 | 80 | Grande inspiration, puis il hurle : tête qui grossit, yeux plissés, traits de cri, veine, il reprend son souffle dents serrées |
| `taro_rouge_pleure.json` | 1672 | 104 | Il pleure de rage : lèvre qui tremble, cinq sanglots, ruisseaux de larmes, gouttes projetées en éventail, il renifle et se refâche |
| `taro_rouge_explose.json` | 1672 | 112 | La colère monte, yeux fous, trois sauts rageurs avec impacts, jets de vapeur par les oreilles, puis il halète |
| `taro_rouge_bascule.json` | 1672 | 60 | Le passage en mode hardcore : le Taro normal fronce les sourcils, le rouge lui monte au visage, petit saut, vapeur |
| `taro_rouge_calme.json` | 1672 | 56 | La sortie du mode hardcore : il souffle, le rouge redescend, il redevient le Taro normal |
| `taro_rouge_reactions.json` | 1672 | 421 | Les cinq dans un seul fichier, segments en marqueurs (`crie 0→80`, `pleure 82→186`, `explose 188→300`, `bascule 302→362`, `calme 364→420`) |

`cartes.json` décrit les segments (début, fin, image la plus forte, titre).

Même mécanique que les réactions actuelles de l'app : l'attente occupe, dans le cadre 1672, la sous-fenêtre de 75 % décalée de 12,5 % à gauche et 25 % en haut. Chaque réaction part de la pose de repos et y revient, on peut donc la lancer à tout moment de la boucle. La bascule part du Taro normal (idle d'origine, image 0) et finit sur la pose de repos rouge ; le retour au calme fait l'inverse.

Format bodymovin 5.7, images PNG intégrées, compatible lottie-web et lottie-ios.

## Le parcours prévu dans l'app

1. Mode hardcore disponible (l'utilisateur a payé) : bouton « Taro hardcore ».
2. Tap sur le bouton : `bascule`, puis la boucle `attente` (Taro rouge, énervé même au repos).
3. Chaque réplique de Taro lance au plus une réaction, choisie selon son ton (proposition, à caler sur les vraies répliques) :

| Réplique de Taro | Réaction |
| --- | --- |
| Neutre, il attend la réponse | aucune (attente) |
| Reproche sec, première erreur | `crie` |
| Plaintive, découragée, erreurs en série | `pleure` |
| Outrée, erreur grave ou abandon | `explose` |

   Pas deux fois la même réaction d'affilée ; une réplique qui arrive pendant une réaction attend qu'elle finisse.
4. Sortie du mode hardcore : `calme`, puis l'idle normal.

Le branchement dans le code de Talkana reste à faire : le dépôt de l'app n'était pas accessible depuis la session qui a produit ces fichiers.

## Comment c'est fabriqué

1. **Pièces complètes** (`construit.py`, `exporte.py`, `joint.py`) : les pièces de l'idle d'origine étaient coupées là où elles étaient cachées. Elles sont reconstruites entières (oreilles séparées, menton et cou, queue prolongée en arc sous la joue, dos de capuche), chaque bord visible encré. Les jonctions oreilles / tête et le petit jour de fond sous le menton reproduisent l'original au repos.
2. **Visage** (`tete.py`, `visage.py`, `production.py`) : sourcils et bouche d'origine effacés, rougeur (normale et rage), patchs d'yeux (base, plissés, mi-clos, clos, serrés, fous). Résultat dans `final/`, avec les pièces du Taro normal (`*_normal`) pour la bascule.
3. **Lottie** (`taro_rig.py`, `traits.py`, `effets.py`, `anims.py`, `build.py`) : squelette, sourcils et bouches vectoriels qui se déforment, effets de manga, et les six animations.
4. **Contrôle** (`controle.py`, `stress.py`, `qa.py`, `visib.py`, `visib_carte.py`) : chaque image rendue est vérifiée (aucun bord découpé, aucun trou, rien hors cadre), plus un test du squelette en poses extrêmes et une carte de ce que chaque pièce découvre pendant les animations.

Commandes (Python 3 avec numpy, scipy, opencv, Pillow ; lottie-web et playwright-core pour le rendu) :

- `python3 build.py` regénère les Lottie après une retouche d'animation ;
- `python3 maj_piece.py queue` regénère une seule pièce (rig puis final) ;
- `node render.js livrable/taro_rouge_crie.json sortie/ all 600` rend des images ;
- `python3 video.py` fait la vidéo du parcours complet, `python3 page_donnees.py` prépare `page/donnees.js` et les affiches.

`rig/` garde les pièces complètes du Taro normal (sans rougeur), réutilisables pour corriger les réactions existantes.

Les étapes 1 et 2, la vidéo et la page relisent l'idle d'origine de Talkana (`tanuki_idle`, ses pièces dans `pieces/` et `idle.json`), qui n'est pas versionné ici.
