# The scene's edges and faces as places marks can be organised on (python3 cells/lab/devtools/splats-marks-geo.py):
# for each entry a drawing is measured by (splats-field-measure.py: creases, lines, faces), its geometry in the scene:
# a crease as a polyline with the normal a stroke on it should lie in (between its two faces' normals, each faced away
# from its object's middle); a line (the seam, a culm's nodes, the niche) as its polyline(s); a face as its triangles
# and normal. Writes devtools/out/field/marks-geo.json, which devtools/splats-marks-fit.mjs builds its marks from.
import json, importlib.util, numpy as np
base = __file__.rsplit('/', 1)[0]
spec = importlib.util.spec_from_file_location('measure', f'{base}/splats-field-measure.py'); Mz = importlib.util.module_from_spec(spec); spec.loader.exec_module(Mz)
T = Mz.T; norm = lambda a: a / (np.linalg.norm(a) + 1e-12)
omid = {int(o): T[Mz.OBJ == o].reshape(-1, 3).mean(0) for o in set(Mz.OBJ)}
F = []
for f, (o, n, d) in enumerate(Mz.faces):
  tr = T[Mz.face_of == f]; c = tr.reshape(-1, 3).mean(0); out = c - omid[int(o)]
  if abs(n[1]) < 0.5: out = np.array([out[0], 0, out[2]])
  F.append({'obj': int(o), 'n': n if np.dot(n, out) >= 0 else -n, 'tris': tr})
r4 = lambda p: [round(float(c), 4) for c in p]
out = []
pairs = {}
for (a, b), ts in Mz.edges.items():
  if len(ts) != 2: continue
  f1, f2 = sorted((int(Mz.face_of[ts[0]]), int(Mz.face_of[ts[1]])))
  if f1 != f2 and abs(np.dot(Mz.N[ts[0]], Mz.N[ts[1]])) < np.cos(np.radians(40)): pairs.setdefault((f1, f2), []).append((np.array(a), np.array(b)))
for (f1, f2), segs in pairs.items():
  # (its points in order along it: sorted along its longest direction)
  pts = np.unique(np.round(np.array([p for s in segs for p in s]), 4), axis=0); d = pts - pts.mean(0); w, v = np.linalg.eigh(d.T @ d); pts = pts[np.argsort(d @ v[:, -1])]
  if len(pts) == 2: pts = np.array([pts[0] + (pts[1] - pts[0]) * k / 4 for k in range(5)])
  n = norm(F[f1]['n'] + F[f2]['n'])
  out.append({'name': f'crease {f1}-{f2}', 'kind': 'crease', 'obj': F[f1]['obj'], 'mid': r4(omid[F[f1]['obj']]), 'spine': [r4(p) for p in pts], 'normal': r4(n), 'length': round(float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()), 4)})
groups = {}
for L in Mz.M['lines']: groups.setdefault(L['name'], []).append(L['pts'])
for name, ls in groups.items():
  c = np.mean([p for l in ls for p in l], 0); o = int(min(omid, key=lambda k: np.hypot(omid[k][0] - c[0], omid[k][2] - c[2])))
  out.append({'name': f'line {name}', 'kind': 'line', 'obj': o, 'mid': r4(omid[o]), 'spines': [[r4(p) for p in l] for l in ls]})
for f, face in enumerate(F):
  area = float(sum(np.linalg.norm(np.cross(t[1] - t[0], t[2] - t[0])) / 2 for t in face['tris']))
  out.append({'name': f'face {f}', 'kind': 'face', 'obj': face['obj'], 'mid': r4(omid[face['obj']]), 'normal': r4(face['n']), 'area': round(area, 4), 'tris': [[r4(p) for p in t] for t in face['tris']]})
json.dump(out, open(f'{base}/out/field/marks-geo.json', 'w'))
print(len(out), 'entries:', sum(e['kind'] == 'crease' for e in out), 'creases,', sum(e['kind'] == 'line' for e in out), 'lines,', sum(e['kind'] == 'face' for e in out), 'faces')
