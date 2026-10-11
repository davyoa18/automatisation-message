"""Prepare les donnees de la page de presentation : donnees.js (Lottie + cartes) et affiches JPG."""
import json, os, subprocess, tempfile
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
L = f'{ICI}/livrable'
P = f'{ICI}/page'
FOND = (255, 250, 245)


def rend(fichier, frame, taille):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['node', f'{ICI}/render.js', fichier, d, str(frame), str(taille), 'transparent'], check=True)
        return Image.open(os.path.join(d, f'f{frame:04d}.png')).convert('RGBA')


def main():
    os.makedirs(f'{P}/affiches', exist_ok=True)
    cartes = json.load(open(f'{L}/cartes.json'))
    with open(f'{P}/donnees.js', 'w') as f:
        f.write('window.TR_CARTES=' + json.dumps(cartes, ensure_ascii=False) + ';\n')
        for nom, src in (('TR_IDLE', f'{L}/taro_rouge_attente.json'), ('TR_IDLE_NORMAL', f'{ICI}/idle.json'),
                         ('TR_REACTIONS', f'{L}/taro_rouge_reactions.json')):
            f.write(f'window.{nom}=' + open(src).read().strip() + ';\n')
    # affiche de l'attente : l'idle dans sa sous-fenetre du cadre 1672 (75 %, decalee de 12,5 % et 25 %)
    T = 640
    for nom, src in (('attente', f'{L}/taro_rouge_attente.json'), ('normal', f'{ICI}/idle.json')):
        im = rend(src, 0, int(T * 0.75))
        c = Image.new('RGBA', (T, T), FOND + (255,))
        c.alpha_composite(im, (int(T * 0.125), int(T * 0.25)))
        c.convert('RGB').save(f'{P}/affiches/{nom}.jpg', quality=88)
    for d in cartes:
        im = rend(f'{L}/taro_rouge_reactions.json', d['de'] + d['forte'], T)
        c = Image.new('RGBA', (T, T), FOND + (255,))
        c.alpha_composite(im)
        c.convert('RGB').save(f'{P}/affiches/{d["nom"]}.jpg', quality=88)
    print('donnees.js', os.path.getsize(f'{P}/donnees.js') // 1024, 'Ko')


if __name__ == '__main__':
    main()
