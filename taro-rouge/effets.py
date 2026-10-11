"""Effets de manga vectoriels (style des symboles de Talkana : couleur pleine + gros contour encre).
Chaque fabrique renvoie une fonction f(t0, I, ip, op, parents) -> [(place, calque), ...]
ou place vaut 'devant', 'derriere' ou 'sous_bouche'."""
import numpy as np
import lottie_base as L
from vecteur import Chemin, lisse

ENCRE = (0.075, 0.020, 0.018)
ROUGE_VEINE = (0.90, 0.16, 0.14)
BLANC = (1.0, 1.0, 1.0)
EAU = (0.60, 0.83, 0.97)
EAU_CLAIRE = (0.86, 0.95, 1.0)
VAPEUR = (0.99, 0.97, 0.96)


def _ks_simple(p_keys, t0, s_keys=None, r_keys=None, o_keys=None, a=(0, 0)):
    p = L.prop([(t + t0, [v[0], v[1], 0], e) for (t, v, e) in p_keys]) if len(p_keys) > 1 \
        else {'a': 0, 'k': [p_keys[0][1][0], p_keys[0][1][1], 0]}
    s = L.prop([(t + t0, [v * 100, v * 100, 100] if np.isscalar(v) else [v[0] * 100, v[1] * 100, 100], e)
                for (t, v, e) in s_keys]) if s_keys else None
    r = L.prop([(t + t0, v, e) for (t, v, e) in r_keys]) if r_keys else None
    o = L.prop([(t + t0, v, e) for (t, v, e) in o_keys]) if o_keys else None
    return L.ks(p=p, a={'a': 0, 'k': [a[0], a[1], 0]}, s=s, r=r, o=o)


def _ellipse(cx, cy, r):
    return {'ty': 'el', 'nm': 'el', 'p': {'a': 0, 'k': [cx, cy]}, 's': {'a': 0, 'k': [2 * r, 2 * r]}, 'd': 1, 'hd': False}


# ------------------------------------------------------------------ veine de colere (💢)
def _crochet(angle, R=56.0, g=14.0):
    """Un des quatre crochets de la veine, dans le quadrant 'angle' (deg), bombe vers le centre."""
    t = np.radians(angle)
    c, s = np.cos(t), np.sin(t)
    rot = lambda p: np.array([p[0] * c - p[1] * s, p[0] * s + p[1] * c])
    A, B = rot((g, R)), rot((R, g))
    # tangentes : partent vers le centre puis reviennent (crochet bien creuse)
    tA = rot((0.0, -0.9 * R))
    tB = rot((-0.9 * R, 0.0))
    return Chemin([A, B], i=[[0, 0], tB], o=[tA, [0, 0]], ferme=False)


def veine(pos, t_on, t_off, battements=(), parent='tete', echelle=1.0, rot=-12, place='devant'):
    """Veine qui gonfle (pop avec rebond), bat sur 'battements', puis se resorbe."""
    def f(t0, I, ip, op, P):
        items = []
        for a in (0, 90, 180, 270):
            ch = _crochet(a)
            items.append(L.groupe(f'c{a}', [L.trace({'a': 0, 'k': ch.lottie()}), L.trait(ROUGE_VEINE, 14)]))
        for a in (0, 90, 180, 270):
            ch = _crochet(a)
            items.append(L.groupe(f'e{a}', [L.trace({'a': 0, 'k': ch.lottie()}), L.trait(ENCRE, 28)]))
        e = echelle
        sk = [(t_on, 0, 'sortie'), (t_on + 4, 1.28 * e, 'doux'), (t_on + 8, 0.9 * e, 'doux'), (t_on + 11, 1.0 * e, 'doux')]
        t = t_on + 11
        for b in battements:
            if b <= t + 2 or b >= t_off - 5:
                continue
            sk += [(b, 1.0 * e, 'sortie'), (b + 2, 1.2 * e, 'doux'), (b + 6, 1.0 * e, 'doux')]
            t = b + 6
        sk += [(t_off - 5, 1.0 * e, 'doux'), (t_off - 2, 1.18 * e, 'entree'), (t_off, 0, 'lin')]
        lay = L.calque_forme('veine', I(), max(ip, t0 + t_on), min(op, t0 + t_off + 1), items,
                             _ks_simple([(0, pos, 'lin')], t0, s_keys=sk, r_keys=[(t_on, rot - 8, 'sortie'), (t_on + 8, rot, 'doux')]),
                             parent=P[parent])
        return [(place, lay)]
    return f


