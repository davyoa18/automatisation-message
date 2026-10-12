"""Compositeur de test : pose les pieces du corps avec des rotations aux articulations (repere scene)."""
import numpy as np, cv2


def M_rot(c, deg):
    return cv2.getRotationMatrix2D((float(c[0]), float(c[1])), -deg, 1.0)   # deg > 0 : sens horaire a l'ecran


def compose3(M1, M2):
    A = np.vstack([M1, [0, 0, 1]]); B = np.vstack([M2, [0, 0, 1]])
    return (A @ B)[:2]


def warp(img, M, N=1254):
    return cv2.warpAffine(img, M, (N, N), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))


def T_(dx, dy):
    return np.array([[1, 0, dx], [0, 1, dy]], float)


def pose(P, C, a_epaule_g=0, a_coude_g=0, a_epaule_d=0, a_coude_d=0, a_jambe_g=0, a_jambe_d=0,
         a_pied_g=0, a_pied_d=0, p_epaule_g=(0, 0), p_epaule_d=(0, 0), p_pied_g=(0, 0), p_pied_d=(0, 0), fond=(1.0, 0.98, 0.96)):
    """P : pieces ; C : module corps (pivots). Renvoie l'image RGB composee."""
    I = np.eye(3)[:2]
    Mbg = compose3(T_(*p_epaule_g), M_rot(C.S_G, a_epaule_g))
    Mag = compose3(Mbg, M_rot(C.E_G, a_coude_g))
    Mbd = compose3(T_(*p_epaule_d), M_rot(C.S_D, a_epaule_d))
    Mad = compose3(Mbd, M_rot(C.E_D, a_coude_d))
    Mjg = M_rot(C.H_JAMBE, a_jambe_g); Mjd = M_rot(C.H_JAMBE, a_jambe_d)
    Mpg = compose3(Mjg, compose3(T_(*p_pied_g), M_rot(C.TALON_G, a_pied_g)))
    Mpd = compose3(Mjd, compose3(T_(*p_pied_d), M_rot(C.TALON_D, a_pied_d)))
    ordre = [('capuche_avant', I), ('avbras_g', Mag), ('pli_coude_g', Mbg), ('bras_g', Mbg), ('avbras_d', Mad), ('bras_d', Mbd),
             ('ombre_bras_g', Mbg), ('ombre_avbras_g', Mag), ('ombre_bras_d', Mbd), ('ombre_avbras_d', Mad), ('torse', I),
             ('jambe_g', Mjg), ('jambe_d', Mjd), ('pied_g', Mpg), ('pied_d', Mpd)]
    out = np.zeros((1254, 1254, 3), np.float32); out[:] = fond
    for nom, M in reversed(ordre):
        if nom not in P:
            continue
        im = warp(P[nom], M)
        a = im[..., 3:4]
        out = out * (1 - a) + im[..., :3] * a
    return out
