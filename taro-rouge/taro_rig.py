"""Squelette Lottie de Taro rouge : une Timeline (canaux animes) -> pile de calques."""
import json, os
from collections import defaultdict
import numpy as np
import lottie_base as L
import traits as TR
from vecteur import Chemin

ICI = os.path.dirname(os.path.abspath(__file__))
INFO = json.load(open(f'{ICI}/final/pieces.json'))
ETATS_YEUX = ['base', 'plisse', 'mi', 'clos', 'serres', 'fous']

PIV_ROOT = (624.0, 1196.0)
PIV_TETE = (700.0, 760.0)
PIV_OREILLE = {'g': (352.0, 352.0), 'd': (826.0, 214.0)}
PIV_QUEUE = (480.0, 940.0)
PIV_COU = (722.0, 860.0)
# corps articule (voir corps.py)
PIV_TORSE = (690.0, 1050.0)                      # taille : penche, gonfle, se tasse
S_G, E_G = (488.0, 822.0), (441.0, 901.0)        # epaule / coude gauche (a l'ecran)
S_D, E_D = (928.0, 806.0), (957.7, 854.6)        # epaule / coude droit
H_JAMBE = (712.0, 1088.0)
# tassement du short : perpendiculairement a la ligne entrejambe -> coin haut exterieur visible de la jambe ; ni
# l'entrejambe ni le coin sous l'ourlet du sweat ne bougent, seul l'ourlet du short remonte avec le pied
TASSE_P0 = (712.0, 1086.0)
TASSE_ANGLE = {'g': 4.06, 'd': -10.6}
TALON_G, TALON_D = (626.0, 1180.0), (770.0, 1186.0)

REPOS = {
    'root.p': (0, 0), 'root.r': 0, 'root.s': (1, 1),
    'tete.p': (0, 0), 'tete.r': 0, 'tete.s': (1, 1),
    'oreille_g.r': 0, 'oreille_d.r': 0,
    'queue.r': 0, 'queue.s': (1, 1),
    'cou.s': (1, 1),
    'torse.p': (0, 0), 'torse.r': 0, 'torse.s': (1, 1),
    'epaule_g.r': 0, 'epaule_g.p': (0, 0), 'coude_g.r': 0,
    'epaule_d.r': 0, 'epaule_d.p': (0, 0), 'coude_d.r': 0,
    'jambe_g.r': 0, 'jambe_d.r': 0, 'jambe_g.s': (1, 1), 'jambe_d.s': (1, 1), 'pied_g.r': 0, 'pied_d.r': 0, 'pied_g.p': (0, 0), 'pied_d.p': (0, 0),
    'rage': 0, 'bouchon': 0, 'pli_g': 1, 'encre_queue': 0,
    'sourcil_g': 'colere', 'sourcil_d': 'colere', 'sourcil_g.p': (0, 0), 'sourcil_d.p': (0, 0),
    'plis': 'colere',
    'bouche': 'moue', 'bouche.s': (1, 1), 'bouche.p': (0, 0), 'bouche.r': 0,
    'yeux.p': (0, 0),
}


def assets():
    out = []
    for nom, i in INFO.items():
        out.append(L.asset_png('tr_' + nom, f'{ICI}/final/{nom}.png', i['w'], i['h']))
    return out


