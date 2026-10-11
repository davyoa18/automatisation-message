"""Construit toutes les pieces completes et les enregistre (PNG RGBA recadre + position scene)."""
import json, os
from construit import *

os.makedirs('rig', exist_ok=True)


def scelle(img):
    """Rend opaques les micro-trous interieurs (alpha partiel herite de la palette d'origine)."""
    a = img[..., 3]
    S = ndi.binary_closing(a > 0.5, iterations=2)
    inter = ndi.binary_erosion(S, iterations=2)
    out = img.copy()
    out[..., 3] = np.where(inter, 1.0, a)
    return out


def recadre_et_sauve(nom, img):
    img = scelle(img)
    x0, y0, x1, y1 = bbox_alpha(img, marge=3)
    sauve(img[y0:y1, x0:x1], f'rig/{nom}.png')
    return {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}


if __name__ == '__main__':
    info = {}
    Qq, _, _ = queue_complete2()
    info['queue'] = recadre_et_sauve('queue', Qq)
    ore = oreilles_completes()
    info['oreille_g'] = recadre_et_sauve('oreille_g', ore['g'][0])
    info['oreille_d'] = recadre_et_sauve('oreille_d', ore['d'][0])
    Qc, _ = cou()
    Qk, _ = capuche_dos()
    info['capuche'] = recadre_et_sauve('capuche', Qk)
    info['cou'] = recadre_et_sauve('cou', Qc)
    Qt, _, _ = tete_complete()
    info['tete'] = recadre_et_sauve('tete', Qt)
    Qs, _, _ = torse_complet()
    info['torse'] = recadre_et_sauve('torse', Qs)
    json.dump(info, open('rig/pieces.json', 'w'), indent=1)
    print(json.dumps(info))
