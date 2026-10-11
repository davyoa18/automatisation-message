import json, numpy as np
from PIL import Image
from atelier import compose, sauve
import traits as TR
from vecteur import remplit, contour
INFO = json.load(open('final/pieces.json'))

def P(nom):
    a = np.asarray(Image.open(f'final/{nom}.png').convert('RGBA')).astype(np.float32) / 255
    c = np.zeros((1254, 1254, 4), np.float32)
    i = INFO[nom]; c[i['y']:i['y'] + i['h'], i['x']:i['x'] + i['w']] = a
    return c

def scene(teinte='rouge', yeux='base', sourcils='colere', bouche='moue', fond=(1.0, 0.98, 0.96)):
    S = np.zeros((1254, 1254, 4), np.float32); S[..., :3] = fond; S[..., 3] = 1
    for n in ('capuche', 'queue', f'oreille_g_{teinte}', f'oreille_d_{teinte}', 'cou', f'tete_{teinte}',
              f'oeil_g_{yeux}', f'oeil_d_{yeux}'):
        compose(S, P(n), 0, 0)
    for c in ('g', 'd'):
        remplit(S, TR.sourcil(c, sourcils), TR.ENCRE)
    for p in TR.plis(sourcils):
        contour(S, p, TR.ENCRE, 7)
    b = TR.bouche(bouche)
    remplit(S, b, TR.GORGE); remplit(S, TR.langue(bouche), TR.LANGUE)
    remplit(S, TR.dents_haut(bouche), TR.DENTS); remplit(S, TR.dents_bas(bouche), TR.DENTS)
    contour(S, b, TR.ENCRE, 10)
    compose(S, P('torse'), 0, 0)
    return S

if __name__ == '__main__':
    vign = []
    for t, y, s, b in [('rouge', 'base', 'colere', 'moue'), ('rouge', 'plisse', 'colere', 'grr'),
                       ('rouge', 'mi', 'colere', 'moue'), ('rouge', 'clos', 'colere', 'moue'),
                       ('rouge', 'serres', 'furie', 'cri'), ('rage', 'fous', 'furie', 'hurle'),
                       ('rouge', 'serres', 'pleure', 'sanglot'), ('rage', 'base', 'furie', 'grr')]:
        S = scene(t, y, s, b)
        vign.append(Image.fromarray((np.clip(S[250:780, 300:1060, :3], 0, 1) * 255).astype(np.uint8)).resize((380, 265), Image.LANCZOS))
    Pl = Image.new('RGB', (4 * 380, 2 * 265), (255, 255, 255))
    for i, im in enumerate(vign): Pl.paste(im, ((i % 4) * 380, (i // 4) * 265))
    Pl.save('out/final_etats.png')
    S = scene()
    sauve(S[::2, ::2], 'out/final_base.png')
    sauve(S[380:680, 360:1000], 'out/final_yeux_zoom.png')