class Timeline:
    def __init__(self, nom, duree):
        self.nom = nom
        self.duree = duree
        self.ch = defaultdict(list)
        self.yeux = [(0, 'base')]
        self.dents = [(0, 0)]
        self.fx = []           # fonctions (t0, ind, ip, op, parents) -> liste de calques
        self.remplissage = None  # (t_debut, t_fin, 'monte' | 'descend') : bascule normal <-> rouge

    def k(self, nom, t, v, e='doux'):
        self.ch[nom].append((t, v, e))
        return self

    def seq(self, nom, liste, e='doux'):
        for it in liste:
            if len(it) == 3:
                self.k(nom, it[0], it[1], it[2])
            else:
                self.k(nom, it[0], it[1], e)
        return self

    def oeil(self, t, etat):
        self.yeux.append((t, etat))
        return self

    def valeur(self, nom, t):
        """Valeur du canal a l'instant t (lineaire, pour verification de raccord)."""
        ks = sorted(self.ch.get(nom, []), key=lambda k: k[0])
        if not ks:
            return REPOS[nom]
        if t <= ks[0][0]:
            return ks[0][1]
        if t >= ks[-1][0]:
            return ks[-1][1]
        for a, b in zip(ks, ks[1:]):
            if a[0] <= t <= b[0]:
                return a[1] if t - a[0] < b[0] - t else b[1]

    def eval(self, nom, t):
        """Valeur exacte (avec l'easing de Lottie) du canal numerique 'nom' a l'instant t."""
        ks = sorted(self.ch.get(nom, []), key=lambda k: k[0])
        if not ks:
            return np.atleast_1d(np.asarray(REPOS[nom], float))
        if t <= ks[0][0]:
            return np.atleast_1d(np.asarray(ks[0][1], float))
        if t >= ks[-1][0]:
            return np.atleast_1d(np.asarray(ks[-1][1], float))
        for a, b in zip(ks, ks[1:]):
            if a[0] <= t <= b[0]:
                va, vb = np.atleast_1d(np.asarray(a[1], float)), np.atleast_1d(np.asarray(b[1], float))
                if a[2] == 'hold':
                    return va
                x1, y1, x2, y2 = L.EASE[a[2]] if isinstance(a[2], str) else a[2]
                u = (t - a[0]) / max(b[0] - a[0], 1e-9)
                return va + (vb - va) * _bezier_y(u, x1, y1, x2, y2)

    def nettoie(self):
        """Trie les cles et supprime les doublons d'instant (la derniere ecrite gagne)."""
        doublons = []
        for nom, ks in self.ch.items():
            par_t = {}
            for k in ks:
                if k[0] in par_t:
                    doublons.append((nom, k[0]))
                par_t[k[0]] = k
            self.ch[nom] = [par_t[t] for t in sorted(par_t)]
        return doublons

    def verifie_raccords(self, boucle=False):
        """Chaque canal doit etre au repos a 0 et a la fin (sinon le raccord avec l'idle saute)."""
        pb = []
        for nom, ks in self.ch.items():
            ks = sorted(ks, key=lambda k: k[0])
            if nom == 'encre_queue':          # calque jamais visible au repos
                continue
            for t in (0, self.duree):
                v = self.valeur(nom, t)
                r = REPOS[nom]
                if nom == 'bouchon':              # en mode rouge, le petit triangle de fond est bouche
                    rouge = {'bascule': t > 0, 'calme': t == 0}.get(self.nom, True)
                    r = 1.0 if rouge else 0.0
                if isinstance(r, str) or isinstance(v, (str, Chemin)):
                    ok = (v == r)
                else:
                    ok = np.allclose(np.atleast_1d(v), np.atleast_1d(r), atol=1e-6)
                if not ok:
                    pb.append(f'{self.nom}: canal {nom} a t={t} vaut {v} au lieu de {r}')
            if ks[0][0] != 0 or ks[-1][0] != self.duree:
                pb.append(f'{self.nom}: canal {nom} ne couvre pas 0..{self.duree} ({ks[0][0]}..{ks[-1][0]})')
        ys = sorted(self.yeux)
        if ys[0] != (0, 'base') or ys[-1][1] != 'base':
            pb.append(f'{self.nom}: yeux ne commencent/finissent pas sur base')
        return pb


Y_BAS, Y_HAUT = 832.0, -14.0   # sous le menton / au-dessus des oreilles (repere de la tete)


def chemin_ligne(t, ta, tb, sens):
    """Zone (fermee) AU-DESSUS d'une ligne ondulee a l'instant t. 'monte' : la ligne part du bas
    (Taro normal partout) et monte (le rouge remplit la tete de bas en haut). 'descend' : l'inverse."""
    from vecteur import lisse, Chemin
    u = np.clip((t - ta) / max(tb - ta, 1e-6), 0, 1)
    e = _bezier_y(u, 0.55, 0.0, 0.8, 1.0) if sens == 'monte' else _bezier_y(u, 0.3, 0.0, 0.6, 1.0)
    if sens == 'monte':
        y = Y_BAS + (Y_HAUT - Y_BAS) * e
    else:
        y = Y_HAUT + (Y_BAS - Y_HAUT) * e
    # ondulation qui voyage (liquide qui monte), plus forte au milieu de la course
    amp = 11.0 * np.sin(np.pi * u) + 2.0
    xs = np.linspace(1500, -250, 23)
    ph = t * 0.55
    vague = [(x, y + amp * np.sin(x / 92.0 + ph) + 0.4 * amp * np.sin(x / 41.0 - ph * 1.7)) for x in xs]
    w = lisse(vague, ferme=False, tension=1.0)
    v = np.vstack([[[-250, -700], [1500, -700]], w.v])
    i_ = np.vstack([[[0, 0], [0, 0]], w.i])
    o_ = np.vstack([[[0, 0], [0, 0]], w.o])
    i_[2] = 0
    o_[-1] = 0
    return Chemin(v, i_, o_, True)


