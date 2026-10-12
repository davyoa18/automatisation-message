"""Recadre une image de reaction (cadre 1672, decalage scene 209,418) sur une boite en repere scene."""
import sys
from PIL import Image, ImageDraw
def crop(src, box, z, dst, label=None):
    im = Image.open(src).convert('RGB')
    s = im.size[0] / 1672
    b = [int((box[0] + 209) * s), int((box[1] + 418) * s), int((box[2] + 209) * s), int((box[3] + 418) * s)]
    c = im.crop(b).resize((int((box[2] - box[0]) * z), int((box[3] - box[1]) * z)), Image.LANCZOS)
    if label:
        ImageDraw.Draw(c).text((4, 4), label, fill=(200, 0, 0))
    if dst:
        c.save(dst)
    return c
def planche(srcs, box, z, dst, cols=4, labels=None):
    cs = [crop(s, box, z, None, (labels[i] if labels else s[-9:-4])) for i, s in enumerate(srcs)]
    W, H = cs[0].size
    rows = (len(cs) + cols - 1) // cols
    p = Image.new('RGB', (cols * (W + 2), rows * (H + 2)), 'white')
    for i, c in enumerate(cs):
        p.paste(c, ((i % cols) * (W + 2), (i // cols) * (H + 2)))
    p.save(dst)
