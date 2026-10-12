"""Exporte les pieces du corps articule (corps.py) dans final/ (PNG recadres + positions dans pieces.json)."""
import json, os
import numpy as np
import corps as C
import production as P

NOMS = ['capuche_avant', 'torse', 'bras_g', 'avbras_g', 'bras_d', 'avbras_d', 'jambe_g', 'jambe_d', 'pied_g', 'pied_d']


def main():
    pieces = C.pieces_corps()
    fin = json.load(open(f'{P.OUT}/pieces.json'))
    for nom in NOMS:
        img = np.clip(pieces[nom], 0, 1)
        crop, x, y = P.recadre(img)
        ch = f'{P.OUT}/corps_{nom}.png'
        P.sauve_rgba(crop, ch)
        P.quantifie(ch)
        fin[f'corps_{nom}'] = {'x': x, 'y': y, 'w': int(crop.shape[1]), 'h': int(crop.shape[0])}
        print(nom, fin[f'corps_{nom}'], os.path.getsize(ch) // 1024, 'Ko')
    json.dump(fin, open(f'{P.OUT}/pieces.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
