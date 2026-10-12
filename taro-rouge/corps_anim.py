"""Jeu d'acteur du corps (epaules, bras, poings, torse, jambes, pieds) ajoute aux animations de anims.py.

Chaque canal est une fonction du temps, echantillonnee image par image (courbes lisses, rien ne pope).

Conventions (rotation positive = sens horaire a l'ecran) :
  epaule_g.r > 0 / epaule_d.r < 0 : le coude s'ecarte du corps ; epaule_x.p : haussement (dy < 0 = monte)
  coude_g.r < 0 : le poing gauche remonte vers la poitrine ; > 0 : le bras se deplie vers le bas
  coude_d.r < 0 : l'avant-bras droit s'ouvre vers l'exterieur ; > 0 : il rentre
  pied_x.p : le pied se souleve (il glisse sous le short) ; pied_g.r > 0 / pied_d.r < 0 : la pointe se leve
  torse.s / torse.r / torse.p : respiration, penche (pivot a la taille)
Poings « plantes » : quand l'epaule bouge, le coude compense pour que le poing reste sur la hanche (le coude
s'ecarte au lieu que le poing glisse) ; un poids w(t) melange cette pose plantee et une pose libre.
Plages propres verifiees : les bras restent en place sur le buste (rotation d'epaule 1,2 deg et haussement 2,5 px
au plus : tout glissement du poing sur la hanche casse la jonction) ; le haussement d'epaules est porte par
l'etirement du buste (torse.s y jusqu'a 5,5 %) ;
coude : bloque au repos (bras rigide), sauf le poing gauche replie sur la poitrine (-30..-50) ; pieds : jusqu'a 16 px de haut, le short se tasse avec (jambe_x.s) ; torse.r +-1 ; torse.s x +-1,2 %.
Les poings ne sont pas plantes : quand l'epaule monte, tout le bras monte et le poing glisse sur la hanche (c'est
le haussement qui se lit, pas une articulation cassee).
"""
import numpy as np

S_G, E_G, F_G = np.array((488.0, 822.0)), np.array((441.0, 901.0)), np.array((557.4, 990.9))
S_D, E_D, F_D = np.array((928.0, 806.0)), np.array((957.7, 854.6)), np.array((902.5, 943.0))


# ------------------------------------------------------------------ outils de courbes
def _ease(u, e):
    u = min(max(u, 0.0), 1.0)
    if e == 'lin':
        return u
    if e == 'sortie':       # part vite, se pose
        return 1 - (1 - u) ** 2.2
    if e == 'entree':       # accelere (chute, frappe)
        return u ** 2.2
    if e == 'hold':
        return 0.0
    return u * u * (3 - 2 * u)


def courbe(keys):
    """keys : [(t, valeur, ease_du_segment_suivant), ...] -> fonction t -> valeur (scalaire ou tuple)."""
    ks = sorted(keys, key=lambda k: k[0])

    def f(t):
        if t <= ks[0][0]:
            v = ks[0][1]
        elif t >= ks[-1][0]:
            v = ks[-1][1]
        else:
            for a, b in zip(ks, ks[1:]):
                if a[0] <= t <= b[0]:
                    e = a[2] if len(a) > 2 else 'doux'
                    w = _ease((t - a[0]) / max(b[0] - a[0], 1e-9), e)
                    va, vb = np.asarray(a[1], float), np.asarray(b[1], float)
                    v = va + (vb - va) * w
                    break
        v = np.asarray(v, float)
        return float(v) if v.ndim == 0 else tuple(float(x) for x in v)
    return f


def cloche(t, t0, t1, t2, e1='sortie', e2='doux'):
    """0 -> 1 (de t0 a t1) -> 0 (en t2)."""
    if t <= t0 or t >= t2:
        return 0.0
    if t <= t1:
        return _ease((t - t0) / max(t1 - t0, 1e-9), e1)
    return 1 - _ease((t - t1) / max(t2 - t1, 1e-9), e2)


def frappe(t, t0, monte=3, tenu=1, chute=1):
    """Pied qui se leve (t0 -> t0+monte, en freinant), tient, puis claque au sol en 'chute' images."""
    a, b, c = t0 + monte, t0 + monte + tenu, t0 + monte + tenu + chute
    if t <= t0 or t >= c:
        return 0.0
    if t <= a:
        return _ease((t - t0) / monte, 'sortie')
    if t <= b:
        return 1.0
    return 1 - _ease((t - b) / chute, 'entree')


def vibre(t, amp, graine, periode=2):
    """Tremblement : alterne de signe toutes les 'periode' images, amplitude jitteree (deterministe)."""
    k = int(np.floor(t / periode))
    v0 = (1 if k % 2 == 0 else -1) * amp * np.random.default_rng(graine * 1000 + k).uniform(0.7, 1.15)
    v1 = (1 if (k + 1) % 2 == 0 else -1) * amp * np.random.default_rng(graine * 1000 + k + 1).uniform(0.7, 1.15)
    u = (t - k * periode) / periode
    return v0 + (v1 - v0) * (u * u * (3 - 2 * u))


