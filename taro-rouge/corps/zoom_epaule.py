import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [('ep-6', dict(a_epaule_g=-6, a_epaule_d=6)), ('ep+8', dict(a_epaule_g=8, a_epaule_d=-8))]
Z = 3
boxes = ((400, 730, 580, 830), (830, 700, 1010, 800))
sheet = Image.new('RGB', (2 * 180 * Z, len(poses) * 100 * Z), 'white')
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, box in enumerate(boxes):
        c = pil.crop(box).resize((180 * Z, 100 * Z), Image.NEAREST)
        d = ImageDraw.Draw(c); d.text((6, 6), nom, fill=(200, 0, 0))
        for x in range(box[0], box[2], 20):
            d.text(((x - box[0]) * Z, 88 * Z), str(x), fill=(0, 0, 200))
        for y in range(box[1], box[3], 20):
            d.text((2, (y - box[1]) * Z), str(y), fill=(0, 0, 200))
        sheet.paste(c, (j * 180 * Z, i * 100 * Z))
sheet.save('out/zz/zoom_epaule.png')
