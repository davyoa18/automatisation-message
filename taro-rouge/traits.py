"""Traits vectoriels du visage (repere scene, pose de repos). Memes definitions pour l'apercu et le Lottie."""
import numpy as np
from vecteur import Chemin, lisse, trait_effile, interp

INCLINAISON = -10.6          # le visage est tourne : l'oeil droit est plus haut
BOUCHE_C = (706.0, 621.0)    # centre de la bouche (scene)
ENCRE = (0.075, 0.020, 0.018)
GORGE = (0.36, 0.05, 0.05)
LANGUE = (0.93, 0.40, 0.44)
DENTS = (1.0, 0.985, 0.965)


def _rot(deg, centre):
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    cx, cy = centre
    return np.array([[c, -s, cx], [s, c, cy]])


def local(ch, centre=BOUCHE_C, deg=INCLINAISON):
    return ch.transforme(_rot(deg, centre))


# ------------------------------------------------------------------ sourcils
# courbe centrale (coin exterieur -> coin interieur) et largeurs (9 echantillons)
SOURCILS = {
    'colere': {
        'g': ([(386, 382), (474, 381), (564, 422), (642, 474)], [10, 18, 24, 28, 31, 33, 35, 35, 34]),
        'd': ([(942, 300), (864, 326), (784, 380), (720, 438)], [9, 15, 20, 24, 27, 30, 32, 33, 33]),
    },
    'furie': {   # plus bas, plus serres, plus epais
        'g': ([(384, 392), (474, 398), (566, 444), (648, 500)], [12, 20, 27, 31, 34, 36, 38, 38, 37]),
        'd': ([(944, 310), (866, 342), (784, 400), (716, 462)], [11, 17, 23, 27, 30, 33, 35, 36, 36]),
    },
    'pleure': {  # interieur releve (detresse) mais toujours fronce
        'g': ([(388, 384), (476, 384), (566, 414), (640, 448)], [10, 17, 22, 26, 29, 31, 32, 32, 31]),
        'd': ([(940, 298), (862, 318), (786, 362), (724, 414)], [9, 14, 19, 23, 26, 28, 30, 30, 30]),
    },
    'tic': {     # sourcil gauche qui tressaute (un peu plus haut a l'exterieur)
        'g': ([(384, 366), (474, 370), (564, 416), (642, 472)], [10, 18, 24, 28, 31, 33, 35, 35, 34]),
        'd': ([(942, 300), (864, 326), (784, 380), (720, 438)], [9, 15, 20, 24, 27, 30, 32, 33, 33]),
    },
}


def sourcil(cote, etat='colere'):
    c, L = SOURCILS[etat][cote]
    return trait_effile(c, L, n=9)


# plis du front entre les sourcils : deux petits coups de pinceau effiles (larges en bas)
PLIS_K = {'colere': 1.0, 'furie': 1.3, 'pleure': 0.75, 'tic': 1.0, 'repos': 0.0}


def plis(etat='colere'):
    k = PLIS_K[etat]
    a = trait_effile([(668, 436), (673, 418 - 5 * k), (682, 400 - 9 * k)], [7, 6.5, 5.5, 4.5, 3.5, 2.6, 1.8, 1.2, 0.6], n=9)
    b = trait_effile([(694, 448), (701, 431 - 5 * k), (711, 414 - 9 * k)], [7, 6.5, 5.5, 4.5, 3.5, 2.6, 1.8, 1.2, 0.6], n=9)
    return a, b


# ------------------------------------------------------------------ bouches (repere local)
# contour : 8 sommets (coin g, haut g, haut milieu, haut d, coin d, bas d, bas milieu, bas g)
def _bouche(coin_g, haut, coin_d, bas, creux=0.0):
    """haut/bas : (y_g, y_m, y_d) ; coin : (x, y). 'creux' tire les coins vers le bas."""
    v = np.array([
        coin_g,
        ((coin_g[0] * 0.55), haut[0]),
        (0.0, haut[1]),
        ((coin_d[0] * 0.55), haut[2]),
        coin_d,
        ((coin_d[0] * 0.55), bas[2]),
        (0.0, bas[1]),
        ((coin_g[0] * 0.55), bas[0]),
    ], np.float64)
    return lisse(v, ferme=True, tension=0.95)


