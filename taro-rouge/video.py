"""Video d'apercu du parcours complet : Taro normal -> bascule -> attente -> crie -> attente -> pleure ->
attente -> explose -> attente -> retour au calme -> Taro normal. Toutes les images sont rendues avant."""
import os, subprocess, sys
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
B = f'{ICI}/out/vid2'
T = 720


def rend(fichier, dossier, taille):
    if not os.path.isdir(dossier) or not os.listdir(dossier):
        subprocess.run(['node', f'{ICI}/render.js', fichier, dossier, 'all', str(taille), '#FFFAF5'], check=True)
    return [os.path.join(dossier, f) for f in sorted(os.listdir(dossier))]


def main():
    os.makedirs(f'{B}/seq', exist_ok=True)
    for f in os.listdir(f'{B}/seq'):
        os.remove(f'{B}/seq/{f}')
    normal = rend(f'{ICI}/idle.json', f'{B}/normal', 540)            # idle d'origine de l'app
    attente = rend(f'{ICI}/livrable/taro_rouge_attente.json', f'{B}/attente', 540)
    reac = {n: rend(f'{ICI}/livrable/taro_rouge_{n}.json', f'{B}/{n}', T)
            for n in ('bascule', 'crie', 'pleure', 'explose', 'calme')}
    k = [0]

    def put(im):
        im.save(f'{B}/seq/{k[0]:05d}.png')
        k[0] += 1

    def petit(chemin):
        im = Image.open(chemin).convert('RGB')
        c = Image.new('RGB', (T, T), (255, 250, 245))
        c.paste(im, (90, 180))
        return c

    for i in range(90):
        put(petit(normal[i % len(normal)]))
    for n, suite in (('bascule', 75), ('crie', 45), ('pleure', 45), ('explose', 75), ('calme', 0)):
        for f in reac[n]:
            put(Image.open(f).convert('RGB'))
        for i in range(suite):
            put(petit(attente[i % len(attente)]))
    for i in range(60):
        put(petit(normal[i % len(normal)]))
    sortie = f'{ICI}/out/taro_rouge_parcours.mp4'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '30', '-i', f'{B}/seq/%05d.png',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', sortie], check=True)
    print(k[0], 'images ->', sortie)


if __name__ == '__main__':
    main()
