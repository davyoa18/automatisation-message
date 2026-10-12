"""Decoupe du corps de Taro en membres articules.

Le torse d'origine est une seule image (sweat, bras poings sur les hanches, short, chaussures).
On le separe en : capuche avant (languettes sur les epaules), bras (haut), avant-bras (avec la
manchette), poings, torse (sweat seul), jambes et pieds. Chaque piece est completee la ou elle etait
cachee (flancs du sweat sous les bras, dessous du bras sous l'avant-bras, poing entier sous la
manchette, haut des jambes sous l'ourlet, dessus des chaussures sous le short) avec un contour encre
partout ou un bord neuf peut se decouvrir. Au repos, la superposition redonne exactement le dessin.

Ordre des calques (devant -> derriere) :
  capuche_avant, avbras_g, avbras_d, poing_g, poing_d, bras_g, bras_d, torse, ..., jambes, pieds
"""
import json
import numpy as np
import cv2
from scipy import ndimage as ndi
from pieces import (N, masque_poly, masque_trait, chemin, catmull, encre_de, lum, repeint, complete,
                    grain, ENCRE)

ICI = __file__.rsplit('/', 1)[0]


def torse_rig():
    info = json.load(open(f'{ICI}/rig/pieces.json'))['torse']
    from PIL import Image
    a = np.asarray(Image.open(f'{ICI}/rig/torse.png').convert('RGBA')).astype(np.float32) / 255
    T = np.zeros((N, N, 4), np.float32)
    T[info['y']:info['y'] + info['h'], info['x']:info['x'] + info['w']] = a
    return T


def disque(c, r):
    yy, xx = np.mgrid[0:N, 0:N]
    return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= r * r


# ------------------------------------------------------------------ geometrie (repere scene 1254)
# Bras gauche (a l'ecran) : epaule S, coude E, poignet W
S_G, E_G = (488.0, 822.0), (441.0, 901.0)
R_EPAULE_G = 58.0
# contour exterieur du coude : cercle de rayon ~80 autour de E (de 100 a 225 deg). L'avant-bras garde une
# boule sans encre (rayon R_BOULE) ; l'anneau encre du coude appartient au bras.
R_BOULE_G, R_ANNEAU_G = 50.0, 81.0
ANG_PLI_G, ANG_FIN_G = -39.0, 150.0
# zone du bras gauche : sous la languette de capuche, le long du pli doux, autour du poing, bas de l'avant-bras
ZONE_BRAS_G = [(330, 760), (430, 760), (445, 778), (500, 780), (545, 786), (562, 800), (566, 818), (572, 835),
               (578, 850), (583, 866), (585, 882), (580, 898), (588, 913), (600, 935), (608, 960), (607, 990),
               (597, 1015), (572, 1032), (535, 1036), (500, 1027), (470, 1015), (447, 1006), (430, 1004), (416, 995),
               (330, 995)]
LANGUETTE_G = [(428, 768), (446, 756), (500, 750), (545, 752), (560, 770), (552, 786), (520, 784), (490, 786),
               (460, 791), (444, 792), (436, 782)]
# points du sweat (hors bras) relies au tissu qui deborde de la zone : retires du bras
GRAINES_CORPS_G = [(625, 960), (612, 1000), (470, 1030), (520, 1040), (590, 1030)]
# bord haut du pli du coude (l'encre du pli appartient a l'avant-bras, devant)
PLI_G = [(503, 851), (505, 854), (515, 856), (525, 859), (535, 864), (545, 871), (552, 876), (558, 883),
         (564, 891), (570, 897)]


def zones_bras_g(T):
    A = T[..., 3] > 0.02
    ink = encre_de(T, 0.24) & A
    zone = (masque_poly(ZONE_BRAS_G) > 0.5) & A
    # le tissu du sweat au-dela du contour du poing et sous l'avant-bras n'est pas du bras
    tissu = A & ~ink
    yy, xx = np.mgrid[0:N, 0:N]
    boite = ((xx >= 572) & (xx <= 650) & (yy >= 905) & (yy <= 1050)) | ((xx >= 425) & (xx <= 650) & (yy >= 985) & (yy <= 1050))
    lab, n = ndi.label(tissu & boite)
    corps_ = np.isin(lab, [lab[y, x] for (x, y) in GRAINES_CORPS_G if lab[y, x] > 0])
    zone &= ~corps_
    lang = (masque_poly(LANGUETTE_G) > 0.5) & A
    bras = zone & ~lang
    # avant-bras (avec la manchette et le poing) : petite boule unie autour du coude (rayon R_BOULE, invisible
    # quand elle tourne), secteur [ANG_PLI, ANG_FIN] de l'anneau du coude (son encre est concentrique : elle
    # glisse sur celle du bras), puis tout ce qui est sous le pli au-dela de l'anneau.
    yy, xx = np.mgrid[0:N, 0:N]
    dx, dy = xx - E_G[0], yy - E_G[1]
    r = np.hypot(dx, dy)
    ang = np.degrees(np.arctan2(dy, dx))
    secteur = (ang >= ANG_PLI_G) & (ang <= ANG_FIN_G)
    dessous = masque_poly(list(PLI_G) + [(640, 897), (640, 1050), (300, 1050), (300, 990)]) > 0.5
    avb = bras & ((r <= R_BOULE_G) | (secteur & (r <= R_ANNEAU_G)) | (dessous & (r > R_ANNEAU_G)))
    # encre trop loin du tissu de l'avant-bras (amorces de contours du sweat) : rendue au sweat
    loin = ink & avb & (ndi.distance_transform_edt(~(avb & ~ink)) > 21)
    avb &= ~loin
    bras &= ~loin
    zone &= ~loin
    haut = bras & ~avb
    return dict(zone=zone, lang=lang, bras=bras, haut=haut, avb=avb, ink=ink)




# points du tissu principal de chaque avant-bras (manchette, poing) : le reste du tissu n'en fait pas partie
GRAINES_AVB_G = [(470, 930), (520, 960), (548, 985), (500, 900), (560, 1010)]
GRAINES_AVB_D = [(915, 955), (900, 930), (960, 900), (940, 920), (880, 940)]


# Bras droit (a l'ecran) : ici le haut du bras (avec la boule du coude) passe DEVANT l'avant-bras ;
# l'avant-bras ressort par en dessous, son bord haut est l'ombre douce sous la boule.
S_D, E_D = (928.0, 806.0), (957.7, 854.6)
LANGUETTE_D = [(770, 700), (800, 688), (900, 688), (936, 698), (942, 722), (932, 737), (915, 744), (900, 750),
               (880, 758), (860, 766), (830, 776), (800, 786), (770, 793)]
ZONE_BRAS_D = [(846, 770), (880, 757), (900, 748), (915, 742), (932, 735), (950, 690), (1070, 690), (1070, 930),
               (1012, 930), (996, 946), (976, 958), (956, 969), (941, 981), (925, 988), (905, 992), (888, 991),
               (866, 984), (853, 962), (850, 930), (853, 905), (856, 890), (856, 878), (855, 866), (852, 852),
               (848, 835), (846, 815), (846, 792)]
GRAINES_CORPS_D = [(840, 940), (845, 990), (975, 985), (1000, 975), (960, 995)]
# bord haut de l'avant-bras (haut de la bande d'ombre), du pli interieur jusqu'a l'anneau du coude
OMBRE_D = [(850, 868), (885, 870), (903, 874), (919, 875), (929, 882), (938, 889), (948, 893), (959, 900),
           (966, 902), (974, 904), (981, 901), (987, 898), (994, 895), (1000, 889), (1006, 884)]
R_ANNEAU_D = 82.0
R_BOULE_D = 50.0
ANG_A_D, ANG_B_D = 20.0, 110.0
# dessous du haut du bras droit, cache par l'avant-bras (du pli interieur jusqu'au coude)
DESSOUS_D = [(858, 862), (885, 866), (920, 872), (945, 884), (960, 920), (930, 935), (895, 925), (870, 905), (864, 885)]


def nettoie_zone(z, ink, graines):
    """Le tissu de l'avant-bras qui n'est pas relie a son tissu principal (bouts de sweat sous le poing) est
    rendu au sweat, avec l'encre qui n'est plus pres du tissu de l'avant-bras."""
    tissu = z['avb'] & ~ink
    lab, n = ndi.label(tissu)
    tailles = ndi.sum(tissu, lab, np.arange(1, n + 1))
    ids = {lab[y, x] for (x, y) in graines if lab[y, x] > 0} | {i + 1 for i, t_ in enumerate(tailles) if t_ >= 800}
    garde = np.isin(lab, list(ids))     # manche, manchette et poing (la paume beige est un morceau a part)
    rendu = tissu & ~garde
    # mais les liseres d'antialiasing colles aux traits de l'avant-bras (bord du pli du coude) restent a lui
    lab_r, nr = ndi.label(rendu)
    if nr:
        tailles_r = ndi.sum(rendu, lab_r, np.arange(1, nr + 1))
        petits = np.isin(lab_r, 1 + np.nonzero(tailles_r < 60)[0])
        rendu &= ~(petits & ndi.binary_dilation(z['avb'] & ink, iterations=2))
    avb = z['avb'] & ~rendu
    loin = ink & avb & (ndi.distance_transform_edt(~(avb & ~ink)) > 21)
    avb &= ~loin
    out = dict(z)
    retire = rendu | loin
    out['avb'] = avb
    out['bras'] = z['bras'] & ~retire
    out['zone'] = z['zone'] & ~retire
    out['haut'] = out['bras'] & ~avb
    return out


