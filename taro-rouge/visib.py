"""Carte de visibilite des pieces : quelles zones de chaque piece se voient au repos, et lesquelles
ne se decouvrent que pendant les animations. Chaque image de piece est remplacee par une image
codee (R,G = coordonnees dans la piece), on rend trois variantes et on relit les pixels visibles.
Sortie : out/visib/<piece>.png (zones jamais vues assombries, contour vert = vu au repos,
contour magenta = vu au moins une fois)."""
import base64, io, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

ICI = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('SORTIE', 'livrable')
O = f'{ICI}/out/visib'
GROUPES = ['queue', 'tete', 'oreille_g', 'oreille_d', 'cou', 'torse', 'capuche', 'yeux', 'masque']


def groupe(aid):
    n = aid[3:]
    if n.startswith('oeil'):
        return 'yeux'
    for g in GROUPES:
        if n.startswith(g):
            return g
    return 'masque'


def png64(arr):
    b = io.BytesIO()
    Image.fromarray(arr, 'RGBA').save(b, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def variante(d, mode):
    d = json.loads(json.dumps(d))
    for a in d['assets']:
        if 'p' not in a or not str(a['p']).startswith('data:'):
            continue
        im = np.asarray(Image.open(io.BytesIO(base64.b64decode(a['p'].split(',', 1)[1]))).convert('RGBA'))
        h, w = im.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        out = np.zeros((h, w, 4), np.uint8)
        out[..., 3] = im[..., 3]
        if mode in 'ab':
            out[..., 0] = np.round(xx * 255 / max(w - 1, 1))
            out[..., 1] = np.round(yy * 255 / max(h - 1, 1))
            out[..., 2] = 255 if mode == 'a' else 0
        else:
            out[..., 0] = 20 * (GROUPES.index(groupe(a['id'])) + 1)
            out[..., 1] = 0
            out[..., 2] = 255
        a['p'] = png64(out)
    return d


def rend(fichier, dossier, frames, taille):
    subprocess.run(['node', f'{ICI}/render.js', fichier, dossier, frames, str(taille), '#000000'], check=True)


def main():
    os.makedirs(O, exist_ok=True)
    anims = sys.argv[1:] or ['attente', 'bascule', 'calme', 'crie', 'pleure', 'explose']
    tailles = {}
    taches = []
    for n in anims:
        d = json.load(open(f'{ICI}/{SRC}/taro_rouge_{n}.json'))
        for a in d['assets']:
            if 'p' in a:
                tailles[a['id']] = (a['w'], a['h'])
        pas = 4 if n == 'attente' else 2
        frames = ','.join(str(f) for f in range(d['ip'], d['op'], pas))
        taille = d['w'] if n == 'attente' else 1254
        for m in 'abc':
            f = f'{O}/{n}_{m}.json'
            json.dump(variante(d, m), open(f, 'w'))
            taches.append((f, f'{O}/{n}_{m}', frames, taille))
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda t: rend(*t), taches))
    json.dump(tailles, open(f'{O}/tailles.json', 'w'))


if __name__ == '__main__':
    main()
