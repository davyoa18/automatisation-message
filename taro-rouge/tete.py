"""Fabrique la tete de Taro rouge : rougeur, sourcils et bouche d'origine effaces,
paupieres en colere. Toutes les coordonnees sont celles de la piece 'head' (1104 x 724)."""
import numpy as np
import cv2
from scipy import ndimage as ndi
from atelier import charge, sauve, zones, rgb_vers_hsl, hsl_vers_rgb, OEIL_G, OEIL_D, masque_ellipse

SS = 4  # sur-echantillonnage pour l'anticrenelage

ORIG = charge('idle_head')
H, W = ORIG.shape[:2]
Z, (HH, SSAT, LL) = zones(ORIG)
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)

# composantes d'encre (cf. analyse) : sourcils, bouche
_e = (Z['encre'] > 0).astype(np.uint8)
_n, LAB, ST, _c = cv2.connectedComponentsWithStats(_e, connectivity=8)


def _comp_contenant(x, y):
    return LAB == LAB[y, x]


def _lisse(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def oeil_plein(oeil, comp_pts):
    """Masque complet de l'oeil (anneau d'encre compris) a partir de l'ellipse et des composantes."""
    m = masque_ellipse(ORIG.shape, oeil, marge=3) > 0.5
    for (x, y) in comp_pts:
        m |= _comp_contenant(x, y)
    # tout le blanc de l'oeil (le croissant du bas deborde de l'ellipse)
    bl, _n = ndi.label(Z['blanc'] > 0)
    for k in np.unique(bl[m & (bl > 0)]):
        comp = bl == k
        if comp.sum() > 500:
            m |= comp
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_closing(m, iterations=6)
    m = ndi.binary_fill_holes(m)
    return m


# points appartenant a l'anneau superieur et a l'iris de chaque oeil
OEIL_G_PLEIN = oeil_plein(OEIL_G, [(int(ST[13][0] + ST[13][2] / 2), int(ST[13][1] + 4)), (434, 502)])
OEIL_D_PLEIN = oeil_plein(OEIL_D, [(int(ST[10][0] + ST[10][2] / 2), int(ST[10][1] + 4)), (724, 448)])


def masque_trait(pts, epais, taille=(W, H), ferme=False, extremites=True):
    """Trait polyligne anticrenele, epaisseur variable possible (liste ou scalaire)."""
    c = np.zeros((taille[1] * SS, taille[0] * SS), np.uint8)
    pts = np.asarray(pts, np.float64)
    if np.isscalar(epais):
        epais = [epais] * len(pts)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ea, eb = epais[i], epais[i + 1]
        # segment en trapeze + disques aux extremites pour un trait a epaisseur variable
        d = b - a
        L = np.hypot(*d) + 1e-9
        nrm = np.array([-d[1], d[0]]) / L
        poly = np.array([a + nrm * ea / 2, b + nrm * eb / 2, b - nrm * eb / 2, a - nrm * ea / 2]) * SS
        cv2.fillPoly(c, [np.round(poly).astype(np.int32)], 255, cv2.LINE_AA)
        cv2.circle(c, tuple(np.round(a * SS).astype(int)), int(ea / 2 * SS), 255, -1, cv2.LINE_AA)
        cv2.circle(c, tuple(np.round(b * SS).astype(int)), int(eb / 2 * SS), 255, -1, cv2.LINE_AA)
    return cv2.resize(c, taille, interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def masque_poly(pts, taille=(W, H)):
    c = np.zeros((taille[1] * SS, taille[0] * SS), np.uint8)
    cv2.fillPoly(c, [np.round(np.asarray(pts) * SS).astype(np.int32)], 255, cv2.LINE_AA)
    return cv2.resize(c, taille, interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def bezier(p0, p1, p2, n=40):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2 = map(np.asarray, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


def bezier3(p0, p1, p2, p3, n=48):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.asarray, (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def grain(shape, ampl, graine, flou=0.7):
    rng = np.random.default_rng(graine)
    g = rng.normal(0, 1, shape[:2]).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), flou)
    g /= g.std() + 1e-9
    # un peu de marbrure basse frequence, comme la peinture d'origine
    m = rng.normal(0, 1, (shape[0] // 24 + 2, shape[1] // 24 + 2)).astype(np.float32)
    m = cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)
    m = cv2.GaussianBlur(m, (0, 0), 6)
    m /= m.std() + 1e-9
    return (g * 0.9 + m * 0.25) * ampl


def repeint(img, masque, graine=1, ampl=None, rayon=6):
    """Remplit la zone 'masque' (bool) par inpainting + grain assorti au voisinage."""
    rgb8 = np.clip(img[..., :3] * 255, 0, 255).astype(np.uint8)
    m8 = (masque > 0).astype(np.uint8) * 255
    m8 = cv2.dilate(m8, np.ones((3, 3), np.uint8), iterations=2)
    out = cv2.inpaint(rgb8, m8, rayon, cv2.INPAINT_TELEA).astype(np.float32) / 255
    mm = m8 > 0
    if ampl is None:
        # bruit du voisinage (anneau autour de la zone)
        ann = cv2.dilate(m8, np.ones((3, 3), np.uint8), iterations=14) > 0
        ann &= ~mm
        lum = img[..., :3].mean(-1)
        ann &= (lum > 0.22)  # ignore l'encre
        hp = lum - cv2.GaussianBlur(lum, (0, 0), 2.0)
        ampl = float(np.median(np.abs(hp[ann])) * 1.25) if ann.any() else 0.01
    g = grain(img.shape, ampl, graine)
    out = out + g[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
    # transition douce sur le bord de la zone
    w = cv2.GaussianBlur(mm.astype(np.float32), (0, 0), 1.2)
    w = np.maximum(w, mm.astype(np.float32))
    res = img.copy()
    res[..., :3] = img[..., :3] * (1 - w[..., None]) + out * w[..., None]
    return res


def efface_traits(img):
    """Efface les sourcils et la bouche d'origine (garde la truffe)."""
    for i in (8, 9):
        m = ndi.binary_dilation(LAB == i, iterations=3)
        img = repeint(img, m, graine=i)
    m = LAB == 19
    x, y, w, h = ST[19][:4]
    box = np.zeros_like(m)
    box[y - 4:y + h + 30, x - 6:x + w + 6] = True
    rose = (Z['rose'] > 0) | ((HH < 20) & (LL > 0.45) & (LL < 0.85) & (SSAT > 0.4))
    interieur = ndi.binary_fill_holes(m | (rose & box))
    # enveloppe convexe de toute la bouche (contour + langue + ombre de la langue)
    pts = np.argwhere(interieur | (rose & box))[:, ::-1].astype(np.int32)
    hull = cv2.convexHull(pts)
    env = np.zeros(m.shape, np.uint8)
    cv2.fillPoly(env, [hull], 1)
    m = ndi.binary_dilation(env.astype(bool) | interieur, iterations=5)
    m &= ~ndi.binary_dilation(LAB == 15, iterations=2)   # sans toucher la truffe
    # la truffe est repeinte avec la bouche (pour ne pas baver d'encre), puis recollee telle quelle
    truffe = ndi.binary_dilation(LAB == 15, iterations=3)
    res = repeint(img, m | truffe, graine=19)
    wt = cv2.GaussianBlur(ndi.binary_dilation(LAB == 15, iterations=2).astype(np.float32), (0, 0), 0.9)
    wt = np.clip(wt * 1.6, 0, 1)[..., None]
    res[..., :3] = res[..., :3] * (1 - wt) + ORIG[..., :3] * wt
    return res


def texture_masque(img, oeil_plein, graine):
    """Remplit tout l'oeil de texture du masque brun (comme si la paupiere etait close)."""
    m = ndi.binary_dilation(oeil_plein, iterations=2)
    return repeint(img, m, graine=graine, rayon=10)


ENCRE = np.array([0.075, 0.020, 0.018], np.float32)


def paupiere(img, oeil_plein, courbe, epais, graine, couvre_dessous=False):
    """Paupiere en colere : tout ce qui est au-dessus de 'courbe' (dans l'oeil) devient masque,
    puis un trait d'encre epais suit la courbe. 'courbe' va du coin exterieur au coin interieur
    (ou l'inverse), points (x,y)."""
    courbe = np.asarray(courbe, np.float64)
    tex = texture_masque(img, oeil_plein, graine)
    # demi-plan au-dessus de la courbe : polygone ferme vers le haut
    a, b = courbe[0], courbe[-1]
    d = b - a
    d = d / np.hypot(*d)
    ext_a = a - d * 120
    ext_b = b + d * 120
    haut = np.array([0, -1.0]) * 400
    poly = np.vstack([[ext_a + haut], [ext_a], courbe, [ext_b], [ext_b + haut]])
    dessus = masque_poly(poly)
    if couvre_dessous:
        dessus = 1 - dessus
    zone_oeil = cv2.GaussianBlur(ndi.binary_dilation(oeil_plein, iterations=2).astype(np.float32), (0, 0), 0.8)
    w = (dessus * zone_oeil)[..., None]
    out = img.copy()
    out[..., :3] = img[..., :3] * (1 - w) + tex[..., :3] * w
    # trait d'encre, coupe a l'oeil (un peu deborde pour se raccorder a l'anneau)
    trait = masque_trait(courbe, epais)
    lim = cv2.GaussianBlur(ndi.binary_dilation(oeil_plein, iterations=3).astype(np.float32), (0, 0), 0.8)
    t = (trait * lim)[..., None]
    out[..., :3] = out[..., :3] * (1 - t) + ENCRE * t
    return out, (dessus * zone_oeil)


def troncon_dans(courbe, masque, deborde=4.0):
    """Garde la partie de la courbe qui traverse le masque, prolongee de 'deborde' px."""
    c = np.asarray(courbe, np.float64)
    # re-echantillonnage fin et regulier
    seg = np.hypot(*np.diff(c, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    ss = np.arange(0, s[-1], 0.5)
    fin = np.stack([np.interp(ss, s, c[:, 0]), np.interp(ss, s, c[:, 1])], 1)
    xi = np.clip(np.round(fin[:, 0]).astype(int), 0, W - 1)
    yi = np.clip(np.round(fin[:, 1]).astype(int), 0, H - 1)
    dedans = masque[yi, xi]
    idx = np.where(dedans)[0]
    i0, i1 = idx[0], idx[-1]
    k = int(deborde / 0.5)
    i0, i1 = max(0, i0 - k), min(len(fin) - 1, i1 + k)
    out = fin[i0:i1 + 1]
    # sous-echantillonne pour le dessin
    pas = max(1, len(out) // 60)
    return np.vstack([out[::pas], out[-1:]])


def profil(n, e_debut, e_milieu, e_fin, pointe_debut=0.0, pointe_fin=0.0):
    """Epaisseurs le long d'un trait : interpolation douce + pointes effilees optionnelles."""
    t = np.linspace(0, 1, n)
    u0 = np.clip(t / 0.5, 0, 1); u1 = np.clip((t - 0.5) / 0.5, 0, 1)
    e = np.where(t < 0.5, e_debut + (e_milieu - e_debut) * u0 ** 0.7,
                 e_milieu + (e_fin - e_milieu) * u1 ** 1.3)
    if pointe_debut > 0:
        e *= np.clip(t / pointe_debut, 0.35, 1) ** 0.6
    if pointe_fin > 0:
        e *= np.clip((1 - t) / pointe_fin, 0.35, 1) ** 0.6
    return e


_TEX = {}


def tex_oeil(oeil_plein, graine):
    """Texture du masque pour un oeil, calculee une fois depuis la tete aux traits effaces."""
    if graine not in _TEX:
        _TEX[graine] = _texture_masque(efface_traits(ORIG.copy()), oeil_plein, graine)
    return _TEX[graine]


def paupiere2(img, oeil_plein, courbe, eps, graine, remplit=True, cote='dessus'):
    """eps = (debut, milieu, fin, pointe_debut, pointe_fin). Renvoie (image, poids_paupiere)."""
    courbe = np.asarray(courbe, np.float64)
    zone = ndi.binary_dilation(oeil_plein, iterations=2)
    w_lid = np.zeros((H, W), np.float32)
    out = img.copy()
    if remplit:
        tex = tex_oeil(oeil_plein, graine)
        a, b = courbe[0], courbe[-1]
        d = (b - a) / np.hypot(*(b - a))
        haut = np.array([0, -1.0]) * 500
        if cote == 'dessous':
            haut = -haut
        poly = np.vstack([[a - d * 150 + haut], [a - d * 150], courbe, [b + d * 150], [b + d * 150 + haut]])
        dessus = masque_poly(poly)
        zone_f = cv2.GaussianBlur(zone.astype(np.float32), (0, 0), 0.8)
        w_lid = dessus * zone_f
        out[..., :3] = img[..., :3] * (1 - w_lid[..., None]) + tex[..., :3] * w_lid[..., None]
    tr = troncon_dans(courbe, ndi.binary_dilation(oeil_plein, iterations=1), deborde=3)
    e = profil(len(tr), *eps)
    trait = masque_trait(tr, e)
    out[..., :3] = out[..., :3] * (1 - trait[..., None]) + ENCRE * trait[..., None]
    return out, np.maximum(w_lid, trait)


def push_pull(rgb, poids, niveaux=8):
    """Remplissage lisse par pyramide (push-pull) : couleur moyenne ponderee des sources."""
    pyr = [(rgb * poids[..., None], poids)]
    for _ in range(niveaux):
        c, w = pyr[-1]
        c2 = cv2.pyrDown(c)
        w2 = cv2.pyrDown(w)
        pyr.append((c2, w2))
    c, w = pyr[-1]
    est = c / np.maximum(w[..., None], 1e-6)
    for k in range(len(pyr) - 2, -1, -1):
        c, w = pyr[k]
        up = cv2.resize(est, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
        loc = c / np.maximum(w[..., None], 1e-6)
        a = np.clip(w * 4.0, 0, 1)[..., None]
        est = loc * a + up * (1 - a)
    return est


def texture_masque(img, oeil_plein, graine):
    return tex_oeil(oeil_plein, graine)


def _texture_masque(img, oeil_plein, graine):
    """Remplit tout l'oeil avec la peinture du masque brun (sources : brun du masque seulement)."""
    zone = ndi.binary_dilation(oeil_plein, iterations=6)
    h, s, l = rgb_vers_hsl(img[..., :3])
    brun = (l > 0.22) & (l < 0.48) & (h < 32) & (s > 0.2) & (img[..., 3] > 0.9)
    anneau = ndi.binary_dilation(zone, iterations=40) & ~ndi.binary_dilation(zone, iterations=3)
    src = brun & anneau
    base = push_pull(img[..., :3], src.astype(np.float32))
    # detail : grain du masque copie depuis l'anneau (meme facon que la peinture d'origine)
    L = img[..., :3].mean(-1)
    hp = L - cv2.GaussianBlur(L, (0, 0), 2.0)
    ampl = float(np.median(np.abs(hp[src])) * 1.3) if src.any() else 0.01
    g = grain(img.shape, ampl, graine)
    out = img.copy()
    out[..., :3] = base + g[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
    return out
