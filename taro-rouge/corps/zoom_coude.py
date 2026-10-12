import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [('g+12 d-21', dict(a_coude_g=12, a_coude_d=-21)), ('g+20 d-30', dict(a_coude_g=20, a_coude_d=-30)),
         ('g-12 d+10', dict(a_coude_g=-12, a_coude_d=10)), ('g-40 d+20', dict(a_coude_g=-40, a_coude_d=20))]
Z = 4
sheet = Image.new('RGB', (2 * 110 * Z, len(poses) * 100 * Z), 'white')
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, box in enumerate(((500, 830, 610, 930), (830, 820, 940, 920))):
        c = pil.crop(box).resize((110 * Z, 100 * Z), Image.LANCZOS)
        ImageDraw.Draw(c).text((6, 6), nom, fill=(200, 0, 0))
        sheet.paste(c, (j * 110 * Z, i * 100 * Z))
sheet.save(sys.argv[1] if len(sys.argv) > 1 else 'out/zz/zoom_coude.png')
