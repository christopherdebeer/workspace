# What a fit of the brush to a teacher is measured by (python3 cells/lab/devtools/splats-taught-measure.py
# targets <teacher> | measure <grabs.json>): a teacher's drawings, or the brush's renders of the same views, as the
# measures of splats-field-measure.py `extras`, each entry averaged over the views it's in sight, the right view left
# out (kept for scoring). For a teacher, also how much it inks an interior crease against one on the outline (`inner`).
# Prints JSON: { entries: { name: { ink, inkx, mass } | { mean, peak } }, inner }.
import json, sys, importlib.util, numpy as np
base = __file__.rsplit('/', 1)[0]
spec = importlib.util.spec_from_file_location('measure', f'{base}/splats-field-measure.py'); Mz = importlib.util.module_from_spec(spec); spec.loader.exec_module(Mz)
TRAIN = [v for v in Mz.VIEWS if v != 'right']
def average(per_view):
  out = {}
  for name in sorted({n for d in per_view.values() for n in d}):
    ds = [d[name] for d in per_view.values() if name in d]
    out[name] = {k: round(float(np.mean([d[k] for d in ds])), 4) for k in ds[0]}
  return out
mode = sys.argv[1]
if mode == 'targets':
  teacher = sys.argv[2]; per = {v: Mz.extras(Mz.darkness(teacher, v), v) for v in TRAIN}
  # (interior against outline: a crease is on the outline from a view if one of its faces is turned to the eye and the
  # other away; the faces' normals faced away from their object's middle)
  T = Mz.T; norm = lambda a: a / (np.linalg.norm(a) + 1e-12); omid = {o: T[Mz.OBJ == o].reshape(-1, 3).mean(0) for o in set(Mz.OBJ)}
  F = []
  for f, (o, n, d) in enumerate(Mz.faces):
    c = T[Mz.face_of == f].reshape(-1, 3).mean(0); out = c - omid[o]
    if abs(n[1]) < 0.5: out = np.array([out[0], 0, out[2]])
    F.append((n if np.dot(n, out) >= 0 else -n, c))
  on, off = [], []
  for v in TRAIN:
    E = np.array(next(c for c in Mz.M['cams'] if c['name'] == v)['eye'])
    for name, m in per[v].items():
      if not name.startswith('crease'): continue
      f1, f2 = (int(x) for x in name.split(' ')[1].split('-')); a1 = np.dot(F[f1][0], norm(E - F[f1][1])); a2 = np.dot(F[f2][0], norm(E - F[f2][1]))
      (on if (a1 > 0) != (a2 > 0) else off).append(m['inkx'])
  print(json.dumps({'entries': average(per), 'inner': round(float(np.clip(np.mean(off) / max(1e-6, np.mean(on)), 0, 1)), 3), 'outline': round(float(np.mean(on)), 3), 'interior': round(float(np.mean(off)), 3)}))
else:
  G = json.load(open(sys.argv[2])); per = {}
  for v, g in G.items():
    D = np.array(g['C'], np.float32).reshape(g['h'], g['w'])
    if D.shape != (Mz.H, Mz.W):
      from PIL import Image
      D = np.asarray(Image.fromarray((D * 255).astype(np.uint8)).resize((Mz.W, Mz.H), Image.BICUBIC), dtype=np.float32) / 255
    per[v] = Mz.extras(D, v)
  print(json.dumps({'entries': average(per)}))
