"""Poses de test des coudes (haussement + compensation du coude) : avant / apres."""
import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '.'); sys.path.insert(0, 'corps')
import numpy as np, corps as C, compo, corps_anim as CA
from PIL import Image, ImageDraw
regen = len(sys.argv) > 1 and sys.argv[1] == 'regen'
if regen or not os.path.exists('out/zz/pieces_corps.npz'):
    P = C.pieces_corps()
    np.savez_compressed('out/zz/pieces_corps.npz', **P)
P = dict(np.load('out/zz/pieces_corps.npz'))
poses = []
for h in (-9, -18, -26):
    rg, cg = CA.ik2('g', (0, h), 3.0, borne=6)
    rd, cd = CA.ik2('d', (0, h), -3.0, borne=6)
    poses.append((f'hausse {h}', dict(a_epaule_g=rg, a_coude_g=cg, p_epaule_g=(0, h), a_epaule_d=rd, a_coude_d=cd, p_epaule_d=(0, h))))
poses += [('coude g +20 d -30', dict(a_coude_g=20, a_coude_d=-30, a_epaule_g=4, a_epaule_d=-4)),
          ('coude g -12 d +10', dict(a_coude_g=-12, a_coude_d=10))]
Z = 2
sheet = Image.new('RGB', (2 * 220 * Z, len(poses) * 200 * Z), 'white')
for i, (nom, kw) in enumerate(poses):
    im = compo.pose(P, C, **kw)
    pil = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8))
    for j, box in enumerate(((420, 760, 640, 960), (820, 740, 1040, 940))):
        c = pil.crop(box).resize((220 * Z, 200 * Z), Image.LANCZOS)
        ImageDraw.Draw(c).text((6, 6), nom, fill=(200, 0, 0))
        sheet.paste(c, (j * 220 * Z, i * 200 * Z))
sheet.save(sys.argv[2] if len(sys.argv) > 2 else 'out/zz/test_coudes.png')
print('ok', [p[0] for p in poses])
