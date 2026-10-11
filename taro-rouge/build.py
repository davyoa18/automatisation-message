"""Assemble les fichiers Lottie de Taro rouge."""
import json, os, sys
from taro_rig import construit, fichier
import anims

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.environ.get('SORTIE', 'livrable')
os.makedirs(f'{ICI}/{SORTIE}', exist_ok=True)

CARTES = {
    'bascule': {'ja': 'カッ！', 'rom': 'ka! — il voit rouge', 'titre': 'La bascule'},
    'calme':   {'ja': 'ふぅ…', 'rom': 'fû… — il redescend', 'titre': 'Retour au calme'},
    'crie':    {'ja': 'もう！！', 'rom': 'mô !! — il crie', 'titre': 'Il crie'},
    'pleure':  {'ja': 'うわーん', 'rom': 'uwân — il pleure de rage', 'titre': 'Il pleure de rage'},
    'explose': {'ja': 'ぷんぷん！', 'rom': 'punpun ! — il explose', 'titre': 'Il explose'},
}
FORTE = {'crie': 30, 'pleure': 47, 'explose': 31, 'bascule': 24, 'calme': 26}
DECAL = (209, 418)   # cadre elargi 1672 : meme calcul que dans l'app


def verifie(tl):
    pb = tl.verifie_raccords()
    d = tl.nettoie()
    if d:
        print(f'  [{tl.nom}] cles en double ecrasees : {d[:6]}{"..." if len(d) > 6 else ""}')
    for p in pb:
        print('  RACCORD :', p)
    return pb


def main():
    tout_ok = True
    if os.environ.get('SANS_EFFETS'):
        _orig = {k: v for k, v in anims.TOUTES.items()}
        def sans(f):
            def g():
                tl = f(); tl.fx = []; return tl
            return g
        anims.TOUTES = {k: sans(v) for k, v in _orig.items()}
        anims.attente = sans(anims.attente)
    # --- attente (boucle, cadre 1254)
    tl = anims.attente()
    tout_ok &= not verifie(tl)
    couches, _ = construit(tl, 0, 0)
    json.dump(fichier('taro_rouge_attente', 1254, 1254, tl.duree, couches), open(f'{ICI}/{SORTIE}/taro_rouge_attente.json', 'w'),
              separators=(',', ':'))
    # --- reactions (cadre 1672), un fichier commun a segments + un fichier par reaction
    t0, ind, couches, cartes, marqueurs = 0, 0, [], [], []
    for nom in ('crie', 'pleure', 'explose', 'bascule', 'calme'):
        tl = anims.TOUTES[nom]()
        tout_ok &= not verifie(tl)
        c, ind = construit(tl, t0, ind, DECAL)
        couches += c
        cartes.append({'nom': nom, 'de': t0, 'a': t0 + tl.duree, 'duree': tl.duree + 1, 'boucle': False,
                       'forte': FORTE[nom], **CARTES[nom]})
        marqueurs.append({'tm': t0, 'cm': nom, 'dr': tl.duree})
        seul, _ = construit(anims.TOUTES[nom](), 0, 0, DECAL)
        json.dump(fichier(f'taro_rouge_{nom}', 1672, 1672, tl.duree, seul), open(f'{ICI}/{SORTIE}/taro_rouge_{nom}.json', 'w'),
                  separators=(',', ':'))
        t0 += tl.duree + 2
        ind += 10
    json.dump(fichier('taro_rouge_reactions', 1672, 1672, t0 - 1, couches, marqueurs),
              open(f'{ICI}/{SORTIE}/taro_rouge_reactions.json', 'w'), separators=(',', ':'))
    json.dump(cartes, open(f'{ICI}/{SORTIE}/cartes.json', 'w'), ensure_ascii=False, indent=1)
    for f in sorted(os.listdir(f'{ICI}/{SORTIE}')):
        print(f'  {f:34s} {os.path.getsize(f"{ICI}/{SORTIE}/{f}") // 1024:6d} Ko')
    print('raccords OK' if tout_ok else 'RACCORDS A REVOIR')


if __name__ == '__main__':
    main()