def _bezier_y(u, x1, y1, x2, y2):
    """Easing cubic-bezier (0,0)-(x1,y1)-(x2,y2)-(1,1) : y pour x = u."""
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        x = 3 * (1 - m) ** 2 * m * x1 + 3 * (1 - m) * m ** 2 * x2 + m ** 3
        if x < u:
            lo = m
        else:
            hi = m
    m = (lo + hi) / 2
    return 3 * (1 - m) ** 2 * m * y1 + 3 * (1 - m) * m ** 2 * y2 + m ** 3


# ------------------------------------------------------------------ conversions de canaux
def _decale(keys, t0):
    return [(t + t0, v, e) for (t, v, e) in keys]


def p_prop(keys, repos_xy, t0):
    if not keys:
        return {'a': 0, 'k': [repos_xy[0], repos_xy[1], 0]}
    return L.prop([(t + t0, [repos_xy[0] + v[0], repos_xy[1] + v[1], 0], e) for (t, v, e) in keys])


def s_prop(keys, t0):
    if not keys:
        return {'a': 0, 'k': [100, 100, 100]}
    return L.prop([(t + t0, [100 * v[0], 100 * v[1], 100], e) for (t, v, e) in keys])


def r_prop(keys, t0):
    if not keys:
        return {'a': 0, 'k': 0}
    return L.prop([(t + t0, v, e) for (t, v, e) in keys])


def o_prop(keys, t0, f=lambda v: 100 * v):
    if not keys:
        return {'a': 0, 'k': 0}
    return L.prop([(t + t0, f(v), e) for (t, v, e) in keys])


def chemin_prop(keys, resol, t0):
    return L.prop_chemin([(t + t0, resol(v) if isinstance(v, str) else v, e) for (t, v, e) in keys])


def holds(liste, t0, actif):
    """Opacite en paliers : 100 quand l'etat 'actif' est en cours."""
    liste = sorted(liste)
    keys = []
    for t, etat in liste:
        v = 100 if etat == actif else 0
        if keys and keys[-1][1] == v:
            continue
        keys.append((t + t0, v, 'hold'))
    if len(keys) == 1:
        return {'a': 0, 'k': keys[0][1]}
    return L.prop(keys, hold=True)


# ------------------------------------------------------------------ construction
class Indices:
    def __init__(self, depart):
        self.n = depart

    def __call__(self):
        self.n += 1
        return self.n


