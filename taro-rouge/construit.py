"""Construction des pieces completes (repere scene idle 1254)."""
from pieces import *

TETE = charge('idle_head')
HX, HY = POS['idle_head']


def etrangers_tete():
    head = TETE
    enc = encre_de(head)
    fill = (head[..., 3] > 0.5) & ~enc
    lab, n = ndi.label(fill)
    cx = ndi.center_of_mass(fill, lab, index=np.arange(1, n + 1))
    etr = np.zeros_like(fill)
    for i, (cy, cxx) in enumerate(cx, start=1):
        if cxx < 175 and cy > 540:
            etr |= lab == i
    dist = ndi.distance_transform_edt(~(fill & ~etr))
    yy, xx = np.mgrid[0:head.shape[0], 0:head.shape[1]]
    # (le zigzag des touffes de la joue est le contour de la TETE : il reste a la tete)
    encre_loin = enc & (dist > 22)
    zone = (yy > 530) & (xx < 200)
    return (etr | encre_loin) & zone


ETR = etrangers_tete()


def en_scene(img_piece, x, y):
    c = vide()
    compose(c, img_piece, x, y)
    return c


def masque_scene(m, x, y):
    c = np.zeros((N, N), bool)
    h, w = m.shape
    c[y:y + h, x:x + w] = m
    return c


def queue_complete(debug=False):
    T = place('idle_tailfill')
    compose(T, charge('idle_tail'), *POS['idle_tail'])
    bits = TETE.copy()
    bits[..., 3] *= ETR
    compose(T, en_scene(bits, HX, HY), 0, 0)
    # fragments parasites sous la queue (bouts de chaussure)
    T[1072:, :, 3] = 0
    a0 = T[..., 3] > 0.5
    # --- silhouette complete ---
    # contour superieur prolonge : du haut de l'arc exterieur vers la frange, puis derriere le corps
    haut = chemin(((236, 601), (252, 612), (262, 632), (262, 652)))
    frange_fin = (427, 759)
    haut_ext = chemin(((424, 757), (470, 770), (510, 790), (560, 815)))
    bas_ext = chemin(((404, 1062), (450, 1048), (505, 1030), (560, 1005)))
    # polygone de la zone cachee a remplir (a droite de la coupe, derriere le torse)
    poly_droite = np.vstack([[[400, 745]], haut_ext, [[600, 815], [600, 1005]], bas_ext[::-1], [[395, 1062], [330, 1000], [330, 800]]])
    m_droite = masque_poly(poly_droite) > 0.5
    # encoche du haut (entre l'arc et la frange)
    poly_encoche = np.vstack([[[228, 598]], haut, [[275, 690], [215, 690], [215, 610]]])
    m_encoche = masque_poly(poly_encoche) > 0.5
    sil = a0 | m_droite | m_encoche
    sil = ndi.binary_fill_holes(sil)
    # on ne garde pas ce qui deborde au-dessus du contour superieur prolonge (ni sous le bas)
    zone = sil & ~a0
    # source : couleurs de queue hors encre
    src = a0 & ~encre_de(T, 0.22)
    Q = repeint(T, zone, source=src, graine=7, rayon=10)
    Q[..., 3] = np.where(sil, np.maximum(Q[..., 3], 1.0 * zone), Q[..., 3])
    # traits d'encre des contours prolonges
    ink = np.maximum(masque_trait(haut, np.linspace(21, 16, len(haut))), 0)
    ink = np.maximum(ink, masque_trait(haut_ext, 18))
    ink = np.maximum(ink, masque_trait(bas_ext, np.linspace(22, 20, len(bas_ext))))
    Q = encre_sur(Q, ink)
    # rien au-dessus/au-dessous des contours prolonges : coupe propre le long du trait
    garde = np.ones((N, N), np.float32)
    au_dessus = masque_poly(np.vstack([[[380, 600]], haut_ext + [0, -9], [[600, 600]]]))
    au_dessous = masque_poly(np.vstack([[[380, 1200]], bas_ext + [0, 10], [[600, 1200]]]))
    garde = garde * (1 - au_dessus) * (1 - au_dessous)
    Q = coupe(Q, garde)
    return Q