def ik(cote, a_s, p_s):
    """Angle de coude qui garde le poing sur la hanche quand l'epaule tourne de a_s et se deplace de p_s."""
    S, E, F = (S_G, E_G, F_G) if cote == 'g' else (S_D, E_D, F_D)
    c, s = np.cos(np.radians(-a_s)), np.sin(np.radians(-a_s))
    Rinv = np.array([[c, -s], [s, c]])
    Fp = Rinv @ (F - np.asarray(p_s, float) - S) + S          # poing ramene dans le repere du haut du bras
    a0 = np.degrees(np.arctan2(F[1] - E[1], F[0] - E[0]))
    a1 = np.degrees(np.arctan2(Fp[1] - E[1], Fp[0] - E[0]))
    d = a1 - a0
    return float((d + 180) % 360 - 180)


def ik2(cote, p_s, r_pref=0.0, borne=4.0):
    """IK a deux os : pour un haussement p_s, rotation d'epaule (la plus proche de r_pref, bornee) qui garde la
    distance coude-poing, puis angle de coude : le poing reste plante sur la hanche."""
    S, E, F = (S_G, E_G, F_G) if cote == 'g' else (S_D, E_D, F_D)
    L = np.linalg.norm(F - E)
    def err(a):
        c, s = np.cos(np.radians(a)), np.sin(np.radians(a))
        Ew = np.array([[c, -s], [s, c]]) @ (E - S) + S + np.asarray(p_s, float)
        return np.linalg.norm(F - Ew) - L
    cand = np.linspace(-borne, borne, 161)
    e = np.array([abs(err(a)) for a in cand]) + 0.02 * np.abs(cand - r_pref)
    a = float(cand[int(np.argmin(e))])
    return a, ik(cote, a, p_s)



LEVE_MAX = -2.5      # haussement propre des bras (le poing glisse d'autant sur la hanche) : c'est le buste qui
                     # s'etire pour hausser les epaules, les poings restent en place
ROT_MAX = 1.2        # rotation d'epaule (le poing glisse aussi) : tremblements seulement


def bras(tl, D, cote, ep_r, ep_p, libre, w, plus=lambda t: 0.0):
    """Echantillonne epaule et coude d'un bras. Le bras est rigide (coude au repos) : le moindre pli du coude
    decale les traits du pli et du haut de la manchette. Seul le bras gauche replie (poing sur la poitrine) plie au
    coude, avec un fondu entre -2 et -20 degres. w(t) melange la pose de repos (1) et la pose libre ; plus(t) : tremblement ou
    coup, applique au coude quand le bras est replie, sinon a l'epaule (tout le bras tremble)."""
    for t in range(D + 1):
        p = ep_p(t)
        ww = w(t)
        c_l = (1 - ww) * libre(t)
        pl = plus(t)
        r = ep_r(t)
        k = _ease((-c_l - 2.0) / 18.0, 'doux')        # 0 pres du repos, 1 bras replie (au-dela de -20)
        a = k * (c_l + pl)
        # poing sur la hanche (k = 0) : le bras est fige sur le buste (le moindre decalage fait grésiller la
        # jonction poing / hanche et l'ombre du coude) ; il ne bouge par rapport au buste que replie
        r = float(k * ROT_MAX * np.tanh(r / ROT_MAX))
        py = LEVE_MAX * np.tanh(p[1] / LEVE_MAX) if p[1] < 0 else 2.0 * np.tanh(p[1] / 2.0)
        a = float(np.clip(a, -52.0, 0.0))
        tl.k(f'epaule_{cote}.r', t, r, 'lin')
        tl.k(f'epaule_{cote}.p', t, (float(k * p[0]), float(k * py)), 'lin')
        tl.k(f'coude_{cote}.r', t, a, 'lin')
        if cote == 'g':
            # le trait du pli et l'ombre du coude disparaissent quand le poing se replie
            tl.k('pli_g', t, float(np.clip((a + 12.0) / 10.0, 0, 1)), 'lin')


def canal(tl, D, nom, f):
    for t in range(D + 1):
        v = f(t)
        tl.k(nom, t, tuple(float(x) for x in v) if isinstance(v, tuple) else float(v), 'lin')


def ajoute(tl, nom, f):
    """Ajoute f(t) a un canal deja anime par le visage (tete, racine...) : reechantillonne image par image."""
    D = tl.duree
    base = [np.atleast_1d(tl.eval(nom, t)).astype(float) for t in range(D + 1)]
    tl.ch[nom] = []
    for t in range(D + 1):
        v = base[t] + np.atleast_1d(np.asarray(f(t), float))
        tl.k(nom, t, tuple(float(x) for x in v) if len(v) > 1 else float(v[0]), 'lin')


HAUT_JAMBE = 100.0    # de l'axe de tassement (entrejambe -> coin haut de la jambe) a l'ourlet exterieur du short


