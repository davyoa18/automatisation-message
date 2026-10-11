"""Detecte les bords decoupes d'une piece : bord de l'alpha qui n'est pas un trait d'encre."""
import sys
import numpy as np
from scipy import ndimage as ndi
from atelier import charge, sauve, rgb_vers_hsl

def bords_coupes(img, seuil_l=0.30):
    a = img[..., 3]
    opaque = a > 0.5
    vide = a < 0.15
    voisin_vide = ndi.binary_dilation(vide, structure=np.ones((3, 3)))
    bord = opaque & voisin_vide
    _, _, l = rgb_vers_hsl(img[..., :3])
    # un vrai contour : le pixel ou un voisin proche (2 px vers l'interieur) est de l'encre
    encre = (l < seuil_l) & opaque
    encre_proche = ndi.binary_dilation(encre, iterations=2)
    return bord & ~encre_proche, bord

if __name__ == '__main__':
    for nom in sys.argv[1:]:
        img = charge(nom)
        coupe, bord = bords_coupes(img)
        vis = np.zeros_like(img); vis[..., :3] = 0.55; vis[..., 3] = 1
        a = img[..., 3:4]
        vis[..., :3] = vis[..., :3] * (1 - a) + img[..., :3] * a
        k = ndi.binary_dilation(coupe, iterations=2)
        vis[k, :3] = (0, 1, 1)
        sauve(vis, f'out/coupes_{nom}.png')
        print(nom, img.shape[1], 'x', img.shape[0], 'bord', int(bord.sum()), 'coupe', int(coupe.sum()))