def queue_complete2():
    T = place('idle_tailfill')
    compose(T, charge('idle_tail'), *POS['idle_tail'])
    bits = TETE.copy()
    bits[..., 3] *= ETR
    compose(T, en_scene(bits, HX, HY), 0, 0)
    T[1072:, :, 3] = 0
    opaque = T[..., 3] > 0.5
    # on ne garde tel quel que ce qui est visible au repos (devant : tete sans le brin, torse)
    tete_sans = TETE.copy()
    tete_sans[..., 3] *= (1 - ETR)
    occ = 1 - (1 - en_scene(tete_sans, HX, HY)[..., 3]) * (1 - place('idle_torso')[..., 3])
    cache = ndi.binary_dilation(occ > 0.5, iterations=5)
    confiance = opaque & ~cache
    # debris de raccord (coin noir pres de l'epaule, amas d'encre sous la joue)
    # (seulement la ou c'est cache au repos : ce qui se voit au repos reste le dessin d'origine)
    for poly in ([(383, 742), (446, 742), (446, 838), (383, 838)],
                 [(198, 596), (272, 596), (272, 705), (198, 705)]):
        confiance &= ~((masque_poly(poly) > 0.5) & cache)
    # extension cachee derriere le torse (bord superieur dans le prolongement de la frange)
    d_droite = np.vstack([[[392, 752]],
                          chemin(((420, 757), (470, 772), (525, 795), (548, 845)),
                                 ((548, 845), (566, 900), (556, 965), (520, 1004)),
                                 ((520, 1004), (485, 1035), (450, 1050), (404, 1063))),
                          [[330, 1063], [330, 752]]])
    # encoche du haut : l'arc exterieur s'enroule jusqu'a la frange
    d_encoche = np.vstack([chemin(((190, 614), (212, 604), (240, 598), (258, 606)),
                                  ((258, 606), (274, 616), (276, 646), (262, 690))),
                           [[262, 712], [190, 712]]])
    # dos de la queue cache sous la joue : un arc rond du lobe gauche jusqu'a la frange (au lieu de la
    # marche d'escalier qui suivait l'ancien contour de la joue). Tout est cache par la tete au repos.
    arc = chemin(((258, 606), (330, 586), (418, 640), (446, 752)))
    d_dos = np.vstack([arc, [(446, 790), (300, 790), (258, 700)]])
    Q, sil = complete(T, confiance, [d_droite, d_encoche, d_dos], epais=19, graine=7)
    # anciens traits devenus interieurs (sous la joue et l'epaule) : repeints en fourrure,
    # seulement la ou la tete ou le torse les cachent au repos
    Qt, _, _ = tete_complete()
    couvert = ndi.binary_erosion((Qt[..., 3] > 0.5) | (place('idle_torso')[..., 3] > 0.5), iterations=3)
    yy, xx = np.mgrid[0:N, 0:N]
    boite = (xx > 236) & (xx < 480) & (yy > 585) & (yy < 840)
    bord = sil & ~ndi.binary_erosion(sil, iterations=24)
    vieux = encre_de(Q, 0.30) & sil & ~bord & couvert & boite
    # le bout de trait en biais sous l'epaule (fin de l'ancienne frange)
    vieux |= encre_de(Q, 0.30) & sil & couvert & (xx > 378) & (xx < 446) & (yy > 744) & (yy < 820)
    if vieux.any():
        z = ndi.binary_dilation(vieux, iterations=3) & sil & ~bord & boite
        Q = repeint(Q, z, source=sil & ~z & ~encre_de(Q, 0.30), graine=9, rayon=8)
    # pointe de fourrure coincee entre le lobe gauche et l'arc : sur le dessin d'origine elle est noire
    # (cachee par le zigzag de la joue). On prolonge le trait exterieur a epaisseur constante pour
    # qu'il n'y ait ni encoche ni marche quand la tete se souleve.
    d_ext = ndi.distance_transform_edt(sil)
    zone = (xx >= 206) & (xx <= 266) & (yy >= 590) & (yy <= 646)
    trait = sil & zone & (d_ext <= 21.0)
    if trait.any():
        voisin = encre_de(Q, 0.2) & sil & (xx >= 150) & (xx <= 330) & (yy >= 575) & (yy <= 646) & ~trait
        a_t = (np.clip(21.5 - d_ext, 0, 1) * trait)[..., None]
        Q[..., :3] = Q[..., :3] * (1 - a_t) + np.median(Q[..., :3][voisin], axis=0) * a_t
    # petite tache d'encre isolee sous l'epaule (reste de l'ancien raccord, cachee au repos)
    tache = (Q[..., :3].mean(2) < 0.25) & sil & (d_ext > 10) & (xx > 400) & (xx < 446) & (yy > 740) & (yy < 780)
    lab, n = ndi.label(tache)
    if n:
        tailles = ndi.sum(tache, lab, np.arange(1, n + 1))
        petites = np.isin(lab, 1 + np.nonzero(tailles < 30)[0])
        if petites.any():
            z = ndi.binary_dilation(petites, iterations=2) & sil
            Q = repeint(Q, z, source=sil & ~z & ~encre_de(Q, 0.30), graine=11, rayon=6)
    # petit triangle de fond entre le menton, la capuche et la queue : visible sur l'original au repos,
    # la queue prolongee ne doit pas le boucher. Les bords recoupes sont encres (au repos ils sont
    # sous les traits du menton et de la capuche ; si la queue tourne un peu, on voit un trait, pas une coupe).
    orig = np.ones((N, N), np.float32)
    for k in ('idle_head', 'idle_torso', 'idle_tail', 'idle_tailfill', 'idle_filler'):
        orig *= 1 - place(k)[..., 3]
    orig = 1 - orig
    boite_t = (xx >= 395) & (xx <= 448) & (yy >= 745) & (yy <= 815)
    trou = ndi.binary_opening(boite_t & (orig < 0.5) & sil, iterations=1)
    if trou.any():
        a_trou = np.clip(cv2.GaussianBlur(trou.astype(np.float32), (0, 0), 0.7) * 1.4, 0, 1)
        Q[..., 3] *= 1 - a_trou
        sil = sil & ~trou
        bord_t = sil & (ndi.distance_transform_edt(~trou) <= 9) & ~encre_de(Q, 0.2)
        a_b = cv2.GaussianBlur(bord_t.astype(np.float32), (0, 0), 0.6)[..., None] * sil[..., None]
        coul_q = np.median(Q[..., :3][encre_de(Q, 0.2) & sil & (xx > 330) & (yy > 700) & (yy < 860)], axis=0)
        Q[..., :3] = Q[..., :3] * (1 - a_b) + coul_q * a_b
    return Q, sil, confiance


