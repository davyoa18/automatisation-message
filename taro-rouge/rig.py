"""Compositeur du squelette (verification en Python, independant de Lottie)."""
import json
import numpy as np
import cv2
from PIL import Image

ICI = __file__.rsplit('/', 1)[0]
INFO = json.load(open(f'{ICI}/rig/pieces.json'))
_cache = {}


def piece(nom, dossier='rig'):
    k = (dossier, nom)
    if k not in _cache:
        a = np.asarray(Image.open(f'{ICI}/{dossier}/{nom}.png').convert('RGBA')).astype(np.float32) / 255
        a[..., :3] *= a[..., 3:4]   # premultiplie
        _cache[k] = a
    return _cache[k]


# pivots en repere scene (1254)
PIVOT = {
    'root': (624, 1190), 'tete': (700, 760), 'oreille_g': (352, 352), 'oreille_d': (826, 214),
    'queue': (480, 940), 'cou': (722, 800), 'torse': (624, 1190), 'capuche': (624, 1190),
}
PARENT = {'capuche': 'root', 'tete': 'root', 'oreille_g': 'tete', 'oreille_d': 'tete', 'queue': 'root', 'cou': 'root',
          'torse': 'root', 'root': None}
ORDRE = ['capuche', 'queue', 'oreille_g', 'oreille_d', 'cou', 'tete', 'torse']   # du fond vers l'avant


def mat(t=(0, 0), r=0.0, s=(1, 1), pivot=(0, 0)):
    """Matrice 3x3 : translate(pivot+t) . rot(r) . scale(s) . translate(-pivot)."""
    px, py = pivot
    c, si = np.cos(np.radians(r)), np.sin(np.radians(r))
    T1 = np.array([[1, 0, -px], [0, 1, -py], [0, 0, 1]], np.float64)
    S = np.diag([s[0], s[1], 1.0])
    R = np.array([[c, -si, 0], [si, c, 0], [0, 0, 1]], np.float64)
    T2 = np.array([[1, 0, px + t[0]], [0, 1, py + t[1]], [0, 0, 1]], np.float64)
    return T2 @ R @ S @ T1


def monde(nom, pose):
    p = pose.get(nom, {})
    M = mat(p.get('t', (0, 0)), p.get('r', 0), p.get('s', (1, 1)), PIVOT[nom])
    par = PARENT[nom]
    return (monde(par, pose) @ M) if par else M


def rend(pose, taille=1254, fond=None, cadre=None, sauf=(), dossier='rig', pieces_info=None):
    """pose : {nom: {'t':(dx,dy), 'r':deg, 's':(sx,sy)}}. Renvoie RGBA float non premultiplie."""
    info = pieces_info or INFO
    acc = np.zeros((taille, taille, 4), np.float32)
    for nom in ORDRE:
        if nom in sauf:
            continue
        img = piece(nom, dossier)
        x0, y0 = info[nom]['x'], info[nom]['y']
        M = monde(nom, pose) @ np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], np.float64)
        w = cv2.warpAffine(img, M[:2], (taille, taille), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
        a = w[..., 3:4]
        acc = w + acc * (1 - a)
    out = acc.copy()
    out[..., :3] = acc[..., :3] / np.maximum(acc[..., 3:4], 1e-6)
    if fond is not None:
        f = np.zeros_like(out); f[..., :3] = fond; f[..., 3] = 1
        a = out[..., 3:4]
        f[..., :3] = out[..., :3] * a + f[..., :3] * (1 - a)
        out = f
    return out
