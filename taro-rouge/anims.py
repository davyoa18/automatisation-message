"""Les quatre animations de Taro rouge (30 i/s). Toutes partent de la pose de repos et y reviennent."""
import numpy as np
from taro_rig import Timeline, tremble, monde
import effets as FX

# reperes de la tete au repos (scene 1254)
NEZ_G, NEZ_D = (697.0, 556.0), (724.0, 551.0)
COIN_G, COIN_D = (432.0, 590.0), (906.0, 528.0)       # coins exterieurs des yeux (depart des larmes)
OREILLE_G, OREILLE_D = (300.0, 350.0), (850.0, 205.0)    # creux (rose) des oreilles
CENTRE_TETE = (690.0, 440.0)
VEINE_POS = (944.0, 376.0)    # tempe droite, sur la fourrure (hors oreille et sourcil)


def blink(tl, t, etat_retour='base'):
    tl.oeil(t, 'mi').oeil(t + 1, 'clos').oeil(t + 3, 'mi').oeil(t + 5, etat_retour)


# ======================================================================== ATTENTE (boucle)
def _lisse01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def impulsion(t, t0, t1, t2):
    """0 avant t0, monte vite jusqu'a 1 en t1, redescend doucement a 0 en t2."""
    if t <= t0 or t >= t2:
        return 0.0
    if t <= t1:
        u = (t - t0) / (t1 - t0)
        return 1 - (1 - u) ** 2.4
    return 1 - _lisse01((t - t1) / (t2 - t1))


def ressort(t, t0, periode, amort, duree):
    """Oscillation amortie qui demarre a t0 (0 avant, ~0 apres t0 + duree)."""
    if t <= t0 or t >= t0 + duree:
        return 0.0
    u = t - t0
    fin = 1 - _lisse01((u - duree * 0.6) / (duree * 0.4))
    return np.sin(2 * np.pi * u / periode) * np.exp(-u / amort) * fin


def echantillonne(tl, canal, f, d, pas=1):
    for t in range(0, d + 1, pas):
        v = f(t)
        tl.k(canal, t, tuple(float(x) for x in v) if isinstance(v, (tuple, list, np.ndarray)) else float(v), 'lin')


def attente():
    """Boucle de 4 s. Toutes les courbes sont periodiques (120 images) et passent par la pose de repos
    en 0 sans s'arreter toutes ensemble : le raccord de boucle est invisible et rien ne fige."""
    D = 120
    tl = Timeline('attente', D)
    w1 = 2 * np.pi / 120
    w2 = 2 * np.pi / 60
    souffle = lambda t: (1 - np.cos(w2 * t)) / 2                 # deux respirations lourdes par boucle
    hmpf = lambda t: impulsion(t, 37, 41, 55)                    # le « hmpf »
    pince = lambda t: impulsion(t, 38, 41, 50)
    claque = lambda t: ressort(t, 58, 7.0, 7.0, 18)              # l'oreille qui claque
    fouet = lambda t: impulsion(t, 40, 44, 56)                   # coup de queue sur le hmpf
    cligne = lambda t: impulsion(t, 99, 101, 108)
    echantillonne(tl, 'root.s', lambda t: (1 - 0.008 * souffle(t) + 0.008 * hmpf(t), 1 + 0.016 * souffle(t) - 0.011 * hmpf(t)), D)
    echantillonne(tl, 'root.r', lambda t: 0.45 * np.sin(w1 * t), D)
    echantillonne(tl, 'tete.r', lambda t: -1.1 * np.sin(w2 * t) - 0.5 * np.sin(w1 * t) + 1.6 * hmpf(t), D)
    echantillonne(tl, 'tete.p', lambda t: (1.6 * hmpf(t), -3.0 * souffle(t) + 5.0 * hmpf(t)), D)
    echantillonne(tl, 'bouche.s', lambda t: (1 + 0.14 * pince(t), 1 - 0.28 * pince(t)), D)
    for c in ('g', 'd'):
        echantillonne(tl, f'sourcil_{c}.p', lambda t: (0.0, 5.0 * hmpf(t) + 3.0 * cligne(t)), D)
    echantillonne(tl, 'oreille_d.r', lambda t: 0.9 * np.sin(w1 * t + 0.0) - 10.0 * claque(t), D)
    echantillonne(tl, 'oreille_g.r', lambda t: -1.2 * np.sin(w1 * t) + 1.5 * impulsion(t, 61, 64, 80), D)
    echantillonne(tl, 'queue.r', lambda t: -2.6 * np.sin(w2 * t) + 4.5 * fouet(t), D)
    tl.fx.append(FX.bouffee(NEZ_G, (548, 668), 41, 13, r=14, taille_max=1.2, rot=-20))
    tl.fx.append(FX.bouffee(NEZ_D, (872, 630), 41, 13, r=14, taille_max=1.2, rot=15))
    # tic du sourcil gauche
    tl.seq('sourcil_g', [(0, 'colere'), (72, 'colere', 'vif'), (74, 'tic', 'vif'), (76, 'colere', 'vif'),
                         (78, 'tic', 'vif'), (81, 'colere'), (120, 'colere')])
    blink(tl, 100)
    return tl


