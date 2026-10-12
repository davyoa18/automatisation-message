import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0,'.'); sys.path.insert(0,'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = [dict(a_jambe_g=12), dict(a_jambe_g=-8), dict(a_jambe_d=-12), dict(a_jambe_d=8),
         dict(a_pied_g=10), dict(a_pied_d=-10), dict(a_jambe_g=10, a_pied_g=8), dict(a_jambe_d=-10, a_pied_d=-8)]
W = 400
sheet = Image.new("RGB", (W * 4, 176 * 2), "white")
for j, kw in enumerate(poses):
    im = compo.pose(P, C, **kw)
    c = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).crop((380, 960, 1040, 1250)).resize((W, int(W*290/660)))
    ImageDraw.Draw(c).text((5, 5), str(kw), fill=(200, 0, 0))
    sheet.paste(c, ((j % 4) * W, (j // 4) * 176))
sheet.save('out/zz/stress_jambes.png')