def _cote(poly):
    return masque_poly(poly) > 0.5


# cote "oreille" de la ligne de contour de la tete (bord exterieur du trait), trace au pixel
BORD_OREILLE_G = [(418, 232), (401, 270), (385, 295), (366, 320), (340, 361), (322, 402),
                  (307, 437), (299, 447), (282, 480), (268, 515), (258, 550), (252, 575)]
BORD_OREILLE_G_LISSE = catmull(BORD_OREILLE_G, 12)
COTE_OREILLE_G = [tuple(p) for p in BORD_OREILLE_G_LISSE] + [(120, 575), (100, 420), (100, 180), (250, 140), (385, 150)]
DISQUE_G = ((266, 345), 190)
DISQUE_D = ((847, 164), 196)
EP_TRAIT_TETE = 19.0


def separe_oreilles():
    """Renvoie (tete en scene, masque oreille gauche, masque oreille droite)."""
    h = TETE.copy()
    h[..., 3] *= (1 - ETR)
    Hs = en_scene(h, HX, HY)
    e = encre_de(Hs)
    op = Hs[..., 3] > 0.003
    fill = (Hs[..., 3] > 0.5) & ~e
    yy, xx = np.mgrid[0:N, 0:N]

    def disque(c, r):
        return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 < r * r

    # gauche : tout ce qui est du cote exterieur du bord trace
    ear_g = op & _cote(COTE_OREILLE_G) & disque(*DISQUE_G)
    # droite : haut de la fourrure du visage colonne par colonne, moins l'epaisseur du trait de tete
    lab, n = ndi.label(fill)
    fd = (lab == lab[82, 847])
    face = fill & ~fd & ~ear_g
    zone_d = disque(*DISQUE_D)
    cols = np.arange(560, 1060)
    haut_face = np.full(N, np.nan)
    for x in cols:
        ys_ = np.nonzero(face[60:, x])[0]
        if len(ys_):
            haut_face[x] = ys_.min() + 60
    # epaisseur reelle du trait au-dessus de la fourrure du visage (plafonnee)
    sombre = (lum(Hs) < 0.32) & (Hs[..., 3] > 0.3)
    haut_trait = np.full(N, np.nan)
    for x in cols:
        if np.isnan(haut_face[x]):
            continue
        y = int(haut_face[x]) - 1
        run = 0
        while y >= 0 and sombre[y, x] and run < 30:
            run += 1
            y -= 1
        haut_trait[x] = haut_face[x] - min(max(run, 8), 24)
    xs_all = np.arange(N)
    ok = ~np.isnan(haut_trait)
    lim = np.interp(xs_all, xs_all[ok], haut_trait[ok])
    lim = ndi.median_filter(lim, size=41)
    lim = cv2.GaussianBlur(lim.reshape(1, -1).astype(np.float32), (0, 0), 4).ravel() - 0.5
    ear_d = op & disque(*DISQUE_D) & (yy <= lim[xx] + 1.0)
    return Hs, ear_g, ear_d



