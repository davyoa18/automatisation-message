import sys, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0,'.'); sys.path.insert(0,'corps')
import numpy as np, corps as C, compo
from scipy import ndimage as ndi
P = C.pieces_corps()
np.savez_compressed('out/zz/pieces_corps.npz', **P)
T = C.torse_rig()
rest = compo.pose({k: v for k, v in P.items() if k != 'raccord_g'}, C)   # raccord_g : invisible au repos
a=T[...,3:4]; orig=np.ones((1254,1254,3),np.float32)*np.array([1.0,0.98,0.96]); orig=orig*(1-a)+T[...,:3]*a
d=np.abs(rest-orig).max(2)
print('ecart max', round(float(d.max()),3), '>0.02:', int((d>0.02).sum()), '>0.1:', int((d>0.1).sum()))