def pieds(tl, D, fg, fd):
    """fg / fd : t -> (hauteur du pied en px, angle de pointe en degres, glissement x). Le short se tasse avec le
    pied (le genou monte vers nous) : son ourlet remonte de 80 % de la hauteur, la chaussure reste visible ;
    l'entrejambe ne bouge pas (pivot a sa hauteur, pas d'elargissement)."""
    for cote, f, sg in (('g', fg, 1), ('d', fd, -1)):
        for t in range(D + 1):
            h, a, dx = f(t)
            tl.k(f'pied_{cote}.p', t, (float(dx), float(-h)), 'lin')
            tl.k(f'pied_{cote}.r', t, float(sg * a), 'lin')
            tl.k(f'jambe_{cote}.r', t, float(sg * 0.05 * h), 'lin')
            sy = 1 - 0.8 * h / HAUT_JAMBE
            tl.k(f'jambe_{cote}.s', t, (1.0, float(sy)), 'lin')


ZERO = lambda t: 0.0
UN = lambda t: 1.0


# ------------------------------------------------------------------ ATTENTE (boucle de 120)
TAPES = [(72, 0.6), (79, 0.85), (85, 1.2)]


def attente(tl):
    """Il bout sur place. Souffle ample (poitrine et epaules) ; « hmpf » : il se tasse (anticipation), puis les
    epaules montent d'un coup vers les oreilles en decale (gauche puis droite), coudes ecartes, buste gonfle, et
    retombent en decale apres la tete. Puis trois tapes du pied droit de plus en plus fortes : le poids passe sur
    la jambe gauche quand le pied monte, tout le buste encaisse chaque claquement."""
    D = tl.duree
    w1, w2 = 2 * np.pi / 120, 2 * np.pi / 60
    souffle = lambda t: (1 - np.cos(w2 * t)) / 2
    tape = lambda t: sum(a * frappe(t, t0, 4, 1, 1) for t0, a in TAPES)
    leve = lambda t: sum(min(a, 1.0) * cloche(t, t0, t0 + 4, t0 + 7, 'sortie', 'entree') for t0, a in TAPES)
    choc = lambda t: sum(a * cloche(t, t0 + 5, t0 + 6, t0 + 11, 'sortie', 'doux') for t0, a in TAPES)
    poids = lambda t: cloche(t, 70, 74, 96, 'doux', 'doux')        # le poids reste a gauche pendant les tapes
    tasse = lambda t: cloche(t, 28, 35, 38, 'doux', 'entree')
    hm = {'g': lambda t: cloche(t, 36, 39, 60, 'sortie', 'doux') - 0.15 * cloche(t, 58, 62, 68),
          'd': lambda t: cloche(t, 37, 40, 62, 'sortie', 'doux') - 0.15 * cloche(t, 60, 64, 70)}
    for c, sg, ph in (('g', 1, 0.0), ('d', -1, 0.6)):
        h = hm[c]
        bras(tl, D, c,
             ep_r=lambda t, sg=sg, h=h, ph=ph: sg * (2.6 * h(t) + 0.5 * (np.sin(w1 * t + ph) - np.sin(ph))
                                                  + 1.2 * choc(t) - 0.8 * tasse(t)),
             ep_p=lambda t, h=h: (0.0, -4.5 * souffle(t) - 14.0 * h(t) + 2.0 * tasse(t) + 3.0 * choc(t)
                                  - 2.0 * leve(t)),
             libre=ZERO, w=UN,
             plus=lambda t, sg=sg: sg * 1.2 * choc(t))
    canal(tl, D, 'torse.s', lambda t: (1 + 0.006 * souffle(t) + 0.01 * hm['g'](t) - 0.004 * tasse(t),
                                       1 + 0.008 * souffle(t) + 0.045 * hm['g'](t) - 0.01 * tasse(t)
                                       - 0.015 * choc(t)))
    canal(tl, D, 'torse.p', lambda t: (-4.0 * poids(t), -1.5 * hm['g'](t) + 2.0 * tasse(t) + 3.5 * choc(t)
                                       - 1.5 * leve(t)))
    canal(tl, D, 'torse.r', lambda t: -0.7 * poids(t) + 0.35 * choc(t))
    pieds(tl, D, lambda t: (0.0, 0.0, 0.0), lambda t: (19.0 * tape(t), 4.0 * tape(t), 2.0 * tape(t)))
    return tl


