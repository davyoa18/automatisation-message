"""Briques Lottie (bodymovin 5.7) : proprietes animees, calques, formes. Compatible lottie-web et lottie-ios."""
import base64
import numpy as np

EASE = {
    'lin':    (0.0, 0.0, 1.0, 1.0),
    'doux':   (0.42, 0.0, 0.58, 1.0),
    'sortie': (0.10, 0.0, 0.35, 1.0),   # part vite, se pose en douceur
    'entree': (0.62, 0.0, 0.95, 1.0),   # accelere jusqu'au bout (chute, avant impact)
    'vif':    (0.24, 0.0, 0.30, 1.0),
    'mou':    (0.33, 0.0, 0.67, 1.0),
    'elan':   (0.55, 0.0, 0.25, 1.0),
}


def _arr(v):
    if isinstance(v, (list, tuple, np.ndarray)):
        return [round(float(x), 4) for x in v]
    return [round(float(v), 4)]


def prop(keys, statique=None, hold=False):
    """keys : liste de (t, valeur, ease) ; valeur scalaire ou vecteur. Renvoie la propriete Lottie."""
    if not keys:
        return {'a': 0, 'k': statique if not isinstance(statique, np.ndarray) else statique.tolist()}
    keys = sorted(keys, key=lambda k: k[0])
    if len(keys) == 1:
        v = keys[0][1]
        return {'a': 0, 'k': (_arr(v) if isinstance(v, (list, tuple, np.ndarray)) else round(float(v), 4))}
    out = []
    for n, k in enumerate(keys):
        t, v = k[0], k[1]
        e = k[2] if len(k) > 2 else 'doux'
        d = {'t': round(float(t), 3), 's': _arr(v)}
        if n < len(keys) - 1:
            if hold or e == 'hold':
                d['h'] = 1
            else:
                x1, y1, x2, y2 = EASE[e] if isinstance(e, str) else e
                d['o'] = {'x': [x1], 'y': [y1]}
                d['i'] = {'x': [x2], 'y': [y2]}
        out.append(d)
    return {'a': 1, 'k': out}


def prop_chemin(keys):
    """keys : liste de (t, Chemin, ease). Morphing de trace."""
    keys = sorted(keys, key=lambda k: k[0])
    if len(keys) == 1:
        return {'a': 0, 'k': keys[0][1].lottie()}
    out = []
    for n, k in enumerate(keys):
        t, ch = k[0], k[1]
        e = k[2] if len(k) > 2 else 'doux'
        d = {'t': round(float(t), 3), 's': [ch.lottie()]}
        if n < len(keys) - 1:
            if e == 'hold':
                d['h'] = 1
            else:
                x1, y1, x2, y2 = EASE[e] if isinstance(e, str) else e
                d['o'] = {'x': [x1], 'y': [y1]}
                d['i'] = {'x': [x2], 'y': [y2]}
        out.append(d)
    return {'a': 1, 'k': out}


def ks(p=None, a=None, s=None, r=None, o=None):
    return {
        'o': o if o is not None else {'a': 0, 'k': 100},
        'r': r if r is not None else {'a': 0, 'k': 0},
        'p': p if p is not None else {'a': 0, 'k': [0, 0, 0]},
        'a': a if a is not None else {'a': 0, 'k': [0, 0, 0]},
        's': s if s is not None else {'a': 0, 'k': [100, 100, 100]},
    }


def calque_null(nm, ind, ip, op, ks_, parent=None):
    d = {'ddd': 0, 'ind': ind, 'ty': 3, 'nm': nm, 'sr': 1, 'ks': ks_, 'ao': 0,
         'ip': ip, 'op': op, 'st': 0, 'bm': 0}
    if parent is not None:
        d['parent'] = parent
    return d


def calque_image(nm, ind, ip, op, ref, ks_, parent=None):
    d = {'ddd': 0, 'ind': ind, 'ty': 2, 'nm': nm, 'refId': ref, 'sr': 1, 'ks': ks_, 'ao': 0,
         'ip': ip, 'op': op, 'st': 0, 'bm': 0}
    if parent is not None:
        d['parent'] = parent
    return d


def calque_forme(nm, ind, ip, op, formes, ks_=None, parent=None):
    d = {'ddd': 0, 'ind': ind, 'ty': 4, 'nm': nm, 'sr': 1, 'ks': ks_ or ks(), 'ao': 0,
         'shapes': formes, 'ip': ip, 'op': op, 'st': 0, 'bm': 0}
    if parent is not None:
        d['parent'] = parent
    return d


def tr(p=(0, 0), a=(0, 0), s=(100, 100), r=0, o=100):
    def P(v):
        return v if isinstance(v, dict) else {'a': 0, 'k': list(v) if hasattr(v, '__len__') else v}
    return {'ty': 'tr', 'p': P(p), 'a': P(a), 's': P(s), 'r': P(r), 'o': P(o),
            'sk': {'a': 0, 'k': 0}, 'sa': {'a': 0, 'k': 0}, 'nm': 'Transform'}


def groupe(nm, items, transform=None):
    return {'ty': 'gr', 'nm': nm, 'it': list(items) + [transform or tr()], 'np': len(items), 'cix': 2,
            'bm': 0, 'ix': 1, 'hd': False}


def trace(ks_path, nm='trace'):
    return {'ty': 'sh', 'nm': nm, 'ks': ks_path, 'ind': 0, 'ix': 1, 'hd': False}


def rempli(c, o=100):
    oo = o if isinstance(o, dict) else {'a': 0, 'k': o}
    return {'ty': 'fl', 'nm': 'Fond', 'c': {'a': 0, 'k': [float(c[0]), float(c[1]), float(c[2]), 1]},
            'o': oo, 'r': 1, 'bm': 0, 'hd': False}


def trait(c, w, o=100):
    ww = w if isinstance(w, dict) else {'a': 0, 'k': w}
    oo = o if isinstance(o, dict) else {'a': 0, 'k': o}
    return {'ty': 'st', 'nm': 'Contour', 'c': {'a': 0, 'k': [float(c[0]), float(c[1]), float(c[2]), 1]},
            'o': oo, 'w': ww, 'lc': 2, 'lj': 2, 'ml': 4, 'bm': 0, 'hd': False}


def coupe(s=None, e=None, o=None):
    def P(v, d):
        return v if isinstance(v, dict) else {'a': 0, 'k': d if v is None else v}
    return {'ty': 'tm', 'nm': 'Coupe', 's': P(s, 0), 'e': P(e, 100), 'o': P(o, 0), 'm': 1, 'hd': False}


def asset_png(ident, chemin, w, h):
    b64 = base64.b64encode(open(chemin, 'rb').read()).decode()
    return {'id': ident, 'w': int(w), 'h': int(h), 'u': '', 'p': 'data:image/png;base64,' + b64, 'e': 1}
