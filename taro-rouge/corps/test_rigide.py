import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [('repos', {}),
         ('rigide -9', dict(p_epaule_g=(0, -9), p_epaule_d=(0, -9))),
         ('rigide -14 r+-2', dict(p_epaule_g=(0, -14), p_epaule_d=(0, -14), a_epaule_g=2, a_epaule_d=-2)),
         ('rigide -14 coude 2', dict(p_epaule_g=(0, -14), p_epaule_d=(0, -14), a_coude_g=2, a_coude_d=-2.5))]
Z = 2
sheet = Image.new('RGB', (2 * 260 * Z, len(poses) * 300 * Z), 'white')
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, box in enumerate(((380, 760, 640, 1060), (800, 740, 1060, 1040))):
        c = pil.crop(box).resize((260 * Z, 300 * Z), Image.LANCZOS)
        ImageDraw.Draw(c).text((6, 6), nom, fill=(200, 0, 0))
        sheet.paste(c, (j * 260 * Z, i * 300 * Z))
sheet.save('out/zz/test_rigide.png')
