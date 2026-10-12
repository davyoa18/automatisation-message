import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0,'.'); sys.path.insert(0,'corps')
import numpy as np, corps as C, compo
from PIL import Image, ImageDraw
P = dict(np.load('out/zz/pieces_corps.npz'))
def z(cas, sortie, cols=3):
    ims = []
    for kw, box, zz in cas:
        im = compo.pose(P, C, **kw)
        c = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).crop(box)
        c = c.resize((int(c.size[0] * zz), int(c.size[1] * zz)), Image.LANCZOS)
        ImageDraw.Draw(c).text((4, 4), str(kw), fill=(200, 0, 0))
        ims.append(c)
    W = max(i.size[0] for i in ims); H = max(i.size[1] for i in ims)
    rows = (len(ims) + cols - 1) // cols
    p = Image.new('RGB', (cols * (W + 4), rows * (H + 4)), 'white')
    for k, i in enumerate(ims):
        p.paste(i, ((k % cols) * (W + 4), (k // cols) * (H + 4)))
    p.save(sortie)
if __name__ == '__main__':
    z([(dict(a_coude_g=-45), (350, 880, 520, 1020), 2.2), (dict(a_coude_g=-30), (350, 880, 520, 1020), 2.2),
       (dict(a_coude_g=25), (420, 840, 620, 1040), 1.8),
       (dict(a_coude_d=20), (840, 820, 1040, 1000), 1.8), (dict(a_coude_d=-25), (840, 820, 1040, 1000), 1.8),
       (dict(a_epaule_g=-15), (400, 730, 600, 860), 1.8),
       (dict(a_epaule_g=15), (400, 730, 600, 860), 1.8), (dict(a_epaule_d=-15), (820, 680, 1000, 820), 2.0),
       (dict(a_epaule_d=15), (820, 680, 1000, 820), 2.0)], 'out/zz/zoom_bras.png')
