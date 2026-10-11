"""Production des pieces finales de Taro rouge -> final/*.png + final/pieces.json
- tetes 'rouge' et 'rage' : yeux remplis de masque (paupieres closes, sans trait), sourcils/bouche effaces
- patchs d'yeux par etat : detoures par difference avec la tete close, NON teintes (blanc, iris, encre)
- oreilles rouge/rage, cou, queue, torse, capuche"""
import json, os
import numpy as np
import cv2
from scipy import ndimage as ndi
from PIL import Image
import tete as T0
from tete import ORIG, efface_traits, OEIL_G_PLEIN, OEIL_D_PLEIN, push_pull
from visage import yeux, plein_oeil, rougit, charge_rig, vers_scene, zone_visage, N, DX, DY, INFO

ICI = os.path.dirname(os.path.abspath(__file__))
OUT = f'{ICI}/final'
os.makedirs(OUT, exist_ok=True)
ETATS = ['base', 'plisse', 'mi', 'clos', 'serres', 'fous']


def sauve_rgba(arr, chemin):
    a = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(a, 'RGBA').save(chemin)


def recadre(img, marge=2):
    ys, xs = np.nonzero(img[..., 3] > 0.002)
    x0, y0 = max(0, xs.min() - marge), max(0, ys.min() - marge)
    x1, y1 = min(img.shape[1], xs.max() + 1 + marge), min(img.shape[0], ys.max() + 1 + marge)
    return img[y0:y1, x0:x1], int(x0), int(y0)


def tete_close_old():
    old = efface_traits(ORIG.copy())
    old, _ = plein_oeil(old, OEIL_G_PLEIN, 31)
    old, _ = plein_oeil(old, OEIL_D_PLEIN, 32)
    return old


def tete_scene(old):
    Hn = charge_rig('tete')
    z = vers_scene(zone_visage())
    # jamais pres du contour exterieur de la tete (redessine dans la piece complete)
    d = ndi.distance_transform_edt(Hn[..., 3] > 0.5)
    z = z * np.clip((d - 40.0) / 6.0, 0, 1)
    o = vers_scene(old)
    Hn[..., :3] = Hn[..., :3] * (1 - z[..., None]) + o[..., :3] * z[..., None]
    return Hn


def detoure(D, C, zone):
    """Patch (couleur F, alpha) tel que F over C == D, dans 'zone'. D, C : RGB (repere ancien)."""
    diff = np.abs(D - C).max(-1)
    R = (diff > 0.012) & zone
    R = ndi.binary_opening(R, iterations=1) | (R & (diff > 0.05))
    interieur = ndi.binary_erosion(R, iterations=2)
    # couleur de premier plan : D a l'interieur, prolongee vers le bord
    F = push_pull(D, interieur.astype(np.float32))
    F = np.where(interieur[..., None], D, F)
    num = ((D - C) * (F - C)).sum(-1)
    den = ((F - C) ** 2).sum(-1)
    a = np.where(den > 1e-4, num / np.maximum(den, 1e-6), 0)
    a = np.clip(a, 0, 1)
    a = np.where(interieur, 1.0, a)
    a = np.where(ndi.binary_dilation(R, iterations=2), a, 0)
    patch = np.zeros(D.shape[:2] + (4,), np.float32)
    patch[..., :3] = F
    patch[..., 3] = a
    return patch


def quantifie(chemin, couleurs=256):
    """Palette (comme les pieces d'origine) via libimagequant, si le gain vaut la peine."""
    try:
        import imagequant
    except ImportError:
        return
    im = Image.open(chemin).convert('RGBA')
    q = imagequant.quantize_pil_image(im, dithering_level=1.0, max_colors=couleurs, min_quality=70, max_quality=100)
    tmp = chemin + '.q.png'
    q.save(tmp, optimize=True)
    if os.path.getsize(tmp) < os.path.getsize(chemin):
        os.replace(tmp, chemin)
    else:
        os.remove(tmp)


def main():
    info = {}

    def ajoute(nom, img_scene, quant=True):
        crop, x, y = recadre(img_scene)
        ch = f'{OUT}/{nom}.png'
        sauve_rgba(crop, ch)
        if quant:
            quantifie(ch)
        info[nom] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}

    # ---- tetes
    C_old = tete_close_old()
    C_sc = tete_scene(C_old)
    zero = np.zeros((N, N), np.float32)
    ajoute('tete_rouge', rougit(C_sc, zero, 'rouge'))
    ajoute('tete_rage', rougit(C_sc, zero, 'rage'))
    # ---- masque des larmes : interieur de la tete, sans le contour encre (le menton passe devant)
    sil = C_sc[..., 3] > 0.5
    inter = ndi.binary_erosion(sil, iterations=17)
    mq = np.zeros_like(C_sc)
    mq[..., :3] = 1.0
    mq[..., 3] = cv2.GaussianBlur(inter.astype(np.float32), (0, 0), 1.0)
    ajoute('masque_tete', mq)
    # ---- oreilles, cou
    for o in ('oreille_g', 'oreille_d'):
        img = charge_rig(o)
        ajoute(f'{o}_rouge', rougit(img, zero, 'rouge', force=0.85))
        ajoute(f'{o}_rage', rougit(img, zero, 'rage', force=0.85))
    cou = charge_rig('cou')
    ajoute('cou', rougit(cou, zero, 'rouge', force=0.45))
    for nom in ('queue', 'torse', 'capuche'):
        ajoute(nom, charge_rig(nom))
    # ---- yeux
    base_old = efface_traits(ORIG.copy())
    for etat in ETATS:
        D_old, _ = yeux(etat, base_old.copy())
        for cote, plein in (('g', OEIL_G_PLEIN), ('d', OEIL_D_PLEIN)):
            zone = ndi.binary_dilation(plein, iterations=6)
            P = detoure(D_old[..., :3], C_old[..., :3], zone)
            ajoute(f'oeil_{cote}_{etat}', vers_scene(P))
    json.dump(info, open(f'{OUT}/pieces.json', 'w'), indent=1)
    tot = sum(os.path.getsize(f'{OUT}/{k}.png') for k in info)
    print(json.dumps(info))
    print('poids total PNG', tot // 1024, 'Ko')


if __name__ == '__main__':
    main()
