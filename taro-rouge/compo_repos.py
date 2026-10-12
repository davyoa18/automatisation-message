"""Composition au repos (sans transformation) des pieces du corps : ce qu'il y a sous une piece donnee."""
import numpy as np

# devant -> derriere (meme ordre que corps/compo.py)
ORDRE = ['capuche_avant', 'avbras_g', 'raccord_g', 'pli_coude_g', 'bras_g', 'avbras_d', 'bras_d', 'ombre_bras_g',
         'ombre_avbras_g', 'ombre_bras_d', 'ombre_avbras_d', 'hanche_g', 'torse', 'jambe_g', 'jambe_d', 'pied_g',
         'pied_d']
FOND = (1.0, 0.98, 0.96)


def dessous(P, nom):
    """RGB compose de toutes les pieces situees derriere 'nom' (au repos)."""
    i = ORDRE.index(nom)
    N = P[nom].shape[0]
    out = np.zeros((N, N, 3), np.float32); out[:] = FOND
    for n in reversed(ORDRE[i + 1:]):
        if n not in P or n == 'raccord_g':
            continue
        a = P[n][..., 3:4]
        out = out * (1 - a) + P[n][..., :3] * a
    return out
