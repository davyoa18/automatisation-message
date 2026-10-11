"""Controle qualite : bords decoupes exposes et trous, sur une image rendue (RGBA)."""
import numpy as np
from scipy import ndimage as ndi
from atelier import rgb_vers_hsl


def defauts(img, seuil_l=0.30, ignore=None):
    """img RGBA float non premultiplie. Renvoie (bords_non_encres, trous) en masques bool."""
    a = img[..., 3]
    S = a > 0.5
    bord = S & ndi.binary_dilation(~S)
    _, _, l = rgb_vers_hsl(img[..., :3])
    encre = (l < seuil_l) & S
    # un bord est correct si un pixel d'encre est a <= 2 px vers l'interieur
    ok = ndi.binary_dilation(encre, iterations=2)
    mauvais = bord & ~ok
    # trous : zones transparentes entierement enfermees
    trous = ndi.binary_fill_holes(S) & ~S
    # les petits trous de 1-2 px d'anticrenelage ne comptent pas
    lab, n = ndi.label(trous)
    if n:
        tailles = ndi.sum(trous, lab, range(1, n + 1))
        petits = np.isin(lab, 1 + np.nonzero(tailles < 6)[0])
        trous &= ~petits
    if ignore is not None:
        mauvais &= ~ignore
        trous &= ~ignore
    return mauvais, trous


def marque(img, mauvais, trous, fond=(0.85, 0.85, 0.85)):
    out = np.zeros_like(img)
    out[..., :3] = fond
    out[..., 3] = 1
    a = img[..., 3:4]
    out[..., :3] = img[..., :3] * a + out[..., :3] * (1 - a)
    m = ndi.binary_dilation(mauvais, iterations=3)
    t = ndi.binary_dilation(trous, iterations=2)
    out[m, :3] = (1, 0, 1)
    out[t, :3] = (0, 0.8, 1)
    return out