# ======================================================================== IL CRIE
def crie():
    D = 80
    tl = Timeline('crie', D)
    # 0-14 : grande inspiration, il se tend en arriere
    tl.seq('root.s', [(0, (1, 1)), (5, (1.035, 0.965)), (14, (0.955, 1.065), 'sortie'), (17, (1.07, 0.94), 'sortie'),
                      (22, (1.02, 0.985))])
    tl.seq('root.r', [(0, 0), (14, -2.8), (17, 2.6, 'sortie'), (24, 1.2)])
    tl.seq('tete.r', [(0, 0), (14, -7.5), (17, 6, 'sortie')])
    tl.seq('tete.p', [(0, (0, 0)), (14, (-6, -18)), (17, (10, 6), 'sortie')])
    tl.seq('tete.s', [(0, (1, 1)), (14, (0.98, 1.025)), (17, (1.17, 1.17), 'sortie'), (21, (1.12, 1.12))])
    tl.oeil(3, 'plisse').oeil(15, 'serres').oeil(54, 'plisse').oeil(60, 'base')
    blink(tl, 68)
    tl.seq('bouche', [(0, 'moue'), (6, 'o'), (14, 'o', 'sortie'), (16, 'hurle')])
    tl.seq('bouche.s', [(0, (1, 1)), (14, (1.06, 1.12)), (16, (1.0, 1.0))])
    tl.seq('sourcil_g', [(0, 'colere'), (12, 'furie'), (56, 'furie'), (66, 'colere'), (80, 'colere')])
    tl.seq('sourcil_d', [(0, 'colere'), (12, 'furie'), (56, 'furie'), (66, 'colere'), (80, 'colere')])
    tl.seq('plis', [(0, 'colere'), (12, 'furie'), (56, 'furie'), (66, 'colere'), (80, 'colere')])
    tl.seq('oreille_g.r', [(0, 0), (14, 7), (17, -24, 'sortie')])
    tl.seq('oreille_d.r', [(0, 0), (14, -7), (17, 24, 'sortie')])
    tl.seq('queue.r', [(0, 0), (14, -6), (17, -17, 'sortie')])
    tl.seq('queue.s', [(0, (1, 1)), (17, (1.08, 1.08), 'sortie')])
    # 17-52 : le cri, tout vibre
    tremble(tl, 'tete.r', 17, 52, 3.0, 1.2, 2, base=lambda t: 6 - 3 * (t - 17) / 35, graine=1)
    tremble(tl, 'tete.p', 17, 52, 6.0, 2.5, 2, base=lambda t: (10 - 6 * (t - 17) / 35, 6 - 3 * (t - 17) / 35), axe=(1, 0.3), graine=2)
    tremble(tl, 'tete.s', 21, 52, 0.018, 0.01, 4, base=lambda t: (1.125, 1.125), axe=(1, 1), graine=3, e='doux')
    tremble(tl, 'oreille_g.r', 17, 52, 4, 2, 3, base=lambda t: -24, graine=4)
    tremble(tl, 'oreille_d.r', 17, 52, 4, 2, 3, base=lambda t: 24, graine=5)
    tremble(tl, 'queue.r', 17, 52, 3, 1.5, 3, base=lambda t: -17, graine=6)
    tremble(tl, 'root.r', 24, 52, 0.6, 0.3, 2, base=lambda t: 1.2, graine=7)
    # la bouche hurle par saccades
    for k, t in enumerate(range(19, 50, 6)):
        tl.k('bouche', t, 'cri' if k % 2 == 0 else 'hurle', 'doux')
    tl.k('bouche', 50, 'hurle', 'doux')
    tremble(tl, 'bouche.s', 18, 50, 0.07, 0.04, 3, base=lambda t: (1, 1), axe=(0.3, 1), graine=8, e='doux')
    # 52-80 : il reprend son souffle, dents serrees, retour au repos
    tl.seq('tete.r', [(52, 2.5, 'doux'), (58, -2.0), (65, 0.8), (72, -0.3), (80, 0)])
    tl.seq('tete.p', [(52, (4, 3), 'doux'), (58, (0, -3)), (66, (0, 1)), (80, (0, 0))])
    tl.seq('tete.s', [(52, (1.125, 1.125), 'doux'), (57, (0.97, 1.03), 'doux'), (63, (1.015, 0.985)), (70, (1, 1)), (80, (1, 1))])
    tl.seq('root.s', [(52, (1.02, 0.985)), (58, (0.98, 1.02)), (64, (1.012, 0.99)), (72, (0.996, 1.006)), (80, (1, 1))])
    tl.seq('root.r', [(52, 1.0), (60, -0.6), (68, 0.2), (80, 0)])
    tl.seq('bouche', [(55, 'grr', 'doux'), (66, 'grr', 'doux'), (74, 'moue'), (80, 'moue')])
    tl.seq('bouche.s', [(50, (1, 1)), (56, (1.08, 0.9)), (62, (1, 1)), (80, (1, 1))])
    tl.dents = [(0, 0), (56, 1), (72, 0)]
    tl.seq('oreille_g.r', [(52, -24), (60, 5, 'sortie'), (67, -2), (74, 0.5), (80, 0)])
    tl.seq('oreille_d.r', [(52, 24), (60, -5, 'sortie'), (67, 2), (74, -0.5), (80, 0)])
    tl.seq('queue.r', [(52, -17), (62, 4, 'doux'), (70, -1.5), (80, 0)])
    tl.seq('queue.s', [(52, (1.08, 1.08)), (64, (1, 1)), (80, (1, 1))])
    tl.seq('rage', [(0, 0), (14, 0), (24, 1, 'doux'), (50, 1), (70, 0), (80, 0)])
    tl.fx.append(FX.traits_cri(CENTRE_TETE, [(17, 8), (26, 8), (35, 8), (44, 8)], n=7, r1=380, r2=470, graine=11))
    tl.fx.append(FX.veine(VEINE_POS, 19, 58, battements=(28, 37, 46), echelle=0.72))
    return tl


