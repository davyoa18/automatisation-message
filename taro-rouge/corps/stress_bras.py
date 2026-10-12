import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0,'.'); sys.path.insert(0,'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
lignes = [
  ('coude g', 'a_coude_g', [-75, -45, -20, 25, 50, 80]),
  ('epaule g', 'a_epaule_g', [-35, -20, -10, 10, 25, 40]),
  ('coude d', 'a_coude_d', [-80, -50, -25, 25, 60, 100]),
  ('epaule d', 'a_epaule_d', [-40, -25, -10, 10, 20, 35]),
]
W, H = 330, 300
sheet = Image.new('RGB', (W * 6, H * len(lignes)), 'white')
for i, (nom, k, angs) in enumerate(lignes):
    box = (300, 640, 700, 1100) if k.endswith('_g') else (700, 620, 1100, 1080)
    for j, a in enumerate(angs):
        im = compo.pose(P, C, **{k: a})
        c = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).crop(box).resize((W, int(W * (box[3]-box[1]) / (box[2]-box[0]))))
        d = ImageDraw.Draw(c); d.text((6, 6), f'{nom} {a}', fill=(200, 0, 0))
        sheet.paste(c.crop((0, 0, W, H)), (j * W, i * H))
sheet.save('out/zz/stress_bras.png')