BOUCHES = {
    # moue renfrognee : arche fermee (haut = bas)
    'moue':    _bouche((-46, 12), (-4, -10, -4), (46, 12), (-4, -10, -4)),
    # dents serrees (grr) : bouche large, peu ouverte
    'grr':     _bouche((-54, 10), (-12, -14, -12), (54, 10), (16, 20, 16)),
    # cri : grande ouverture
    'cri':     _bouche((-74, 4), (-36, -36, -36), (74, 4), (56, 80, 56)),
    # hurlement maximal (rage)
    'hurle':   _bouche((-86, 6), (-42, -40, -42), (86, 6), (68, 94, 68)),
    # sanglot : bouche ouverte, coins tombants
    'sanglot': _bouche((-50, 26), (-20, -8, -20), (50, 26), (38, 60, 38)),
    # petite ouverture (inspiration, renifle)
    'o':       _bouche((-22, 6), (-12, -14, -12), (22, 6), (18, 26, 18)),
}


def bouche(etat):
    return local(BOUCHES[etat])


def _bande(etat, haut=True, ep=0.0):
    """Bande de dents collee au bord haut (ou bas) de la bouche, epaisseur ep (local)."""
    b = BOUCHES[etat]
    idx = [0, 1, 2, 3, 4] if haut else [4, 5, 6, 7, 0]
    bord = b.v[idx]
    bord_i = b.i[idx]
    bord_o = b.o[idx]
    dirn = 1.0 if haut else -1.0
    inner = bord + np.array([0, dirn * ep])
    # resserre la bande aux coins
    inner[0, 0] *= 0.82
    inner[-1, 0] *= 0.82
    inner[0, 1] = bord[0, 1]
    inner[-1, 1] = bord[-1, 1]
    v = np.vstack([bord, inner[::-1]])
    ch = lisse(v, ferme=True, tension=0.8)
    return ch


EP_DENTS_HAUT = {'moue': 0.0, 'grr': 22.0, 'cri': 22.0, 'hurle': 26.0, 'sanglot': 13.0, 'o': 0.0}
EP_DENTS_BAS = {'moue': 0.0, 'grr': 22.0, 'cri': 0.0, 'hurle': 16.0, 'sanglot': 0.0, 'o': 0.0}


def dents_haut(etat):
    return local(_bande(etat, True, EP_DENTS_HAUT[etat]))


def dents_bas(etat):
    return local(_bande(etat, False, EP_DENTS_BAS[etat]))


LANGUES = {
    # langue : ellipse aplatie posee au fond de la bouche (8 sommets)
    'moue': (0, 0, 0, 0), 'grr': (0, 14, 0, 0), 'o': (0, 18, 4, 2),
    'cri': (0, 62, 40, 16), 'hurle': (0, 76, 48, 18), 'sanglot': (0, 46, 30, 12),
}


def langue(etat):
    cx, cy, rx, ry = LANGUES[etat]
    t = np.linspace(0, 2 * np.pi, 8, endpoint=False) + np.pi / 8
    v = np.stack([cx + rx * np.cos(t), cy + ry * np.sin(t)], 1)
    return local(lisse(v, ferme=True, tension=1.05))


def ligne_dents(etat):
    """Jonction des dents (bouche 'grr') : trait ouvert du coin gauche au coin droit, au milieu."""
    b = BOUCHES[etat]
    haut = b.v[[0, 1, 2, 3, 4]]
    bas = b.v[[0, 7, 6, 5, 4]]
    mil = (haut + bas) / 2
    mil[0, 0] *= 0.86
    mil[-1, 0] *= 0.86
    return local(lisse(mil, ferme=False, tension=1.0))


def separations(etat):
    """Deux petites separations verticales entre les dents (bouche 'grr')."""
    b = BOUCHES[etat]
    out = []
    for fx in (-0.36, 0.36):
        x = fx * b.v[4, 0]
        out.append(local(lisse([(x, -7.0), (x * 1.02, 7.0)], ferme=False)))
    return out