# ------------------------------------------------------------------ IL CRIE (80)
def crie(tl):
    """Inspiration : il se gonfle et se cambre, epaules tres hautes, coudes en ailes, pied droit leve. Cri : le
    pied claque, les epaules restent hautes et partent en avant (coudes jetes vers l'exterieur, poings arraches des
    hanches), tout vibre ; un second coup de talon (gauche) relance le cri. Puis il halete et reprend la pose."""
    D = tl.duree
    for c, sg, gr, dt in (('g', 1, 1, 0), ('d', -1, 2, 1)):
        bras(tl, D, c,
             ep_r=lambda t, sg=sg, gr=gr: sg * (courbe([(0, 0), (13, 2.0, 'sortie'), (16, 3.5), (50, 3.0, 'doux'),
                                                         (57, -0.8), (64, 0.4), (80, 0)])(t)
                                                 + 0.9 * vibre(t, 1, gr + 40) * cloche(t, 16, 19, 52, 'doux', 'doux')),
             ep_p=courbe([(0, (0, 0)), (12 + dt, (0, -13), 'sortie'), (15 + dt, (0, -6)), (18 + dt, (0, -12), 'doux'),
                          (50, (0, -10), 'doux'), (55 + dt, (0, 3)), (60, (0, -5)), (65, (0, 1.5)), (71, (0, -2.5)),
                          (77, (0, 0)), (80, (0, 0))]),
             libre=ZERO, w=UN,
             plus=lambda t, gr=gr, sg=sg: sg * (1.5 * cloche(t, 14, 16, 22) + 1.4 * vibre(t, 1, gr) * cloche(t, 18, 22, 52)))
    canal(tl, D, 'torse.s', courbe([(0, (1, 1)), (13, (0.988, 1.05), 'sortie'), (16, (1.012, 0.975)),
                                    (21, (1.008, 1.03)), (50, (1.008, 1.025), 'doux'), (56, (0.996, 1.03)),
                                    (62, (1.004, 0.99)), (70, (0.998, 1.012)), (80, (1, 1))]))
    tr = courbe([(0, 0), (13, -1.0, 'sortie'), (16, 1.0), (50, 0.7, 'doux'), (60, -0.4), (80, 0)])
    canal(tl, D, 'torse.r', lambda t: tr(t) + 0.4 * vibre(t, 1, 7) * cloche(t, 18, 22, 52))
    canal(tl, D, 'torse.p', courbe([(0, (0, 0)), (13, (0, -3), 'entree'), (16, (0, 4)), (20, (0, 1)),
                                    (30, (0, 0), 'entree'), (32, (0, 4)), (36, (0, 1)), (55, (0, 1)), (80, (0, 0))]))
    fd = lambda t: frappe(t, 4, 9, 2, 1)
    fg = lambda t: frappe(t, 26, 4, 1, 1)
    pieds(tl, D, lambda t: (13.0 * fg(t), 3.0 * fg(t), -3.0 * fg(t)),
          lambda t: (16.0 * fd(t), 3.0 * fd(t), 3.0 * fd(t)))
    return tl


# ------------------------------------------------------------------ IL PLEURE (104)
SANGLOTS = [(12, 0.75), (26, 1.0), (40, 0.85), (54, 1.1), (68, 0.8)]


def pleure(tl):
    """Poing gauche serre contre la poitrine qu'il martele a chaque braillement (il l'arme puis frappe) ; main
    droite sur la hanche ; a chaque sanglot les epaules montent d'un coup (hoquet) et retombent lentement ; un
    coup de pied rageur a chaque braillement (alterne), avec le buste qui encaisse."""
    D = tl.duree
    insp = lambda t: sum(a * cloche(t, ts, ts + 2, ts + 9, 'sortie', 'doux') for ts, a in SANGLOTS)
    brai = lambda t: sum(a * cloche(t, ts + 6, ts + 7, ts + 12, 'sortie', 'doux') for ts, a in SANGLOTS)
    arme = lambda t: sum(a * cloche(t, ts + 2, ts + 5, ts + 6, 'doux', 'entree') for ts, a in SANGLOTS)
    frappe_p = lambda t: sum(a * cloche(t, ts + 6, ts + 7, ts + 10, 'sortie', 'doux') for ts, a in SANGLOTS)
    sniff = lambda t: cloche(t, 81, 84, 90, 'sortie', 'doux')
    poitrine = courbe([(0, 0), (11, 1, 'doux'), (82, 1, 'doux'), (96, 0), (104, 0)])
    for c, sg in (('g', 1), ('d', -1)):
        dt = 0 if c == 'g' else 1
        if c == 'g':
            ep_r = lambda t: -2.0 * poitrine(t) + 2.5 * insp(t) + 2.0 * arme(t) - 1.0 * brai(t)
            libre = lambda t: (-38.0 * poitrine(t) + 14.0 * arme(t) * poitrine(t) - 9.0 * frappe_p(t) * poitrine(t)
                               + 7.0 * cloche(t, 88, 92, 100))
        else:
            ep_r = lambda t: -(2.5 * insp(t - 1) - 1.0 * brai(t)) - 0.8 * cloche(t, 86, 92, 104)
            libre = ZERO
        bras(tl, D, c, ep_r=ep_r,
             ep_p=lambda t, dt=dt: (0.0, -2.5 * poitrine(t) - 13.0 * insp(t - dt) + 3.0 * brai(t) - 9.0 * sniff(t - dt)),
             libre=libre,
             w=(lambda t: 1 - poitrine(t)) if c == 'g' else UN,
             plus=(lambda t: 1.5 * vibre(t, 1, 11, 3) * poitrine(t)) if c == 'g' else ZERO)
    canal(tl, D, 'torse.s', lambda t: (1 - 0.005 * insp(t) + 0.01 * brai(t) - 0.003 * sniff(t),
                                       1 + 0.045 * insp(t) - 0.03 * brai(t) + 0.03 * sniff(t)))
    canal(tl, D, 'torse.r', lambda t: sum((0.9 if k % 2 == 0 else -0.9) * a * cloche(t, ts + 6, ts + 8, ts + 14)
                                          for k, (ts, a) in enumerate(SANGLOTS)))
    kg = [(ts, a) for k, (ts, a) in enumerate(SANGLOTS) if k % 2 == 1]
    kd = [(ts, a) for k, (ts, a) in enumerate(SANGLOTS) if k % 2 == 0]
    hg = lambda t: sum(a * frappe(t, ts + 2, 4, 0, 1) for ts, a in kg)
    hd = lambda t: sum(a * frappe(t, ts + 2, 4, 0, 1) for ts, a in kd)
    canal(tl, D, 'torse.p', lambda t: (0.0, -1.5 * (hg(t) + hd(t)) + 3.0 * frappe_p(t)))
    pieds(tl, D, lambda t: (25.0 * hg(t), 5.0 * hg(t), -3.0 * hg(t)), lambda t: (25.0 * hd(t), 5.0 * hd(t), 3.0 * hd(t)))
    return tl


