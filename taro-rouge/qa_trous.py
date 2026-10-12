"""Trous inattendus (fond visible a l'interieur de la silhouette) hors du petit triangle entre joue et epaule."""
import numpy as np, os, sys
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from controle import defauts
import anims
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'revue3'))
from prepare import matrices

for nom in ('attente', 'crie', 'pleure', 'explose', 'bascule', 'calme'):
    dec = (0, 0) if nom == 'attente' else (209, 418)
    tl = anims.TOUTES[nom]()
    autres = []
    for f in sorted(os.listdir(f'out/qa/{nom}')):
        t = int(f[1:5])
        a = np.asarray(Image.open(f'out/qa/{nom}/{f}').convert('RGBA')).astype(np.float32) / 255
        m, tr = defauts(a)
        lab, n = ndi.label(tr)
        if not n:
            continue
        Mr, Mt = matrices(tl, t)
        Mi = np.linalg.inv(Mt)
        for i, sl in enumerate(ndi.find_objects(lab)):
            ys, xs = np.nonzero(lab[sl] == i + 1)
            cx, cy = xs.mean() + sl[1].start - dec[0], ys.mean() + sl[0].start - dec[1]
            p = Mi @ np.array([cx, cy, 1.0])
            if 330 < p[0] < 470 and 640 < p[1] < 840:
                continue
            autres.append((t, int(len(xs)), int(p[0]), int(p[1])))
    print(nom, len(autres), autres[:8])