# ------------------------------------------------------------------ vapeur
def _nuage(r=30.0):
    cercles = [(0, 0, r), (-0.86 * r, 0.30 * r, 0.72 * r), (0.80 * r, 0.34 * r, 0.66 * r), (0.1 * r, -0.55 * r, 0.62 * r)]
    blanc = L.groupe('blanc', [_ellipse(x, y, rr) for (x, y, rr) in cercles] + [L.rempli(VAPEUR)])
    encre = L.groupe('encre', [_ellipse(x, y, rr + 7) for (x, y, rr) in cercles] + [L.rempli(ENCRE)])
    return [blanc, encre]


def bouffee(depart, arrivee, t_on, duree, r=30.0, parent='tete', place='devant', taille_max=1.25, rot=0):
    """Une bouffee de vapeur : jaillit de 'depart', file vers 'arrivee', grossit puis se dissipe."""
    def f(t0, I, ip, op, P):
        d = np.asarray(depart, float)
        a = np.asarray(arrivee, float)
        m = d + (a - d) * 0.62
        pk = [(t_on, d, 'sortie'), (t_on + duree * 0.45, m, 'doux'), (t_on + duree, a, 'lin')]
        sk = [(t_on, 0.15, 'sortie'), (t_on + duree * 0.35, taille_max * 0.85, 'doux'),
              (t_on + duree * 0.7, taille_max, 'entree'), (t_on + duree, 0.0, 'lin')]
        ok = [(t_on, 100, 'lin'), (t_on + duree, 100, 'lin')]
        lay = L.calque_forme('vapeur', I(), max(ip, int(t0 + t_on)), min(op, int(t0 + t_on + duree) + 1), _nuage(r),
                             _ks_simple(pk, t0, s_keys=sk, o_keys=ok, r_keys=[(t_on, rot - 10, 'doux'), (t_on + duree, rot + 10, 'lin')]),
                             parent=P[parent])
        return [(place, lay)]
    return f


# ------------------------------------------------------------------ traits de cri (emanata)
def traits_cri(centre, salves, n=7, r1=330.0, r2=420.0, a0=-168, a1=-12, parent='tete', larg=13.0, graine=1):
    """Rayons qui jaillissent autour de la tete a chaque salve (t, duree)."""
    def f(t0, I, ip, op, P):
        rng = np.random.default_rng(graine)
        out = []
        angs = np.linspace(a0, a1, n)
        for k, ang in enumerate(angs):
            ang += rng.uniform(-6, 6)
            t = np.radians(ang)
            u = np.array([np.cos(t), np.sin(t)])
            rr1 = r1 * rng.uniform(0.95, 1.05)
            rr2 = r2 * rng.uniform(0.9, 1.08)
            A = np.asarray(centre) + u * rr1
            B = np.asarray(centre) + u * rr2
            ch = Chemin([A, B], ferme=False)
            ek, sk = [], []
            for (ts, du) in salves:
                dec = rng.uniform(0, 2)
                ek += [(ts + dec, 0, 'sortie'), (ts + dec + du * 0.4, 100, 'lin')]
                sk += [(ts + dec, 0, 'lin'), (ts + dec + du * 0.45, 0, 'entree'), (ts + dec + du, 100, 'hold')]
            ek.append((salves[-1][0] + salves[-1][1] + 3, 100, 'lin'))
            sk.append((salves[-1][0] + salves[-1][1] + 3, 100, 'lin'))
            items = [L.groupe('rayon', [L.trace({'a': 0, 'k': ch.lottie()}),
                                        L.coupe(s=L.prop([(t + t0, v, e) for (t, v, e) in sk]),
                                                e=L.prop([(t + t0, v, e) for (t, v, e) in ek])),
                                        L.trait(ENCRE, larg)])]
            t_deb = int(salves[0][0])
            t_fin = int(salves[-1][0] + salves[-1][1] + 4)
            out.append(('devant', L.calque_forme(f'cri{k}', I(), max(ip, t0 + t_deb), min(op, t0 + t_fin), items,
                                                 parent=P[parent])))
        return out
    return f


