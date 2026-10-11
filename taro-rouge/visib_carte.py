"""Lit les rendus codes de visib.py et dessine, pour chaque piece, ce qui est vu au repos et ce qui
ne se decouvre qu'en animation."""
import json, os, sys
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

ICI = os.path.dirname(os.path.abspath(__file__))
O = f'{ICI}/out/visib'
GROUPES = ['queue', 'tete', 'oreille_g', 'oreille_d', 'cou', 'torse', 'capuche', 'yeux', 'masque']
PIECE = {'queue': 'queue', 'tete': 'tete_rouge', 'oreille_g': 'oreille_g_rouge', 'oreille_d': 'oreille_d_rouge',
         'cou': 'cou', 'torse': 'torse', 'capuche': 'capuche'}


def lit(n, f):
    return [np.asarray(Image.open(f'{O}/{n}_{m}/f{f:04d}.png').convert('RGB')).astype(np.int32) for m in 'abc']


def accumule(n, frames, cartes, qui=None):
    for f in frames:
        a, b, c = lit(n, f)
        vis = (a[..., 2] - b[..., 2]) > 200
        gid = np.round(c[..., 0] / 20.0).astype(int) - 1
        for g, piece in PIECE.items():
            w, h = cartes[g].shape[1], cartes[g].shape[0]
            m = vis & (gid == GROUPES.index(g))
            # on jette les pixels de bord (melange de deux pieces)
            m &= ~ndi.binary_dilation(gid != GROUPES.index(g), iterations=1)
            ys, xs = np.nonzero(m)
            px = np.round(a[ys, xs, 0] / 255.0 * (w - 1)).astype(int)
            py = np.round(a[ys, xs, 1] / 255.0 * (h - 1)).astype(int)
            np.add.at(cartes[g], (py, px), 1)
            if qui is not None:
                np.maximum.at(qui[g], (py, px), f + 1)


def main():
    anims = ['attente', 'bascule', 'calme', 'crie', 'pleure', 'explose']
    repos, tout = {}, {}
    for g, p in PIECE.items():
        im = Image.open(f'{ICI}/final/{p}.png')
        repos[g] = np.zeros((im.size[1], im.size[0]), np.int32)
        tout[g] = np.zeros_like(repos[g])
    accumule('attente', [0], repos)
    par_anim = {}
    for n in anims:
        fr = sorted(int(x[1:5]) for x in os.listdir(f'{O}/{n}_a'))
        c = {g: np.zeros_like(v) for g, v in tout.items()}
        accumule(n, fr, c)
        par_anim[n] = c
        for g in tout:
            tout[g] += c[g]
    os.makedirs(f'{O}/cartes', exist_ok=True)
    for g, p in PIECE.items():
        im = np.asarray(Image.open(f'{ICI}/final/{p}.png').convert('RGBA')).astype(np.float64)
        r = ndi.binary_closing(repos[g] > 0, iterations=3)
        t = ndi.binary_closing(tout[g] > 0, iterations=3)
        nouveau = t & ~ndi.binary_dilation(r, iterations=3)
        fond = np.zeros_like(im[..., :3]); fond[:] = (120, 200, 255)
        al = im[..., 3:4] / 255
        rgb = im[..., :3] * al + fond * (1 - al)
        rgb[~t] = rgb[~t] * 0.3 + fond[~t] * 0.7
        rgb = rgb.astype(np.uint8).copy()
        for m, col in ((r, (0, 200, 0)), (t, (255, 0, 255))):
            cs = cv2.findContours(m.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)[0]
            cv2.drawContours(rgb, cs, -1, col, 1)
        Image.fromarray(rgb).save(f'{O}/cartes/{g}.png')
        np.save(f'{O}/cartes/{g}_nouveau.npy', nouveau)
        np.save(f'{O}/cartes/{g}_repos.npy', r)
        det = ', '.join(f'{n} {int(((par_anim[n][g] > 0) & ~ndi.binary_dilation(r, iterations=3)).sum())}' for n in anims)
        print(f'{g:10s} decouvert hors repos : {int(nouveau.sum()):6d} px  ({det})')


if __name__ == '__main__':
    main()