def ellipse_contour(m, exclure=None):
    """Ajuste une ellipse sur le bord exterieur visible d'un masque (bord contre le vide)."""
    bord = m & ndi.binary_dilation(~m, iterations=1)
    if exclure is not None:
        bord &= ~exclure
    ys, xs = np.nonzero(bord)
    pts = np.stack([xs, ys], 1).astype(np.float32)
    return cv2.fitEllipse(pts)


def poly_ellipse(e, n=180, gonfle=0.0):
    (cx, cy), (w, h), ang = e
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    a, b = w / 2 + gonfle, h / 2 + gonfle
    ca, sa = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    x = a * np.cos(t)
    y = b * np.sin(t)
    return np.stack([cx + x * ca - y * sa, cy + x * sa + y * ca], 1)


def oreilles_completes():
    Hs, eg, ed = separe_oreilles()
    tete_a = Hs[..., 3] > 0.5
    res = {}
    for nom, m, graine in (('g', eg, 11), ('d', ed, 12)):
        E = Hs.copy()
        E[..., 3] *= m
        # bord exterieur seulement (pas la frontiere avec la tete)
        frontiere = ndi.binary_dilation(tete_a & ~m, iterations=3)
        el = ellipse_contour(m & (E[..., 3] > 0.5), exclure=frontiere)
        # ellipse legerement retrecie pour rester dans le trait d'origine
        disque_poly = poly_ellipse(el, gonfle=-1.0)
        Q, sil = complete(E, m & (E[..., 3] > 0.5), [disque_poly], epais=20, graine=graine)
        res[nom] = (Q, sil, el)
    return res


def remplit_symetrie(E, conf, zone, centre, axes_deg, rot_deg=(8, -8, 16, -16, 24, -24, 32, -32)):
    """Remplit 'zone' en copiant des pixels de confiance obtenus par reflexion (axes passant par
    'centre', angles en degres) puis par rotation. Renvoie l'image modifiee et le masque rempli."""
    out = E.copy()
    ys, xs = np.nonzero(zone)
    fait = np.zeros(len(xs), bool)
    cx, cy = centre
    X, Y = xs - cx, ys - cy
    cands = []
    for a in axes_deg:
        t = np.radians(a)
        ux, uy = np.cos(t), np.sin(t)
        d = X * ux + Y * uy
        cands.append((2 * d * ux - X, 2 * d * uy - Y))
    for r in rot_deg:
        t = np.radians(r)
        cands.append((X * np.cos(t) - Y * np.sin(t), X * np.sin(t) + Y * np.cos(t)))
    for (sx, sy) in cands:
        px = np.round(sx + cx).astype(int)
        py = np.round(sy + cy).astype(int)
        ok = ~fait & (px >= 0) & (px < N) & (py >= 0) & (py < N)
        ok[ok] &= conf[py[ok], px[ok]]
        out[ys[ok], xs[ok], :3] = E[py[ok], px[ok], :3]
        out[ys[ok], xs[ok], 3] = 1
        fait |= ok
    rempli = np.zeros(zone.shape, bool)
    rempli[ys[fait], xs[fait]] = True
    return out, rempli


def oreilles_completes():
    Hs, eg, ed = separe_oreilles()
    tete_a = Hs[..., 3] > 0.5
    yy, xx = np.mgrid[0:N, 0:N]
    res = {}
    for nom, m, graine in (('g', eg, 11), ('d', ed, 12)):
        E = Hs.copy()
        E[..., 3] *= m
        frontiere = ndi.binary_dilation(tete_a & ~m, iterations=7)
        conf = m & (E[..., 3] > 0.5) & ~frontiere
        el = ellipse_contour(m & (E[..., 3] > 0.5), exclure=ndi.binary_dilation(tete_a & ~m, iterations=3))
        disque_poly = poly_ellipse(el, gonfle=-1.0)
        disque = masque_poly(disque_poly) > 0.5
        zone = disque & ~conf
        if nom == 'g':
            E2, rempli = remplit_symetrie(E, conf, zone, el[0], (115.0, 25.0))
        else:
            # ovale creme : ajuste sur sa partie visible
            L = lum(E)
            creme = conf & (L > 0.86)
            lab, n = ndi.label(creme)
            if n:
                tailles = ndi.sum(creme, lab, range(1, n + 1))
                creme = lab == (1 + int(np.argmax(tailles)))
            ov = ellipse_contour(creme, exclure=ndi.binary_dilation(tete_a & ~m, iterations=9))
            (ox, oy) = ov[0]
            r_in = 0.5 * min(ov[1]) + 38
            d_ov = np.hypot(xx - ox, yy - oy)
            z_in = zone & (d_ov < r_in)
            z_ring = zone & ~z_in
            E2, r1 = remplit_symetrie(E, conf, z_in, (ox, oy), (20.0, 200.0), rot_deg=(10, -10, 20, -20))
            E2, r2 = remplit_symetrie(E2, conf, z_ring, el[0], (), rot_deg=(6, -6, 12, -12, 18, -18, 26, -26, 34, -34, 45, -45))
            rempli = r1 | r2
        conf2 = conf | rempli
        Q, sil = complete(E2, conf2, [disque_poly], epais=20, graine=graine)
        res[nom] = (Q, sil, el)
    return res


