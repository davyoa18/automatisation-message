"""Formes vectorielles partagees entre l'apercu Python et le Lottie.
Un chemin = sommets v, tangentes entrantes i et sortantes o (relatives, convention Lottie), ferme ou non."""
import numpy as np
import cv2

SS = 4


class Chemin:
    def __init__(self, v, i=None, o=None, ferme=True):
        self.v = np.asarray(v, np.float64)
        n = len(self.v)
        self.i = np.zeros((n, 2)) if i is None else np.asarray(i, np.float64)
        self.o = np.zeros((n, 2)) if o is None else np.asarray(o, np.float64)
        self.ferme = ferme

    def copie(self):
        return Chemin(self.v.copy(), self.i.copy(), self.o.copy(), self.ferme)

    def decale(self, dx, dy):
        c = self.copie()
        c.v += [dx, dy]
        return c

    def transforme(self, M):
        """M : matrice 2x3 affine (appliquee aux sommets, partie lineaire aux tangentes)."""
        c = self.copie()
        A = np.asarray(M)[:, :2]
        b = np.asarray(M)[:, 2]
        c.v = c.v @ A.T + b
        c.i = c.i @ A.T
        c.o = c.o @ A.T
        return c

    def echantillons(self, n=24):
        pts = []
        m = len(self.v)
        segs = m if self.ferme else m - 1
        for k in range(segs):
            a = self.v[k]
            b = self.v[(k + 1) % m]
            p1 = a + self.o[k]
            p2 = b + self.i[(k + 1) % m]
            t = np.linspace(0, 1, n, endpoint=False)[:, None]
            pts.append((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * b)
        if not self.ferme:
            pts.append(self.v[-1][None])
        return np.vstack(pts)

    def lottie(self):
        return {'i': np.round(self.i, 3).tolist(), 'o': np.round(self.o, 3).tolist(),
                'v': np.round(self.v, 3).tolist(), 'c': bool(self.ferme)}


def lisse(points, ferme=False, tension=1.0):
    """Chemin lisse passant par les points (tangentes Catmull-Rom)."""
    P = np.asarray(points, np.float64)
    n = len(P)
    T = np.zeros_like(P)
    for k in range(n):
        if ferme:
            a, b = P[(k - 1) % n], P[(k + 1) % n]
        else:
            a = P[max(k - 1, 0)]
            b = P[min(k + 1, n - 1)]
        T[k] = (b - a) / 2.0 * tension
    if not ferme:
        T[0] = (P[1] - P[0]) * 0.5 * tension
        T[-1] = (P[-1] - P[-2]) * 0.5 * tension
    return Chemin(P, -T / 3.0, T / 3.0, ferme)


def trait_effile(centre, largeurs, n=9):
    """Forme fermee d'un trait a epaisseur variable le long d'une courbe centrale (points).
    'largeurs' : liste de n largeurs (ou fonction t->largeur). Renvoie un Chemin ferme
    a nombre de sommets fixe (2n), donc morphable."""
    c = lisse(centre).echantillons(64)
    seg = np.hypot(*np.diff(c, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    ts = np.linspace(0, s[-1], n)
    pts = np.stack([np.interp(ts, s, c[:, 0]), np.interp(ts, s, c[:, 1])], 1)
    tg = np.gradient(pts, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-tg[:, 1], tg[:, 0]], 1)
    if callable(largeurs):
        L = np.array([largeurs(t) for t in np.linspace(0, 1, n)])
    else:
        L = np.asarray(largeurs, np.float64)
    haut = pts + nrm * (L[:, None] / 2)
    bas = pts - nrm * (L[:, None] / 2)
    contour = np.vstack([haut, bas[::-1]])
    return lisse(contour, ferme=True, tension=0.9)


def interp(a, b, t):
    """Interpolation lineaire entre deux chemins de meme topologie."""
    return Chemin(a.v * (1 - t) + b.v * t, a.i * (1 - t) + b.i * t, a.o * (1 - t) + b.o * t, a.ferme)


# ---------------------------------------------------------------- rendu Python (apercu)
def _poly_ss(ch, H, W):
    pts = ch.echantillons(28) * SS
    m = np.zeros((H * SS, W * SS), np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 255, cv2.LINE_AA)
    return m


def remplit(canvas, ch, couleur, opacite=1.0):
    H, W = canvas.shape[:2]
    m = _poly_ss(ch, H, W)
    a = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255 * opacite
    peint(canvas, a, couleur)


def contour(canvas, ch, couleur, largeur, opacite=1.0):
    H, W = canvas.shape[:2]
    pts = ch.echantillons(28)
    if ch.ferme:
        pts = np.vstack([pts, pts[:1]])
    m = np.zeros((H * SS, W * SS), np.uint8)
    p = np.round(pts * SS).astype(np.int32)
    cv2.polylines(m, [p], False, 255, int(round(largeur * SS)), cv2.LINE_AA)
    r = int(round(largeur * SS / 2))
    for q in (p[0], p[-1]):
        cv2.circle(m, tuple(q), r, 255, -1, cv2.LINE_AA)
    a = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255 * opacite
    peint(canvas, a, couleur)


def peint(canvas, a, couleur):
    c = np.asarray(couleur, np.float32)
    ca = canvas[..., 3]
    oa = a + ca * (1 - a)
    canvas[..., :3] = (c * a[..., None] + canvas[..., :3] * (ca * (1 - a))[..., None]) / np.maximum(oa, 1e-6)[..., None]
    canvas[..., 3] = oa
