import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [(f'ep {a}', dict(a_epaule_g=a, a_epaule_d=-a)) for a in (-8, -5, 5, 8, 11)]
poses += [(f'ep {a} hausse -14', dict(a_epaule_g=a, a_epaule_d=-a, p_epaule_g=(0, -14), p_epaule_d=(0, -14))) for a in (0, 6)]
W = 520
sheet = Image.new('RGB', (W * 2, len(poses) * 300), 'white')
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, box in enumerate(((330, 700, 680, 1060), (740, 680, 1090, 1040))):
        c = pil.crop(box).resize((W, int(W * 360 / 350)), Image.LANCZOS).crop((0, 0, W, 300))
        ImageDraw.Draw(c).text((6, 6), nom, fill=(200, 0, 0))
        sheet.paste(c, (j * W, i * 300))
sheet.save('out/zz/test_epaules.png')
