"""Bord droit de la queue contre le petit triangle de fond (sous la joue) : un seul trait en biais, comme
le dessin d'origine (et non une marche d'escalier). Applique aussi aux PNG deja exportes (rig/ et final/)."""
import json
import numpy as np
from scipy import ndimage as ndi

ENCRE_Q = (0.075, 0.02, 0.018)

# bord gauche du trait (fourrure brune a gauche), mesure sur le dessin d'origine, repere scene
BORD_TRIANGLE = [(371, 736), (377, 748), (383, 760), (389, 772), (394, 784), (398, 796), (403, 808), (405, 816)]
# (au-dessus de y=754, sous le trait de la joue : le trait continue, pas de corne de fourrure quand la tete bouge)
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
    # au-dessus du triangle, sous le trait de la joue (cache au repos) : tout est noir a droite du bord, jusqu'au
    # contour de la queue ; si la tete bouge, on voit le prolongement du trait de joue, pas une corne de fourrure
    haut_ = opaque & (yy >= 734) & (yy < 762) & (xx <= 445) & (s >= 1.5)
    Q[..., :3] = np.where(haut_[..., None], enc, Q[..., :3])
    return Q


BOITE_BOUCHON = (362, 728, 464, 836)


def nettoie_haut(Q):
    """Partie de la queue cachee sous la joue au repos, qui se voit quand la tete se souleve (cri) : coin rentrant
    du contour sans encoche, et sans petits traits egares sur la fourrure."""
    from tete import push_pull
    from pieces import encre_de, lum
    N = Q.shape[0]
    yy, xx = np.mgrid[0:N, 0:N]
    # coin rentrant entre l'arc exterieur et le bord bas : on le referme a l'encre
    coin = (xx >= 418) & (xx < 452) & (yy >= 748) & (yy < 782)
    plein = Q[..., 3] > 0.5
    ferme = ndi.binary_closing(plein, structure=np.ones((3, 3)), iterations=4)
    neuf = (ferme & ~plein & coin) | (coin & ferme & (Q[..., 3] > 0.02) & (Q[..., 3] < 0.995) & (lum(Q) < 0.3))
    enc = np.median(Q[..., :3][encre_de(Q, 0.30) & plein & coin], axis=0) if (encre_de(Q, 0.30) & plein & coin).any() else np.array([0.06, 0.02, 0.02])
    Q[..., :3] = np.where(neuf[..., None], enc, Q[..., :3])
    Q[..., 3] = np.where(neuf, 1.0, Q[..., 3])
    # trait egare sous la joue (repere a la main)
    egare = (xx >= 394) & (xx < 408) & (yy >= 749) & (yy < 760) & (lum(Q) < 0.345) & plein
    if egare.any():
        z = ndi.binary_dilation(egare, iterations=1) & plein
        src = plein & ~z & (lum(Q) >= 0.345) & ndi.binary_dilation(z, iterations=8)
        F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=3)
        Q[..., :3] = np.where(z[..., None], F, Q[..., :3])
    # petits traits sombres isoles sur la fourrure (restes de l'ancien raccord)
    zone = (xx >= 370) & (xx < 470) & (yy >= 730) & (yy < 830)
    fourrure = np.median(lum(Q)[plein & zone & (lum(Q) > 0.2)])
    sombre = (lum(Q) < fourrure - 0.04) & plein & zone
    grand = encre_de(Q, 0.30) & plein
    lab, n = ndi.label(sombre)
    if n:
        tailles = ndi.sum(sombre, lab, np.arange(1, n + 1))
        petits = np.isin(lab, 1 + np.nonzero(tailles < 60)[0])
        # pas les bouts du vrai contour (colles a une grande masse d'encre)
        lab_g, n_g = ndi.label(grand)
        if n_g:
            tg = ndi.sum(grand, lab_g, np.arange(1, n_g + 1))
            gros = np.isin(lab_g, 1 + np.nonzero(tg >= 200)[0])
            petits &= ~ndi.binary_dilation(gros, iterations=2)
        if petits.any():
            z = ndi.binary_dilation(petits, iterations=2) & plein
            src = plein & ~z & ~ndi.binary_dilation(lum(Q) < fourrure - 0.04, iterations=2) & ndi.binary_dilation(z, iterations=12)
            F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=4)
            Q[..., :3] = np.where(z[..., None], F, Q[..., :3])
    return Q


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
    d_trou = ndi.distance_transform_edt(~trou)
    # l'anneau d'encre du bas du trou est aussi bouche (il touche presque le bord de la queue a cet endroit)
    R = (ndi.binary_dilation(trou, iterations=12) | bande) & boite & ((d_ext > 19) | trou | ((d_trou <= 10) & (yy > 785)))
    # la bande noire posee au-dessus du triangle (sous le trait de la joue) est bouchee aussi
    R |= boite & (yy >= 730) & (yy < 764) & (xx <= 445) & (s >= -3) & (Q[..., 3] > 0.5) & (d_ext > 19)
    # le bord adouci du bouchon tombe sur la fourrure, pas sur l'encre de l'anneau du trou
    R |= ndi.binary_dilation(R & (Q[..., :3].mean(-1) < 0.3), iterations=4) & boite & (d_ext > 19)
    ink = encre_de(Q, 0.30)
    from pieces import lum
    voisins = (Q[..., 3] > 0.9) & ~R & ndi.binary_dilation(R, iterations=30)
    fourrure = np.median(lum(Q)[voisins & ~ink])
    src = voisins & ~ndi.binary_dilation(ink | (lum(Q) < fourrure - 0.04), iterations=2)
    F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=6)
    import cv2
    F = cv2.GaussianBlur(F, (0, 0), 2.0)
    B = np.zeros_like(Q)
    B[..., :3] = F
    # bord gauche (sur la fourrure de la queue) fondu sur 3 px : pas de couture
    fondu = np.clip((s + 3.0) / 3.0, 0, 1)
    # bord lisse et anticrenele (le bouchon est visible en permanence en mode rouge : pas de dents de scie contre
    # le trait noir)
    # a droite et en bas du trou, le bouchon s'arrete sur le bord d'encre d'origine du triangle : dans l'anneau du
    # trou, il porte le bord de la queue compose sur la fourrure (opaque : le blanc de l'anticrenelage d'origine ne
    # transparait plus) ; ailleurs (bande du bord de queue a gauche, bande noire au-dessus), bord lisse
    lignes = np.nonzero(trou.any(1))[0]
    haut_trou = lignes.min() if len(lignes) else N
    garde = R   # la fourrure couvre aussi l'anneau d'encre du triangle (sinon son contour reapparait quand la tete monte)
    Rs = cv2.GaussianBlur(garde.astype(np.float32), (0, 0), 1.5)
    A1 = np.clip((Rs - 0.5) * 2.5 + 0.5, 0, 1) * (Rs > 0.02)
    A1 = A1 * np.where(bande & ~ndi.binary_dilation(trou, iterations=12), fondu, 1.0)
    H = ndi.binary_dilation(trou, iterations=3)
    Qa = Q[..., 3:4]
    bord = Q[..., :3] * Qa + F * (1 - Qa)
    melange = A1[..., None] * F + (1 - A1[..., None]) * bord
    B[..., :3] = np.where(H[..., None], melange, F)
    B[..., 3] = np.where(H, 1.0, A1)
    return B


# fente de fond entre joue, queue et epaule aux atterrissages de « explose » (la tete tasse vibre et laisse
# une fente d'1 image) : bande d'encre sous la queue, a droite de son bord, jamais visible au repos
BOITE_FENTE = (434, 738, 471, 777)


def encre_fente(Q):
    N = Q.shape[0]
    yy, xx = np.mgrid[0:N, 0:N]
    x0, y0, x1, y1 = BOITE_FENTE
    op = Q[..., 3] > 0.5
    ferme = ndi.binary_fill_holes(ndi.binary_closing(op, structure=np.ones((3, 3)), iterations=5))
    R = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1) & ~ferme
    B = np.zeros_like(Q)
    B[..., :3] = ENCRE_Q
    B[..., 3] = R.astype(np.float32)
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
    nettoie_haut(Q)
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
    Bf = encre_fente(Q)
    crop, x, y = P.recadre(Bf)
    P.sauve_rgba(crop, f'{P.OUT}/queue_encre.png')
    fin['queue_encre'] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}
    json.dump(fin, open(f'{P.OUT}/pieces.json', 'w'), indent=1)
    print('queue', fin['queue'], 'bouchon', fin['queue_bouchon'])
