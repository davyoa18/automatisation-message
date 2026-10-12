"""Prepare la revue finale : planches de 8 images (jeu) et planches d'articulations en pleine resolution
(chaque image de l'animation, recadree autour des jonctions qui suivent le corps)."""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw
ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ICI)
os.chdir(ICI)
import anims
from taro_rig import _M, PIV_ROOT, PIV_TORSE

R = f"{ICI}/{os.environ.get('REVUE', 'revue3')}"
DECAL = (209, 418)
# regions (repere scene) : (nom, centre, largeur, hauteur, os, cote d'epaule a suivre)
REGIONS = {
    'bras': [('coude_g', (560, 880), 130, 120, 'torse', 'g'), ('hanche_g', (545, 1000), 130, 110, 'torse', 'g'),
             ('coude_d', (885, 870), 130, 120, 'torse', 'd'), ('hanche_d', (915, 965), 130, 110, 'torse', 'd')],
    'haut': [('rabat_g', (500, 785), 170, 90, 'torse', 'g'), ('rabat_d', (895, 752), 170, 90, 'torse', 'd'),
             ('triangle', (412, 790), 110, 110, 'torse', None)],
    'pieds': [('pieds', (700, 1140), 620, 130, 'root', None)],
}
ECHELLE = {'bras': 2.0, 'haut': 1.8, 'pieds': 1.5}
LIGNES = 8


def matrices(tl, t):
    Mr = _M(tl.eval('root.p', t), float(tl.eval('root.r', t)[0]), tl.eval('root.s', t), PIV_ROOT)
    Mt = Mr @ _M(tl.eval('torse.p', t), float(tl.eval('torse.r', t)[0]), tl.eval('torse.s', t), PIV_TORSE)
    return Mr, Mt


def main():
    os.makedirs(f'{R}/planches', exist_ok=True)
    os.makedirs(f'{R}/articulations', exist_ok=True)
    index = {}
    for nom, f in anims.TOUTES.items():
        tl = f()
        dossier = f'{R}/full/{nom}'
        fs = sorted(x for x in os.listdir(dossier) if x.endswith('.png'))
        n = len(fs)
        dec = (0, 0) if nom == 'attente' else DECAL
        index[nom] = {'images': n, 'planches': [], 'articulations': {g: [] for g in REGIONS}}
        # --- planches de jeu : 8 images, perso entier
        boite = (40, 0, 1214, 1254) if nom == 'attente' else (180, 360, 1420, 1660)
        tw = 420
        th = int(tw * (boite[3] - boite[1]) / (boite[2] - boite[0]))
        for k in range(0, n, 8):
            ch = fs[k:k + 8]
            S = Image.new('RGB', (4 * tw, 2 * (th + 18)), 'white')
            d = ImageDraw.Draw(S)
            for i, fn in enumerate(ch):
                im = Image.open(f'{dossier}/{fn}').convert('RGB').crop(boite).resize((tw, th), Image.LANCZOS)
                x, y = (i % 4) * tw, (i // 4) * (th + 18)
                S.paste(im, (x, y + 18))
                d.text((x + 4, y + 3), f'{nom} {int(fn[1:5])}', fill=(200, 0, 0))
            p = f'{R}/planches/{nom}_{k:03d}-{min(k + 7, n - 1):03d}.png'
            S.save(p)
            index[nom]['planches'].append(os.path.basename(p))
        # --- articulations : une ligne par image
        for g, regs in REGIONS.items():
            z = ECHELLE[g]
            tuiles = [(int(w * z), int(h * z)) for (_, _, w, h, _, _) in regs]
            lw = sum(t[0] for t in tuiles) + 4 * (len(tuiles) - 1) + 60
            lh = max(t[1] for t in tuiles)
            for k in range(0, n, LIGNES):
                ch = list(range(k, min(k + LIGNES, n)))
                S = Image.new('RGB', (lw, len(ch) * (lh + 4)), (40, 40, 40))
                d = ImageDraw.Draw(S)
                for row, t in enumerate(ch):
                    im = Image.open(f'{dossier}/f{t:04d}.png').convert('RGB')
                    Mr, Mt = matrices(tl, t)
                    x = 60
                    y = row * (lh + 4)
                    d.text((4, y + 4), str(t), fill=(255, 255, 0))
                    for (rn, c, w, h, os_, cote), (tw_, th_) in zip(regs, tuiles):
                        M = Mt if os_ == 'torse' else Mr
                        cc = M @ np.array([c[0], c[1], 1.0])
                        if cote:
                            ep = tl.eval(f'epaule_{cote}.p', t)
                            cc[:2] += np.asarray(ep, float)[:2] * (0.5 if rn.startswith('rabat') else 1.0)
                        cx, cy = cc[0] + dec[0], cc[1] + dec[1]
                        b = (int(round(cx - w / 2)), int(round(cy - h / 2)), int(round(cx + w / 2)), int(round(cy + h / 2)))
                        tile = im.crop(b).resize((tw_, th_), Image.NEAREST)
                        S.paste(tile, (x, y))
                        d.text((x + 3, y + 2), rn, fill=(0, 90, 255))
                        x += tw_ + 4
                p = f'{R}/articulations/{nom}_{g}_{k:03d}-{ch[-1]:03d}.png'
                S.save(p)
                index[nom]['articulations'][g].append(os.path.basename(p))
        print(nom, n, 'images', len(index[nom]['planches']), 'planches',
              {g: len(v) for g, v in index[nom]['articulations'].items()})
    json.dump(index, open(f'{R}/index.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
