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
            if b <= t + 2 or b >= t_off - 12:
                continue
            sk += [(b, 1.0 * e, 'sortie'), (b + 2, 1.2 * e, 'doux'), (b + 6, 1.0 * e, 'doux')]
            t = b + 6
        sk += [(t_off - 9, 1.0 * e, 'doux'), (t_off - 6, 1.16 * e, 'sortie'), (t_off, 0, 'doux')]
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
            out.append(('derriere', L.calque_forme(f'cri{k}', I(), max(ip, t0 + t_deb), min(op, t0 + t_fin), items,
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


def _flot(depart, direction, longueur, phase, n=9, larg0=30.0, larg1=58.0, ondul=10.0, plein=250.0):
    """Points et largeurs d'un ruisseau de larmes ; 'longueur' 0..1 de la longueur max.
    L'ondulation a un nombre d'onde absolu (une perle courte reste droite, sans pli) et le haut
    reste accroche au coin de l'oeil."""
    d0 = np.asarray(depart, float)
    u = np.asarray(direction, float)
    u /= np.linalg.norm(u)
    v = np.array([-u[1], u[0]])
    ts = np.linspace(0, 1, n)
    Lmax = plein * longueur + 8
    s = ts * Lmax
    k = 6.5 / (plein + 8)
    amp = ondul * (0.3 + ts) * min(1.0, longueur * 1.4)
    pts = d0 + u[None] * s[:, None] + v[None] * ((np.sin(s * k + phase) - np.sin(phase)) * amp)[:, None]
    larg = larg0 + (larg1 - larg0) * ts ** 0.8
    larg *= 1.0 + 0.10 * np.sin(ts * 9.0 + phase * 1.3)
    larg *= 0.6 + 0.4 * min(1.0, longueur * 2.0)
    larg[-1] *= 0.85
    return pts, larg


def flots_larmes(coins, t_on, t_fin, t_off, parent='tete', dir_g=(-0.18, 1.0), dir_d=(0.22, 1.0)):
    """Deux ruisseaux de larmes depuis les coins exterieurs des yeux, dans un seul calque masque par
    l'interieur de la tete (ils passent derriere le contour du menton).
    Naissance : une perle qui gonfle au coin de l'oeil puis s'allonge. Fin (t_fin -> t_off) : le
    ruisseau s'ecoule par le menton (il se tasse vers son bout bas) avant que les yeux se rouvrent."""
    def f(t0, I, ip, op, P):
        groupes = []
        for k, (coin, dirn) in enumerate(zip(coins, (dir_g, dir_d))):
            u = np.asarray(dirn, float)
            u /= np.linalg.norm(u)
            bas = np.asarray(coin, float) + u * (250.0 + 8)
            keys, reflet = [], []
            etapes = [(t_on, 0.12, 0.0), (t_on + 6, 0.55, 0.6), (t_on + 12, 1.0, 1.4)]
            t, ph = t_on + 12, 1.4
            while t + 5 <= t_off:
                t += 5
                ph += 1.15
                etapes.append((t, 1.0 if (len(etapes) % 2) else 0.94, ph))
            for (t, lg, ph) in etapes:
                pts, larg = _flot(coin, dirn, lg, ph + k * 0.9)
                keys.append((t, _ruban(pts, larg), 'doux'))
                cote = -1 if k == 0 else 1
                q = pts + np.array([9.0 * cote, 0.0]) * (0.6 + 0.4 * min(1.0, lg * 2))
                reflet.append((t, lisse(q[1:6], ferme=False), 'doux'))
            eau = [L.groupe(f'reflet{k}', [L.trace(L.prop_chemin([(t + t0, c, e) for (t, c, e) in reflet])),
                                           L.trait(EAU_CLAIRE, 8)]),
                   L.groupe(f'eau{k}', [L.trace(L.prop_chemin([(t + t0, c, e) for (t, c, e) in keys])),
                                        L.rempli(EAU), L.trait(ENCRE, 8)])]
            # naissance : la perle gonfle depuis le coin de l'oeil
            nait = L.tr(p=list(coin), a=list(coin),
                        s=L.prop([(t_on + t0, [0, 0], 'sortie'), (t_on + 4 + t0, [108, 108], 'doux'),
                                  (t_on + 7 + t0, [100, 100], 'doux')]))
            # fin : le ruisseau se tasse vers le menton et s'en va
            part = L.tr(p=list(bas), a=list(bas),
                        s=L.prop([(t_fin + t0, [100, 100], 'entree'), (t_off + t0, [45, 0], 'lin')]))
            groupes.append(L.groupe(f'flot{k}', [L.groupe(f'perle{k}', eau, nait)], part))
        ip2, op2 = max(ip, t0 + t_on), min(op, t0 + t_off)
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


def goutte(depart, vitesse, t_on, duree, parent='scene', r=17.0, gravite=2.2, place='devant'):
    """Goutte projetee : trajectoire balistique, orientee dans le sens du mouvement. Elle nait deja
    detachee (a mi-taille) et disparait en retrecissant, jamais en fondu (pas de goutte fantome)."""
    def f(t0, I, ip, op, P):
        d = np.asarray(depart, float)
        v = np.asarray(vitesse, float)
        pk, rk = [], []
        n = 6
        for j in range(n + 1):
            t = duree * j / n
            pos = d + v * t + np.array([0, 0.5 * gravite * t * t])
            vel = v + np.array([0, gravite * t])
            ang = np.degrees(np.arctan2(vel[1], vel[0])) + 90 + 180   # pointe a l'arriere
            pk.append((t_on + t, pos, 'lin'))
            rk.append((t_on + t, ang, 'lin'))
        sk = [(t_on, 0.55, 'sortie'), (t_on + 3, 1.0, 'doux'), (t_on + duree * 0.6, 1.0, 'entree'),
              (t_on + duree, 0.0, 'lin')]
        ch = _goutte(r)
        items = [L.groupe('reflet', [_ellipse(-0.35 * r, -0.05 * r, 0.22 * r), L.rempli(BLANC)]),
                 L.groupe('goutte', [L.trace({'a': 0, 'k': ch.lottie()}), L.rempli(EAU), L.trait(ENCRE, 7)])]
        lay = L.calque_forme('goutte', I(), max(ip, int(t0 + t_on)), min(op, int(np.ceil(t0 + t_on + duree))), items,
                             _ks_simple(pk, t0, s_keys=sk, r_keys=rk), parent=P[parent])
        return [(place, lay)]
    return f


# ------------------------------------------------------------------ choc au sol (trepignement)
def choc(t_on, parent='root', duree=8):
    """Traits d'impact a l'atterrissage : ils fusent des bords exterieurs des chaussures, au ras du sol,
    vers l'exterieur et vers le haut (jamais vers le bas : ils resteraient coupes par le cadre)."""
    pieds = (((388.0, 1176.0), -1), ((999.0, 1172.0), 1))

    def f(t0, I, ip, op, P):
        items = []
        for (x, y), sgn in pieds:
            for j, (ang, l0, l1) in enumerate(((4, 18, 92), (28, 22, 84), (52, 26, 70))):
                t = np.radians(ang)
                u = np.array([sgn * np.cos(t), -np.sin(t)])
                A = np.array([x, y]) + u * l0
                B = np.array([x, y]) + u * l1
                ch = Chemin([A, B], ferme=False)
                ek = [(t_on, 0, 'sortie'), (t_on + duree * 0.4, 100, 'lin'), (t_on + duree, 100, 'lin')]
                sk = [(t_on, 0, 'lin'), (t_on + duree * 0.35, 0, 'entree'), (t_on + duree, 100, 'lin')]
                items.append(L.groupe(f'l{sgn}{j}', [L.trace({'a': 0, 'k': ch.lottie()}),
                                                    L.coupe(s=L.prop([(t + t0, v, e) for (t, v, e) in sk]),
                                                            e=L.prop([(t + t0, v, e) for (t, v, e) in ek])),
                                                    L.trait(ENCRE, 11)]))
        lay = L.calque_forme('choc', I(), max(ip, int(t0 + t_on)), min(op, int(t0 + t_on + duree) + 1), items,
                             parent=P[parent])
        return [('devant', lay)]
    return f


def jet_vapeur(depart, direction, t_on, n=4, ecart=2, duree=20, r=40.0, portee=190.0, parent='tete',
               place='devant', graine=0):
    """Jet de vapeur : n bouffees lachees toutes les 'ecart' images, dans UN seul calque. Tous les blancs
    sont dessines au-dessus de tous les contours : la vapeur forme une seule masse avec un seul contour
    exterieur (pas de nuages emboites). Par defaut attache a la tete, pour qu'il ne se decroche pas."""
    rng = np.random.default_rng(graine)
    u = np.asarray(direction, float)
    u /= np.linalg.norm(u)
    v = np.array([-u[1], u[0]])
    d0 = np.asarray(depart, float)
    cercles = [(0, 0, 1.0), (-0.86, 0.30, 0.72), (0.80, 0.34, 0.66), (0.1, -0.55, 0.62)]

    def f(t0, I, ip, op, P):
        blancs, encres = [], []
        t_fin = t_on + (n - 1) * ecart + duree
        for k in range(n):
            ta = t_on + k * ecart
            dev = rng.uniform(-0.18, 0.18)
            d = u + v * dev
            d /= np.linalg.norm(d)
            fin = d0 + d * portee * rng.uniform(0.85, 1.1)
            mi = d0 + (fin - d0) * 0.62
            rk = r * rng.uniform(0.85, 1.12)
            tmax = rng.uniform(1.3, 1.55)
            rot0 = rng.uniform(-25, 25)
            pk = [(ta, d0, 'sortie'), (ta + duree * 0.45, mi, 'doux'), (ta + duree, fin, 'lin')]
            sk = [(ta, 0.45, 'sortie'), (ta + duree * 0.35, tmax * 0.85, 'doux'), (ta + duree * 0.7, tmax, 'entree'),
                  (ta + duree, 0.0, 'lin')]
            if ta > t_on:
                pk.insert(0, (t_on, d0, 'hold'))
                sk.insert(0, (t_on, 0.0, 'hold'))
            P_ = L.prop([(t + t0, [p_[0], p_[1]], e) for (t, p_, e) in pk])
            S_ = L.prop([(t + t0, [100 * s_, 100 * s_], e) for (t, s_, e) in sk])
            R_ = L.prop([(ta + t0, rot0 - 10, 'doux'), (ta + duree + t0, rot0 + 10, 'lin')])
            tr_ = L.tr(p=P_, s=S_, r=R_)
            blancs.append(L.groupe(f'blanc{k}', [_ellipse(x * rk, y * rk, rr * rk) for (x, y, rr) in cercles]
                                   + [L.rempli(VAPEUR)], tr_))
            encres.append(L.groupe(f'encre{k}', [_ellipse(x * rk, y * rk, rr * rk + 7) for (x, y, rr) in cercles]
                                   + [L.rempli(ENCRE)], tr_))
        lay = L.calque_forme('vapeur', I(), max(ip, int(t0 + t_on)), min(op, int(t0 + t_fin) + 1), blancs + encres,
                             parent=P[parent])
        return [(place, lay)]
    return f