# ------------------------------------------------------------------ IL EXPLOSE (112)
SAUTS = [(22, 30, 37), (40, 47, 53), (56, 61, 66)]


def explose(tl):
    """La rage monte : il se ramasse (buste tasse, epaules qui montent, coudes en ailes), tout tremble de plus en
    plus. A chaque saut : poussee (buste etire), bras en l'air differents a chaque saut (poing gauche ramene sur la
    poitrine / coudes jetes vers l'exterieur), pieds replies ; a l'atterrissage les epaules et le buste s'ecrasent
    et rebondissent. Il halete, epaules qui se soulevent, puis les poings reviennent sur les hanches."""
    D = tl.duree
    w = courbe([(0, 1), (18, 1, 'sortie'), (22, 0), (66, 0, 'doux'), (72, 1), (112, 1)])   # libre des le 1er saut : pas de pop
    kg = [(0, 0), (22, 0)]
    erg, erd = [(0, 0), (16, 2.5, 'doux')], [(0, 0), (16, -2.5, 'doux')]
    ep = [(0, (0, 0)), (18, (0, -12), 'doux')]
    for j, (td, ta, tt) in enumerate(SAUTS):
        poing = j != 1                               # sauts 1 et 3 : poing gauche sur la poitrine
        haut = -46.0 if poing else 2.5
        kg += [(td, 1.0, 'sortie'), (ta - 1, haut, 'doux'), (tt - 1, haut * 0.8, 'entree'), (tt + 2, 1.0, 'sortie')]
        erg += [(td + 2, 0.5, 'sortie'), (ta - 1, 1.0 if poing else 3.5, 'doux'), (tt + 2, 1.5, 'sortie')]
        erd += [(td + 2, -0.5, 'sortie'), (ta - 1, -3.5 if poing else -1.0, 'doux'), (tt + 2, -1.5, 'sortie')]
        ep += [(td + 2, (0, 2.5), 'sortie'), (ta - 1, (0, -14), 'doux'), (tt + 1, (0, 3.0), 'sortie'), (tt + 4, (0, -3))]
    kg += [(72, 0), (112, 0)]
    erg += [(70, 2.5), (84, 2.0, 'doux'), (98, -0.5), (112, 0)]
    erd += [(70, -2.5), (84, -2.0, 'doux'), (98, 0.5), (112, 0)]
    for c, gr, er in (('g', 21, erg), ('d', 22, erd)):
        dt = 0 if c == 'g' else 1
        ep_c = ep + [(70 + dt, (0, -8), 'sortie'), (75 + dt, (0, 2)), (80 + dt, (0, -7)), (85 + dt, (0, 1.5)),
                     (91 + dt, (0, -5)), (97 + dt, (0, 1)), (104, (0, -1)), (112, (0, 0))]
        rr = courbe(er)
        bras(tl, D, c, ep_r=lambda t, rr=rr, gr=gr: rr(t) + (1.6 * min(1.0, t / 18.0)) * vibre(t, 1, gr + 50) * cloche(t, 4, 18, 23, 'lin', 'doux'),
             ep_p=courbe(ep_c), libre=courbe(kg) if c == 'g' else ZERO, w=w if c == 'g' else UN,
             plus=lambda t, gr=gr: vibre(t, 0.5 + 1.8 * min(1.0, t / 20.0), gr) * cloche(t, 4, 18, 23, 'lin', 'doux'))
    ts_ = [(0, (1, 1)), (19, (1.01, 0.965), 'doux')]
    tp_ = [(0, (0, 0)), (19, (0, 5), 'doux')]
    for td, ta, tt in SAUTS:
        ts_ += [(td + 3, (0.99, 1.05), 'sortie'), (ta - 1, (0.994, 1.04), 'doux'), (tt + 1, (1.012, 0.95), 'sortie'),
                (tt + 4, (1.0, 1.01))]
        tp_ += [(td + 2, (0, -2), 'sortie'), (tt, (0, 0), 'sortie'), (tt + 1, (0, 4)), (tt + 4, (0, 0.5))]
    ts_ += [(70, (1.006, 0.985)), (75, (0.995, 1.035)), (80, (1.006, 0.985)), (85, (0.996, 1.03)), (91, (1.003, 0.99)),
            (97, (0.999, 1.008)), (112, (1, 1))]
    tp_ += [(112, (0, 0))]
    canal(tl, D, 'torse.s', courbe(ts_))
    canal(tl, D, 'torse.p', courbe(tp_))
    canal(tl, D, 'torse.r', lambda t: 0.4 * vibre(t, 1, 61) * cloche(t, 6, 18, 23, 'lin', 'doux'))
    pf = lambda t: sum(cloche(t, td + 3, ta - 1, tt - 1, 'sortie', 'entree') * (1 - 0.1 * j)
                       for j, (td, ta, tt) in enumerate(SAUTS))
    pieds(tl, D, lambda t: (14.0 * pf(t), 3.0 * pf(t), -3.0 * pf(t)), lambda t: (14.0 * pf(t), 3.0 * pf(t), 3.0 * pf(t)))
    tl.k('encre_queue', 0, 1.0, 'hold').k('encre_queue', D, 1.0, 'hold')
    return tl