# ======================================================================== IL PLEURE (de rage)
def pleure():
    D = 104
    tl = Timeline('pleure', D)
    # 0-12 : la levre tremble, le menton se creuse, les yeux se plissent
    tl.seq('bouche', [(0, 'moue'), (8, 'sanglot', 'doux')])
    tl.seq('bouche.s', [(0, (1, 1)), (3, (0.9, 0.8)), (5, (1.0, 0.75)), (7, (0.92, 0.85)), (10, (0.8, 0.7))])
    tl.seq('sourcil_g', [(0, 'colere'), (8, 'pleure')])
    tl.seq('sourcil_d', [(0, 'colere'), (8, 'pleure')])
    tl.seq('plis', [(0, 'colere'), (8, 'pleure')])
    tl.oeil(3, 'plisse').oeil(9, 'serres')
    tl.seq('tete.r', [(0, 0), (10, 3)])
    tl.seq('tete.p', [(0, (0, 0)), (10, (0, 7))])
    tl.seq('root.s', [(0, (1, 1)), (10, (1.02, 0.98))])
    tl.seq('oreille_g.r', [(0, 0), (12, -16)])
    tl.seq('oreille_d.r', [(0, 0), (12, 16)])
    tl.seq('queue.r', [(0, 0), (12, 5)])
    # 12-82 : cinq sanglots (inspiration saccadee puis braillement)
    sanglots = [12, 26, 40, 54, 68]
    for k, ts in enumerate(sanglots):
        a = 1.0 if k not in (0, 4) else 0.8
        tl.k('root.s', ts + 3, (0.975, 1.035 * a + (1 - a)), 'sortie')
        tl.k('root.s', ts + 7, (1.0 + 0.05 * a, 1.0 - 0.05 * a), 'sortie')
        tl.k('root.s', ts + 12, (1.012, 0.99), 'doux')
        tl.k('tete.p', ts + 3, (0, -9 * a), 'sortie')
        tl.k('tete.p', ts + 7, (0, 9 * a), 'sortie')
        tl.k('tete.p', ts + 12, (0, 4), 'doux')
        tl.k('tete.r', ts + 3, -3 * a, 'sortie')
        tl.k('tete.r', ts + 7, 4.5 * a * (1 if k % 2 == 0 else -0.6), 'sortie')
        tl.k('tete.r', ts + 12, 1.5, 'doux')
        tl.k('bouche', ts + 3, 'sanglot', 'sortie')
        tl.k('bouche', ts + 7, 'cri', 'doux')
        tl.k('bouche', ts + 12, 'sanglot', 'doux')
        tl.k('bouche.s', ts + 3, (0.86, 0.8), 'sortie')
        tl.k('bouche.s', ts + 7, (1.05, 1.08), 'sortie')
        tl.k('bouche.s', ts + 12, (0.95, 0.9), 'doux')
        tl.k('queue.r', ts + 7, 8, 'sortie')
        tl.k('queue.r', ts + 12, 4, 'doux')
        # gouttes projetees au braillement (lachees depuis la position reelle des coins des yeux)
        # elles naissent deja a cote du ruisseau (cote exterieur), jamais posees dessus
        tp = ts + 7
        for coin, sx in ((COIN_G, -1), (COIN_D, 1)):
            p0 = monde(tl, coin, tp)
            # en eventail : une vers le haut, une a l'horizontale, une entre les deux (lisibles une par une)
            for j, (vx, vy, du, r) in enumerate(((10.0, -19.0, 18, 18), (22.0, -8.0, 15, 15), (16.0, -13.0, 14, 12))):
                tl.fx.append(FX.goutte(p0 + np.array([sx * 60.0, -18.0]), (sx * vx * a, vy * a),
                                       tp + 2 * j, du, r=r))
    tremble(tl, 'oreille_g.r', 14, 80, 2.5, 2.5, 4, base=lambda t: -16, graine=21, e='doux')
    tremble(tl, 'oreille_d.r', 14, 80, 2.5, 2.5, 4, base=lambda t: 16, graine=22, e='doux')
    tl.fx.append(FX.flots_larmes([COIN_G, COIN_D], 10, 76, 84))     # partis avant que les yeux se rouvrent
    # 82-104 : il renifle, se redresse, toujours furieux
    tl.seq('bouche', [(84, 'o', 'sortie'), (88, 'o', 'doux'), (94, 'grr', 'doux'), (99, 'moue'), (104, 'moue')])
    tl.seq('bouche.s', [(84, (0.7, 0.62), 'sortie'), (88, (0.8, 0.75)), (94, (1, 1)), (104, (1, 1))])
    tl.dents = [(0, 0), (93, 1), (99, 0)]
    tl.seq('root.s', [(84, (0.975, 1.03), 'sortie'), (90, (1.01, 0.99)), (96, (0.997, 1.004)), (104, (1, 1))])
    tl.seq('tete.p', [(84, (0, -7), 'sortie'), (90, (0, 2)), (97, (0, -1)), (104, (0, 0))])
    tl.seq('tete.r', [(84, -2.5, 'sortie'), (92, 0.8), (98, -0.3), (104, 0)])
    tl.oeil(84, 'plisse').oeil(92, 'base')
    blink(tl, 97)
    tl.seq('sourcil_g', [(86, 'pleure'), (92, 'colere'), (104, 'colere')])
    tl.seq('sourcil_d', [(86, 'pleure'), (92, 'colere'), (104, 'colere')])
    tl.seq('plis', [(86, 'pleure'), (92, 'colere'), (104, 'colere')])
    tl.seq('oreille_g.r', [(80, -16), (92, 3, 'sortie'), (98, -1), (104, 0)])
    tl.seq('oreille_d.r', [(80, 16), (92, -3, 'sortie'), (98, 1), (104, 0)])
    tl.seq('queue.r', [(84, -3, 'doux'), (94, 1.5), (104, 0)])
    return tl


