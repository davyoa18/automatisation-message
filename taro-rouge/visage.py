"""Visage de Taro rouge : rougeur, regard en colere, etats des yeux.
Les retouches se font dans le repere de l'ancienne piece 'head' (tete.py), puis sont
transferees sur la nouvelle tete complete (rig/tete.png, repere scene)."""
import json, os
import numpy as np
import cv2
from scipy import ndimage as ndi
from PIL import Image
import tete as T0
from tete import (ORIG, efface_traits, paupiere2, texture_masque, masque_trait, profil, bezier,
                  OEIL_G_PLEIN, OEIL_D_PLEIN, ENCRE)
from atelier import sauve, rgb_vers_hsl, hsl_vers_rgb, masque_ellipse, OEIL_G, OEIL_D
from tete import ORIG as _ORIG_

ICI = os.path.dirname(os.path.abspath(__file__))
INFO = json.load(open(f'{ICI}/rig/pieces.json'))
N = 1254
DX, DY = 94, 30            # ancienne piece 'head' -> scene
os.makedirs(f'{ICI}/rouge', exist_ok=True)


def charge_rig(nom):
    a = np.asarray(Image.open(f'{ICI}/rig/{nom}.png').convert('RGBA')).astype(np.float32) / 255
    c = np.zeros((N, N, 4), np.float32)
    i = INFO[nom]
    c[i['y']:i['y'] + i['h'], i['x']:i['x'] + i['w']] = a
    return c


def vers_scene(img_old):
    c = np.zeros((N, N) + img_old.shape[2:], img_old.dtype)
    h, w = img_old.shape[:2]
    c[DY:DY + h, DX:DX + w] = img_old
    return c


# ---------------------------------------------------------------- yeux (repere ancien)
def plein_oeil(img, oeil_plein, graine):
    """Recouvre tout l'oeil de texture du masque (paupiere entierement fermee)."""
    tex = texture_masque(img, oeil_plein, graine)
    z = cv2.GaussianBlur(ndi.binary_dilation(oeil_plein, iterations=5).astype(np.float32), (0, 0), 0.8)
    out = img.copy()
    out[..., :3] = img[..., :3] * (1 - z[..., None]) + tex[..., :3] * z[..., None]
    return out, z


def trait(img, pts, eps):
    pts = np.asarray(pts, np.float64)
    t = masque_trait(pts, profil(len(pts), *eps))
    out = img.copy()
    out[..., :3] = out[..., :3] * (1 - t[..., None]) + ENCRE * t[..., None]
    return out, t


# courbes des paupieres (coin exterieur -> coin interieur pour l'oeil gauche, l'inverse a droite)
PAUP = {
    'base':   (((260, 425), (410, 450), (560, 530)), ((610, 476), (745, 398), (890, 322))),
    'plisse': (((258, 446), (410, 482), (560, 556)), ((610, 500), (745, 426), (890, 348))),
    'mi':     (((256, 486), (410, 528), (562, 590)), ((608, 528), (745, 466), (892, 392))),
}
EPS_G = (12, 21, 19, 0.18, 0.0)
EPS_D = (19, 21, 12, 0.0, 0.18)


def yeux(etat, img):
    """Applique un etat d'yeux sur une tete (repere ancien) dont traits sont deja effaces.
    Renvoie (image, masque des zones d'oeil encore visibles : blanc + iris)."""
    vis_g = masque_ellipse(img.shape, OEIL_G, marge=2)
    vis_d = masque_ellipse(img.shape, OEIL_D, marge=2)
    if etat in PAUP:
        cg, cd = PAUP[etat]
        img, lg = paupiere2(img, OEIL_G_PLEIN, bezier(*cg, 80), EPS_G, 31)
        img, ld = paupiere2(img, OEIL_D_PLEIN, bezier(*cd, 80), EPS_D, 32)
        vis_g *= 1 - lg
        vis_d *= 1 - ld
    elif etat in ('clos', 'serres'):
        img, zg = plein_oeil(img, OEIL_G_PLEIN, 31)
        img, zd = plein_oeil(img, OEIL_D_PLEIN, 32)
        vis_g *= 0
        vis_d *= 0
        if etat == 'clos':
            # paupiere close : trait legerement arque, penche vers le nez
            img, _ = trait(img, bezier((318, 540), (420, 548), (516, 580), 60), (10, 20, 18, 0.25, 0.1))
            img, _ = trait(img, bezier((652, 520), (745, 486), (842, 446), 60), (18, 20, 10, 0.1, 0.25))
        else:
            # yeux plisses tres fort : chevrons > < avec pointes effilees
            img, _ = trait(img, bezier((330, 470), (430, 486), (512, 532), 40), (8, 20, 21, 0.35, 0.0))
            img, _ = trait(img, bezier((512, 532), (430, 560), (336, 600), 40), (21, 20, 8, 0.0, 0.35))
            img, _ = trait(img, bezier((836, 392), (746, 420), (668, 470), 40), (8, 20, 21, 0.35, 0.0))
            img, _ = trait(img, bezier((668, 470), (750, 494), (832, 516), 40), (21, 20, 8, 0.0, 0.35))
    elif etat == 'fous':
        # yeux de rage : iris remplace par du blanc, toute petite pupille, paupieres en colere
        cg, cd = PAUP['base']
        for oeil, plein, (cx, cy), r in ((OEIL_G, OEIL_G_PLEIN, (452, 520), 17), (OEIL_D, OEIL_D_PLEIN, (760, 452), 15)):
            # tout l'interieur du contour de l'oeil devient blanc (iris, croissant et trait du bas compris)
            # (le bas de l'oeil d'origine n'a pas de contour : le blanc touche la fourrure ; le haut est
            #  recouvert juste apres par la paupiere en colere et son trait)
            d_in = ndi.distance_transform_edt(plein)
            m = np.clip(d_in - 1.5, 0, 1).astype(np.float32)
            m = cv2.GaussianBlur(m, (0, 0), 0.6)
            blanc = np.array([0.985, 0.975, 0.97], np.float32)
            img[..., :3] = img[..., :3] * (1 - m[..., None]) + blanc * m[..., None]
            yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
            p = np.clip(r + 0.5 - np.hypot(xx - cx, yy - cy), 0, 1).astype(np.float32)
            img[..., :3] = img[..., :3] * (1 - p[..., None]) + ENCRE * p[..., None]
        img, lg = paupiere2(img, OEIL_G_PLEIN, bezier(*cg, 80), EPS_G, 31)
        img, ld = paupiere2(img, OEIL_D_PLEIN, bezier(*cd, 80), EPS_D, 32)
        vis_g *= 1 - lg
        vis_d *= 1 - ld
    return img, np.maximum(vis_g, vis_d)