FEN_HANCHE_G = (395, 950, 480, 1035)
FEN_HANCHE_D = (860, 925, 995, 1012)
W_CONTOUR = 17.0
EP_POING = 16.8          # epaisseur du trait du contour du poing (mesuree au bord exterieur)
FEN_PLI_G = (540, 850, 606, 920)   # jonction pli du coude / manchette gauche (se voit quand le poing se replie)


def hanche(z, ink, fen):
    """Jonction poing / hanche : l'avant-bras possede exactement l'encre de son propre contour (a moins d'une
    largeur de trait de son tissu), le sweat garde le reste (le trait du flanc). Plus de lame d'encre qui reste
    collee au sweat ni de bout de flanc qui part avec le poing."""
    yy, xx = np.mgrid[0:N, 0:N]
    w = (xx >= fen[0]) & (xx < fen[2]) & (yy >= fen[1]) & (yy < fen[3])
    tissu_f = z['avb'] & ~ink
    d_f = ndi.distance_transform_edt(~tissu_f)
    a_lui = ink & w & (d_f <= W_CONTOUR) & ndi.binary_dilation(z['avb'], iterations=int(W_CONTOUR) + 2)
    pas_lui = ink & w & z['avb'] & (d_f > W_CONTOUR)
    out = dict(z)
    out['avb'] = (z['avb'] | a_lui) & ~pas_lui
    out['bras'] = (z['bras'] | a_lui) & ~pas_lui
    out['zone'] = (z['zone'] | a_lui) & ~pas_lui
    out['haut'] = out['bras'] & ~out['avb']
    return out


def donne_jonction_au_rabat(z, ink, larg=7):
    """L'encre de la jonction rabat de capuche / bras (juste sous le rabat) appartient au rabat : quand le bras
    se hausse ou s'abaisse, on ne voit pas de trait dedouble sous le bord du rabat."""
    j = ink & z['haut'] & ndi.binary_dilation(z['lang'], iterations=larg)
    # avec la frange d'antialiasing de ce trait (pixels assombris juste a cote)
    T_ = torse_rig()
    j |= z['haut'] & ndi.binary_dilation(j, iterations=2) & (lum(T_) < 0.5)
    out = dict(z)
    out['lang'] = z['lang'] | j
    out['haut'] = z['haut'] & ~j
    out['bras'] = z['bras'] & ~j
    return out


def frange_a_lavant_bras(z, ink, T):
    """Les pixels du haut du bras colles a un trait de l'avant-bras (antialiasing du pli du coude, du haut de la
    manchette) partent avec l'avant-bras : sinon un fil pointille reste en place quand le coude plie."""
    fr = z['haut'] & ndi.binary_dilation(z['avb'] & ink, iterations=3) & ~ndi.binary_dilation(z['haut'] & ink, iterations=4)
    fr &= lum(T) < np.percentile(lum(T)[z['haut'] & ~ink], 50) - 0.02
    out = dict(z)
    out['avb'] = z['avb'] | fr
    out['haut'] = z['haut'] & ~fr
    return out


def zones_bras_d(T):
    A = T[..., 3] > 0.02
    ink = encre_de(T, 0.24) & A
    zone = (masque_poly(ZONE_BRAS_D) > 0.5) & A
    tissu = A & ~ink
    yy, xx = np.mgrid[0:N, 0:N]
    boite = ((xx >= 820) & (xx <= 875) & (yy >= 860) & (yy <= 1015)) | ((xx >= 860) & (xx <= 1070) & (yy >= 940) & (yy <= 1015))
    lab, n = ndi.label(tissu & boite)
    corps_ = np.isin(lab, [lab[y, x] for (x, y) in GRAINES_CORPS_D if lab[y, x] > 0])
    zone &= ~corps_
    lang = (masque_poly(LANGUETTE_D) > 0.5) & A
    bras = zone & ~lang
    # avant-bras (devant, comme a gauche) : boule unie du coude (r <= R_BOULE_D), secteur bas de l'anneau
    # (concentrique : il glisse sur l'anneau complet du haut du bras), puis tout ce qui est sous la ligne d'ombre
    dessous = masque_poly(list(OMBRE_D) + [(1080, 884), (1080, 1030), (820, 1030), (820, 868)]) > 0.5
    r = np.hypot(xx - E_D[0], yy - E_D[1])
    ang = np.degrees(np.arctan2(yy - E_D[1], xx - E_D[0]))
    secteur = (ang >= ANG_A_D) & (ang <= ANG_B_D)
    avb = bras & ((r <= R_BOULE_D) | (secteur & (r <= R_ANNEAU_D)) | (dessous & (r > R_BOULE_D)))
    haut = bras & ~avb
    return dict(zone=zone, lang=lang, bras=bras, haut=haut, avb=avb, ink=ink)


# ------------------------------------------------------------------ completion des pieces
# flancs du sweat caches sous les bras (le torse seul doit etre complet quand les bras s'ecartent)
FLANC_G = [(600, 778), (540, 782), (480, 784), (446, 778), (431, 782), (418, 796), (412, 815), (417, 840),
           (428, 870), (440, 910), (447, 950), (446, 975), (437, 992), (429, 1004), (428, 1045), (600, 1045)]
FLANC_D = [(780, 760), (860, 760), (905, 748), (931, 738), (955, 742), (975, 755), (986, 775), (984, 800),
           (972, 830), (957, 870), (946, 910), (937, 950), (933, 970), (930, 984), (924, 994), (912, 1002), (780, 1002)]
# epaules : prolongement du haut du bras sous la languette de capuche (cache au repos)
EXT_EPAULE_G = None   # calculees plus bas (calotte centree sur l'epaule)
EXT_EPAULE_D = None
# dessous du bras gauche cache par l'avant-bras : du pli jusqu'au coude, bord interieur tangent a l'anneau
DESSOUS_G = [(490, 838), (505, 842), (566, 876), (582, 896), (566, 910), (530, 935), (487, 958), (441, 901)]
# dessous du haut du bras gauche, cache par l'avant-bras : bande sous le pli (son bord bas sera encre)
def _bande_pli_g(ep=18.0):
    P = np.array(PLI_G, float)
    return [tuple(p) for p in P] + [tuple(p + (0, ep)) for p in P[::-1]]


def _poly_disque(c, r, n=96):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [(c[0] + r * np.cos(a), c[1] + r * np.sin(a)) for a in t]


def _secteur(c, r0, r1, a0, a1, n=48):
    t = np.radians(np.linspace(a0, a1, n))
    ext = [(c[0] + r1 * np.cos(a), c[1] + r1 * np.sin(a)) for a in t]
    inn = [(c[0] + r0 * np.cos(a), c[1] + r0 * np.sin(a)) for a in t[::-1]]
    return ext + inn