# ------------------------------------------------------------------ LA BASCULE (60)
def bascule(tl):
    """La pression monte : epaules qui se crispent vers les oreilles, coudes en ailes, tremblement croissant ; au
    declic, les coudes sont jetes vers l'exterieur et il bondit ; il retombe, le buste s'ecrase, les poings
    reviennent aux hanches."""
    D = tl.duree
    for c, sg, gr in (('g', 1, 31), ('d', -1, 32)):
        dt = 0 if c == 'g' else 1
        bras(tl, D, c,
             ep_r=lambda t, sg=sg, gr=gr: sg * (courbe([(0, 0), (6, 0), (24, 2.0, 'doux'), (28, 3.5, 'sortie'),
                                                         (36, 2.5, 'doux'), (44, -0.8), (52, 0), (60, 0)])(t)
                                                 + vibre(t, 0.4 + 1.2 * max(0.0, (t - 8) / 18.0), gr + 7)
                                                 * cloche(t, 8, 22, 27, 'lin', 'sortie')),
             ep_p=courbe([(0, (0, 0)), (6, (0, 0)), (24, (0, -13), 'doux'), (27, (0, 2.5), 'sortie'),
                          (31 + dt, (0, -4)), (36 + dt, (0, 1.5)), (42 + dt, (0, -2.5)), (48, (0, 0)), (60, (0, 0))]),
             libre=ZERO, w=UN,
             plus=lambda t, gr=gr: vibre(t, 0.4 + 1.5 * max(0.0, (t - 8) / 18.0), gr) * cloche(t, 8, 22, 27, 'lin', 'sortie'))
    canal(tl, D, 'torse.s', courbe([(0, (1, 1)), (6, (1, 1)), (22, (0.994, 1.035), 'doux'), (25, (1.008, 0.975), 'entree'), (28, (0.99, 1.05), 'sortie'),
                                    (31, (1.012, 0.97)), (35, (0.997, 1.015)), (42, (1, 1)), (60, (1, 1))]))
    canal(tl, D, 'torse.p', courbe([(0, (0, 0)), (6, (0, 0)), (24, (0, 3), 'doux'), (27, (0, -2), 'sortie'),
                                    (31, (0, 4)), (35, (0, 0.5)), (42, (0, 0)), (60, (0, 0))]))
    canal(tl, D, 'torse.r', lambda t: vibre(t, 0.12 + 0.3 * max(0.0, (t - 8) / 18.0), 33) * cloche(t, 8, 22, 27, 'lin', 'sortie'))
    hop = lambda t: cloche(t, 26, 28, 31, 'sortie', 'entree')
    pieds(tl, D, lambda t: (10.0 * hop(t), 2.0 * hop(t), -1.5 * hop(t)), lambda t: (10.0 * hop(t), 2.0 * hop(t), 1.5 * hop(t)))
    # « hmpf » final : il souffle par le nez (46), les epaules retombent d'un coup puis il se redresse, boudeur
    hmpf = lambda t: cloche(t, 44, 47, 57, 'sortie', 'doux')
    ajoute(tl, 'torse.s', lambda t: (0.006 * hmpf(t), -0.03 * hmpf(t) + 0.012 * cloche(t, 40, 44, 47, 'doux', 'entree')))
    ajoute(tl, 'torse.r', lambda t: -0.6 * hmpf(t))
    ajoute(tl, 'torse.p', lambda t: (0.0, 3.0 * hmpf(t)))
    return tl