MACHOIRE = np.vstack([
    [(262, 712), (280, 726), (300, 733), (330, 743), (360, 750), (390, 757), (420, 764)],
    chemin(((420, 764), (480, 778), (580, 776), (650, 760)),
           ((650, 760), (690, 751), (722, 747), (760, 741)),
           ((760, 741), (812, 733), (870, 712), (905, 690))),
    [(920, 683), (935, 675)],
])


def tete_complete():
    Hs, eg, ed = separe_oreilles()
    to = place('idle_torso')[..., 3] > 0.5
    a = Hs[..., 3] > 0.5
    conf = a & ~eg & ~ed & ~ndi.binary_dilation(to, iterations=9)
    # on ne fait pas confiance au trait estompe entre oreille gauche et joue
    conf &= ~(ndi.binary_dilation(eg, iterations=2) & ~encre_de(Hs))
    E = Hs.copy()
    E[..., 3] *= ~(eg | ed)
    ajout = np.vstack([MACHOIRE, [(935, 600), (262, 600)]])
    def ep_tete(x, y):
        # menton visible dans l'encolure : trait plus fin
        k = np.clip((np.abs(x - 708) - 70) / 50.0, 0, 1) * 0 + np.clip((np.abs(x - 708) - 60) / 60.0, 0, 1)
        k = np.maximum(k, np.clip((710 - y) / 30.0, 0, 1))
        return 12.0 + 6.0 * k
    Q, sil = complete(E, conf, [ajout], epais=ep_tete, graine=21)
    # contour gauche de la tete redessine d'un seul trait regulier : sous l'oreille et le long de la joue,
    # le dessin d'origine etait en escalier (cache par l'oreille et la queue au repos)
    # (seulement sous l'oreille : plus bas, les touffes de la joue d'origine sont gardees telles quelles)
    pts = [(418, 232), (401, 270), (385, 295), (366, 320), (340, 361), (322, 402), (307, 437), (292, 462),
           (281, 486), (273, 506)]
    c = catmull(pts, 10)
    exterieur = masque_poly(np.vstack([c, [(273, 512), (120, 512), (120, 232)]]))
    yy, xx = np.mgrid[0:N, 0:N]
    exterieur *= (yy < 500)
    Q[..., 3] *= (1 - exterieur)
    sil = sil & (exterieur < 0.5)
    # ombre estompee d'origine juste a l'interieur du contour (sous l'oreille) : on la repeint en fourrure
    bande_int = masque_poly(np.vstack([decale(c, 19.0), decale(c, 46.0)[::-1]])) > 0.5
    bande_int &= (yy > 300) & (yy < 470)
    sombre = (lum(Q) < 0.42) & bande_int
    if sombre.any():
        Q = repeint(Q, ndi.binary_dilation(sombre, iterations=2) & bande_int, graine=23)
    bande = masque_trait(decale(c, 10.0), np.r_[np.linspace(17, 20, 12), np.full(len(c) - 24, 20.0), np.linspace(20, 14, 12)])
    bande *= Q[..., 3]
    coul = np.median(Q[..., :3][encre_de(Q, 0.10) & conf], axis=0)
    Q[..., :3] = Q[..., :3] * (1 - bande[..., None]) + coul * bande[..., None]
    # jonctions oreilles / tete : sur l'original, le contour de chaque oreille se fond dans celui de la tete
    # en un seul trait epais. La separation des oreilles l'a coupe (encoche de fond, liseré de fourrure
    # entre les deux traits). On remet dans la tete l'encre d'origine de la jonction.
    fourrure = (Q[..., 3] > 0.5) & ~encre_de(Q)
    d_four = ndi.distance_transform_edt(~fourrure)
    for (x0, y0, x1, y1) in ((236, 425, 314, 548), (884, 214, 1004, 334)):
        jonction = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
        encre_orig = encre_de(Hs) & (Hs[..., 3] > 0.5) & jonction & (d_four <= 32)
        encre_orig = ndi.binary_closing(encre_orig, iterations=2) & jonction
        lab_j, n_j = ndi.label(encre_orig)
        if not n_j:
            continue
        tailles_j = ndi.sum(encre_orig, lab_j, np.arange(1, n_j + 1))
        encre_orig = lab_j == (1 + int(np.argmax(tailles_j)))
        a_j = np.clip(cv2.GaussianBlur(encre_orig.astype(np.float32), (0, 0), 0.7) * 1.6, 0, 1)
        a_j = np.maximum(a_j, encre_orig.astype(np.float32))
        Q[..., :3] = Q[..., :3] * (1 - a_j[..., None]) + coul * a_j[..., None]
        Q[..., 3] = np.maximum(Q[..., 3], a_j)
        sil = sil | encre_orig
    # fragments detaches du corps de la tete (restes de l'ancien contour) : supprimes
    lab_, n_ = ndi.label(Q[..., 3] > 0.05)
    if n_ > 1:
        tailles = ndi.sum(np.ones((N, N)), lab_, range(1, n_ + 1))
        garde = lab_ == (1 + int(np.argmax(tailles)))
        Q[..., 3] *= garde
        sil = sil & garde
    return Q, sil, conf