# ======================================================================== TRES ENERVE (il explose)
def explose():
    D = 112
    tl = Timeline('explose', D)
    # 0-22 : la colere monte, il se ramasse et tremble de plus en plus
    tl.seq('root.s', [(0, (1, 1)), (20, (1.06, 0.93), 'doux')])
    tl.seq('rage', [(0, 0), (18, 1, 'doux'), (74, 1), (100, 0, 'doux'), (112, 0)])
    tl.oeil(3, 'plisse').oeil(9, 'fous').oeil(80, 'plisse').oeil(92, 'base')
    blink(tl, 100)
    tl.seq('sourcil_g', [(0, 'colere'), (8, 'furie'), (84, 'furie'), (94, 'colere'), (112, 'colere')])
    tl.seq('sourcil_d', [(0, 'colere'), (8, 'furie'), (84, 'furie'), (94, 'colere'), (112, 'colere')])
    tl.seq('plis', [(0, 'colere'), (8, 'furie'), (84, 'furie'), (94, 'colere'), (112, 'colere')])
    tl.seq('bouche', [(0, 'moue'), (7, 'grr', 'sortie'), (21, 'grr', 'sortie'), (24, 'hurle')])
    tl.dents = [(0, 0), (7, 1), (23, 0), (68, 1), (92, 0)]
    tl.seq('bouche.s', [(0, (1, 1)), (8, (1.12, 1.0)), (21, (1.15, 0.95))])
    tl.seq('tete.s', [(0, (1, 1)), (20, (1.05, 1.05))])
    tl.seq('tete.r', [(0, 0), (6, 0)])
    tl.seq('tete.p', [(0, (0, 0)), (6, (0, 0))])
    tremble(tl, 'tete.r', 6, 22, 0.6, 2.4, 2, graine=31)
    tremble(tl, 'tete.p', 6, 22, 1.0, 4.0, 2, base=lambda t: (0, 0), axe=(1, 0.2), graine=32)
    tl.seq('root.r', [(0, 0), (8, 0)])
    tremble(tl, 'root.r', 8, 22, 0.3, 1.2, 2, graine=33)
    tl.seq('oreille_g.r', [(0, 0), (16, -18)])
    tl.seq('oreille_d.r', [(0, 0), (16, 18)])
    tl.seq('queue.r', [(0, 0), (16, -8)])
    tl.seq('queue.s', [(0, (1, 1)), (16, (1.07, 1.07))])
    tl.seq('yeux.p', [(0, (0, 0)), (10, (0, 0))])
    tremble(tl, 'yeux.p', 10, 80, 2.2, 2.2, 2, base=lambda t: (0, 0), axe=(1, 0.6), graine=34)
    tl.seq('yeux.p', [(80, (0, 0)), (112, (0, 0))])
    # 22-68 : il trepigne : trois sauts rageurs, impacts au sol
    sauts = [(22, 30, 37, 165), (40, 47, 53, 125), (56, 61, 66, 80)]
    tl.k('root.p', 0, (0, 0)).k('root.p', 22, (0, 0), 'sortie')
    for (td, ta, tt, h) in sauts:
        tl.k('root.p', ta, (0, -h), 'entree')
        tl.k('root.p', tt, (0, 0), 'sortie' if tt < 66 else 'doux')
        tl.k('root.s', td + 3, (0.9, 1.13), 'sortie')
        tl.k('root.s', ta, (0.98, 1.03), 'entree')
        tl.k('root.s', tt - 1, (0.94, 1.07), 'sortie')
        tl.k('root.s', tt + 1, (1.15, 0.85), 'sortie')
        tl.k('root.s', tt + 4, (1.03, 0.97), 'doux')
        tl.k('root.r', ta, -2.5 if h > 100 else 2, 'doux')
        tl.k('root.r', tt + 1, 1.5, 'sortie')
        tl.k('tete.p', ta, (0, -8), 'entree')
        tl.k('tete.p', tt + 1, (0, 12), 'sortie')
        tl.k('tete.p', tt + 4, (0, 2), 'doux')
        tl.k('tete.r', ta, -4, 'entree')
        tl.k('tete.r', tt + 1, 5, 'sortie')
        tl.k('tete.r', tt + 4, -1.5, 'doux')
        tl.k('oreille_g.r', ta, -28, 'entree')
        tl.k('oreille_g.r', tt + 1, -8, 'sortie')
        tl.k('oreille_d.r', ta, 28, 'entree')
        tl.k('oreille_d.r', tt + 1, 8, 'sortie')
        tl.k('queue.r', td + 4, 9, 'sortie')
        tl.k('queue.r', ta, 6, 'entree')
        tl.k('queue.r', tt + 1, -9, 'sortie')
        tl.k('bouche.s', ta, (1.0, 1.12), 'doux')
        tl.k('bouche.s', tt + 1, (1.1, 0.85), 'sortie')
        tl.fx.append(FX.choc(tt))
    tl.seq('bouche', [(24, 'hurle'), (31, 'cri'), (37, 'hurle'), (48, 'cri'), (54, 'hurle'), (62, 'cri'), (66, 'hurle')])
    tl.seq('tete.s', [(22, (1.05, 1.05)), (30, (1.12, 1.12)), (66, (1.1, 1.1))])
    # jets de vapeur par les oreilles a chaque envol, et veine qui bat
    for j, (td, ta, tt, h) in enumerate(sauts):
        # assez couches vers l'exterieur pour que le nuage ne touche jamais le haut du cadre au sommet du saut
        dy = -0.82 if j == 0 else -0.72
        for o, dirn in ((OREILLE_G, (-0.9, dy)), (OREILLE_D, (1.0, dy))):
            tl.fx.append(FX.jet_vapeur(o, dirn, td + 2, n=4, ecart=2, duree=20, r=48 - 7 * j, portee=190 - 25 * j,
                                       graine=50 + j * 3 + (o == OREILLE_D), place='devant'))
    tl.fx.append(FX.veine(VEINE_POS, 8, 92, battements=(16, 26, 38, 50, 62, 74), echelle=0.8))
    tl.fx.append(FX.traits_cri(CENTRE_TETE, [(24, 7), (32, 7), (42, 7), (50, 7), (58, 7)], n=8, r1=380, r2=455, graine=41))
    # 66-112 : halete, la vapeur retombe, la couleur redescend
    tl.seq('root.s', [(70, (1.02, 0.98)), (76, (0.985, 1.02)), (82, (1.015, 0.985)), (88, (0.99, 1.012)),
                      (95, (1.006, 0.994)), (102, (0.998, 1.003)), (112, (1, 1))])
    tl.seq('root.r', [(70, 0.6), (80, -0.4), (92, 0.2), (112, 0)])
    tl.seq('root.p', [(112, (0, 0))])
    tl.seq('tete.p', [(70, (0, 4)), (76, (0, -4)), (82, (0, 3)), (88, (0, -2)), (96, (0, 1)), (112, (0, 0))])
    tl.seq('tete.r', [(70, 1.5), (78, -1.2), (88, 0.6), (98, -0.2), (112, 0)])
    tl.seq('tete.s', [(70, (1.06, 1.06)), (84, (1.0, 1.0)), (112, (1, 1))])
    tl.seq('bouche', [(70, 'grr', 'doux'), (90, 'grr'), (97, 'moue'), (112, 'moue')])
    tl.seq('bouche.s', [(70, (1.1, 0.95)), (76, (1.0, 1.05)), (82, (1.08, 0.95)), (88, (1, 1)), (112, (1, 1))])
    tl.seq('oreille_g.r', [(70, -12), (84, 3, 'doux'), (92, -1), (100, 0), (112, 0)])
    tl.seq('oreille_d.r', [(70, 12), (84, -3, 'doux'), (92, 1), (100, 0), (112, 0)])
    tl.seq('queue.r', [(70, -6), (86, 3), (98, -1), (112, 0)])
    tl.seq('queue.s', [(70, (1.07, 1.07)), (92, (1, 1)), (112, (1, 1))])
    for j, (t, r) in enumerate(((74, 28), (88, 20))):
        for o, dirn in ((OREILLE_G, (-0.55, -1.0)), (OREILLE_D, (0.6, -1.0))):
            tl.fx.append(FX.jet_vapeur(o, dirn, t, n=2, ecart=3, duree=18, r=r + 8, portee=150 - 30 * j,
                                       graine=70 + j * 2 + (o == OREILLE_D), place='devant'))
    return tl