# ------------------------------------------------------------------ RETOUR AU CALME (56)
def calme(tl):
    """Grand soupir : a l'inspiration il se gonfle, epaules tout en haut ; a l'expiration tout retombe (epaules
    plus bas que le repos, buste qui se tasse, coudes relaches) ; un petit sautillement soulage quand il redevient
    normal ; les epaules reviennent en place."""
    D = tl.duree
    for c, sg in (('g', 1), ('d', -1)):
        dt = 0 if c == 'g' else 1
        bras(tl, D, c,
             ep_r=lambda t, sg=sg: sg * courbe([(0, 0), (11, 2.5, 'doux'), (26, -1.2, 'doux'), (40, 0.5), (50, 0),
                                                (56, 0)])(t),
             ep_p=courbe([(0, (0, 0)), (11 + dt, (0, -14), 'doux'), (26 + dt, (0, 3), 'doux'), (33, (0, -3)),
                          (37, (0, 1)), (44, (0, 0)), (56, (0, 0))]),
             libre=ZERO, w=UN)
    canal(tl, D, 'torse.s', courbe([(0, (1, 1)), (11, (0.99, 1.055), 'doux'), (26, (1.01, 0.97), 'doux'),
                                    (33, (0.998, 1.012)), (40, (1, 1)), (56, (1, 1))]))
    canal(tl, D, 'torse.p', courbe([(0, (0, 0)), (11, (0, -2), 'doux'), (26, (0, 3), 'doux'), (33, (0, 0)), (56, (0, 0))]))
    saut = lambda t: cloche(t, 30, 33, 36, 'sortie', 'entree')
    # petit sautillement soulage : tout le corps decolle (les pieds ne quittent pas le corps)
    pieds(tl, D, lambda t: (0.0, 1.0 * saut(t), 0.0), lambda t: (0.0, 1.0 * saut(t), 0.0))
    ajoute(tl, 'root.p', lambda t: (0.0, -18.0 * saut(t)))
    ajoute(tl, 'torse.s', lambda t: (-0.006 * saut(t), 0.025 * saut(t)))
    return tl


# ------------------------------------------------------------------ bouchon du petit triangle de fond
P_TRIANGLE = np.array((420.0, 790.0))
ROUGES = ('attente', 'crie', 'pleure', 'explose')
SEUIL_BOUCHON = 6.0


def ecart_triangle(tl, t):
    """Deplacement (px) du petit triangle de fond entre joue, capuche et queue, du a la queue ou a la tete."""
    from taro_rig import PIV_TETE, PIV_QUEUE
    def M(r, s):
        c, sn = np.cos(np.radians(r)), np.sin(np.radians(r))
        return np.array([[c, -sn], [sn, c]]) @ np.diag(s)
    qr, qs = float(tl.eval('queue.r', t)[0]), tl.eval('queue.s', t)
    tp, tr, ts = tl.eval('tete.p', t), float(tl.eval('tete.r', t)[0]), tl.eval('tete.s', t)
    pq = np.array(PIV_QUEUE) + M(qr, qs) @ (P_TRIANGLE - PIV_QUEUE)
    ph = np.array(PIV_TETE) + tp + M(tr, ts) @ (P_TRIANGLE - PIV_TETE)
    return float(max(np.linalg.norm(pq - P_TRIANGLE), np.linalg.norm(ph - P_TRIANGLE)))


def bouchon_queue(tl, nom):
    """Bouchon de fourrure (taro_rig) sur le petit triangle de fond : en mode rouge il est toujours la (le triangle
    se deforme des que la tete ou la queue bougent : fente blanche, contour qui transparait dans un fondu). Il
    apparait d'un coup (sans fondu) pendant les secousses de la bascule et disparait pendant le retour au calme,
    a l'image ou la tete s'est le plus ecartee."""
    D = tl.duree
    tl.ch['bouchon'] = []
    if nom in ROUGES:
        tl.k('bouchon', 0, 1.0, 'hold').k('bouchon', D, 1.0, 'hold')
        return tl
    d = [ecart_triangle(tl, t) for t in range(D + 1)]
    au_dela = [t for t in range(D + 1) if d[t] > SEUIL_BOUCHON]
    if nom == 'bascule':
        ts = au_dela[0] if au_dela else D // 2
        tl.k('bouchon', 0, 0.0, 'hold').k('bouchon', ts, 1.0, 'hold').k('bouchon', D, 1.0, 'hold')
    else:
        ts = au_dela[-1] + 1 if au_dela else D // 2
        tl.k('bouchon', 0, 1.0, 'hold').k('bouchon', ts, 0.0, 'hold').k('bouchon', D, 0.0, 'hold')
    return tl