# ------------------------------------------------------------------ larmes
def _ruban(points, larg, ferme_bas=True):
    """Ruban a largeur variable le long d'une polyligne (n points) -> chemin ferme de 2n sommets."""
    P = np.asarray(points, float)
    tg = np.gradient(P, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-tg[:, 1], tg[:, 0]], 1)
    Lg = np.asarray(larg, float)[:, None]
    g = P + nrm * Lg / 2
    d = P - nrm * Lg / 2
    return lisse(np.vstack([g, d[::-1]]), ferme=True, tension=0.85)


def _flot(depart, direction, longueur, phase, n=9, larg0=30.0, larg1=58.0, ondul=10.0):
    """Points d'un flot de larmes ondulant ; 'longueur' 0..1 de la longueur max."""
    d0 = np.asarray(depart, float)
    u = np.asarray(direction, float)
    u /= np.linalg.norm(u)
    v = np.array([-u[1], u[0]])
    ts = np.linspace(0, 1, n)
    Lmax = 250.0 * longueur + 8
    pts = d0 + u[None] * (ts[:, None] * Lmax) + v[None] * (np.sin(ts * 6.5 + phase) * ondul * (0.3 + ts))[:, None]
    larg = larg0 + (larg1 - larg0) * ts ** 0.8
    larg *= 1.0 + 0.10 * np.sin(ts * 9.0 + phase * 1.3)
    larg[-1] *= 0.85
    return pts, larg


def flots_larmes(coins, t_on, t_off, parent='tete', dir_g=(-0.18, 1.0), dir_d=(0.22, 1.0)):
    """Deux ruisseaux de larmes depuis les coins exterieurs des yeux, dans un seul calque
    (masque par la silhouette de la tete : les larmes coulent sur les joues et s'arretent au menton)."""
    def f(t0, I, ip, op, P):
        groupes = []
        for k, (coin, dirn) in enumerate(zip(coins, (dir_g, dir_d))):
            keys, reflet = [], []
            etapes = [(t_on, 0.0, 0.0), (t_on + 6, 0.55, 0.6), (t_on + 12, 1.0, 1.4)]
            t = t_on + 12
            ph = 1.4
            while t + 5 < t_off - 10:
                t += 5
                ph += 1.15
                etapes.append((t, 1.0 if (len(etapes) % 2) else 0.94, ph))
            etapes += [(t_off - 8, 0.7, ph + 1.0), (t_off, 0.0, ph + 1.6)]
            for (t, lg, ph) in etapes:
                pts, larg = _flot(coin, dirn, lg, ph + k * 0.9)
                keys.append((t, _ruban(pts, larg), 'doux'))
                q = pts + np.array([-9.0, 0.0]) * (1 if k == 0 else -1)
                reflet.append((t, lisse(q[1:6], ferme=False), 'doux'))
            groupes.append(L.groupe(f'reflet{k}', [L.trace(L.prop_chemin([(t + t0, c, e) for (t, c, e) in reflet])),
                                                   L.trait(EAU_CLAIRE, 8)]))
            groupes.append(L.groupe(f'eau{k}', [L.trace(L.prop_chemin([(t + t0, c, e) for (t, c, e) in keys])),
                                                L.rempli(EAU), L.trait(ENCRE, 8)]))
        ip2, op2 = max(ip, t0 + t_on), min(op, t0 + t_off + 1)
        larmes = L.calque_forme('larmes', I(), ip2, op2, groupes, parent=P[parent])
        larmes['tt'] = 1
        return [('sous_bouche', ('masque_tete', ip2, op2)), ('sous_bouche', larmes)]
    return f


def _goutte(r=17.0):
    """Goutte, pointe vers le haut (-y) ; sommets : pointe, flanc droit, bas, flanc gauche."""
    v = [(0, -2.2 * r), (r, 0.15 * r), (0, r), (-r, 0.15 * r)]
    i = [(-0.2 * r, 0.8 * r), (0, -0.9 * r), (0.55 * r, 0), (0, 0.55 * r)]
    o = [(0.2 * r, 0.8 * r), (0, 0.55 * r), (-0.55 * r, 0), (0, -0.9 * r)]
    return Chemin(v, i=i, o=o, ferme=True)