def torse_complet():
    T = place('idle_torso')
    # le bout gauche de la chaussure etait range dans la piece de la queue : on le rend au torse
    q = place('idle_tail')
    q[:1072, :, 3] = 0
    dessous = q
    compose(dessous, T, 0, 0)
    T = dessous
    e = encre_de(T)
    fill = (T[..., 3] > 0.5) & ~e
    lab, n = ndi.label(fill)
    # composantes etrangeres : peau du cou dans le V + bout de menton, bouts de queue a gauche
    etr = np.zeros((N, N), bool)
    objs = ndi.find_objects(lab)
    for i, sl in enumerate(objs, 1):
        ys, xs = sl
        petit = (lab[sl] == i).sum() < 12
        col_v = ys.start < 760 and xs.start > 620 and xs.stop < 860          # cou + menton dans le V
        queue_g = xs.stop <= 440 and ys.start >= 800 and ys.stop <= 1045     # bouts de queue
        if petit or col_v or queue_g:
            etr |= lab == i
    # encre flottante : trop loin de tout remplissage restant du torse
    reste = fill & ~etr
    d = ndi.distance_transform_edt(~reste)
    flottant = e & (d > 22)
    # cote gauche (bras) : le contour du bras fait ~16 px ; au-dela, ce sont les traits de la queue
    yy, xx = np.mgrid[0:N, 0:N]
    zone_g = (xx < 448) & (yy > 790) & (yy < 1075)
    flottant |= e & zone_g & (d > 17)
    # trait de col qui traverse le V : encre du V a plus de 9 px du sweat orange
    sweat = lab == lab[900, 700]
    v = ndi.binary_dilation(lab == lab[760, 700], iterations=8)
    d_sweat = ndi.distance_transform_edt(~sweat)
    col = e & v & (d_sweat > 13)
    retire = etr | flottant | col
    retire = ndi.binary_dilation(retire, iterations=1) & ~(sweat | (e & ~col & ~flottant))
    conf = (T[..., 3] > 0.5) & ~retire
    E = T.copy()
    E[..., 3] *= ~retire
    Q, sil = complete(E, conf, [], epais=17, graine=31)
    return Q, sil, conf


COU_POLY = np.vstack([
    chemin(((604, 600), (600, 660), (612, 730), (626, 820))),
    [(640, 860), (800, 860)],
    chemin(((806, 820), (826, 735), (838, 660), (842, 590))),
    [(720, 570)],
])


def cou():
    m = masque_poly(COU_POLY)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    # creme au centre, beige plus soutenu sur les cotes, ombre portee sous le menton
    centre = 722.0
    u = np.clip(np.abs(xx - centre) / 115.0, 0, 1)
    creme = np.array([0.905, 0.780, 0.665], np.float32)
    cote = np.array([0.800, 0.630, 0.520], np.float32)
    rgb = creme * (1 - u[..., None] ** 1.6) + cote * (u[..., None] ** 1.6)
    ombre = np.clip((800 - yy) / 110.0, 0, 1) ** 1.2
    ombre_c = np.array([0.70, 0.52, 0.44], np.float32)
    rgb = rgb * (1 - 0.55 * ombre[..., None]) + ombre_c * 0.55 * ombre[..., None]
    img = np.zeros((N, N, 4), np.float32)
    img[..., :3] = rgb
    img[..., 3] = m
    # grain de papier emprunte a la creme du museau (meme pinceau)
    g = grain((N, N), 0.010, 41)
    img[..., :3] += g[..., None] * np.array([1.0, 0.95, 0.9], np.float32)
    conf = ndi.binary_erosion(m > 0.5, iterations=2)
    Q, sil = complete(img, conf, [COU_POLY], epais=15, graine=41)
    return Q, sil


