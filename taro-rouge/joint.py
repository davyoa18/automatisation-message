"""Joint d'encre entre la queue et le bas de la joue : bande sombre posee sur le haut de la queue,
cachee par la tete au repos. Quand la tete se decolle un peu, on voit un trait plus epais
au lieu d'un mince coin de fond."""
import json
import numpy as np
import cv2
from scipy import ndimage as ndi
from PIL import Image

ICI = __file__.rsplit('/', 1)[0]
N = 1254


def _alpha(nom):
    info = json.load(open(f'{ICI}/final/pieces.json'))[nom]
    a = np.asarray(Image.open(f'{ICI}/final/{nom}.png').convert('RGBA'))[..., 3] > 127
    c = np.zeros((N, N), bool)
    c[info['y']:info['y'] + info['h'], info['x']:info['x'] + info['w']] = a
    return c


def polygone(epaisseur=30.0, recouvre=6.0):
    q = _alpha('queue')
    t = ndi.binary_erosion(_alpha('tete_rouge'), iterations=4)
    xs = np.arange(274, 470, 3)
    haut = np.array([np.nonzero(q[560:, x])[0].min() + 560 for x in xs], np.float64)
    haut = cv2.GaussianBlur(haut.reshape(1, -1).astype(np.float32), (0, 0), 2).ravel()
    bas = haut + recouvre
    sommet = haut - epaisseur
    poly = np.vstack([np.stack([xs, bas], 1), np.stack([xs[::-1], sommet[::-1]], 1)])
    m = np.zeros((N, N), np.uint8)
    cv2.fillPoly(m, [np.round(poly).astype(np.int32)], 1)
    m = (m > 0) & (t | q)          # jamais hors de la tete (sauf sur la queue elle-meme)
    # coin entre le lobe gauche de la queue et la joue
    yy, xx = np.mgrid[0:N, 0:N]
    t0 = _alpha('tete_rouge')
    coin = (xx >= 244) & (xx <= 300) & (yy >= 618) & (yy <= 732) & ndi.binary_dilation(t0, iterations=4) & ~ndi.binary_erosion(q, iterations=7)
    # (la pointe noire entre l'arc et le zigzag de la joue est maintenant peinte dans la queue elle-meme)
    m = coin                          # le haut de la queue remonte maintenant sous la joue : plus de bande
    m = ndi.binary_opening(m, iterations=1)
    cs = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    out = []
    for c in sorted(cs, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < 12:
            continue
        c = cv2.approxPolyDP(c.astype(np.float32), 1.0, True)[:, 0, :].astype(np.float64)
        if len(c) >= 3:
            out.append(c)
    return out


if __name__ == '__main__':
    for p in polygone():
        print(len(p), p.min(0), p.max(0))