def construit(tl, t0, ind0, decalage_scene=(0, 0)):
    """Renvoie la liste des calques (ordre Lottie : premier = devant) pour la timeline tl,
    placee a l'instant t0 du fichier."""
    tl.nettoie()
    ip, op = t0, t0 + tl.duree + 1
    I = Indices(ind0)
    C = tl.ch
    nm = lambda s: f'{tl.nom}.{s}'
    # --- nulls
    i_scene, i_root, i_tete, i_og, i_od = I(), I(), I(), I(), I()
    i_torse, i_eg, i_cg, i_ed, i_cd, i_jg, i_jd, i_pg, i_pd = I(), I(), I(), I(), I(), I(), I(), I(), I()

    def articulation(nom, ind, piv, parent, r=None, p=None, s=None):
        return L.calque_null(nm(nom), ind, ip, op, L.ks(
            p=p_prop(C[p], piv, t0) if p else {'a': 0, 'k': [piv[0], piv[1], 0]},
            a={'a': 0, 'k': [piv[0], piv[1], 0]},
            r=r_prop(C[r], t0) if r else None, s=s_prop(C[s], t0) if s else None), parent=parent)

    nulls = [
        L.calque_null(nm('scene'), i_scene, ip, op, L.ks(p={'a': 0, 'k': [decalage_scene[0], decalage_scene[1], 0]})),
        L.calque_null(nm('root'), i_root, ip, op, L.ks(
            p=p_prop(C['root.p'], PIV_ROOT, t0), a={'a': 0, 'k': [PIV_ROOT[0], PIV_ROOT[1], 0]},
            s=s_prop(C['root.s'], t0), r=r_prop(C['root.r'], t0)), parent=i_scene),
        articulation('torse', i_torse, PIV_TORSE, i_root, r='torse.r', p='torse.p', s='torse.s'),
        L.calque_null(nm('tete'), i_tete, ip, op, L.ks(
            p=p_prop(C['tete.p'], PIV_TETE, t0), a={'a': 0, 'k': [PIV_TETE[0], PIV_TETE[1], 0]},
            s=s_prop(C['tete.s'], t0), r=r_prop(C['tete.r'], t0)), parent=i_torse),
        articulation('epaule_g', i_eg, S_G, i_torse, r='epaule_g.r', p='epaule_g.p'),
        articulation('coude_g', i_cg, E_G, i_eg, r='coude_g.r'),
        articulation('epaule_d', i_ed, S_D, i_torse, r='epaule_d.r', p='epaule_d.p'),
        articulation('coude_d', i_cd, E_D, i_ed, r='coude_d.r'),
        articulation('jambe_g', i_jg, H_JAMBE, i_root, r='jambe_g.r'),
        articulation('jambe_d', i_jd, H_JAMBE, i_root, r='jambe_d.r'),
        articulation('pied_g', i_pg, TALON_G, i_jg, r='pied_g.r', p='pied_g.p'),
        articulation('pied_d', i_pd, TALON_D, i_jd, r='pied_d.r', p='pied_d.p'),
    ]
    for cote, i_o in (('g', i_og), ('d', i_od)):
        pv = PIV_OREILLE[cote]
        nulls.append(L.calque_null(nm(f'oreille_{cote}'), i_o, ip, op, L.ks(
            p={'a': 0, 'k': [pv[0], pv[1], 0]}, a={'a': 0, 'k': [pv[0], pv[1], 0]},
            r=r_prop(C[f'oreille_{cote}.r'], t0)), parent=i_tete))

    def img(nom, parent, o=None, pivot=None, r=None, s=None, p_extra=None):
        i = INFO[nom]
        if pivot is None:
            ks_ = L.ks(p={'a': 0, 'k': [i['x'], i['y'], 0]}, o=o)
            if p_extra is not None:
                ks_['p'] = p_prop(p_extra, (i['x'], i['y']), t0)
        else:
            ks_ = L.ks(p={'a': 0, 'k': [pivot[0], pivot[1], 0]},
                       a={'a': 0, 'k': [pivot[0] - i['x'], pivot[1] - i['y'], 0]}, o=o, r=r, s=s)
        return L.calque_image(nm(nom), I(), ip, op, 'tr_' + nom, ks_, parent=parent)

    rage_o = o_prop(C['rage'], t0) if C['rage'] else None
    fixe0 = {'a': 0, 'k': 0}

    # --- visage vectoriel
    def bouche_ks():
        return L.ks(p=p_prop(C['bouche.p'], TR.BOUCHE_C, t0), a={'a': 0, 'k': [TR.BOUCHE_C[0], TR.BOUCHE_C[1], 0]},
                    s=s_prop(C['bouche.s'], t0), r=r_prop(C['bouche.r'], t0))

    bk = C['bouche'] or [(0, 'moue', 'doux')]
    contour = L.calque_forme(nm('bouche_contour'), I(), ip, op, [L.groupe('bouche', [
        L.trace(chemin_prop(bk, TR.bouche, t0)), L.trait(TR.ENCRE, 12)])], bouche_ks(), parent=i_tete)
    matte = L.calque_forme(nm('bouche_matte'), I(), ip, op, [L.groupe('bouche', [
        L.trace(chemin_prop(bk, TR.bouche, t0)), L.rempli((1, 1, 1))])], bouche_ks(), parent=i_tete)
    matte['td'] = 1
    dents_o = holds(tl.dents, t0, 1) if len(tl.dents) > 1 else {'a': 0, 'k': 100 if tl.dents[0][1] else 0}
    interieur = L.calque_forme(nm('bouche_interieur'), I(), ip, op, [
        L.groupe('jonction', [L.trace(chemin_prop(bk, TR.ligne_dents, t0)), L.trait(TR.ENCRE, 5, o=dents_o)]),
        L.groupe('sep1', [L.trace(chemin_prop(bk, lambda e: TR.separations(e)[0], t0)), L.trait(TR.ENCRE, 4, o=dents_o)]),
        L.groupe('sep2', [L.trace(chemin_prop(bk, lambda e: TR.separations(e)[1], t0)), L.trait(TR.ENCRE, 4, o=dents_o)]),
        L.groupe('dents_haut', [L.trace(chemin_prop(bk, TR.dents_haut, t0)), L.rempli(TR.DENTS)]),
        L.groupe('dents_bas', [L.trace(chemin_prop(bk, TR.dents_bas, t0)), L.rempli(TR.DENTS)]),
        L.groupe('langue', [L.trace(chemin_prop(bk, TR.langue, t0)), L.rempli(TR.LANGUE)]),
        L.groupe('gorge', [L.trace(chemin_prop(bk, TR.bouche, t0)), L.rempli(TR.GORGE)]),
    ], bouche_ks(), parent=i_tete)
    interieur['tt'] = 1

    def sourcil_groupe(cote):
        keys = C[f'sourcil_{cote}'] or [(0, 'colere', 'doux')]
        tr_ = L.tr(p=p_prop(C[f'sourcil_{cote}.p'], (0, 0), t0) if C[f'sourcil_{cote}.p'] else (0, 0))
        return L.groupe(f'sourcil_{cote}', [L.trace(chemin_prop(keys, lambda e: TR.sourcil(cote, e), t0)),
                                            L.rempli(TR.ENCRE)], tr_)

    pk = C['plis'] or [(0, 'colere', 'doux')]
    plis_g = [L.groupe(f'pli{k}', [L.trace(chemin_prop(pk, lambda e, k=k: TR.plis(e)[k], t0)), L.rempli(TR.ENCRE)])
              for k in (0, 1)]
    sourcils = L.calque_forme(nm('sourcils'), I(), ip, op, [sourcil_groupe('g'), sourcil_groupe('d')] + plis_g,
                              parent=i_tete)

    # --- yeux
    yeux = []
    for etat in ETATS_YEUX:
        o = holds(tl.yeux, t0, etat)
        if o.get('a') == 0 and o['k'] == 0:
            continue   # etat jamais utilise dans cette animation
        for cote in ('g', 'd'):
            yeux.append(img(f'oeil_{cote}_{etat}', i_tete, o=o,
                            p_extra=C['yeux.p'] if (etat == 'fous' and C['yeux.p']) else None))

    # --- fx (calques devant / derriere)
    parents = {'scene': i_scene, 'root': i_root, 'tete': i_tete, 'torse': i_torse}
    devant, derriere, sous_bouche = [], [], []
    for f in tl.fx:
        for (place, calque) in f(t0, I, ip, op, parents):
            if isinstance(calque, tuple) and calque[0] == 'masque_tete':
                # calque-masque : silhouette de la tete (meme image, non affichee)
                m = img('masque_tete', i_tete)
                m['nm'] = nm('masque_tete')
                m['ip'], m['op'] = calque[1], calque[2]
                m['td'] = 1
                calque = m
            {'devant': devant, 'derriere': derriere, 'sous_bouche': sous_bouche}[place].append(calque)

    # --- bascule normal <-> rouge : le Taro normal recouvre le Taro rouge au-dessus d'une ligne ondulee
    #     (repere de la tete) qui monte (normal -> rouge) ou descend (rouge -> normal)
    sur_visage, sur_oreille = [], {'g': [], 'd': []}
    if tl.remplissage:
        ta, tb, sens = tl.remplissage
        fin_overlay = op if sens == 'descend' else t0 + tb + 1
        def ligne_cle(t):
            return chemin_ligne(t, ta, tb, sens)
        keys = []
        pas = 1
        t = 0
        while t <= tl.duree:
            if (t < ta - 2 or t > tb + 2) and t not in (0, tl.duree):
                t += pas
                continue
            keys.append((t, ligne_cle(t), 'lin'))
            t += pas
        def matte_ligne(nom_):
            m = L.calque_forme(nm(nom_), I(), ip, fin_overlay, [L.groupe('zone', [
                L.trace(chemin_prop(keys, None, t0)), L.rempli((1, 1, 1))])], parent=i_tete)
            m['td'] = 1
            return m
        def normal(nom_, parent):
            c = img(nom_, parent)
            c['op'] = fin_overlay
            c['tt'] = 1
            return c
        sur_visage = [matte_ligne('remplissage_tete'), normal('tete_normal', i_tete)]
        for cote, i_o in (('g', i_og), ('d', i_od)):
            sur_oreille[cote] = [matte_ligne(f'remplissage_oreille_{cote}'), normal(f'oreille_{cote}_normal', i_o)]

    pile = []
    nulls_tasse = []
    pile += devant
    # corps articule : capuche avant (languettes), bras (chaque avant-bras devant son haut de bras), torse seul
    pile.append(img('corps_capuche_avant', i_torse))
    pile.append(img('corps_avbras_g', i_cg))
    # raccord arrondi du haut du poing replie (encre) : apparait quand le pli du coude s'efface
    pile.append(img('corps_raccord_g', i_cg, o=o_prop(C['pli_g'], t0, f=lambda v: 100 * (1 - v)) if C['pli_g'] else {'a': 0, 'k': 0}))
    # pli du coude gauche et ombre du coude : s'effacent quand le poing se replie sur la poitrine
    pile.append(img('corps_pli_coude_g', i_eg, o=o_prop(C['pli_g'], t0) if C['pli_g'] else {'a': 0, 'k': 100}))
    pile.append(img('corps_bras_g', i_eg))
    pile.append(img('corps_avbras_d', i_cd))
    pile.append(img('corps_bras_d', i_ed))
    # sweat d'origine sous le poing gauche (ombre du poing) : s'efface quand le poing quitte la hanche
    pile.append(img('corps_hanche_g', i_torse, o=o_prop(C['pli_g'], t0) if C['pli_g'] else {'a': 0, 'k': 100}))
    pile.append(img('corps_torse', i_torse))
    pile += sur_visage
    pile += [contour, matte, interieur]
    pile += sous_bouche
    pile.append(sourcils)
    pile += yeux
    if rage_o is not None:
        pile.append(img('tete_rage', i_tete, o=rage_o))
    pile.append(img('tete_rouge', i_tete))
    for cote, i_o in (('g', i_og), ('d', i_od)):
        pile += sur_oreille[cote]
        if rage_o is not None:
            pile.append(img(f'oreille_{cote}_rage', i_o, o=rage_o))
        pile.append(img(f'oreille_{cote}_rouge', i_o))
    pile.append(img('cou', i_torse, pivot=PIV_COU, s=s_prop(C['cou.s'], t0)))
    # jambes (la gauche devant la droite) et pieds, derriere l'ourlet du sweat
    # (le short se tasse quand le genou monte : le bas de la jambe suit le pied, la chaussure reste visible)
    for cote, i_j in (('g', i_jg), ('d', i_jd)):
        i_a, i_b = I(), I()
        piv = {'a': 0, 'k': [TASSE_P0[0], TASSE_P0[1], 0]}
        nulls_tasse.append(L.calque_null(nm(f'tasse_{cote}_axe'), i_a, ip, op, L.ks(
            p=piv, a=piv, r={'a': 0, 'k': TASSE_ANGLE[cote]}), parent=i_j))
        nulls_tasse.append(L.calque_null(nm(f'tasse_{cote}'), i_b, ip, op, L.ks(
            p=piv, a=piv, s=s_prop(C[f'jambe_{cote}.s'], t0)), parent=i_a))
        pile.append(img(f'corps_jambe_{cote}', i_b, pivot=TASSE_P0, r={'a': 0, 'k': -TASSE_ANGLE[cote]}))
    pile.append(img('corps_pied_g', i_pg))
    pile.append(img('corps_pied_d', i_pd))
    # joint d'encre pose sur le haut de la queue (meme transformation que la queue), cache par la tete au repos
    from joint import polygone
    from vecteur import Chemin
    traces = [L.trace({'a': 0, 'k': Chemin(p_, ferme=True).lottie()}, nm=f'joint{k}') for k, p_ in enumerate(polygone())]
    pile.append(L.calque_forme(nm('joint_queue'), I(), ip, op, [L.groupe('joint', traces + [L.rempli(TR.ENCRE)])],
        L.ks(p={'a': 0, 'k': [PIV_QUEUE[0], PIV_QUEUE[1], 0]}, a={'a': 0, 'k': [PIV_QUEUE[0], PIV_QUEUE[1], 0]},
             r=r_prop(C['queue.r'], t0), s=s_prop(C['queue.s'], t0)), parent=i_torse))
    # bouchon de fourrure sur le petit triangle de fond : visible seulement quand la queue ou la tete bougent beaucoup
    # ombre de la joue sur la queue : suit la tete, masquee par la queue (track matte alpha)
    m_q = img('queue', i_torse, pivot=PIV_QUEUE, r=r_prop(C['queue.r'], t0), s=s_prop(C['queue.s'], t0))
    m_q['nm'] = nm('matte_ombre_joue')
    m_q['td'] = 1
    o_j = img('ombre_joue', i_tete)
    o_j['tt'] = 1
    pile += [m_q, o_j]
    pile.append(img('queue_bouchon', i_torse, pivot=PIV_QUEUE, r=r_prop(C['queue.r'], t0), s=s_prop(C['queue.s'], t0),
                    o=o_prop(C['bouchon'], t0)))
    pile.append(img('queue', i_torse, pivot=PIV_QUEUE, r=r_prop(C['queue.r'], t0), s=s_prop(C['queue.s'], t0)))
    # encre sous le bord droit de la queue (fente de fond aux atterrissages de « explose » seulement)
    pile.append(img('queue_encre', i_torse, pivot=PIV_QUEUE, r=r_prop(C['queue.r'], t0), s=s_prop(C['queue.s'], t0),
                    o=o_prop(C['encre_queue'], t0) if C['encre_queue'] else {'a': 0, 'k': 0}))
    pile.append(img('capuche', i_torse))
    pile += derriere
    pile += nulls
    pile += nulls_tasse
    return pile, I.n