# dos de la capuche : un bourrelet de tissu arrondi, derriere le cou, entre les deux epaules.
# Il ne deborde jamais a gauche de l'epaule (sinon il apparait comme une plaque orange
# quand la tete se leve) : a gauche, entre la queue et la joue, on doit voir le fond.
CAPUCHE_POLY = np.vstack([
    chemin(((452, 760), (448, 712), (472, 676), (520, 660)),
           ((520, 660), (600, 634), (760, 626), (850, 640)),
           ((850, 640), (890, 655), (906, 682), (912, 712)),
           ((912, 712), (914, 760), (915, 820), (916, 900))),
    [(470, 900)],
])


def capuche_dos():
    """Dos de la capuche : orange du sweat, interieur plus sombre autour du cou, contour encre."""
    m = masque_poly(CAPUCHE_POLY)
    m = cv2.GaussianBlur(m, (0, 0), 0.7)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    T = place('idle_torso')
    e = encre_de(T)
    fill = (T[..., 3] > 0.5) & ~e
    # couleurs du sweat echantillonnees sur le torse
    orange = np.median(T[..., :3][fill & (np.abs(xx - 700) < 80) & (np.abs(yy - 900) < 40)], axis=0)
    fonce = orange * np.array([0.80, 0.70, 0.62], np.float32)
    rgb = np.zeros((N, N, 3), np.float32) + orange
    # interieur de la capuche (ouverture autour du cou) : ellipse plus sombre, bord adouci
    d = ((xx - 722) / 205.0) ** 2 + ((yy - 760) / 95.0) ** 2
    k = np.clip((1.15 - d) / 0.3, 0, 1)
    rgb = rgb * (1 - k[..., None]) + fonce * k[..., None]
    img = np.zeros((N, N, 4), np.float32)
    img[..., :3] = rgb + grain((N, N), 0.010, 51)[..., None]
    img[..., 3] = m
    conf = ndi.binary_erosion(m > 0.5, iterations=2)
    contour_m = cv2.findContours((m > 0.5).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    poly = max(contour_m, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    Q, sil = complete(img, conf, [poly], epais=16, graine=51)
    return Q, sil


def _fit_ellipse_pts(pts):
    return cv2.fitEllipse(np.asarray(pts, np.float32))


def _rho(e, xx, yy):
    """Rayon normalise (1 = sur l'ellipse) de chaque point par rapport a l'ellipse e."""
    (cx, cy), (w, h), ang = e
    t = np.radians(ang)
    dx, dy = xx - cx, yy - cy
    u = dx * np.cos(t) + dy * np.sin(t)
    v = -dx * np.sin(t) + dy * np.cos(t)
    return np.sqrt((u / (w / 2)) ** 2 + (v / (h / 2)) ** 2)


def oreilles_completes():
    """Oreilles entieres et propres : la partie cachee par la tete est repeinte en anneaux concentriques
    (profil de couleur mesure sur la partie visible), l'interieur rose est une ellipse complete avec
    son contour, sans plaques ni coutures."""
    from tete import push_pull
    Hs, eg, ed = separe_oreilles()
    tete_a = Hs[..., 3] > 0.5
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    h_, s_, l_ = rgb_vers_hsl(Hs[..., :3])
    res = {}
    for nom, m, graine in (('g', eg, 11), ('d', ed, 12)):
        E = Hs.copy()
        E[..., 3] *= m
        front = ndi.binary_dilation(tete_a & ~m, iterations=7)
        conf = m & (E[..., 3] > 0.5) & ~front
        e_o = ellipse_contour(m & (E[..., 3] > 0.5), exclure=ndi.binary_dilation(tete_a & ~m, iterations=3))
        ext = masque_poly(poly_ellipse(e_o, gonfle=-1.0)) > 0.5
        conf &= ndi.binary_dilation(ext, iterations=2)       # pas de bout de contour de la tete hors de l'oreille
        # interieur rose (rose + creme tres clair), ellipse ajustee sur son bord visible
        rose = conf & (((l_ > 0.72) & ((h_ < 25) | (h_ > 320))) | (l_ > 0.86)) & (E[..., 3] > 0.9)
        rose = ndi.binary_closing(rose, iterations=3)
        lab, n = ndi.label(rose)
        if n:
            rose = lab == (1 + int(np.argmax(ndi.sum(rose, lab, range(1, n + 1)))))
        rose = ndi.binary_fill_holes(rose)
        bord_rose = rose & ndi.binary_dilation(~rose) & ~ndi.binary_dilation(front, iterations=5)
        ys, xs = np.nonzero(bord_rose)
        e_i = _fit_ellipse_pts(np.stack([xs, ys], 1))
        r_o = _rho(e_o, xx, yy)
        r_i = _rho(e_i, xx, yy)
        dans_i = r_i < 1.0
        encre = l_ < 0.22
        brun = conf & ~encre & (r_i > 1.25) & (l_ < 0.50) & (h_ < 25)     # anneau brun, sans les taches claires
        clair = conf & dans_i & ~encre
        cache = ext & ~conf
        # profils radiaux
        def profil(sel, r, nb=24, lo=0.0, hi=1.0):
            bins = np.clip(((r[sel] - lo) / (hi - lo) * nb).astype(int), 0, nb - 1)
            cols = Hs[..., :3][sel]
            prof = np.zeros((nb, 3), np.float32)
            ok = np.zeros(nb, bool)
            for b in range(nb):
                k = bins == b
                if k.sum() > 20:
                    prof[b] = np.median(cols[k], axis=0)
                    ok[b] = True
            idx = np.arange(nb)
            for c in range(3):
                prof[:, c] = np.interp(idx, idx[ok], prof[ok, c])
            return prof
        p_brun = profil(brun, r_o, lo=0.3, hi=1.0)
        p_clair = profil(clair, r_i, lo=0.0, hi=1.0)
        def lit(prof, r, lo, hi):
            nb = len(prof)
            f = np.clip((r - lo) / (hi - lo) * nb - 0.5, 0, nb - 1)
            i0 = np.floor(f).astype(int)
            i1 = np.minimum(i0 + 1, nb - 1)
            a = (f - i0)[..., None]
            return prof[i0] * (1 - a) + prof[i1] * a
        base = np.where(dans_i[..., None], lit(p_clair, r_i, 0.0, 1.0), lit(p_brun, r_o, 0.3, 1.0))
        base = base + grain((N, N), 0.012, graine)[..., None] * np.array([1.0, 0.92, 0.85], np.float32)
        # raccord doux avec le visible (20 px), pour ne laisser aucune couture droite
        d_vis = ndi.distance_transform_edt(~conf)
        prolonge = push_pull(Hs[..., :3], (conf & ~encre).astype(np.float32))
        w = np.clip(1 - d_vis / 22.0, 0, 1)[..., None] ** 1.5
        rempli = prolonge * w + base * (1 - w)
        # taches claires (fauve) coupees par la tete : chacune est completee en une forme arrondie
        fauve = conf & ~encre & (h_ >= 22) & (h_ <= 48) & (l_ > 0.48) & ~ndi.binary_dilation(rose, iterations=6)
        fauve = ndi.binary_opening(fauve, iterations=2)
        labf, nf = ndi.label(fauve)
        for k in range(1, nf + 1):
            zf = labf == k
            if zf.sum() < 300:
                continue
            # prolongement arrondi : la tache deborde de 34 px dans la partie cachee, bout arrondi
            disque = np.zeros((69, 69), bool)
            cv2.circle(disque.view(np.uint8), (34, 34), 34, 1, -1)
            mf = ndi.binary_dilation(zf, structure=disque) & cache & (r_i > 1.3) & (r_o < 0.97)
            mf = cv2.GaussianBlur(mf.astype(np.float32), (0, 0), 6)
            mf = np.clip((mf - 0.5) * 6 + 0.5, 0, 1) * (cache & (r_i > 1.3)).astype(np.float32)
            coul = np.median(Hs[..., :3][zf], axis=0)
            rempli = rempli * (1 - mf[..., None]) + (coul + grain((N, N), 0.012, graine + k)[..., None]) * mf[..., None]
        E2 = E.copy()
        E2[..., :3] = np.where(cache[..., None], rempli, E[..., :3])
        E2[..., 3] = np.where(cache, 1.0, E2[..., 3])
        # contour de l'interieur rose, complete dans la partie cachee (meme epaisseur que le visible)
        # le trait noir entoure le rose (il est juste a l'exterieur de l'ellipse rose)
        ep_i = 14.0
        demi = min(e_i[1]) / 2
        d_px = (r_i - 1.0) * demi                      # distance approx. au bord de l'ellipse rose
        a_i = np.clip(ep_i / 2 + 0.5 - np.abs(d_px - ep_i / 2 + 1.0), 0, 1) * cache
        E2[..., :3] = E2[..., :3] * (1 - a_i[..., None]) + ENCRE * a_i[..., None]
        conf2 = conf | cache
        Q, sil = complete(E2, conf2, [poly_ellipse(e_o, gonfle=-1.0)], epais=20, graine=graine)
        res[nom] = (Q, sil, e_o)
    return res
