"""Regenere une seule piece (rig/ puis final/) sans relancer toute la chaine : python3 maj_piece.py queue"""
import json, sys
import exporte
from construit import queue_complete2, tete_complete
import production as P

CONSTRUIT = {'queue': lambda: queue_complete2()[0], 'tete': lambda: tete_complete()[0]}

if __name__ == '__main__':
    for nom in sys.argv[1:]:
        info = json.load(open('rig/pieces.json'))
        info[nom] = exporte.recadre_et_sauve(nom, CONSTRUIT[nom]())
        json.dump(info, open('rig/pieces.json', 'w'), indent=1)
        fin = json.load(open(f'{P.OUT}/pieces.json'))
        crop, x, y = P.recadre(P.charge_rig(nom))
        ch = f'{P.OUT}/{nom}.png'
        P.sauve_rgba(crop, ch)
        P.quantifie(ch)
        fin[nom] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}
        json.dump(fin, open(f'{P.OUT}/pieces.json', 'w'), indent=1)
        print(nom, info[nom], fin[nom])