# ======================================================================== LA BASCULE (Taro normal -> Taro rouge)
def bascule():
    """Le rouge lui monte au visage comme dans un thermometre, puis il bout : sourcils qui claquent,
    vapeur, veine. Part de la pose de repos du Taro normal, finit sur la pose de repos de Taro rouge."""
    D = 60
    tl = Timeline('bascule', D)
    tl.remplissage = (6, 26, 'monte')
    # la pression monte : il se tasse et tremble de plus en plus, puis ca explose a 26-27
    tl.seq('root.s', [(0, (1, 1)), (6, (1.0, 1.0)), (24, (1.05, 0.95), 'doux'), (27, (0.94, 1.07), 'sortie'),
                      (31, (0.98, 1.02)), (33, (1.06, 0.95), 'sortie'), (37, (0.995, 1.006)), (44, (1, 1)), (60, (1, 1))])
    tl.seq('root.r', [(0, 0), (10, 0)])
    tremble(tl, 'root.r', 10, 26, 0.2, 1.0, 2, graine=81)
    tl.seq('root.r', [(26, 0), (60, 0)])
    tl.seq('tete.p', [(0, (0, 0)), (8, (0, 0))])
    tremble(tl, 'tete.p', 8, 26, 0.6, 3.2, 2, base=lambda t: (0, 0), axe=(1, 0.25), graine=82)
    tl.seq('tete.p', [(26, (0, 0)), (28, (0, -4), 'sortie'), (33, (0, 3)), (40, (0, 0)), (60, (0, 0))])
    # le sursaut est un petit bond de tout le corps (la tete ne se decolle pas de la queue)
    tl.seq('root.p', [(0, (0, 0)), (26, (0, 0)), (28, (0, -18), 'sortie'), (32, (0, 0), 'entree'), (60, (0, 0))])
    tl.seq('tete.s', [(0, (1, 1)), (24, (0.98, 0.98), 'doux'), (27, (1.1, 1.1), 'sortie'), (32, (1.035, 1.035)),
                      (40, (1, 1)), (60, (1, 1))])
    tl.seq('tete.r', [(0, 0), (26, 0), (28, 2.5, 'sortie'), (34, -1.0), (42, 0.4), (50, 0), (60, 0)])
    # les sourcils apparaissent sous le rouge, hauts, puis claquent vers le bas
    for c in ('g', 'd'):
        tl.seq(f'sourcil_{c}.p', [(0, (0, 0)), (4, (0, -16)), (25, (0, -16), 'vif'), (27, (0, 6), 'sortie'),
                                  (31, (0, -2)), (35, (0, 0)), (60, (0, 0))])
        tl.seq(f'sourcil_{c}', [(0, 'colere'), (25, 'colere', 'vif'), (27, 'furie', 'doux'), (40, 'colere'), (60, 'colere')])
    tl.seq('plis', [(0, 'colere'), (25, 'colere', 'vif'), (27, 'furie', 'doux'), (40, 'colere'), (60, 'colere')])
    tl.seq('bouche', [(0, 'moue'), (10, 'grr', 'doux'), (40, 'grr', 'doux'), (48, 'moue'), (60, 'moue')])
    tl.seq('bouche.s', [(0, (1, 1)), (26, (1, 1)), (28, (1.15, 0.9), 'sortie'), (36, (1, 1)), (60, (1, 1))])
    tl.dents = [(0, 0), (10, 1), (46, 0)]
    tl.oeil(26, 'plisse').oeil(30, 'base')
    blink(tl, 52)
    tl.seq('oreille_g.r', [(0, 0), (24, 0), (27, -15, 'sortie'), (32, 4.5), (38, -1.5), (44, 0), (60, 0)])
    tl.seq('oreille_d.r', [(0, 0), (24, 0), (27, 15, 'sortie'), (32, -4.5), (38, 1.5), (44, 0), (60, 0)])
    tl.seq('queue.r', [(0, 0), (24, -2), (28, 9, 'sortie'), (36, -3.5), (46, 1.2), (60, 0)])
    tl.seq('queue.s', [(0, (1, 1)), (24, (1, 1)), (28, (1.08, 1.08), 'sortie'), (42, (1, 1)), (60, (1, 1))])
    for o, dirn, g in ((OREILLE_G, (-0.6, -1.0), 91), (OREILLE_D, (0.64, -1.0), 92)):
        tl.fx.append(FX.jet_vapeur(o, dirn, 27, n=3, ecart=2, duree=19, r=44, portee=190, graine=g, place='devant'))
    tl.fx.append(FX.veine(VEINE_POS, 27, 54, battements=(36, 45), echelle=0.72))
    tl.fx.append(FX.bouffee(NEZ_G, (548, 668), 46, 13, r=13, taille_max=1.15, rot=-20))
    tl.fx.append(FX.bouffee(NEZ_D, (872, 630), 46, 13, r=13, taille_max=1.15, rot=15))
    return tl


