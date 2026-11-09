# A fitted field scored on a view it wasn't fitted to, by measures that can tell (python3
# cells/lab/devtools/splats-field-score.py): what each field drew of the held-out view (the fitters' --dump) against
# the teacher's drawing of it, by tone (blurred darkness at three scales) and by decisions (ink along each edge, tone
# on each face: splats-field-measure.py), beside blank paper and beside another hand's drawing of the same view (how
# near an independent execution comes: about the best a field taught by one hand could be asked to do).
import json, glob, importlib.util, numpy as np
from PIL import Image
base = __file__.rsplit('/', 1)[0]
spec = importlib.util.spec_from_file_location('measure', f'{base}/splats-field-measure.py'); Mz = importlib.util.module_from_spec(spec); spec.loader.exec_module(Mz)
up = lambda C, w, h: np.asarray(Image.fromarray((np.clip(C, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
def tone(a, b): return float(np.mean([((Mz.blur(a, r) - Mz.blur(b, r)) ** 2).mean() for r in (2, 5, 10)])) * 1000
def dec(a, b, view):
  x, y = Mz.decisions(a, view), Mz.decisions(b, view); ks = sorted(set(x) | set(y)); X = np.array([x.get(k, 0) for k in ks]); Y = np.array([y.get(k, 0) for k in ks])
  return float(((X - Y) ** 2).mean()) * 1000, float(np.corrcoef(X, Y)[0, 1]) if X.std() > 0 and Y.std() > 0 else 0.0
rows = []
for f in sorted(glob.glob(f'{base}/out/field/dump-*.json')):
  d = json.load(open(f)); C = np.array(d['C'], np.float32).reshape(d['h'], d['w']); st, v = d['style'], d['view']
  T = Mz.darkness(st, v); Ts, Cs, Cb = Mz.small(T), up(C, 192, 128), up(C, 1024, 683)
  de, r = dec(Cb, T, v)
  rows.append((f.split('dump-')[1].replace('.json', ''), tone(Cs, Ts), de, r, st, v))
print(f'{"what drew the held-out view":44s} {"tone":>7s} {"decisions":>10s} {"agreement":>10s}')
seen = set()
for name, t, de, r, st, v in rows:
  if (st, v) not in seen:
    seen.add((st, v)); T = Mz.darkness(st, v); Ts = Mz.small(T)
    de0, _ = dec(np.zeros_like(T), T, v); print(f'{"blank paper (" + st + ", " + v + ")":44s} {tone(np.zeros_like(Ts), Ts):7.2f} {de0:10.1f} {"":>10s}')
    for o in ['sumi', 'sumi-bold', 'sumi-light']:
      if o != st: O = Mz.darkness(o, v); deo, ro = dec(O, T, v); print(f'{"another hand (" + o + ")":44s} {tone(Mz.small(O), Ts):7.2f} {deo:10.1f} {ro:10.2f}')
  print(f'{name:44s} {t:7.2f} {de:10.1f} {r:10.2f}')