def remplit_tissu(Q, zone, conf, graine=0, exclure=None):
    """Remplissage lisse (pyramide push-pull) depuis le tissu propre voisin (ni encre, ni ombre forte),
    puis grain de peinture : pas de trainees comme l'inpainting."""
    from tete import push_pull
    encre = encre_de(Q, 0.30)
    propre = conf & ~ndi.binary_dilation(encre, iterations=3)
    if exclure is not None:
        propre &= ~exclure
    base = push_pull(Q[..., :3], propre.astype(np.float32), niveaux=7)
    # adoucit loin du bord seulement (au bord, la couleur colle a celle du tissu voisin)
    # loin du tissu connu : degrade tres doux (pas de taches), pres du bord : la couleur du voisin
    d = ndi.distance_transform_edt(~propre)
    w1 = np.clip((d - 3) / 12.0, 0, 1)[..., None]
    w2 = np.clip((d - 15) / 30.0, 0, 1)[..., None]
    b1 = cv2.GaussianBlur(base, (0, 0), 8)
    b2 = cv2.GaussianBlur(base, (0, 0), 22)
    base = base * (1 - w1) + b1 * w1
    base = base * (1 - w2) + b2 * w2
    g = grain(Q.shape, 0.004, graine, flou=1.2)
    fill = base + g[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
    out = Q.copy()
    out[..., :3] = np.where(zone[..., None], fill, Q[..., :3])
    return out


def cache_de(T, zone, conf):
    """Ou une piece arriere peut etre prolongee : sous 'zone' (piece avant), sans deborder de la silhouette
    d'origine (bord anticrenele). Pas d'erosion a l'interieur : aucune fente le long des decoupes."""
    sil = ndi.binary_erosion(T[..., 3] > 0.5, iterations=1)
    sil_doux = cv2.GaussianBlur(sil.astype(np.float32), (0, 0), 0.6)
    z = zone | (ndi.binary_dilation(zone, iterations=3) & conf)
    return z.astype(np.float32) * sil_doux


def adoucit_interne(P, zone, T, partenaire, larg=4.0):
    """Fondu de l'alpha d'une piece AVANT le long de ses bords internes avec la piece 'partenaire' (qui
    reproduit le dessin d'origine dessous), seulement sur le tissu : quand elle bouge, pas de coupe nette."""
    A = T[..., 3] > 0.5
    autre = A & partenaire & ~zone
    d = ndi.distance_transform_edt(~autre)
    # seulement la ou le voisin le plus proche est bien le partenaire (pas une 3e piece)
    tiers = (A & ~partenaire & ~zone) | ~A
    d_t = ndi.distance_transform_edt(~tiers)
    d = np.where(d_t < d + 2, 1e3, d)
    tissu = ~ndi.binary_dilation(encre_de(T, 0.30), iterations=2)
    f = np.clip((d - 0.5) / larg, 0, 1)
    f = np.where(tissu & zone, f, 1.0)
    P = P.copy()
    P[..., 3] *= f
    return P


def calotte(c, r, a0, a1, bas):
    """Polygone : arc de cercle de centre c (angles a0 -> a1, degres) ferme par la ligne 'bas'."""
    t = np.radians(np.linspace(a0, a1, 40))
    return [(c[0] + r * np.cos(u), c[1] + r * np.sin(u)) for u in t] + list(bas)


def bande_interne(zone_avant, T, larg=6):
    """Bande (dans la piece avant) le long de son bord interne : la piece arriere doit y reproduire
    exactement le dessin d'origine, pour que le fondu de la piece avant soit invisible au repos."""
    A = T[..., 3] > 0.5
    return zone_avant & ndi.binary_dilation(A & ~zone_avant, iterations=larg)


def complete_cache(T, conf, polys, epais, graine, cache=None, orig=False, exact=None, exclure=None):
    """complete() puis : les pixels de confiance reprennent exactement leur valeur d'origine (aucun trait
    ajoute sur ce qui se voit au repos) et l'ajout reste a l'interieur de 'cache' (silhouette d'origine
    erodee : ce qui est ajoute est cache au repos par une autre piece)."""
    E = T.copy()
    E[..., 3] = np.where(conf, T[..., 3], 0)
    Q, sil = complete(E, conf, polys, epais=epais, graine=graine)
    # le remplissage de complete() (inpainting) est remplace par un fond lisse, sous l'encre ajoutee
    ajout = sil & ~conf
    encre_aj = ajout & (lum(Q) < 0.2)
    if exact is not None:
        encre_aj &= ~exact
    F = remplit_tissu(E, ajout, conf, graine, exclure)
    if orig:
        # sous une piece avant du meme tissu : on garde le dessin d'origine la ou c'est du tissu uni (meme
        # couleur que le fond lisse), on ne remplace que les traits et ombres propres a la piece avant
        enc_T = ndi.binary_dilation(encre_de(T, 0.30), iterations=3)
        uni = (np.abs(T[..., :3] - F[..., :3]).max(-1) < 0.07) & (T[..., 3] > 0.98) & ~enc_T
        F = F.copy()
        F[..., :3] = np.where(uni[..., None], T[..., :3], F[..., :3])
    if exact is not None:
        # sous le fondu de la piece avant : le dessin d'origine exact (repos inchange)
        F = F.copy()
        F[..., :3] = np.where(exact[..., None], T[..., :3], F[..., :3])
    Q[..., :3] = np.where((ajout & ~encre_aj)[..., None], F[..., :3], Q[..., :3])
    Q[conf] = T[conf]
    if cache is not None:
        ajout = ~conf
        Q[..., 3] = np.where(ajout, Q[..., 3] * cache, Q[..., 3])
    return Q, sil


def halo(T, zone, autour, ep=3):
    """Pixels de 'autour' (tissu du torse) colles a 'zone' et assombris par l'antialiasing du trait du bras.
    Renvoie (masque, alpha d'encre t) : couleur = encre * t + tissu * (1 - t)."""
    from tete import push_pull
    encre = encre_de(T, 0.30)
    # seulement autour des traits d'encre du bras qui touchent son bord (pas le long d'un pli doux)
    bord = zone & ndi.binary_dilation(~zone, iterations=1)
    bord_encre = bord & ndi.binary_dilation(encre & zone, iterations=1)
    bande = ndi.binary_dilation(bord_encre, iterations=ep) & ~zone & autour & (T[..., 3] > 0.98)
    # tissu de reference : l'anneau juste au-dela du halo (couleur locale, ombre comprise) ; sinon, quand le bras
    # s'ecarte, le halo garde une couleur moyenne plus claire et dessine un fil le long de l'ancien contour
    propre = autour & ~ndi.binary_dilation(encre | zone, iterations=ep + 2)
    proche = propre & ndi.binary_dilation(zone, iterations=ep + 8)
    base = push_pull(T[..., :3], proche.astype(np.float32), niveaux=4)
    loin = push_pull(T[..., :3], propre.astype(np.float32), niveaux=6)
    base = np.where((ndi.distance_transform_edt(~proche) <= 6)[..., None], base, loin)
    # projection sur le segment tissu -> encre : seuls les vrais melanges avec l'encre sont du halo
    # (une ombre orange plus saturee n'est pas sur ce segment et reste au sweat)
    v = ENCRE[None, None] - base
    t = ((T[..., :3] - base) * v).sum(-1) / np.maximum((v * v).sum(-1), 1e-6)
    t = np.clip(t, 0, 1)
    resid = np.abs(base + t[..., None] * v - T[..., :3]).max(-1)
    # tout le lisere d'anticrenelage part avec le bras en encre semi-transparente (meme s'il n'est pas un melange
    # exact tissu / encre : ecart de quelques % au repos) ; le sweat recoit le tissu local dessous. Ni points sombres
    # sur le sweat quand le bras s'en va, ni pixels orange colles au contour du bras quand il bouge.
    m = bande & (t > 0.03) & (resid < 0.25)
    reste = np.zeros_like(m)
    # pas les bords des traits du sweat lui-meme (jonctions de contours) : ils restent au sweat
    encre_propre = encre & autour & ~ndi.binary_dilation(zone, iterations=ep + 1)
    m &= ~ndi.binary_dilation(encre_propre, iterations=ep + 1)
    reste &= ~ndi.binary_dilation(encre_propre, iterations=ep + 1)
    reste &= ~ndi.binary_dilation(encre & autour, iterations=3)
    return m | reste, np.where(reste, -1.0, t * m), base


# calotte d'epaule : arc centre sur le pivot, cache sous la languette ; en tournant, il glisse sur lui-meme
EXT_EPAULE_G = calotte(S_G, 66.0, -200.0, -30.0, [(560, 800), (500, 800), (440, 800)])
EXT_EPAULE_D = calotte(S_D, 66.0, -205.0, -40.0, [(900, 790), (870, 800), (856, 800)])


# contour cache des flancs du sweat (ligne mediane du trait), du contour de hanche visible jusque sous la capuche
CONTOUR_FLANC_G = [(428, 1024), (427, 1010), (429.5, 1000), (432, 990), (436, 978), (440, 962), (444, 945),
                   (446, 925), (445, 900), (438, 870), (428, 842), (421, 815), (424, 795), (436, 780), (460, 770)]
INTERIEUR_FLANC_G = [(620, 770), (620, 1024)]
CONTOUR_FLANC_D = [(937, 1022), (932, 1010), (927.5, 1000), (923, 988), (920, 975), (920, 960), (924, 940), (931, 920),
                   (941, 895), (950, 868), (956, 840), (957, 812), (951, 780), (938, 755), (915, 742)]
INTERIEUR_FLANC_D = [(780, 742), (780, 1022)]
EP_FLANC = {'g': 17.0, 'd': 19.0}


def flanc(T, conf, contour, interieur, graine):
    """Prolonge le sweat sous un bras : zone fermee par le contour lisse + trait d'encre de l'epaisseur du
    contour visible. Ne touche pas aux pixels visibles (conf) et ne sort pas de la silhouette d'origine."""
    c = catmull(contour, 12)
    region = (masque_poly(np.vstack([c, interieur])) > 0.5)
    trait = masque_trait(c, EP_FLANC)
    Ae = ndi.binary_erosion(T[..., 3] > 0.5, iterations=2)
    A = cv2.GaussianBlur(Ae.astype(np.float32), (0, 0), 0.6) * Ae
    neuf = (region | (trait > 0.02)) & ~conf & Ae
    return neuf, np.clip(trait, 0, 1), A


OMBRE = np.array([0.80, 0.27, 0.02], np.float32)    # ombre orange profonde du sweat


def ombre_portee(T, bras, torse_tissu, larg=26):
    """Ombre que le bras projette sur le sweat : pixels du sweat pres du bras, plus sombres que le tissu de
    base. Renvoie (masque, alpha, base) : T = base * (1 - alpha) + OMBRE * alpha."""
    from tete import push_pull
    pres = ndi.binary_dilation(bras, iterations=larg) & torse_tissu & ~bras
    encre = ndi.binary_dilation(encre_de(T, 0.30), iterations=2)
    loin = torse_tissu & ~ndi.binary_dilation(bras, iterations=larg + 6) & ~encre
    base = push_pull(T[..., :3], loin.astype(np.float32), niveaux=7)
    # couleur de l'ombre : la plus soutenue observee pres du bras (orange sature, pas brun)
    zone = pres & ~encre
    ecart = (base - T[..., :3])[..., 1]                     # le vert baisse dans l'ombre
    forts = zone & (ecart > np.percentile(ecart[zone], 92))
    S = np.median(T[..., :3][forts], axis=0).astype(np.float32)
    v = S[None, None] - base
    a = ((T[..., :3] - base) * v).sum(-1) / np.maximum((v * v).sum(-1), 1e-6)
    a = np.clip(a, 0, 0.85) * zone
    a = np.where(a > 0.05, a, 0)
    # le sweat garde le reste exact : sweat * (1 - a) + S * a = dessin d'origine
    sous = (T[..., :3] - S[None, None] * a[..., None]) / np.maximum(1 - a[..., None], 1e-3)
    sous = np.where((a > 0)[..., None], np.clip(sous, 0, 1), base)
    return a > 0, a, sous, S


def _cote_contour(contour, loin_x):
    """Masque du cote exterieur d'un contour de flanc (vers x = loin_x)."""
    c = catmull(contour, 12)
    poly = np.vstack([c, [(loin_x, c[-1][1]), (loin_x, c[0][1])]])
    return masque_poly(poly) > 0.5, c


def torse_complet(T, conf, zg, zd, lang):
    """Torse seul, en une passe : silhouette = sweat visible + dessous des rabats + flancs jusqu'au contour dessine
    (rien au-dela) ; tout ce qui est cache est peint lisse d'apres le tissu voisin, puis le contour est encre."""
    from tete import push_pull
    Ae = ndi.binary_erosion(T[..., 3] > 0.5, iterations=2)
    encre_T = encre_de(T, 0.30)
    # bande sous le fondu des bras : dessin d'origine exact (tissu seulement)
    # (seulement le long de la frontiere bras / torse : pas autour de l'avant-bras)
    pres_torse = ndi.binary_dilation(conf, iterations=6)
    exact = (zg['haut'] | zd['haut']) & pres_torse & ~ndi.binary_dilation(encre_T, iterations=2)
    visible = conf | exact
    # silhouette du torse
    sil = visible.copy()
    ext_g, cg = _cote_contour(CONTOUR_FLANC_G, 250)
    ext_d, cd = _cote_contour(CONTOUR_FLANC_D, 1150)
    for p_ in (LANGUETTE_G, LANGUETTE_D):
        sil |= (masque_poly(p_) > 0.5) & Ae
    interieur = Ae & ~ext_g & ~ext_d
    yy = np.mgrid[0:N, 0:N][0]
    interieur &= (yy > 700) & (yy < 1060)
    sil |= interieur & (zg['bras'] | zd['bras'] | lang)
    traits = np.clip(masque_trait(cg, EP_FLANC['g']) + masque_trait(cd, EP_FLANC['d']), 0, 1)
    sil |= (traits > 0.3) & Ae
    # rien au-dela des contours de flanc (sauf le dessin d'origine visible)
    sil &= ~((ext_g | ext_d) & (traits < 0.3) & ~conf)
    sil = ndi.binary_opening(sil, iterations=1) | conf
    cache = sil & ~visible
    # peinture du cache : tissu propre voisin, sans les ombres que les bras projettent
    ombres = ndi.binary_dilation(zg['bras'] | zd['bras'] | lang, iterations=5)
    # pres du bord : la couleur du tissu voisin (ombres comprises), sans couture ; plus loin : le tissu propre
    tissu = visible & ~ndi.binary_dilation(encre_T, iterations=2)
    pres = push_pull(T[..., :3], tissu.astype(np.float32), niveaux=7)
    src = tissu & (~ombres | exact)
    loin = push_pull(T[..., :3], src.astype(np.float32), niveaux=7)
    loin = cv2.GaussianBlur(loin, (0, 0), 14)
    d = ndi.distance_transform_edt(~tissu)
    w = np.clip((d - 2) / 28.0, 0, 1)[..., None]
    w = w * w * (3 - 2 * w)
    base = cv2.GaussianBlur(pres, (0, 0), 3) * (1 - w) + loin * w
    base = np.where((d <= 1.5)[..., None], pres, base)
    g = grain(T.shape, 0.004, 41)
    fill = base + g[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
    Q = np.zeros_like(T)
    Q[..., :3] = np.where(cache[..., None], fill, T[..., :3])
    # contour du flanc dessine (sous les bras seulement), de la couleur exacte de l'encre d'origine voisine
    enc = np.median(T[..., :3][encre_T & (T[..., 3] > 0.98) & (lum(T) < 0.12)], axis=0)
    t = (np.clip(traits * 1.3, 0, 1) * cache)[..., None]
    Q[..., :3] = Q[..., :3] * (1 - t) + enc * t
    # bord exterieur de l'ajout : encre aussi (sous les rabats, sous les bras)
    Q[..., 3] = np.where(conf, T[..., 3], np.where(sil, 1.0, 0.0))
    Q[..., 3] = np.where(cache, cv2.GaussianBlur(sil.astype(np.float32), (0, 0), 0.6), Q[..., 3])
    Q[..., 3] = np.where(conf, T[..., 3], Q[..., 3])
    return Q


def pieces_corps():
    """Renvoie {nom: image RGBA scene} des pieces du haut du corps."""
    T = torse_rig()
    A = T[..., 3] > 0.02
    zg, zd = zones_bras_g(T), zones_bras_d(T)
    ink0 = encre_de(T, 0.24) & (T[..., 3] > 0.02)
    zg = hanche(donne_jonction_au_rabat(nettoie_zone(zg, ink0, GRAINES_AVB_G), ink0), ink0, FEN_HANCHE_G)
    zd = hanche(donne_jonction_au_rabat(nettoie_zone(zd, ink0, GRAINES_AVB_D), ink0, larg=13), ink0, FEN_HANCHE_D)
    zg, zd = frange_a_lavant_bras(zg, ink0, T), frange_a_lavant_bras(zd, ink0, T)
    # encre du sweat coincee entre le bord du rabat et le haut du bras (jonction) : au rabat, sinon elle reste
    # sur le torse et se decouvre en eclat noir quand l'epaule tourne
    for z in (zg, zd):
        j = ink0 & ~(zg['bras'] | zd['bras']) & ~(zg['lang'] | zd['lang']) & (T[..., 3] > 0.02)
        j &= ndi.binary_dilation(z['lang'], iterations=8) & ndi.binary_dilation(z['bras'], iterations=14)
        z['lang'] = z['lang'] | j
    # l'antialiasing des traits des bras deborde sur le sweat : il part avec le bras (encre semi-transparente)
    torse_tissu = A & ~zg['bras'] & ~zd['bras'] & ~(zg['lang'] | zd['lang'])
    halos = {}
    for cote, z in (('g', zg), ('d', zd)):
        m, t, base = halo(T, z['bras'], torse_tissu)
        # t = -1 : lisere opaque (couleur d'origine), sinon encre semi-transparente
        halos[cote] = (m, t, T[..., :3].copy())
        T2 = T.copy()
        T2[..., :3] = np.where(m[..., None], base, T[..., :3])
        T = T2
    zg['halo'], zd['halo'] = halos['g'], halos['d']
    out = {}
    lang = zg['lang'] | zd['lang']
    cap = T.copy()
    cap[..., 3] *= lang
    out['capuche_avant'] = cap
    # --- torse seul : tout sauf les bras et les languettes, flancs completes
    zj = zones_jambes(T)
    jambes = zj['short'] | zj['pied_g'] | zj['pied_d']
    sweat0 = A & ~zg['bras'] & ~zd['bras'] & ~lang & ~jambes
    # antialiasing du trait de l'ourlet sur le short : il reste au sweat (encre semi-transparente, devant)
    m_h, t_h, base_h = halo(T, sweat0, zj['short'])
    coul_h = T[..., :3].copy()
    T2 = T.copy()
    T2[..., :3] = np.where(m_h[..., None], base_h, T[..., :3])
    T = T2
    halo_ourlet = (m_h, t_h)
    conf = sweat0 & (T[..., 3] > 0.5)
    Q = torse_complet(T, conf, zg, zd, lang)
    torse_zone = sweat0
    m_h, t_h = halo_ourlet
    op_h = m_h & (t_h < 0)
    Q[..., :3] = np.where(m_h[..., None], np.where(op_h[..., None], coul_h, ENCRE), Q[..., :3])
    Q[..., 3] = np.where(m_h, np.where(op_h, 1.0, np.maximum(Q[..., 3], t_h)), Q[..., 3])
    # ombres portees des bras sur le sweat (coin orange fonce a droite du pli du coude, ombre sous les poings) :
    # elles partent avec le bras, sinon elles restent en plaques a bord net quand les poings glissent
    yy_, xx_ = np.mgrid[0:N, 0:N]
    ombres = []
    tissu_t = conf & ~ndi.binary_dilation(encre_de(T, 0.30), iterations=1)
    for cote, z, boites in (('g', zg, OMBRES_G), ('d', zd, OMBRES_D)):
        m_o, a_o, sous_o, S_o = ombre_portee(T, z['bras'], tissu_t)
        dans = np.zeros((N, N), bool)
        for (x0, y0, x1, y1) in boites:
            dans |= (xx_ >= x0) & (xx_ <= x1) & (yy_ >= y0) & (yy_ <= y1)
        m_o &= dans
        # seulement les plages d'ombre collees au bras (pas les grains isoles du tissu)
        lab_o, n_o = ndi.label(m_o)
        if n_o:
            colle = ndi.binary_dilation(z['bras'], iterations=3)
            ids = [i for i in range(1, n_o + 1) if (colle & (lab_o == i)).any() and (lab_o == i).sum() >= 25]
            m_o = np.isin(lab_o, ids)
        # l'ombre part en entier avec le bras, avec un lisere de tissu fondu sur 4 px (dessin d'origine) ; le
        # sweat recoit dessous son tissu sans ombre : ni double bande, ni bord grumeleux quand le bras bouge
        coul_o = None
        if m_o.any():
            from tete import push_pull
            m_o = ndi.binary_closing(m_o, iterations=2) & dans
            m_o = ndi.binary_fill_holes(m_o)
            d_o = ndi.distance_transform_edt(~m_o)
            lisere = (d_o <= 4) & ~m_o & tissu_t
            a_o = np.where(m_o, 1.0, np.where(lisere, np.clip(1 - d_o / 4.5, 0, 1), 0.0)).astype(np.float32)
            src = tissu_t & ~ndi.binary_dilation(m_o, iterations=6) & ndi.binary_dilation(m_o, iterations=30)
            base_o = push_pull(T[..., :3], src.astype(np.float32), niveaux=5)
            base_o = cv2.GaussianBlur(base_o, (0, 0), 2.0)
            coul_o = T[..., :3].copy()
            m_o = m_o | lisere
            Q[..., :3] = np.where(m_o[..., None], base_o, Q[..., :3])
        ombres.append((cote, z, m_o, a_o * m_o, coul_o))
    DEBUG['ombres'] = ombres
    out['torse'] = Q
    conf_torse = conf
    # --- bras gauche (haut, derriere l'avant-bras) : prolonge sous la languette de capuche et sous l'avant-bras,
    #     disque complet du coude avec son anneau d'encre, bord interieur encre jusqu'au coude
    # sous l'avant-bras, le haut du bras ne recopie pas les traits de l'avant-bras (pli du coude, haut de la
    # manchette) : seulement le tissu ; sinon, des que le coude plie, le trait apparait en double
    sans_encre = ndi.binary_dilation(encre_de(T, 0.30), iterations=2)
    conf = zg['haut'] & (T[..., 3] > 0.5)
    cache_g = cache_de(T, zg['avb'] | zg['lang'], zg['haut'])
    Q, sil = complete_cache(T, conf, [EXT_EPAULE_G, _poly_disque(E_G, R_ANNEAU_G), DESSOUS_G], 15, 43, cache_g, orig=False,
                            exact=bande_interne(zg['avb'], T) & ~sans_encre)
    # le pli doux du haut du bras continue sous le pli du coude en s'effilant (cache au repos) : quand le coude
    # plie, on voit la fin naturelle du trait, pas une coupe
    trait = masque_trait(np.array([(563, 866), (562, 881), (559, 893), (555, 903)], float), [11, 9, 6, 2])
    sous = zg['avb'] & (Q[..., 3] > 0.5)
    enc = np.median(T[..., :3][ink0 & (T[..., 3] > 0.98) & (lum(T) < 0.12)], axis=0)
    t_ = (np.clip(trait * 1.2, 0, 1) * sous)[..., None]
    Q[..., :3] = Q[..., :3] * (1 - t_) + enc * t_
    Q = efface_encre_sous_rabat(Q, lang, T, conf)
    out['bras_g'] = adoucit_interne(Q, zg['haut'], T, torse_zone, larg=5.0)
    # --- avant-bras gauche (devant) : tel quel
    E = T.copy()
    E[..., 3] *= zg['avb']
    out['avbras_g'] = adoucit_interne(E, zg['avb'], T, zg['haut'])
    _ajoute_halo(out, 'bras_g', 'avbras_g', zg)
    # --- bras droit (haut, derriere l'avant-bras) : prolonge sous la languette et sous l'avant-bras, disque complet
    conf = zd['haut'] & (T[..., 3] > 0.5)
    cache_r = cache_de(T, zd['avb'] | zd['lang'], zd['haut'])
    Q, sil = complete_cache(T, conf, [EXT_EPAULE_D, _poly_disque(E_D, R_ANNEAU_D), DESSOUS_D], 15, 45, cache_r, orig=False,
                            exact=bande_interne(zd['avb'], T) & ~sans_encre)
    Q = efface_encre_sous_rabat(Q, lang, T, conf)
    out['bras_d'] = adoucit_interne(Q, zd['haut'], T, torse_zone, larg=5.0)
    # --- avant-bras droit (devant) : tel quel
    E = T.copy()
    E[..., 3] *= zd['avb']
    out['avbras_d'] = adoucit_interne(E, zd['avb'], T, zd['haut'])
    _ajoute_halo(out, 'bras_d', 'avbras_d', zd)
    m_tous = np.zeros((N, N), bool)
    for cote, z, m_o, a_o, S_o in ombres:
        # au haut du bras (il ne tourne pas quand le poing se replie sur la poitrine : l'ombre reste au coude)
        if S_o is None:
            continue
        for nom, sel in ((f'bras_{cote}', m_o),):
            P_ = out[nom]
            libre_ = sel & (P_[..., 3] < 0.5)
            P_[..., :3] = np.where(libre_[..., None], S_o, P_[..., :3])
            P_[..., 3] = np.where(libre_, a_o, P_[..., 3])
        m_tous |= m_o
    m_o = m_tous
    # contour du bas des poings (fenetres de hanche) : un trait complet et lisse d'epaisseur constante autour du
    # poing ; le poing n'emporte plus de morceau du trait du flanc (bloc noir, pointilles) quand il glisse
    ENC_ = np.median(T[..., :3][ink0 & (T[..., 3] > 0.98) & (lum(T) < 0.12)], axis=0)
    yy_, xx_ = np.mgrid[0:N, 0:N]
    for avb, fen_ in (('avbras_g', FEN_HANCHE_G), ('avbras_d', FEN_HANCHE_D)):
        Pa = out[avb]
        fab = (Pa[..., 3] > 0.5) & ~ink0
        d_f = ndi.distance_transform_edt(~fab)
        w = (xx_ >= fen_[0]) & (xx_ < fen_[2]) & (yy_ >= fen_[1]) & (yy_ < fen_[3]) & ~fab
        # jamais au-dela de ce que le poing ou l'encre d'origine couvraient (silhouette et repos inchanges) ;
        # on ne fait qu'enlever ce qui depasse du trait du poing (le morceau du trait du flanc)
        w &= ink0 | (Pa[..., 3] > 0.02)
        a_n = np.clip(EP_POING + 0.5 - d_f, 0, 1)
        plafond = np.maximum(Pa[..., 3], np.where(ink0, T[..., 3], 0.0))
        a_n = np.minimum(a_n, plafond)
        noir = w & ink0 & (a_n > 0) & (Pa[..., 3] < 0.02)
        Pa[..., :3] = np.where(noir[..., None], T[..., :3], Pa[..., :3])
        # l'encre que le poing ne garde plus revient au sweat (le repos ne change pas : c'est le trait du flanc)
        rendu = w & ink0 & (Pa[..., 3] > 0.5) & (a_n < Pa[..., 3] - 0.3) & (T[..., 3] > 0.5)
        Pt = out['torse']
        Pt[..., :3] = np.where(rendu[..., None], T[..., :3], Pt[..., :3])
        Pt[..., 3] = np.where(rendu, np.maximum(Pt[..., 3], T[..., 3]), Pt[..., 3])
        Pa[..., 3] = np.where(w, a_n, Pa[..., 3])
    # couture entre le dessin d'origine et la peinture cachee sous les bras (fil clair, points sombres le long de
    # l'ancien contour des poings) : lissee, seulement la ou un bras la couvre au repos (le repos ne change pas)
    couvre = np.zeros((N, N), bool)
    for nom in ('bras_g', 'avbras_g', 'bras_d', 'avbras_d'):
        couvre |= out[nom][..., 3] > 0.97
    out['torse'] = lisse_couture(out['torse'], conf_torse, zg['bras'] | zd['bras'], couvre & ~m_o)
    # sous le poing (cache au repos), le flanc du sweat n'a que son trait de contour : pas de bloc d'encre de la
    # jonction poing / hanche qui se decouvre quand le poing remonte
    for fen_, contour_, ep_, loin_ in ((FEN_HANCHE_G, CONTOUR_FLANC_G, EP_FLANC['g'], 250),
                                       (FEN_HANCHE_D, CONTOUR_FLANC_D, EP_FLANC['d'], 1150)):
        out['torse'] = nettoie_flanc(out['torse'], couvre, contour_, ep_, fen_, loin_, T)
    # eperons aux jonctions poing / hanche : petites pointes d'encre (du torse sous le poing, du poing sur le
    # trait du flanc) qui se decouvrent quand le poing glisse ; on les retire la ou rien ne change au repos
    yy_, xx_ = np.mgrid[0:N, 0:N]
    for (x0, y0, x1, y1), avb in ((FEN_HANCHE_G, 'avbras_g'), (FEN_HANCHE_D, 'avbras_d')):
        fen = (xx_ >= x0) & (xx_ < x1) & (yy_ >= y0) & (yy_ < y1)
        Pt = out['torse']
        plein = Pt[..., 3] > 0.5
        pointes = plein & ~ndi.binary_opening(plein, structure=np.ones((3, 3)), iterations=2) & fen & couvre
        Pt[..., 3] = np.where(pointes, 0.0, Pt[..., 3])
        Pa = out[avb]
        plein_a = Pa[..., 3] > 0.5
        sous_noir = (Pt[..., 3] > 0.9) & (lum(Pt) < 0.3)
        barbes = plein_a & ~ndi.binary_opening(plein_a, structure=np.ones((3, 3)), iterations=2) & fen & sous_noir
        Pa[..., 3] = np.where(barbes, 0.0, Pa[..., 3])
        DEBUG[f'pointes_{avb}'] = (int(pointes.sum()), int(barbes.sum()))
    # --- jambes (moities du short, chevauchement de 8 px a l'entrejambe) et pieds
    yy, xx = np.mgrid[0:N, 0:N]
    # rallonge du haut des jambes : bien a l'interieur du sweat (il bouge un peu : le torse se penche et respire)
    sous_sweat = ndi.binary_erosion(sweat0 | zj['short'], iterations=1) & ndi.binary_erosion(T[..., 3] > 0.5, iterations=9)
    for cote, sel, ext in (('g', xx < CENTRE_ENTREJAMBE_X + 8, EXT_JAMBE_G), ('d', xx >= CENTRE_ENTREJAMBE_X - 8, EXT_JAMBE_D)):
        c = zj['short'] & sel & (T[..., 3] > 0.5)
        if cote == 'd':
            # dans le chevauchement (derriere la jambe gauche) : seulement les pixels opaques (pas de double bord)
            c &= ~((xx < CENTRE_ENTREJAMBE_X + 8) & (T[..., 3] < 0.98))
        Q, sil = complete_cache(T, c, [ext], 15, 51 + (cote == 'd'), cache_de(T, sous_sweat, c))
        out[f'jambe_{cote}'] = Q
    for cote, ext in (('g', EXT_PIED_G), ('d', EXT_PIED_D)):
        c = zj[f'pied_{cote}'] & (T[..., 3] > 0.5)
        cache_p = cache_de(T, zj['short'], zj[f'pied_{cote}'])
        Q, sil = complete_cache(T, c, [ext], 13, 55 + (cote == 'd'), cache_p)
        out[f'pied_{cote}'] = Q
    # sous-couche : chaque piece arriere deborde de 3 px sous la piece avant voisine (dessin d'origine), sinon
    # le rendu par calques laisse un fil clair le long des decoupes des que le corps est mis a l'echelle
    xx = np.mgrid[0:N, 0:N][1]
    zones = {'capuche_avant': lang, 'avbras_g': zg['avb'], 'bras_g': zg['haut'], 'avbras_d': zd['avb'],
             'bras_d': zd['haut'], 'torse': sweat0,
             'jambe_g': zj['short'] & (xx < CENTRE_ENTREJAMBE_X), 'jambe_d': zj['short'] & (xx >= CENTRE_ENTREJAMBE_X),
             'pied_g': zj['pied_g'], 'pied_d': zj['pied_d']}
    # seulement entre pieces qui restent collees (les bras qui bougent beaucoup laisseraient un fantome de trait)
    # (pas sous les rabats pour les bras : le rabat a un bord net, et le bras qui tourne dessous montrerait la copie)
    couples = [('capuche_avant', 'torse'),
               ('torse', 'jambe_g'), ('torse', 'jambe_d'), ('jambe_g', 'jambe_d'),
               ('jambe_g', 'pied_g'), ('jambe_d', 'pied_d')]
    A = T[..., 3] > 0.02
    for f, b in couples:
        if True:
            Pb = out[b]
            commun = zones[f] & ndi.binary_dilation(zones[b], iterations=1)
            if commun.sum() < 5:
                continue
            bande = ndi.binary_dilation(commun, iterations=3) & zones[f] & A
            if b.startswith('bras') or f == 'capuche_avant':
                # le bras bouge sous le rabat (et decouvre le torse sous son bord) : pas de copie du trait du
                # rabat, sinon un fantome de ce trait apparait sous son bord
                pres_bras = ndi.binary_dilation(zg['bras'] | zd['bras'], iterations=16)
                bande &= ~(ndi.binary_dilation(encre_de(T, 0.30), iterations=2) & (pres_bras if f == 'capuche_avant' and b == 'torse' else True))
            Pb[..., :3] = np.where(bande[..., None], T[..., :3], Pb[..., :3])
            Pb[..., 3] = np.where(bande, np.maximum(Pb[..., 3], T[..., 3]), Pb[..., 3])
    # jonctions d'encre (la ou le trait d'une piece rejoint celui d'une autre) : la piece arriere prolonge son trait
    # de 4 px sous la piece avant (copie exacte du dessin) ; au repos rien ne change, en mouvement plus de fil clair.
    ink = encre_de(T, 0.24) & A
    jonctions = [('avbras_d', 'bras_d'), ('avbras_g', 'bras_g'), ('avbras_g', 'torse'), ('avbras_d', 'torse'),
                 ('bras_g', 'torse'), ('bras_d', 'torse')]
    d_ext = ndi.distance_transform_edt(T[..., 3] > 0.5)
    for f, b in jonctions:
        fi, bi = zones[f] & ink, zones[b] & ink
        bande = fi & (ndi.distance_transform_edt(~bi) <= 4.0)
        if f.startswith('avbras') and b.startswith('bras'):
            # seulement le contour exterieur de la silhouette (pas les plis interieurs du coude)
            suite = None
            if b == 'bras_d':
                # sauf le contour interieur du bras droit (le V du pli devient le contour de la manchette) :
                # il continue sous l'avant-bras, vers le bas a gauche (pas le trait du haut de la manchette)
                yy_, xx_ = np.mgrid[0:N, 0:N]
                suite = fi & (ndi.distance_transform_edt(~bi) <= 16.0) & (xx_ <= 872) & (yy_ >= 866) & (yy_ <= 905)
            if b == 'bras_g':
                bande &= d_ext <= 24      # le bras gauche se replie (pleure, explose) : pas de copie du pli
            if suite is not None:
                bande |= suite
        Pb = out[b]
        Pb[..., :3] = np.where(bande[..., None], T[..., :3], Pb[..., :3])
        Pb[..., 3] = np.where(bande, np.maximum(Pb[..., 3], T[..., 3]), Pb[..., 3])
    separe_pli_coude_g(out, zg)
    separe_hanche_g(out, T, ink0)
    raccord_coude_g(out)
    lisse_bord_rabat_g(out)
    liseré_ourlet(out, T)
    joint_taille(out, T)
    return out


# raccords exterieurs bas du sweat / haut du short (le buste penche et se tasse au-dessus des jambes)
FEN_TAILLE = {'d': (895, 1022, 982, 1080), 'g': (392, 1022, 472, 1080)}


def joint_taille(out, T):
    """Sous le coin bas du sweat, la jambe recoit une copie du trait d'origine (cachee par le sweat au repos) : quand
    le buste penche ou se tasse, on voit du trait au raccord au lieu d'une fente de fond."""
    yy, xx = np.mgrid[0:N, 0:N]
    ink = encre_de(T, 0.30) & (T[..., 3] > 0.5)
    for c, (x0, y0, x1, y1) in FEN_TAILLE.items():
        J = out[f'jambe_{c}']
        fen = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        pres = ndi.binary_dilation(J[..., 3] > 0.5, iterations=12)
        ajout = fen & ink & (J[..., 3] < 0.5) & pres & (out['torse'][..., 3] > 0.9)
        J[..., :3] = np.where(ajout[..., None], T[..., :3], J[..., :3])
        J[..., 3] = np.where(ajout, T[..., 3], J[..., 3])
        DEBUG[f'joint_taille_{c}'] = int(ajout.sum())


def liseré_ourlet(out, T):
    """Bord bas du trait d'ourlet du short, contre la chaussure : les pixels d'anticrenelage (encre + brun) etaient
    a la chaussure, si bien que le trait de la jambe finissait sur une marche nette des que la chaussure glissait
    dessous. Ils passent a la jambe en encre transparente ; la chaussure recoit dessous son brun propre."""
    from tete import push_pull
    E = np.array(ENCRE, np.float32)
    yy = np.mgrid[0:N, 0:N][0]
    for c in ('g', 'd'):
        Lg, Pd = out[f'jambe_{c}'], out[f'pied_{c}']
        enc = (Lg[..., 3] > 0.5) & (lum(Lg) < 0.15)
        rim = (Lg[..., 3] < 0.5) & ndi.binary_dilation(enc, iterations=2) & (Pd[..., 3] > 0.5) & (yy > 1095)
        if not rim.any():
            continue
        src = (Pd[..., 3] > 0.9) & ~ndi.binary_dilation(rim | (lum(Pd) < 0.25), iterations=1)
        brun = push_pull(Pd[..., :3], src.astype(np.float32), niveaux=5)
        O = T[..., :3]
        d = brun - E
        a = np.clip(((brun - O) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-4), 0, 1)
        resid = np.linalg.norm(O - (brun - a[..., None] * d), axis=-1)
        ok = rim & (a > 0.03) & (resid < 0.12)
        Lg[..., :3] = np.where(ok[..., None], E, Lg[..., :3])
        Lg[..., 3] = np.where(ok, a, Lg[..., 3])
        Pd[..., :3] = np.where(ok[..., None], brun, Pd[..., :3])
        DEBUG[f'lisere_ourlet_{c}'] = int(ok.sum())


# bord gauche du rabat de capuche gauche, le long du petit triangle sous la joue : decoupe nette (pas
# d'anticrenelage) qui, en mode rouge, borde la fourrure qui comble le triangle
FEN_RABAT_TRIANGLE = (414, 752, 452, 812)


# flanc gauche du sweat, contre la queue (elle le borde quand elle remonte dans « crie »)
FEN_FLANC_G_QUEUE = (392, 940, 452, 1066)


def lisse_bord_rabat_g(out):
    lisse_bord(out, 'capuche_avant', FEN_RABAT_TRIANGLE)
    lisse_bord(out, 'torse', FEN_FLANC_G_QUEUE)


def lisse_bord(out, nom, fen_):
    C = out[nom]
    x0, y0, x1, y1 = fen_
    a = C[y0 - 4:y1 + 4, x0 - 4:x1 + 4, 3]
    m = (a > 0.5).astype(np.float32)
    b = cv2.GaussianBlur(m, (0, 0), 1.2)
    lisse = np.clip((b - 0.5) * 2.2 + 0.5, 0, 1)
    fen = np.zeros_like(a, bool); fen[4:-4, 4:-4] = True
    sombre = lum(C[y0 - 4:y1 + 4, x0 - 4:x1 + 4]) < 0.2
    # seulement le long de l'encre (le bord du rabat ici est son trait noir)
    zone = fen & ndi.binary_dilation(m > 0.5, iterations=2) & ndi.binary_dilation(sombre & (m > 0.5), iterations=3)
    C[y0 - 4:y1 + 4, x0 - 4:x1 + 4, 3] = np.where(zone, lisse, a)
    rgb = C[y0 - 4:y1 + 4, x0 - 4:x1 + 4, :3]
    C[y0 - 4:y1 + 4, x0 - 4:x1 + 4, :3] = np.where((zone & (a < 0.5))[..., None], np.array(ENCRE, np.float32), rgb)


def separe_hanche_g(out, T, ink0):
    """Sous le poing gauche (qui se replie sur la poitrine dans pleure et explose) : le sweat d'origine, avec l'ombre
    du poing et la couture de la zone repeinte, passe dans un calque qui s'efface avec le pli ; dessous, le sweat
    est un tissu lisse (pas de plaque a bord net ni d'ombre orpheline quand la main n'est plus la)."""
    from tete import push_pull
    Pt = out['torse']
    yy, xx = np.mgrid[0:N, 0:N]
    poing = out['avbras_g'][..., 3] > 0.5
    plein = Pt[..., 3] > 0.5
    enc = ndi.binary_dilation(lum(Pt) < 0.30, iterations=1)
    zone = ndi.binary_dilation(poing, iterations=3) & plein & (yy < 1018) & (xx > 452)
    ref = np.percentile(lum(Pt)[plein & ~enc & ~zone & (yy > 850) & (yy < 1010) & (xx > 600) & (xx < 700)], 50)
    ombre = ndi.binary_dilation(poing, iterations=26) & plein & ~enc & (lum(Pt) < ref - 0.03) & (yy < 1018)
    lab, n = ndi.label(ombre)
    if n:
        colle = ndi.binary_dilation(zone, iterations=2)
        ombre = np.isin(lab, [i for i in range(1, n + 1) if (colle & (lab == i)).any()])
    zone = (zone | ombre) & ~enc
    zone = ndi.binary_dilation(zone, iterations=4) & plein & ~enc & (yy < 1018) & (xx > 452)
    ov = np.zeros_like(Pt)
    ov[zone] = Pt[zone]
    out['hanche_g'] = ov
    src = plein & ~enc & ~zone & ndi.binary_dilation(zone, iterations=24) & (lum(Pt) >= ref - 0.03)
    F = push_pull(Pt[..., :3], src.astype(np.float32), niveaux=6)
    F = cv2.GaussianBlur(F, (0, 0), 4.0)
    F = F + grain(Pt.shape, 0.004, 77, flou=1.2)[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
    Pt[..., :3] = np.where(zone[..., None], F, Pt[..., :3])


def demele_bord(out, nom, ecart_max=0.08):
    """Le liseré exterieur d'une piece (pixels opaques melangeant l'encre du contour et ce qu'il y avait derriere
    dans le dessin : ombre, sweat, fond) devient de l'encre en transparence, calculee sur ce qu'il y a dessous au
    repos : le repos est identique, et quand la piece bouge son bord ne traine plus de fil rouge ou brun (pointille
    dans le noir d'un autre contour). Seuls les pixels qui sont bien un melange encre / dessous sont touches."""
    import compo_repos
    A = out[nom]
    E = np.array(ENCRE, np.float32)
    a = A[..., 3].copy()
    L = lum(A)
    encre = (a > 0.5) & (L < 0.12)
    corps_ = (a > 0.5) & ~encre
    lab, n = ndi.label(corps_)
    tailles = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
    interieur = lab == (1 + int(np.argmax(tailles)))
    dehors = ndi.binary_dilation(a < 0.02, iterations=4)
    cand = (a > 0.02) & ~encre & ~interieur & dehors
    B = compo_repos.dessous(out, nom)
    C = A[..., :3]
    d = B - E
    al = np.clip(((B - C) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-4), 0, 1)
    resid = np.linalg.norm(C - (B - al[..., None] * d), axis=-1)
    lise = cand & (resid < ecart_max)
    A[..., :3] = np.where(lise[..., None], E, A[..., :3])
    A[..., 3] = np.where(lise, al * a, a)
    return lise


# bord exterieur de l'avant-bras gauche pres du coude, et raccord arrondi du haut du poing replie
FEN_BORD_AVB_G = (505, 850, 592, 916)
FEN_RACCORD_G = (536, 858, 604, 930)


def raccord_coude_g(out, r=20):
    """Quand le poing gauche se replie, le bord haut de l'avant-bras (cote coude) devient la silhouette :
    1. le liseré d'ombre rouge-orange colle au trait (melange encre + ombre du coude) devient de l'encre en
       transparence, recalculee sur ce qu'il y a dessous au repos (repos identique, plus de fil rouge au repli) ;
    2. eclats isoles retires ;
    3. le cran entre le trait de la manchette et le contour du poing (comble au repos par le pli doux du haut
       du bras) est arrondi par un calque d'encre 'raccord_g' qui apparait avec le repli."""
    A = out['avbras_g']
    E = np.array(ENCRE, np.float32)
    x0, y0, x1, y1 = FEN_BORD_AVB_G
    fen = np.zeros((N, N), bool); fen[y0:y1, x0:x1] = True
    # 2. eclats isoles
    lab, n = ndi.label((A[..., 3] > 0.02) & fen)
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() < 12:
            A[m] = 0.0
    # 1. liseré exterieur -> encre en transparence (sur tout le bord du bras gauche, qui se replie)
    for nom in ('avbras_g', 'bras_g', 'jambe_g', 'jambe_d'):
        # l'avant-bras gauche se replie loin de sa place : tout son lisere devient de l'encre transparente
        DEBUG[f'lise_{nom}'] = demele_bord(out, nom, ecart_max=0.25 if nom == 'avbras_g' else 0.08)
    # couleur d'encre sous les pixels transparents du bord (pas de bavure orange au reechantillonnage)
    A[..., :3] = np.where((fen & (A[..., 3] < 0.02))[..., None], E, A[..., :3])
    # 3. raccord arrondi (fermeture en niveaux de gris de la couverture, dans la fenetre du cran)
    x0, y0, x1, y1 = FEN_RACCORD_G
    m = r + 3
    c = A[y0 - m:y1 + m, x0 - m:x1 + m, 3].astype(np.float32)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    cl = cv2.morphologyEx(c, cv2.MORPH_CLOSE, k)
    ajout = np.clip((cl - c) / np.maximum(1 - c, 1e-3), 0, 1)
    ajout[:m, :] = 0; ajout[-m:, :] = 0; ajout[:, :m] = 0; ajout[:, -m:] = 0
    R = np.zeros_like(A)
    R[y0 - m:y1 + m, x0 - m:x1 + m, 3] = ajout
    R[..., :3] = E
    out['raccord_g'] = R


# pli doux du coude gauche (trait du haut du bras) et ombre du coude : calque a part, qui s'efface quand le poing
# se replie sur la poitrine (sinon le trait ressort en corne au-dessus de l'avant-bras, l'ombre en drapeau)
POLY_PLI_G = [(538, 812), (576, 806), (594, 858), (614, 886), (616, 948), (561, 948), (561, 906), (546, 902),
              (538, 860)]


def separe_pli_coude_g(out, zg):
    from tete import push_pull
    P_ = out['bras_g']
    poly = masque_poly(POLY_PLI_G) > 0.5
    region = poly & (P_[..., 3] > 0.01)
    ov = np.zeros_like(P_)
    ov[region] = P_[region]
    out['pli_coude_g'] = ov
    haut = zg['haut']
    dans = region & haut
    ref = lum(P_)[haut & (P_[..., 3] > 0.9)]
    sombre = lum(P_) < np.percentile(ref, 50) - 0.04
    src = (P_[..., 3] > 0.9) & haut & ~ndi.binary_dilation(poly, iterations=2) & ~ndi.binary_dilation(sombre, iterations=2)
    src &= ndi.binary_dilation(poly, iterations=30)
    F = push_pull(P_[..., :3], src.astype(np.float32), niveaux=6)
    F = cv2.GaussianBlur(F, (0, 0), 3.0)
    P_[..., :3] = np.where(dans[..., None], F, P_[..., :3])
    P_[..., 3] = np.where(region & ~haut, 0.0, P_[..., 3])


def efface_encre_sous_rabat(Q, lang, T, conf, marge=12):
    """Sous le rabat de capuche, pres de son bord bas (cote sweat, pas cote fond), le haut du bras n'a que du
    tissu : quand l'epaule tourne, aucun bout de trait ne sort sous le rabat. Le contour exterieur de l'epaule
    (cote fond) reste encre."""
    from tete import push_pull
    hors_rabat = ~lang
    d_bord = ndi.distance_transform_edt(lang)                      # distance au bord du rabat (dedans)
    d_fond = ndi.distance_transform_edt(T[..., 3] > 0.5)
    enc = (lum(Q) < 0.35) & (Q[..., 3] > 0.3) & ~conf
    z = enc & lang & (d_bord <= marge) & (d_fond > 22)
    z = ndi.binary_dilation(z, iterations=2) & lang & ~conf & (Q[..., 3] > 0.3) & (d_fond > 18)
    if z.any():
        src = (Q[..., 3] > 0.9) & ~ndi.binary_dilation(lum(Q) < 0.35, iterations=2) & ~z
        F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=6)
        Q[..., :3] = np.where(z[..., None], F, Q[..., :3])
    return Q


def nettoie_flanc(Q, couvre, contour, ep, fen, loin_x, T):
    """Dans la fenetre de hanche, la ou le poing couvre le sweat au repos : trait du flanc (bande d'epaisseur ep le
    long du contour) a l'encre, tissu du sweat a l'interieur, rien a l'exterieur (fond)."""
    from tete import push_pull
    yy, xx = np.mgrid[0:N, 0:N]
    w = (xx >= fen[0]) & (xx < fen[2]) & (yy >= fen[1]) & (yy < fen[3]) & couvre
    if not w.any():
        return Q
    ext, c = _cote_contour(contour, loin_x)
    trait = masque_trait(c, ep)
    ligne = trait > 0.5
    Q = Q.copy()
    enc = np.median(T[..., :3][encre_de(T, 0.30) & (T[..., 3] > 0.98) & (lum(T) < 0.12)], axis=0)
    dedans = w & ~ext & ~ligne
    tissu = (Q[..., 3] > 0.9) & ~ndi.binary_dilation(lum(Q) < 0.35, iterations=2) & ~w
    F = push_pull(Q[..., :3], (tissu & ndi.binary_dilation(w, iterations=25)).astype(np.float32), niveaux=5)
    sombre = dedans & (lum(Q) < 0.45)
    Q[..., :3] = np.where(ndi.binary_dilation(sombre, iterations=1)[..., None] & dedans[..., None], F, Q[..., :3])
    a_t = np.clip(trait, 0, 1)
    sel = w & (trait > 0.02)
    Q[..., :3] = np.where(sel[..., None], Q[..., :3] * (1 - a_t[..., None]) + enc * a_t[..., None], Q[..., :3])
    dehors = w & ext & (trait < 0.5)
    Q[..., 3] = np.where(dehors, np.minimum(Q[..., 3], np.clip(trait * 2, 0, 1)), Q[..., 3])
    return Q


DEBUG = {}
# boites ou l'ombre portee d'un bras sur le sweat part avec lui (repere scene)
# (seulement le coin du coude : les ombres sous les poings restent sur le sweat, sinon elles pendent en eclats)
OMBRES_G = [(552, 868, 615, 940)]
OMBRES_D = []


def lisse_couture(Q, conf, bras, couvre, larg=3):
    """Le long de la frontiere visible / repeint du torse sous les bras : on remplace une bande etroite par le
    tissu voisin lisse (sans toucher aux traits d'encre)."""
    from tete import push_pull
    plein = Q[..., 3] > 0.5
    enc = ndi.binary_dilation(lum(Q) < 0.30, iterations=2)
    bande = (ndi.binary_dilation(conf, iterations=larg) & ndi.binary_dilation(plein & ~conf, iterations=larg)
             & ndi.binary_dilation(bras, iterations=3) & plein & ~enc & couvre)
    if bande.any():
        src = plein & ~bande & ~enc & ndi.binary_dilation(bande, iterations=10)
        F = push_pull(Q[..., :3], src.astype(np.float32), niveaux=5)
        F = cv2.GaussianBlur(F, (0, 0), 1.2)
        Q = Q.copy()
        Q[..., :3] = np.where(bande[..., None], F, Q[..., :3])
    return Q


def _ajoute_halo(out, n_haut, n_avb, z):
    """Le halo du trait (sur le sweat) va a la piece de bras la plus proche, en encre semi-transparente."""
    m, t, coul = z['halo']
    opaque = m & (t < 0)
    d_h = ndi.distance_transform_edt(~z['haut'])
    d_a = ndi.distance_transform_edt(~z['avb'])
    for nom, sel in ((n_haut, m & (d_h <= d_a)), (n_avb, m & (d_a < d_h))):
        P = out[nom]
        P[..., :3] = np.where(sel[..., None], np.where(opaque[..., None], coul, ENCRE), P[..., :3])
        P[..., 3] = np.where(sel, np.where(opaque, 1.0, np.maximum(P[..., 3], t)), P[..., 3])


# ------------------------------------------------------------------ jambes et pieds
# Chaque jambe (moitie du short) pivote autour du haut de l'entrejambe : un petit angle souleve le pied
# (trepignement) sans ouvrir l'entrejambe. Les chaussures pivotent autour du talon (taper du pied).
H_JAMBE = (712.0, 1088.0)
CENTRE_ENTREJAMBE_X = 712.0
TALON_G, TALON_D = (626.0, 1180.0), (770.0, 1186.0)
GRAINES = {'short': [(550, 1100), (850, 1100), (712, 1075)], 'pied_g': [(500, 1165), (470, 1140)],
           'pied_d': [(880, 1165), (900, 1140)]}


# haut des jambes cache sous l'ourlet du sweat, dessus des chaussures cache sous le revers du short
EXT_JAMBE_G = [(422, 1005), (716, 1005), (716, 1100), (432, 1100), (418, 1085)]
EXT_JAMBE_D = [(708, 1005), (962, 1005), (968, 1072), (955, 1100), (708, 1100)]
EXT_PIED_G = [(424, 1100), (632, 1100), (640, 1150), (418, 1150)]
EXT_PIED_D = [(752, 1104), (958, 1104), (978, 1150), (748, 1155)]


def zones_jambes(T):
    A = T[..., 3] > 0.02
    ink = encre_de(T, 0.24) & A
    tissu = A & ~ink & (T[..., 3] > 0.5)
    lab, n = ndi.label(tissu)
    def comp(nom):
        ids = {lab[y, x] for (x, y) in GRAINES[nom] if lab[y, x] > 0}
        return np.isin(lab, list(ids))
    short_f, pg_f, pd_f = comp('short'), comp('pied_g'), comp('pied_d')
    yy, xx = np.mgrid[0:N, 0:N]
    bas = yy > 1035
    # petits bouts de tissu sous l'ourlet : au plus proche des grands
    sweat_comp = lab == lab[950, 700]
    reste = tissu & bas & ~short_f & ~pg_f & ~pd_f & ~sweat_comp & ~((T[..., 0] > 0.75) & (T[..., 1] < 0.62))
    # encre : a la region de tissu la plus proche ; le revers du short (entre short et chaussure) au short,
    # l'ourlet du sweat au sweat
    sweat_f = sweat_comp | (tissu & ~short_f & ~pg_f & ~pd_f & ~reste)
    dist = {k: ndi.distance_transform_edt(~m) for k, m in
            (('short', short_f), ('pied_g', pg_f), ('pied_d', pd_f), ('sweat', sweat_f))}
    # l'ourlet du sweat (trait et ombre sombre juste au-dessus) reste en entier au sweat, devant le short
    proche = np.argmin(np.stack([dist['short'] - 3.5, dist['pied_g'], dist['pied_d'], dist['sweat'] - 16.0]), 0)
    zone_enc = ink & bas
    # le trait de l'ourlet du short (entre le tissu du short et la chaussure) va en entier au short : quand le pied
    # monte et que le short se tasse, la chaussure glisse dessous sans amincir le trait ni montrer sa coupe
    for k in (1, 2):
        cle = ('pied_g', 'pied_d')[k - 1]
        # (bouts de l'ourlet compris : tout trait a moins d'une epaisseur d'ourlet du tissu du short)
        ourlet = zone_enc & ((dist['short'] + dist[cle] <= 19.0) | (dist['short'] <= 17.0)) & (proche == k)
        proche = np.where(ourlet, 0, proche)
    short = short_f | (zone_enc & (proche == 0))
    pied_g = pg_f | (zone_enc & (proche == 1))
    pied_d = pd_f | (zone_enc & (proche == 2))
    for m_, k in ((reste, None),):
        pass
    if reste.any():
        lr, nr = ndi.label(reste)
        for i in range(1, nr + 1):
            c = lr == i
            k = int(np.argmin([dist['short'][c].mean(), dist['pied_g'][c].mean(), dist['pied_d'][c].mean()]))
            [short, pied_g, pied_d][k][c] = True
    jambe_g = short & (xx < CENTRE_ENTREJAMBE_X)
    jambe_d = short & (xx >= CENTRE_ENTREJAMBE_X)
    return dict(jambe_g=jambe_g, jambe_d=jambe_d, pied_g=pied_g, pied_d=pied_d, short=short)


if __name__ == '__main__':
    import sys
    sys.path.insert(0, f'{ICI}/corps')
    from voir import vue
    from PIL import Image
    T = torse_rig()
    a = T[..., 3:4]
    rgb = T[..., :3] * a + (1 - a) * np.array([0.47, 0.78, 1.0])
    for cote, f, box, piv in (('g', zones_bras_g, (360, 740, 620, 1060), (S_G, E_G)), ('d', zones_bras_d, (780, 690, 1070, 1020), (S_D, E_D))):
        z = f(T)
        v = rgb.copy()
        for nom, col in (('haut', (0.2, 0.9, 0.2)), ('avb', (0.9, 0.2, 0.9)), ('lang', (1, 1, 0))):
            m = z[nom]
            v[m] = v[m] * 0.45 + np.array(col) * 0.55
        img = Image.fromarray((v * 255).astype(np.uint8))
        vue(box, 3, f'{ICI}/out/zz/decoupe_{cote}.png', img=img,
            points=[(piv[0][0], piv[0][1], 'S'), (piv[1][0], piv[1][1], 'E')])
        print(cote, {k: int(m.sum()) for k, m in z.items()})
