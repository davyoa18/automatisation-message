"""Atelier : outils pour repeindre les pieces raster de Taro (tete rouge et en colere)."""
import numpy as np
from PIL import Image
import colorsys

ICI = __file__.rsplit('/', 1)[0]


def charge(nom):
    """Charge une piece en RGBA float32 [0,1]."""
    im = Image.open(f'{ICI}/pieces/{nom}.png').convert('RGBA')
    return np.asarray(im).astype(np.float32) / 255.0


def sauve(arr, chemin):
    a = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(a, 'RGBA').save(chemin)


def rgb_vers_hsl(rgb):
    """rgb (...,3) -> h [0,360), s, l (vectorise)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d < 1e-6, 0, d / (1 - np.abs(2 * l - 1) + 1e-6))
    h = np.zeros_like(l)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / (d + 1e-9), 0)
    gc = np.where(m, (mx - g) / (d + 1e-9), 0)
    bc = np.where(m, (mx - b) / (d + 1e-9), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0
    h = np.where(m, h, 0)
    return h * 360, np.clip(s, 0, 1), l


def hsl_vers_rgb(h, s, l):
    h = (h % 360) / 360.0
    def f(n):
        k = (n + h * 12) % 12
        a = s * np.minimum(l, 1 - l)
        return l - a * np.maximum(-1, np.minimum(np.minimum(k - 3, 9 - k), 1))
    return np.stack([f(0), f(8), f(4)], axis=-1)


def zones(img):
    """Classe chaque pixel : renvoie un dict de masques float [0,1] (doux)."""
    rgb = img[..., :3]
    a = img[..., 3]
    h, s, l = rgb_vers_hsl(rgb)
    z = {}
    z['encre'] = ((l < 0.20) & (a > 0.02)).astype(np.float32)
    z['blanc'] = ((l > 0.955) & (s < 0.55) & (a > 0.02)).astype(np.float32)
    # creme du museau : tres clair, chaud
    z['creme'] = ((l > 0.80) & (l <= 0.955) & (h > 20) & (h < 60) & (a > 0.02)).astype(np.float32)
    # fourrure doree / orangee
    z['fourrure'] = ((l > 0.45) & (l <= 0.82) & (h >= 15) & (h < 50) & (s > 0.45) & (a > 0.02)).astype(np.float32)
    # masque brun et brun des oreilles
    z['brun'] = ((l > 0.20) & (l <= 0.47) & (h < 30) & (s > 0.2) & (a > 0.02)).astype(np.float32)
    # rose (interieur des oreilles, langue)
    z['rose'] = ((l > 0.55) & ((h < 15) | (h > 330)) & (s > 0.35) & (a > 0.02)).astype(np.float32)
    return z, (h, s, l)


def compose(base, dessus, x, y):
    """Colle 'dessus' (RGBA float) sur 'base' en (x,y), alpha 'over'. Modifie base."""
    H, W = base.shape[:2]
    h, w = dessus.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return base
    d = dessus[y0 - y:y1 - y, x0 - x:x1 - x]
    b = base[y0:y1, x0:x1]
    da = d[..., 3:4]
    ba = b[..., 3:4]
    oa = da + ba * (1 - da)
    oc = (d[..., :3] * da + b[..., :3] * ba * (1 - da)) / np.maximum(oa, 1e-6)
    base[y0:y1, x0:x1, :3] = oc
    base[y0:y1, x0:x1, 3:4] = oa
    return base


# --- yeux de la tete idle (repere de la piece 'head', 1104 x 724) ---
OEIL_G = dict(c=(421.6, 504.5), ax=(92.8, 101.1), ang=56.2)   # demi-axes (blanc+iris)
OEIL_D = dict(c=(738.1, 443.6), ax=(86.1, 91.8), ang=140.4)


def masque_ellipse(shape, oeil, marge=0.0, flou=0.0):
    import cv2
    H, W = shape[:2]
    m = np.zeros((H * 4, W * 4), np.uint8)
    (cx, cy), (a, b), ang = oeil['c'], oeil['ax'], oeil['ang']
    cv2.ellipse(m, (int(cx * 4), int(cy * 4)), (int((a + marge) * 4), int((b + marge) * 4)), ang, 0, 360, 255, -1, cv2.LINE_AA)
    m = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    if flou > 0:
        m = cv2.GaussianBlur(m, (0, 0), flou)
    return m


def scene_idle(head, torso=None, fond=(0.70, 0.12, 0.0)):
    """Compose la pose de repos de l'idle (repere 1254) ; head = piece RGBA float."""
    S = np.zeros((1254, 1254, 4), np.float32)
    S[..., :3] = fond
    S[..., 3] = 1
    compose(S, charge('idle_tailfill'), 68, 623)
    compose(S, charge('idle_tail'), 380 - 335, 730 - 107)
    compose(S, charge('idle_filler'), 95, 607)
    compose(S, head, 130 - 36, 700 - 670)
    compose(S, torso if torso is not None else charge('idle_torso'), 358, 681)
    return S
