"""Outil de mise au point : dessine des polygones / points (repere scene) sur un zoom quadrille du torse."""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw

ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def scene_torse(fond=(120, 200, 255)):
    T = np.load(f'{ICI}/out/zz/T_torse.npy')
    a = T[..., 3:4]
    rgb = T[..., :3] * a + np.array(fond, np.float32)[None, None] / 255 * (1 - a)
    return Image.fromarray((rgb * 255).astype(np.uint8))


def vue(box, z, sortie, polys=(), points=(), img=None, pas=10, lab=20):
    sc = img if img is not None else scene_torse()
    c = sc.crop(box).resize(((box[2] - box[0]) * z, (box[3] - box[1]) * z), Image.NEAREST).convert('RGB')
    d = ImageDraw.Draw(c)
    for x in range((box[0] // pas + 1) * pas, box[2], pas):
        X = (x - box[0]) * z
        d.line([(X, 0), (X, c.size[1])], fill=(255, 60, 60) if x % lab == 0 else (190, 190, 190), width=1)
        if x % lab == 0:
            d.text((X + 2, 2), str(x), fill=(0, 0, 160))
    for y in range((box[1] // pas + 1) * pas, box[3], pas):
        Y = (y - box[1]) * z
        d.line([(0, Y), (c.size[0], Y)], fill=(255, 60, 60) if y % lab == 0 else (190, 190, 190), width=1)
        if y % lab == 0:
            d.text((2, Y + 2), str(y), fill=(0, 0, 160))
    cols = [(0, 255, 0), (255, 0, 255), (255, 255, 0), (0, 255, 255), (255, 128, 0)]
    for k, p in enumerate(polys):
        P = [((x - box[0]) * z, (y - box[1]) * z) for x, y in p]
        d.line(P + [P[0]], fill=cols[k % len(cols)], width=2)
    for (x, y, t) in points:
        X, Y = (x - box[0]) * z, (y - box[1]) * z
        d.ellipse([X - 4, Y - 4, X + 4, Y + 4], outline=(255, 0, 255), width=2)
        d.text((X + 6, Y - 6), t, fill=(255, 0, 255))
    c.save(sortie)