def goutte(depart, vitesse, t_on, duree, parent='scene', r=17.0, gravite=1.6, place='devant'):
    """Goutte projetee : trajectoire balistique, orientee dans le sens du mouvement."""
    def f(t0, I, ip, op, P):
        d = np.asarray(depart, float)
        v = np.asarray(vitesse, float)
        pk, rk = [], []
        n = 5
        for j in range(n + 1):
            t = duree * j / n
            pos = d + v * t + np.array([0, 0.5 * gravite * t * t])
            vel = v + np.array([0, gravite * t])
            ang = np.degrees(np.arctan2(vel[1], vel[0])) + 90 + 180   # pointe a l'arriere
            pk.append((t_on + t, pos, 'lin'))
            rk.append((t_on + t, ang, 'lin'))
        sk = [(t_on, 0.2, 'sortie'), (t_on + 3, 1.0, 'doux'), (t_on + duree * 0.8, 0.9, 'doux'), (t_on + duree, 0.6, 'lin')]
        ok = [(t_on, 100, 'lin'), (t_on + duree - 4, 100, 'lin'), (t_on + duree, 0, 'lin')]
        ch = _goutte(r)
        items = [L.groupe('reflet', [_ellipse(-0.35 * r, -0.05 * r, 0.22 * r), L.rempli(BLANC)]),
                 L.groupe('goutte', [L.trace({'a': 0, 'k': ch.lottie()}), L.rempli(EAU), L.trait(ENCRE, 6)])]
        lay = L.calque_forme('goutte', I(), max(ip, int(t0 + t_on)), min(op, int(t0 + t_on + duree) + 1), items,
                             _ks_simple(pk, t0, s_keys=sk, r_keys=rk, o_keys=ok), parent=P[parent])
        return [(place, lay)]
    return f


# ------------------------------------------------------------------ choc au sol (trepignement)
def choc(t_on, pieds=((452.0, 1192.0), (842.0, 1192.0)), parent='scene', duree=9):
    """Petits traits d'impact qui fusent des pieds a l'atterrissage."""
    def f(t0, I, ip, op, P):
        out = []
        for k, (x, y) in enumerate(pieds):
            sgn = -1 if k == 0 else 1
            items = []
            for j, (ang, l0, l1) in enumerate(((-12, 40, 105), (-40, 36, 92), (-68, 30, 70))):
                t = np.radians(180 + ang if sgn < 0 else -ang)
                u = np.array([np.cos(t), np.sin(t)])
                A = np.array([x, y]) + u * l0 + np.array([sgn * 30, 0])
                B = np.array([x, y]) + u * l1 + np.array([sgn * 30, 0])
                ch = Chemin([A, B], ferme=False)
                ek = [(t_on, 0, 'sortie'), (t_on + duree * 0.45, 100, 'lin'), (t_on + duree, 100, 'lin')]
                sk = [(t_on, 0, 'lin'), (t_on + duree * 0.4, 0, 'entree'), (t_on + duree, 100, 'lin')]
                items.append(L.groupe(f'l{j}', [L.trace({'a': 0, 'k': ch.lottie()}),
                                                L.coupe(s=L.prop([(t + t0, v, e) for (t, v, e) in sk]),
                                                        e=L.prop([(t + t0, v, e) for (t, v, e) in ek])),
                                                L.trait(ENCRE, 11)]))
            out.append(('devant', L.calque_forme('choc', I(), max(ip, int(t0 + t_on)), min(op, int(t0 + t_on + duree) + 1),
                                                 items, parent=P[parent])))
        return out
    return f


def jet_vapeur(depart, direction, t_on, n=4, ecart=2, duree=20, r=40.0, portee=190.0, parent='scene',
               place='derriere', graine=0):
    """Jet de vapeur continu : n bouffees lachees toutes les 'ecart' images, en eventail serre."""
    rng = np.random.default_rng(graine)
    u = np.asarray(direction, float)
    u /= np.linalg.norm(u)
    v = np.array([-u[1], u[0]])
    fs = []
    for k in range(n):
        dev = rng.uniform(-0.18, 0.18)
        d = (u + v * dev)
        d /= np.linalg.norm(d)
        fin = np.asarray(depart, float) + d * portee * rng.uniform(0.85, 1.1)
        fs.append(bouffee(depart, fin, t_on + k * ecart, duree, r=r * rng.uniform(0.85, 1.12), parent=parent,
                          place=place, taille_max=rng.uniform(1.35, 1.6), rot=rng.uniform(-25, 25)))

    def f(t0, I, ip, op, P):
        out = []
        for g in fs:
            out += g(t0, I, ip, op, P)
        return out
    return f
