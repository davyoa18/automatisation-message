"""Apercu statique de Taro rouge (pieces raster + traits vectoriels) en Python."""
import numpy as np
from visage import tete_etat, rougit, charge_rig, N
from vecteur import remplit, contour
import traits as TR
from atelier import compose


def oreille_rouge(nom, teinte='rouge', force=0.85):
    o = charge_rig(nom)
    return rougit(o, np.zeros(o.shape[:2], np.float32), teinte, force=force)


def visage_vecteur(canvas, sourcils='colere', bouche='moue'):
    for c in ('g', 'd'):
        remplit(canvas, TR.sourcil(c, sourcils), TR.ENCRE)
    for p in TR.plis(sourcils):
        contour(canvas, p, TR.ENCRE, 7)
    b = TR.bouche(bouche)
    remplit(canvas, b, TR.GORGE)
    remplit(canvas, TR.langue(bouche), TR.LANGUE)
    remplit(canvas, TR.dents_haut(bouche), TR.DENTS)
    remplit(canvas, TR.dents_bas(bouche), TR.DENTS)
    contour(canvas, b, TR.ENCRE, 10)
    return canvas


def scene(teinte='rouge', etat_yeux='base', sourcils='colere', bouche='moue', fond=(0.70, 0.12, 0.0),
          force_oreilles=0.85):
    S = np.zeros((N, N, 4), np.float32)
    S[..., :3] = fond
    S[..., 3] = 1
    for nom in ('capuche', 'queue'):
        compose(S, charge_rig(nom), 0, 0)
    compose(S, oreille_rouge('oreille_g', teinte, force_oreilles), 0, 0)
    compose(S, oreille_rouge('oreille_d', teinte, force_oreilles), 0, 0)
    cou = charge_rig('cou')
    compose(S, rougit(cou, np.zeros(cou.shape[:2], np.float32), teinte, force=0.45), 0, 0)
    t = tete_etat(etat_yeux, teinte)
    visage_vecteur(t, sourcils, bouche)
    compose(S, t, 0, 0)
    compose(S, charge_rig('torse'), 0, 0)
    return S