# ---------------------------------------------------------------- rougeur
def _lisse(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


TEINTES = {
    #          teinte  fourrure(l,s)   creme(l,s)     brun(l,s)
    'rouge': (356.0, (0.590, 0.84), (0.800, 0.84), (0.290, 0.58)),
    'rage':  (352.0, (0.520, 0.88), (0.730, 0.88), (0.270, 0.62)),
}


def rougit(img, exclus, teinte='rouge', force=1.0, centre=(694, 500)):
    hue, kf, kc, kb = TEINTES[teinte]
    rgb = img[..., :3]
    h, s, l = rgb_vers_hsl(rgb)
    H, W = l.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - centre[0]) / 470) ** 2 + ((yy - centre[1]) / 360) ** 2)
    wsp = np.clip(0.78 + 0.22 * (1 - d), 0, 1) * force
    w_coul = _lisse(l, 0.16, 0.26)
    w_coul *= 1 - _lisse(l, 0.955, 0.985) * _lisse(-s, -0.55, -0.3)
    w = wsp * w_coul * (1 - exclus)
    wc = _lisse(l, 0.80, 0.88)
    wb = 1 - _lisse(l, 0.42, 0.52)
    wf = np.clip(1 - wc - wb, 0, 1)
    lt = wc * (l * kc[0] / 0.92) + wf * (l * kf[0] / 0.70) + wb * (l * kb[0] / 0.37)
    st = wc * kc[1] + wf * kf[1] + wb * kb[1]
    dh = ((hue - h + 180) % 360) - 180
    out = img.copy()
    out[..., :3] = hsl_vers_rgb(h + dh * w, s + (st - s) * w, l + (lt - l) * w)
    return out


# ---------------------------------------------------------------- assemblage
ZONE_VISAGE_OLD = None


def zone_visage():
    """Zone (repere ancien) ou les retouches du visage sont transferees : interieur du visage."""
    global ZONE_VISAGE_OLD
    if ZONE_VISAGE_OLD is None:
        m = np.zeros(ORIG.shape[:2], np.float32)
        # sourcils + yeux + bouche, avec marge, loin des contours de la tete
        cv2.fillPoly(m, [np.array([(250, 250), (720, 190), (930, 280), (930, 560), (720, 665),
                                    (470, 672), (250, 630)], np.int32)], 1.0)
        ZONE_VISAGE_OLD = cv2.GaussianBlur(m, (0, 0), 3)
    return ZONE_VISAGE_OLD


def tete_etat(etat='base', teinte='rouge', base_scene=None):
    """Tete complete (scene) avec le visage en colere dans l'etat d'yeux demande."""
    old = efface_traits(ORIG.copy())
    old, vis = yeux(etat, old)
    Hn = charge_rig('tete') if base_scene is None else base_scene.copy()
    z = vers_scene(zone_visage())
    o = vers_scene(old)
    Hn[..., :3] = Hn[..., :3] * (1 - z[..., None]) + o[..., :3] * z[..., None]
    excl = vers_scene(vis)
    return rougit(Hn, excl, teinte)


if __name__ == '__main__':
    import sys
    base = tete_etat('base', 'rouge')
    sauve(base, f'{ICI}/out/visage_base.png')
