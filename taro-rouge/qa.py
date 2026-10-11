"""Controle automatique de chaque image rendue : bords non encres (coupes) et trous."""
import sys, os, json
import numpy as np
from PIL import Image
from controle import defauts, marque
from atelier import sauve

def analyse(dossier, sortie=None, seuil=3):
    res = {}
    pires = []
    for f in sorted(os.listdir(dossier)):
        a = np.asarray(Image.open(os.path.join(dossier, f)).convert('RGBA')).astype(np.float32) / 255
        m, t = defauts(a)
        res[f] = (int(m.sum()), int(t.sum()))
        if m.sum() > seuil or t.sum() > seuil:
            pires.append((m.sum() + t.sum(), f, a, m, t))
    pires.sort(key=lambda x: -x[0])
    if sortie:
        os.makedirs(sortie, exist_ok=True)
        for _, f, a, m, t in pires[:6]:
            sauve(marque(a, m, t), os.path.join(sortie, f))
    return res, [(p[1], int(p[3].sum()), int(p[4].sum())) for p in pires]

if __name__ == '__main__':
    for nom in sys.argv[1:]:
        res, pires = analyse(f'out/qa/{nom}', f'out/qa_pires/{nom}')
        tot_m = sum(v[0] for v in res.values()); tot_t = sum(v[1] for v in res.values())
        print(f'{nom:8s} images {len(res):4d} | bords non encres {tot_m:6d} | trous {tot_t:6d} | images en defaut {len(pires)}')
        for p in pires[:8]:
            print('     ', p)
