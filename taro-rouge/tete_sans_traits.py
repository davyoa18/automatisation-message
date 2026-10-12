"""Tete du Taro normal sans ses traits (yeux, sourcils, bouche), pour la bascule et le retour au calme : l'expression
change d'un coup (visage fache des le debut du balayage, ou visage normal a la fin du retour) et le rouge monte ou
descend sous des traits entiers, au lieu de couper deux visages en deux (yeux et bouche hybrides)."""
import json
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi
import production as P
from tete import push_pull

# boites des traits (repere scene) : oeil gauche, oeil droit, sourcil gauche, sourcil droit, bouche
BOITES = {'oeil_g': (390, 408, 612, 642), 'oeil_d': (742, 356, 942, 572), 'sourcil_g': (432, 300, 535, 366),
          'sourcil_d': (722, 248, 812, 300), 'bouche': (636, 564, 782, 682)}


def main():
    fin = json.load(open(f'{P.OUT}/pieces.json'))
    i = fin['tete_normal']
    a = np.asarray(Image.open(f'{P.OUT}/tete_normal.png').convert('RGBA')).astype(np.float32) / 255
    rgb, al = a[..., :3], a[..., 3]
    H, W = al.shape
    L = rgb.mean(-1)
    sat = rgb.max(-1) - rgb.min(-1)
    yy, xx = np.mgrid[0:H, 0:W]
    xs, ys = xx + i['x'], yy + i['y']
    trait = np.zeros((H, W), bool)
    for nom, (x0, y0, x1, y1) in BOITES.items():
        b = (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1) & (al > 0.5)
        if nom.startswith('oeil'):
            # blanc de l'oeil, iris, reflets et contour de l'oeil (plus sombres que le masque brun)
            m = b & ((L > 0.80) & (sat < 0.15) | (L < 0.22))
        elif nom == 'bouche':
            m = b & ((L < 0.25) | ((rgb[..., 0] > 0.8) & (rgb[..., 1] < 0.65)))
        else:
            m = b & (L < 0.30)
        lab, n = ndi.label(m)
        if n:
            tailles = ndi.sum(m, lab, range(1, n + 1))
            m = np.isin(lab, 1 + np.nonzero(tailles >= 0.02 * tailles.max())[0])
            m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=3))
        trait |= m
    zone = ndi.binary_dilation(trait, iterations=5) & (al > 0.5)
    # guide : la tete rouge, deja sans traits, dit ou va le masque (sombre), le museau (clair) et le pelage
    r = np.asarray(Image.open(f'{P.OUT}/tete_rouge.png').convert('RGBA')).astype(np.float32) / 255
    Lr = r[..., :3].mean(-1)
    classe = np.where(Lr < 0.36, 0, np.where(Lr > 0.72, 2, 1))
    classe = ndi.median_filter(classe, size=5)
    ext = (al > 0.9) & ~ndi.binary_dilation(zone, iterations=2) & (L > 0.14)
    F = rgb.copy()
    for c in (0, 1, 2):
        src = ext & (classe == c)
        if src.sum() < 50:
            continue
        Fc = push_pull(rgb, src.astype(np.float32), niveaux=7)
        F = np.where((classe == c)[..., None], Fc, F)
    F = cv2.GaussianBlur(F, (0, 0), 1.2)
    from pieces import grain
    F = F + grain(F.shape, 0.010, 23, flou=1.0)[..., None] * zone[..., None]
    w = np.clip(ndi.distance_transform_edt(zone) / 3.0, 0, 1)[..., None]
    out = a.copy()
    out[..., :3] = rgb * (1 - w) + F * w
    P.sauve_rgba(out, f'{P.OUT}/tete_normal_nu.png')
    P.quantifie(f'{P.OUT}/tete_normal_nu.png')
    fin['tete_normal_nu'] = dict(i)
    json.dump(fin, open(f'{P.OUT}/pieces.json', 'w'), indent=1)
    print('tete_normal_nu', fin['tete_normal_nu'], int(zone.sum()), 'px repeints')


if __name__ == '__main__':
    main()
