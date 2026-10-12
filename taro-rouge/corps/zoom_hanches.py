"""Zoom des jonctions poing / hanche quand le bras rigide monte et tourne (poing qui glisse)."""
import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [('repos', {}), ('-14', dict(p_epaule_g=(0, -14), p_epaule_d=(0, -14))),
         ('-14 r3.5', dict(p_epaule_g=(0, -14), p_epaule_d=(0, -14), a_epaule_g=3.5, a_epaule_d=-3.5)),
         ('+3 r-2', dict(p_epaule_g=(0, 3), p_epaule_d=(0, 3), a_epaule_g=-2, a_epaule_d=2))]
Z = 3
boxes = ((470, 930, 630, 1050), (840, 900, 1000, 1020))
sheet = Image.new('RGB', (2 * 160 * Z + 6, len(poses) * 120 * Z + 3 * len(poses)), (40, 40, 40))
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, b in enumerate(boxes):
        c = pil.crop(b).resize((160 * Z, 120 * Z), Image.NEAREST)
        ImageDraw.Draw(c).text((4, 4), nom, fill=(0, 0, 255))
        sheet.paste(c, (j * (160 * Z + 6), i * (120 * Z + 3)))
sheet.save(sys.argv[1] if len(sys.argv) > 1 else 'out/zz/zoom_hanches.png')
