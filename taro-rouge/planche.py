"""Planche contact d'une serie d'images rendues."""
import sys, os
from PIL import Image, ImageDraw
dossier, sortie, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8
fs = sorted(f for f in os.listdir(dossier) if f.endswith('.png'))
ims = [Image.open(os.path.join(dossier, f)).convert('RGB') for f in fs]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
P = Image.new('RGB', (cols * w, rows * (h + 16)), (255, 255, 255))
d = ImageDraw.Draw(P)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * w, (i // cols) * (h + 16)
    P.paste(im, (x, y + 16))
    d.text((x + 4, y + 2), f[1:5], fill=(0, 0, 0))
P.save(sortie)