def fichier(nom, w, h, op, couches, marqueurs=None):
    utilises = {c.get('refId') for c in couches if c.get('ty') == 2}
    d = {'v': '5.7.4', 'fr': 30, 'ip': 0, 'op': op, 'w': w, 'h': h, 'nm': nom, 'ddd': 0,
         'assets': [a for a in assets() if a['id'] in utilises], 'layers': couches}
    if marqueurs:
        d['markers'] = marqueurs
    return d


def _M(t=(0, 0), r=0.0, s=(1, 1), pivot=(0, 0)):
    px, py = pivot
    c, si = np.cos(np.radians(r)), np.sin(np.radians(r))
    T1 = np.array([[1, 0, -px], [0, 1, -py], [0, 0, 1]], float)
    S = np.diag([s[0], s[1], 1.0])
    R = np.array([[c, -si, 0], [si, c, 0], [0, 0, 1]], float)
    T2 = np.array([[1, 0, px + t[0]], [0, 1, py + t[1]], [0, 0, 1]], float)
    return T2 @ R @ S @ T1


def monde(tl, pt, t, os_='tete'):
    """Position (repere scene, sans decalage de cadre) d'un point de la tete/du corps a l'instant t."""
    Mr = _M(tl.eval('root.p', t), float(tl.eval('root.r', t)[0]), tl.eval('root.s', t), PIV_ROOT)
    M = Mr
    if os_ in ('tete', 'torse'):
        M = Mr @ _M(tl.eval('torse.p', t), float(tl.eval('torse.r', t)[0]), tl.eval('torse.s', t), PIV_TORSE)
    if os_ == 'tete':
        M = M @ _M(tl.eval('tete.p', t), float(tl.eval('tete.r', t)[0]), tl.eval('tete.s', t), PIV_TETE)
    v = M @ np.array([pt[0], pt[1], 1.0])
    return v[:2]


def tremble(tl, canal, t0, t1, amp0, amp1, periode=2, base=None, axe=None, graine=0, e='vif'):
    """Ajoute un tremblement alterne sur 'canal' entre t0 et t1 (amplitude interpolee amp0 -> amp1).
    base : fonction t -> valeur de base (scalaire ou vecteur) ; axe : vecteur (pour p/s)."""
    rng = np.random.default_rng(graine)
    n = int((t1 - t0) // periode)
    signe = 1
    for k in range(1, n):
        t = t0 + k * periode
        u = (t - t0) / max(t1 - t0, 1)
        a = amp0 + (amp1 - amp0) * u
        a *= rng.uniform(0.8, 1.15)
        b = base(t) if base else 0
        if axe is None:
            v = b + signe * a
        else:
            jitter = np.asarray(axe, float) * signe * a + rng.uniform(-0.35, 0.35, 2) * a
            v = tuple(np.asarray(b, float) + jitter)
        tl.k(canal, t, v, e)
        signe = -signe
    return tl
