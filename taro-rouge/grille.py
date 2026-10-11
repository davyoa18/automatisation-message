import sys
import numpy as np
from atelier import sauve, compose
from PIL import Image

def avec_grille(img, x0, y0, x1, y1, fond=(0.2, 0.8, 0.9), pas=20, echelle=1.5, chemin='out/g.png', extra=None):
    C = np.zeros((y1 - y0, x1 - x0, 4), np.float32); C[..., :3] = fond; C[..., 3] = 1
    sub = img[y0:y1, x0:x1]
    compose(C, sub, 0, 0)
    if extra is not None:
        for (m, col) in extra:
            mm = m[y0:y1, x0:x1] > 0.5
            C[mm, :3] = col
    for y in range(0, y1 - y0):
        if (y + y0) % pas == 0:
            k = 0.45 if (y + y0) % 100 == 0 else 0.2
            C[y, :, :3] = C[y, :, :3] * (1 - k) + k * (1.0 if (y + y0) % 100 == 0 else 0.0)
    for x in range(0, x1 - x0):
        if (x + x0) % pas == 0:
            k = 0.45 if (x + x0) % 100 == 0 else 0.2
            C[:, x, :3] = C[:, x, :3] * (1 - k) + k * (1.0 if (x + x0) % 100 == 0 else 0.0)
    a = np.clip(C * 255 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(a, 'RGBA')
    im = im.resize((int(im.width * echelle), int(im.height * echelle)), Image.NEAREST)
    im.save(chemin)
