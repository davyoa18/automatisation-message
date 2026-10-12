"""Bord droit de la queue contre le petit triangle de fond (sous la joue) : un seul trait en biais, comme
le dessin d'origine (et non une marche d'escalier). Applique aussi aux PNG deja exportes (rig/ et final/)."""
import json
import numpy as np
from scipy import ndimage as ndi

# bord gauche du trait (fourrure brune a gauche), mesure sur le dessin d'origine, repere scene
BORD_TRIANGLE = [(383, 760), (389, 772), (394, 784), (398, 796), (403, 808), (405, 816)]
LARGEUR_TRAIT = 20.0


def borde_triangle(Q):
    """Q : queue RGBA en scene (modifiee sur place)."""
    from tete import push_pull
    from pieces import encre_de
    N = Q.shape[0]
    yy, xx = np.mgrid[0:N, 0:N]
    ys, xs = [p[1] for p in BORD_TRIANGLE], [p[0] for p in BORD_TRIANGLE]
    xL = np.interp(yy, ys, xs)
    opaque = Q[..., 3] > 0.5
    boite = (yy >= ys[0] - 2) & (yy <= ys[-1] + 2) & (xx >= 362) & (xx <= 432) & opaque
    s = xx + 0.5 - xL                                   # > 0 a droite du bord
    ink = encre_de(Q, 0.30)
    voisin = (yy >= 740) & (yy <= 840) & (xx >= 330) & (xx <= 400)
    fourrure = opaque & ~ndi.binary_dilation(ink, iterations=2) & voisin
    F = push_pull(Q[..., :3], fourrure.astype(np.float32), niveaux=5)
    enc = np.median(Q[..., :3][ink & opaque & (xx > 395) & (yy > 760) & (yy < 815)], axis=0)
    cov = np.clip(s + 0.5, 0, 1)[..., None]             # couverture d'encre (bord anticrenele)
    gauche = boite & (s < 1.5) & (s > -14)
    droite = boite & (s >= 1.5) & (s < LARGEUR_TRAIT)
    col = np.where(ink[..., None], F, Q[..., :3]) * (1 - cov) + enc * cov
    Q[..., :3] = np.where(gauche[..., None], col, Q[..., :3])
    Q[..., :3] = np.where(droite[..., None], enc, Q[..., :3])
    return Q


BOITE_BOUCHON = (370, 740, 464, 836)


def bouchon(Q):
    """Piece de fourrure qui bouche le petit triangle de fond (et le trait de bord de queue qui le longe) : elle
    n'apparait que quand la queue ou la tete bougent beaucoup (sinon le triangle se promene, colle sur la queue)."""
    from tete import push_pull
    from pieces import encre_de
    N = Q.shape[0]
    yy, xx = np.mgrid[0:N, 0:N]
    x0, y0, x1, y1 = BOITE_BOUCHON
    boite = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    ys, xs = [p[1] for p in BORD_TRIANGLE], [p[0] for p in BORD_TRIANGLE]
    s = xx + 0.5 - np.interp(yy, ys, xs)
    ferme = ndi.binary_fill_holes(ndi.binary_closing(Q[..., 3] > 0.5, structure=np.ones((3, 3)), iterations=5))
    trou = boite & (Q[..., 3] < 0.5) & ferme
    d_ext = ndi.distance_transform_edt(ferme)
    bande = (s >= -3) & (s < LARGEUR_TRAIT + 4) & (yy >= ys[0] - 4) & (yy <= ys[-1] + 14)
    R = (ndi.binary_dilation(trou, iterations=12) | bande) & boite & ((d_ext > 19) | trou)
    ink = encre_de(Q, 0.30)
    src = (Q[..., 3] > 0.9) & ~ndi.binary_dilation(ink, iterations=2) & ~R & ndi.binary_dilation(R, iterations=30)
    F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=6)
    import cv2
    F = cv2.GaussianBlur(F, (0, 0), 2.0)
    B = np.zeros_like(Q)
    B[..., :3] = F
    # bord gauche (sur la fourrure de la queue) fondu sur 3 px : pas de couture
    fondu = np.clip((s + 3.0) / 3.0, 0, 1)
    B[..., 3] = cv2.GaussianBlur(R.astype(np.float32), (0, 0), 0.8) * R * np.where(bande & ~ndi.binary_dilation(trou, iterations=12), fondu, 1.0)
    # le trou lui-meme est bouche a 100 % (sinon le fond transparait au bord du trou, contre le contour)
    plein_trou = ndi.binary_dilation(trou, iterations=2) & R
    B[..., 3] = np.where(plein_trou, 1.0, B[..., 3])
    return B


if __name__ == '__main__':
    import production as P
    from PIL import Image
    info_r = json.load(open('rig/pieces.json'))
    i = info_r['queue']
    a = np.asarray(Image.open('rig/queue.png').convert('RGBA')).astype(np.float32) / 255
    Q = np.zeros((1254, 1254, 4), np.float32)
    Q[i['y']:i['y'] + i['h'], i['x']:i['x'] + i['w']] = a
    borde_triangle(Q)
    P.sauve_rgba(Q[i['y']:i['y'] + i['h'], i['x']:i['x'] + i['w']], 'rig/queue.png')
    crop, x, y = P.recadre(Q)
    P.sauve_rgba(crop, f'{P.OUT}/queue.png')
    P.quantifie(f'{P.OUT}/queue.png')
    fin = json.load(open(f'{P.OUT}/pieces.json'))
    fin['queue'] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}
    B = bouchon(Q)
    crop, x, y = P.recadre(B)
    P.sauve_rgba(crop, f'{P.OUT}/queue_bouchon.png')
    fin['queue_bouchon'] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}
    json.dump(fin, open(f'{P.OUT}/pieces.json', 'w'), indent=1)
    print('queue', fin['queue'], 'bouchon', fin['queue_bouchon'])