# ======================================================================== RETOUR AU CALME (Taro rouge -> Taro normal)
def calme():
    """Grand soupir : la vapeur s'echappe, le rouge redescend de haut en bas, Taro redevient normal.
    Part de la pose de repos de Taro rouge, finit sur la pose de repos du Taro normal."""
    D = 56
    tl = Timeline('calme', D)
    tl.remplissage = (14, 36, 'descend')
    # inspiration (0-12), longue expiration (12-36), il se pose (36-56)
    tl.seq('root.s', [(0, (1, 1)), (11, (0.975, 1.03), 'doux'), (30, (1.03, 0.97), 'doux'), (40, (0.995, 1.006)),
                      (48, (1, 1)), (56, (1, 1))])
    tl.seq('tete.p', [(0, (0, 0)), (11, (0, -3), 'doux'), (30, (0, 7), 'doux'), (42, (0, 1)), (50, (0, 0)), (56, (0, 0))])
    tl.seq('tete.r', [(0, 0), (11, -1.8), (30, 1.6), (44, -0.3), (56, 0)])
    tl.seq('bouche', [(0, 'moue'), (6, 'o', 'doux'), (12, 'o', 'doux'), (16, 'moue'), (56, 'moue')])
    tl.seq('bouche.s', [(0, (1, 1)), (8, (1.1, 1.2)), (13, (0.8, 0.7)), (18, (1, 1)), (56, (1, 1))])
    for c in ('g', 'd'):
        tl.seq(f'sourcil_{c}.p', [(0, (0, 0)), (12, (0, -6), 'doux'), (24, (0, -10)), (56, (0, 0))])
    tl.oeil(12, 'mi')
    tl.oeil(40, 'base')
    tl.seq('oreille_g.r', [(0, 0), (11, 3), (30, -9, 'doux'), (42, 1.5), (50, 0), (56, 0)])
    tl.seq('oreille_d.r', [(0, 0), (11, -3), (30, 9, 'doux'), (42, -1.5), (50, 0), (56, 0)])
    tl.seq('queue.r', [(0, 0), (12, 2), (32, -3.5, 'doux'), (46, 1), (56, 0)])
    for o, dirn, g in ((OREILLE_G, (-0.5, -1.0), 93), (OREILLE_D, (0.55, -1.0), 94)):
        tl.fx.append(FX.jet_vapeur(o, dirn, 13, n=3, ecart=3, duree=22, r=36, portee=170, graine=g, place='devant'))
    return tl


def _avec_corps(f):
    """Ajoute le jeu d'acteur du corps (corps_anim.py) a une animation du visage."""
    import corps_anim as CA
    def g():
        tl = f()
        CA.TOUS[f.__name__](tl)
        CA.bouchon_queue(tl, f.__name__)
        return tl
    g.__name__ = f.__name__
    return g


attente, crie, pleure, explose, bascule, calme = (_avec_corps(f) for f in (attente, crie, pleure, explose, bascule, calme))
TOUTES = {'attente': attente, 'crie': crie, 'pleure': pleure, 'explose': explose, 'bascule': bascule, 'calme': calme}