CONTACT = {'g': np.array((517.0, 1196.0)), 'd': np.array((872.0, 1194.0))}   # milieu des semelles au repos
R_BUSTE_MAX = 1.5      # degres d'inclinaison du corps passes au buste quand les deux pieds sont au sol
SX_BUSTE_MAX = 0.03    # elargissement passe au buste


def plante_pieds(tl, nom):
    """Pieds plantes : l'etirement, l'elargissement et l'inclinaison du corps entier (root) faisaient glisser et
    s'enfoncer le pied d'appui. Une translation du corps entier (root.p, aucune piece ne bouge par rapport aux
    autres) ramene a sa place le point d'appui : la semelle du pied au sol, ou le milieu des deux pieds quand les
    deux sont au sol (poids lisses selon la hauteur du pied). Pas dans « explose » (sauts)."""
    if nom == 'explose':
        return tl
    from taro_rig import _M, PIV_ROOT
    D = tl.duree
    poids = []
    for t in range(D + 1):
        w = {}
        for c in ('g', 'd'):
            h = -float(np.atleast_1d(tl.eval(f'pied_{c}.p', t))[1])
            w[c] = float(np.clip(1.0 - h / 4.0, 0.0, 1.0))
        poids.append(w)
    from scipy.ndimage import gaussian_filter1d
    for c in ('g', 'd'):
        lis = gaussian_filter1d(np.array([w[c] for w in poids]), 1.2, mode='nearest')
        for t in range(D + 1):
            poids[t][c] = float(min(poids[t][c], lis[t]) if poids[t][c] < 1 else lis[t])
    # deux pieds au sol : une translation ne peut pas les planter tous les deux ; l'inclinaison et l'elargissement
    # du corps entier passent au buste (plafonnes : au-dela, la taille du sweat decouvre le haut du short)
    rr = [float(tl.eval('root.r', t)[0]) for t in range(D + 1)]
    rs = [np.atleast_1d(tl.eval('root.s', t)).astype(float) for t in range(D + 1)]
    tr = [float(tl.eval('torse.r', t)[0]) for t in range(D + 1)]
    ts = [np.atleast_1d(tl.eval('torse.s', t)).astype(float) for t in range(D + 1)]
    for c in ('root.r', 'root.s', 'torse.r', 'torse.s'):
        tl.ch[c] = []
    for t in range(D + 1):
        wb = poids[t]['g'] * poids[t]['d']
        dr = wb * float(np.clip(rr[t], -R_BUSTE_MAX, R_BUSTE_MAX))
        de = wb * float(np.clip(rs[t][0] - 1.0, -SX_BUSTE_MAX, SX_BUSTE_MAX))
        tl.k('root.r', t, rr[t] - dr, 'lin')
        tl.k('root.s', t, (float(rs[t][0] - de), float(rs[t][1])), 'lin')
        tl.k('torse.r', t, tr[t] + dr, 'lin')
        tl.k('torse.s', t, (float(ts[t][0] * (1.0 + de)), float(ts[t][1])), 'lin')
    base = [np.atleast_1d(tl.eval('root.p', t)).astype(float) for t in range(D + 1)]
    tl.ch['root.p'] = []
    for t in range(D + 1):
        w = poids[t]
        if w['g'] + w['d'] < 1e-6:
            tl.k('root.p', t, tuple(float(x) for x in base[t]), 'lin')
            continue
        C = (w['g'] * CONTACT['g'] + w['d'] * CONTACT['d']) / (w['g'] + w['d'])
        M0 = _M((0, 0), float(tl.eval('root.r', t)[0]), tl.eval('root.s', t), PIV_ROOT)
        q = (M0 @ np.array([C[0], C[1], 1.0]))[:2]
        p = base[t] + (C - q)
        tl.k('root.p', t, (float(p[0]), float(p[1])), 'lin')
    return tl


HAUTS_TETE = [(829.0, 32.0), (302.0, 192.0), (566.0, 109.0)]   # haut de l'oreille droite, de la gauche, du crane
MARGE_CADRE = 10.0


def garde_cadre(tl, nom):
    """Rien ne sort par le haut du cadre : quand les epaules montent (buste etire), la tete rentre dans les epaules
    juste assez pour que les oreilles restent a MARGE_CADRE px du bord (courbe lissee, pas de saccade)."""
    from scipy.ndimage import grey_dilation, gaussian_filter1d
    import taro_rig as TR
    D = tl.duree
    dec = 0.0 if nom == 'attente' else 418.0
    ymin = np.array([min(TR.monde(tl, p, t)[1] for p in HAUTS_TETE) + dec for t in range(D + 1)])
    d = np.maximum(0.0, MARGE_CADRE - ymin)
    if d.max() <= 0:
        return tl
    lisse = gaussian_filter1d(grey_dilation(d, size=7, mode='nearest'), 2.0, mode='nearest')
    d = np.maximum(d, lisse)
    ajoute(tl, 'tete.p', lambda t: (0.0, float(d[t])))
    return tl


TOUS = {'attente': attente, 'crie': crie, 'pleure': pleure, 'explose': explose, 'bascule': bascule, 'calme': calme}
