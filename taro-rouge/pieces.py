"""Reconstruit des pieces COMPLETES pour Taro, dans le repere de la scene idle (1254 x 1254).
Chaque bord visible d'une piece doit etre un trait d'encre ; les zones cachees sont repeintes
pour que rien ne se troue quand les pieces bougent."""
import numpy as np
import cv2
from scipy import ndimage as ndi
from atelier import charge, sauve, compose, rgb_vers_hsl

N = 1254
# positions de repos des pieces d'origine dans la scene idle
POS = {
    'idle_head': (94, 30), 'idle_torso': (358, 681), 'idle_tail': (45, 623),
    'idle_tailfill': (68, 623), 'idle_filler': (95, 607),
}
SS = 4


def vide():
    return np.zeros((N, N, 4), np.float32)


def place(nom):
    c = vide()
    compose(c, charge(nom), *POS[nom])
    return c


def lum(img):
    return rgb_vers_hsl(img[..., :3])[2]


def encre_de(img, seuil=0.24):
    return (lum(img) < seuil) & (img[..., 3] > 0.5)


def masque_poly(pts, taille=(N, N)):
    c = np.zeros((taille[1] * SS, taille[0] * SS), np.uint8)
    cv2.fillPoly(c, [np.round(np.asarray(pts, np.float64) * SS).astype(np.int32)], 255, cv2.LINE_AA)
    return cv2.resize(c, taille, interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def masque_trait(pts, epais, taille=(N, N)):
    c = np.zeros((taille[1] * SS, taille[0] * SS), np.uint8)
    pts = np.asarray(pts, np.float64)
    if np.isscalar(epais):
        epais = [epais] * len(pts)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ea, eb = epais[i], epais[i + 1]
        d = b - a
        L = np.hypot(*d) + 1e-9
        nrm = np.array([-d[1], d[0]]) / L
        poly = np.array([a + nrm * ea / 2, b + nrm * eb / 2, b - nrm * eb / 2, a - nrm * ea / 2]) * SS
        cv2.fillPoly(c, [np.round(poly).astype(np.int32)], 255, cv2.LINE_AA)
        cv2.circle(c, tuple(np.round(a * SS).astype(int)), int(round(ea / 2 * SS)), 255, -1, cv2.LINE_AA)
        cv2.circle(c, tuple(np.round(b * SS).astype(int)), int(round(eb / 2 * SS)), 255, -1, cv2.LINE_AA)
    return cv2.resize(c, taille, interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def bezier3(p0, p1, p2, p3, n=60):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(lambda p: np.asarray(p, np.float64), (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def chemin(*segments):
    """Concatene des segments de bezier cubiques [(p0,p1,p2,p3), ...]."""
    pts = [bezier3(*s) for s in segments]
    return np.vstack([pts[0]] + [p[1:] for p in pts[1:]])


ENCRE = np.array([0.075, 0.020, 0.018], np.float32)


def grain(shape, ampl, graine, flou=0.7):
    rng = np.random.default_rng(graine)
    g = rng.normal(0, 1, shape[:2]).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), flou)
    g /= g.std() + 1e-9
    m = rng.normal(0, 1, (shape[0] // 24 + 2, shape[1] // 24 + 2)).astype(np.float32)
    m = cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)
    m = cv2.GaussianBlur(m, (0, 0), 6)
    m /= m.std() + 1e-9
    return (g * 0.9 + m * 0.25) * ampl


def repeint(img, zone, source=None, graine=1, rayon=8, ampl=None, marge=60):
    """Repeint 'zone' (bool) par inpainting depuis les pixels opaques voisins, avec grain.
    Travaille dans une fenetre autour de la zone."""
    ys, xs = np.nonzero(zone)
    if len(xs) == 0:
        return img
    H, W = zone.shape
    x0, x1 = max(0, xs.min() - marge), min(W, xs.max() + marge + 1)
    y0, y1 = max(0, ys.min() - marge), min(H, ys.max() + marge + 1)
    sous = _repeint(img[y0:y1, x0:x1], zone[y0:y1, x0:x1],
                    None if source is None else source[y0:y1, x0:x1], graine, rayon, ampl)
    out = img.copy()
    out[y0:y1, x0:x1] = sous
    return out


def _repeint(img, zone, source, graine, rayon, ampl):
    rgb = img[..., :3].copy()
    a = img[..., 3]
    connu = (a > 0.6) & ~zone
    if source is not None:
        connu &= source
    rgb8 = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    inc = (~connu).astype(np.uint8) * 255
    plein = cv2.inpaint(rgb8, inc, rayon, cv2.INPAINT_TELEA).astype(np.float32) / 255
    # detail haute frequence copie depuis la peinture connue voisine (grain + marbrure)
    flou = cv2.GaussianBlur(rgb, (0, 0), 3.0)
    hp = rgb - flou
    # sources de texture : loin de tout bord (pas de copie de contours de rayures)
    Lf = cv2.GaussianBlur(rgb.mean(-1), (0, 0), 1.5)
    gx = cv2.Sobel(Lf, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(Lf, cv2.CV_32F, 0, 1, ksize=3)
    calme = np.hypot(gx, gy) < 0.10
    calme = ndi.binary_erosion(calme, iterations=5)
    tex_ok = connu & calme
    det = np.zeros_like(rgb)
    fait = np.zeros(zone.shape, bool)
    H, W = zone.shape
    rng = np.random.default_rng(graine)
    for r in (18, 30, 44, 60, 80, 104, 132, 170, 220):
        angs = rng.permutation(12) * (np.pi / 6) + rng.uniform(0, np.pi / 6)
        for t in angs:
            dx, dy = int(round(r * np.cos(t))), int(round(r * np.sin(t)))
            ys, xs = np.nonzero(zone & ~fait)
            if len(xs) == 0:
                break
            sx, sy = xs + dx, ys + dy
            ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
            ok[ok] &= tex_ok[sy[ok], sx[ok]]
            # evite de copier le grain d'un trait d'encre
            det[ys[ok], xs[ok]] = hp[sy[ok], sx[ok]]
            fait[ys[ok], xs[ok]] = True
    reste = zone & ~fait
    if reste.any():
        if ampl is None:
            ampl = 0.012
        g = grain(img.shape, ampl, graine)
        det[reste] = (g[..., None] * np.array([1.0, 0.92, 0.85], np.float32))[reste]
    det = np.clip(det, -0.045, 0.045)
    plein = plein + det
    out = img.copy()
    zf = zone.astype(np.float32)
    out[..., :3] = rgb * (1 - zf[..., None]) + plein * zf[..., None]
    out[..., 3] = np.maximum(a, zf)
    return out


def encre_sur(img, masque):
    """Peint de l'encre (masque float) sur l'image et rend opaque."""
    m = np.clip(masque, 0, 1)[..., None]
    out = img.copy()
    # couleur sous l'encre : si transparent, l'encre seule
    out[..., :3] = img[..., :3] * (1 - m) + ENCRE * m
    out[..., 3] = np.maximum(img[..., 3], masque)
    # la ou l'image etait transparente, la couleur doit etre l'encre pure
    t = img[..., 3] < 0.05
    out[t, :3] = ENCRE
    return out


def coupe(img, masque_garde):
    out = img.copy()
    out[..., 3] = img[..., 3] * np.clip(masque_garde, 0, 1)
    return out


def bbox_alpha(img, marge=2):
    ys, xs = np.nonzero(img[..., 3] > 0.003)
    x0, x1 = max(0, xs.min() - marge), min(N, xs.max() + 1 + marge)
    y0, y1 = max(0, ys.min() - marge), min(N, ys.max() + 1 + marge)
    return x0, y0, x1, y1


def masque_poly_ss(pts, taille=(N, N), ss=SS):
    """Masque binaire sur-echantillonne (pour distances precises)."""
    c = np.zeros((taille[1] * ss, taille[0] * ss), np.uint8)
    cv2.fillPoly(c, [np.round(np.asarray(pts, np.float64) * ss).astype(np.int32)], 1, cv2.LINE_8)
    return c.astype(bool)


def complete(T, confiance, zones_ajout, epais=19.0, encre_seuil=0.24, graine=3, retire=None, rayon=9):
    """Complete une piece.
    T          : image RGBA (scene) de depart
    confiance  : bool, pixels gardes tels quels
    zones_ajout: liste de polygones (points scene) a ajouter a la silhouette
    retire     : liste de polygones a retirer de la silhouette (optionnel)
    Renvoie (image completee, silhouette bool)."""
    H, W = T.shape[:2]
    ss = 2
    sil_ss = np.zeros((H * ss, W * ss), bool)
    for p in zones_ajout:
        sil_ss |= masque_poly_ss(p, (W, H), ss)
    conf_ss = cv2.resize(confiance.astype(np.uint8), (W * ss, H * ss), interpolation=cv2.INTER_NEAREST).astype(bool)
    sil_ss |= conf_ss
    if retire:
        for p in retire:
            sil_ss &= ~masque_poly_ss(p, (W, H), ss)
    sil_ss = ndi.binary_fill_holes(sil_ss)
    sil_f = cv2.resize(sil_ss.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA)
    sil = sil_f > 0.5
    zone = sil & ~confiance
    ink_conf = confiance & encre_de(T, encre_seuil)
    src = confiance & ~encre_de(T, 0.30)
    Q = repeint(T, zone, source=src, graine=graine, rayon=rayon)
    # alpha : silhouette anticrenelee, mais les pixels de confiance gardent leur alpha d'origine
    a = np.where(confiance, T[..., 3], sil_f)
    a = np.where(zone, np.maximum(sil_f, 0), a)
    Q[..., 3] = np.clip(a, 0, 1)
    # --- encrage automatique des bords neufs ---
    bord_ss = sil_ss & ~ndi.binary_erosion(sil_ss)
    ink_c_ss = cv2.resize(ink_conf.astype(np.uint8), (W * ss, H * ss), interpolation=cv2.INTER_NEAREST).astype(bool)
    deja = bord_ss & ink_c_ss
    a_encrer = bord_ss & ~ink_c_ss
    # epaisseur du trait d'origine aux bords deja encres : distance vers l'interieur non encre
    interieur_ss = conf_ss & ~ink_c_ss
    d_vers_int = ndi.distance_transform_edt(~interieur_ss)
    ep_deja = np.where(deja, np.clip(d_vers_int, 4 * ss, 26 * ss), 0).astype(np.float32)
    # moyenne locale (convolution normalisee) pour une mesure robuste
    num = cv2.GaussianBlur(ep_deja, (0, 0), 8 * ss)
    den = cv2.GaussianBlur(deja.astype(np.float32), (0, 0), 8 * ss)
    ep_lisse = np.where(den > 1e-4, num / np.maximum(den, 1e-6), 18.0 * ss)
    # pour chaque pixel de bord a encrer : bord deja encre le plus proche et sa distance
    dd, (jy, jx) = ndi.distance_transform_edt(~deja, return_indices=True)
    ep_proche = np.clip(ep_lisse[jy, jx], 4 * ss, 26 * ss)
    wloc = np.exp(-dd / (45.0 * ss))
    if callable(epais):
        gy, gx = np.mgrid[0:H * ss, 0:W * ss].astype(np.float32) / ss
        ep_def = epais(gx, gy) * ss
    else:
        ep_def = epais * ss
    ep_bord = wloc * ep_proche + (1 - wloc) * ep_def
    # distance interieure au bord, et point de bord le plus proche
    d_in, (iy, ix) = ndi.distance_transform_edt(~bord_ss, return_indices=True)
    besoin = a_encrer[iy, ix] & sil_ss
    e = ep_bord[iy, ix]
    w_ss = np.clip(e + 0.5 - d_in, 0, 1) * besoin
    w = cv2.resize(w_ss.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA)
    sel = ink_conf & (lum(T) < 0.10)
    couleur = np.median(T[..., :3][sel], axis=0) if sel.sum() > 50 else ENCRE
    Q[..., :3] = Q[..., :3] * (1 - w[..., None]) + couleur * w[..., None]
    return Q, sil


def catmull(points, n_par_seg=16):
    """Courbe lisse (Catmull-Rom centripete simplifiee) passant par les points."""
    P = np.asarray(points, np.float64)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t = np.linspace(0, 1, n_par_seg, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2][None])
    return np.vstack(out)


def decale(courbe, d):
    """Decale une polyligne de d pixels le long de sa normale gauche (sens de parcours)."""
    c = np.asarray(courbe, np.float64)
    t = np.gradient(c, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([t[:, 1], -t[:, 0]], 1)
    return c + nrm * d
