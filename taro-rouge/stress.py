import numpy as np
from rig import rend
from controle import defauts, marque
from atelier import sauve
from PIL import Image

POSES = {
    'repos': {},
    'tete_levee': {'tete': {'t': (0, -45)}},
    'tete_g': {'tete': {'t': (0, -30), 'r': -12}},
    'tete_d': {'tete': {'r': 12}},
    'tete_x1.3': {'tete': {'s': (1.3, 1.3)}},
    'tete_mix': {'tete': {'s': (1.25, 1.25), 'r': 8, 't': (0, -25)}},
    'oreilles_rabattues': {'oreille_g': {'r': -28}, 'oreille_d': {'r': 28}},
    'oreilles_dressees': {'oreille_g': {'r': 15}, 'oreille_d': {'r': -15}},
    'queue_+14': {'queue': {'r': 14}},
    'queue_-14': {'queue': {'r': -14}},
    'ecrase': {'root': {'s': (1.12, 0.88)}},
    'combo': {'tete': {'s': (1.25, 1.25), 'r': -10, 't': (10, -35)}, 'oreille_g': {'r': -25},
              'oreille_d': {'r': 25}, 'queue': {'r': -12}, 'root': {'s': (0.94, 1.06)}},
}

if __name__ == '__main__':
    vign = []
    for nom, pose in POSES.items():
        img = rend(pose)
        m, t = defauts(img)
        print(f'{nom:20s} bords non encres: {int(m.sum()):5d}   trous: {int(t.sum()):5d}')
        v = marque(img, m, t)
        a = (np.clip(v[..., :3], 0, 1) * 255).astype(np.uint8)
        vign.append(Image.fromarray(a).resize((418, 418), Image.LANCZOS))
    W = 4
    H = (len(vign) + W - 1) // W
    planche = Image.new('RGB', (W * 418, H * 418), (255, 255, 255))
    for i, im in enumerate(vign):
        planche.paste(im, ((i % W) * 418, (i // W) * 418))
    planche.save('out/stress.png')
