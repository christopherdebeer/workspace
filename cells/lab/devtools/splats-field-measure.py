# Which measure can see what drawn teachers share? (python3 cells/lab/devtools/splats-field-measure.py)
#
# The restyled wireframe sheets (devtools/field-teachers/<style>/<view>.jpg) are independent drawings of the same
# geometry: two executions of one view put their strokes in different places, so by pixel error they disagree almost
# as much as either does with blank paper, and no model fitted to pixels can be told from another. A measure is only
# worth optimising if it passes a validity test: given one execution's drawing of a view, it should pick out the same
# view among another execution's six (chance 1 in 6), and score it far nearer than blank paper.
#
# Three candidates:
# - pixel: mean squared error of darkness at 192 x 128 (what the fields have been fitted and judged by);
# - tone: the same after blurring both (the mass of tone, at three scales);
# - decisions: the drawing projected onto the scene's known geometry (wire-mesh.json): for each edge in sight (the
#   meshes' creases, each object's silhouette, the seam, the culms' nodes, the niche), how much ink lies along it; for
#   each face in sight, how much tone is on it; and the ground's tone near each object (its cast shadow). A drawing
#   becomes a short vector of decisions, the same entries for every execution.
#
# Writes devtools/out/field/decisions.json (every teacher's decisions, with each entry's name) and prints the test.
import json, itertools, numpy as np
from PIL import Image, ImageFilter
base = __file__.rsplit('/', 1)[0]
M = json.load(open(f'{base}/out/field/wire-mesh.json'))
T = np.array(M['tris'], float).reshape(-1, 3, 3); OBJ = np.array(M['objects']).reshape(-1, 3)[:, 0]
STYLES = ['sumi', 'sumi-bold', 'sumi-light', 'pen-wash', 'engraved', 'watercolour', 'shadowed']; VIEWS = [c['name'] for c in M['cams']]
W, H = 1024, 683
def norm(a): return a / (np.linalg.norm(a, axis=-1, keepdims=True) + 1e-12)
N = norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]))
# (faces: an object's triangles in one plane)
face_of = -np.ones(len(T), int); faces = []
for t in range(len(T)):
  for f, (o, n, d) in enumerate(faces):
    if o == OBJ[t] and abs(np.dot(n, N[t])) > 0.999 and abs(np.dot(n, T[t, 0]) - d) < 0.01: face_of[t] = f; break
  else: faces.append((OBJ[t], N[t], float(np.dot(N[t], T[t, 0])))); face_of[t] = len(faces) - 1
key = lambda p: tuple(np.round(p, 3))
edges = {}
for t in range(len(T)):
  for a, b in ((0, 1), (1, 2), (2, 0)): edges.setdefault(tuple(sorted((key(T[t, a]), key(T[t, b])))), []).append(t)

def darkness(style, view):
  a = np.asarray(Image.open(f'{base}/field-teachers/{style}/{view}.jpg').convert('L'), dtype=np.float32) / 255
  paper, ink = np.percentile(a, 85), np.percentile(a, 0.5)
  D = np.clip((paper - a) / (paper - ink + 1e-6), 0, 1); D[:50, :130] = 0
  return D
def blur(a, r): return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255
def small(D): return np.asarray(Image.fromarray((D * 255).astype(np.uint8)).resize((192, 128), Image.LANCZOS), dtype=np.float32) / 255

# ─── each view's geometry on the screen: the faces' ids, and each edge's seen samples ───
GEO = {}
def _build_geo():
  for cam in M['cams']:
    E = np.array(cam['eye']); f = norm(np.array(cam['target']) - E); r = norm(np.cross(f, [0, 1, 0])); u = np.cross(r, f); fy = H / (2 * np.tan(cam['fov'] / 2))
    def proj(P, E=E, f=f, r=r, u=u, fy=fy):
      q = np.asarray(P) - E; z = q @ f
      return np.stack([W / 2 + fy * (q @ r) / z, H / 2 - fy * (q @ u) / z, z], -1)
    zb = np.full((H, W), np.inf); fid = -np.ones((H, W), int)
    for t in range(len(T)):
      s = proj(T[t])
      if (s[:, 2] < 0.05).any(): continue
      x0, x1 = int(max(0, np.floor(s[:, 0].min()))), int(min(W - 1, np.ceil(s[:, 0].max()))); y0, y1 = int(max(0, np.floor(s[:, 1].min()))), int(min(H - 1, np.ceil(s[:, 1].max())))
      if x1 < x0 or y1 < y0: continue
      ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
      (ax, ay, az), (bx, by, bz), (cx, cy, cz) = s; den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if abs(den) < 1e-9: continue
      l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den; l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den; l3 = 1 - l1 - l2
      z = l1 * az + l2 * bz + l3 * cz; hit = (l1 >= 0) & (l2 >= 0) & (l3 >= 0) & (z < zb[y0:y1 + 1, x0:x1 + 1])
      zb[y0:y1 + 1, x0:x1 + 1] = np.where(hit, z, zb[y0:y1 + 1, x0:x1 + 1]); fid[y0:y1 + 1, x0:x1 + 1] = np.where(hit, face_of[t], fid[y0:y1 + 1, x0:x1 + 1])
    def seen(P):
      P = np.asarray(P, float); pts = np.concatenate([P[i] + (P[i + 1] - P[i]) * np.linspace(0, 1, 9)[:-1, None] for i in range(len(P) - 1)] + [P[-1:]])
      s = proj(pts); out = []
      for x, y, z in s:
        ix, iy = int(x), int(y)
        if z > 0.05 and 0 <= ix < W and 0 <= iy < H and z <= zb[iy, ix] + max(0.015, 0.006 * z): out.append((x, y))
      return np.array(out)
    view = lambda t, E=E: (E - T[t, 0]) @ N[t]
    E_ = {}
    for k, ts in edges.items():
      a, b = np.array(k[0]), np.array(k[1])
      if len(ts) < 2: continue
      f1, f2 = sorted((face_of[ts[0]], face_of[ts[1]]))
      if f1 == f2: continue
      crease = abs(np.dot(N[ts[0]], N[ts[1]])) < np.cos(np.radians(40)); sil = (view(ts[0]) > 0) != (view(ts[1]) > 0)
      if not (crease or sil): continue
      # (a crease is its own entry, named by its two faces; a smooth object's silhouette (a culm's) is one entry an object)
      name = f'crease {f1}-{f2}' if crease else f'silhouette obj{OBJ[ts[0]]}'
      p = seen([a, b])
      if len(p): E_.setdefault(name, []).append(p)
    nodes = {}
    for L in M['lines']:
      p = seen(L['pts'])
      if len(p): nodes.setdefault(L['name'], []).append(p)
    for nm, ps in nodes.items(): E_[f'line {nm}'] = ps
    GEO[cam['name']] = {'fid': fid.astype(np.int16), 'edges': {k: np.concatenate(v) for k, v in E_.items()}}
# (the views' geometry is slow to rasterise and never changes with the drawing: kept on disk, keyed by the mesh's time)
import os, pickle
_cache = f'{base}/out/field/geo-cache.pkl'; _stamp = os.path.getmtime(f'{base}/out/field/wire-mesh.json')
OBJ_OF_FACE = np.array([o for o, _, _ in faces])
def _masks(g):
  # (the regions a drawing is measured in, which depend only on the geometry: inside the objects away from their outline;
  # the ground near them; each object's body)
  fid = g['fid']; allm = fid >= 0; im = lambda m: Image.fromarray((m * 255).astype(np.uint8))
  g['inside'] = np.asarray(im(allm).filter(ImageFilter.MinFilter(17))) > 0
  g['ground'] = (np.asarray(im(allm).filter(ImageFilter.MaxFilter(101))) > 0) & ~allm & ~(np.asarray(im(allm).filter(ImageFilter.MaxFilter(13))) > 0)
  oid = np.where(allm, OBJ_OF_FACE[np.clip(fid, 0, None)], 0)
  g['body'] = {int(o): np.asarray(im(oid == o).filter(ImageFilter.MinFilter(9))) > 0 for o in np.unique(OBJ_OF_FACE)}
_VERSION = 2
try:
  _c = pickle.load(open(_cache, 'rb')); assert _c['stamp'] == _stamp and _c.get('v') == _VERSION; GEO.update(_c['geo'])
except Exception:
  _build_geo()
  for _g in GEO.values(): _masks(_g)
  pickle.dump({'stamp': _stamp, 'v': _VERSION, 'geo': GEO}, open(_cache, 'wb'))
_ANN = np.array([(dx, dy) for dx in range(-14, 15) for dy in range(-14, 15) if 9 <= np.hypot(dx, dy) <= 14])
def extras(D, view):
  '''What a fit needs beyond the decisions: for each edge, its ink and its weight in excess of the tone round it (so a
  wash's edge isn't taken for a stroke: `inkx`, the darkest within 5 px less the darker side's tone; `mass`, the mean
  within 5 px less the mean round it); for each face, each object's body and the ground, the tone's mean and its peak.'''
  g = GEO[view]; fid = g['fid']; out = {}
  Dm = np.asarray(Image.fromarray((D * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(11)), dtype=np.float32) / 255
  Db = np.asarray(Image.fromarray((D * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(5)), dtype=np.float32) / 255
  for name, p in g['edges'].items():
    if len(p) < 6: continue
    ix = np.clip(p[:, 0].astype(int), 0, W - 1); iy = np.clip(p[:, 1].astype(int), 0, H - 1)
    ann = D[np.clip(iy[:, None] + _ANN[None, :, 1], 0, H - 1), np.clip(ix[:, None] + _ANN[None, :, 0], 0, W - 1)]
    k75 = int(ann.shape[1] * 0.75)
    out[name] = {'ink': float(Dm[iy, ix].mean()), 'inkx': float(np.maximum(0, Dm[iy, ix] - np.partition(ann, k75, axis=1)[:, k75]).mean()), 'mass': float(np.maximum(0, Db[iy, ix] - ann.mean(1)).mean())}
  for f in np.unique(fid[fid >= 0]):
    m = (fid == f) & g['inside']
    if m.sum() > 400: out[f'face {f}'] = {'mean': float(D[m].mean()), 'peak': float(np.percentile(D[m], 90))}
  for o, m in g['body'].items():
    if m.sum() > 300: out[f'body obj{o}'] = {'mean': float(D[m].mean()), 'peak': float(np.percentile(D[m], 90))}
  if g['ground'].sum() > 400: out['ground'] = {'mean': float(D[g['ground']].mean()), 'peak': float(np.percentile(D[g['ground']], 97))}
  return out

def decisions(D, view):
  g = GEO[view]; out = {}
  # (ink along an edge: at each seen sample, the darkest within 5 px, averaged; a stroke anywhere on it counts)
  Dm = np.asarray(Image.fromarray((D * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(11)), dtype=np.float32) / 255
  for name, p in g['edges'].items():
    if len(p) < 6: continue
    out[name] = float(Dm[np.clip(p[:, 1].astype(int), 0, H - 1), np.clip(p[:, 0].astype(int), 0, W - 1)].mean())
  # (tone on a face: its inside, away from its edges; the ground's tone near the objects (their shadows))
  inside = g['inside']
  for f in np.unique(g['fid'][g['fid'] >= 0]):
    m = (g['fid'] == f) & inside
    if m.sum() > 400: out[f'face {f}'] = float(D[m].mean())
  ground = g['ground']
  ys = np.where(ground.any(1))[0]
  if len(ys): out['ground, lower'] = float(D[ground & (np.arange(H)[:, None] > np.median(ys))].mean()); out['ground, upper'] = float(D[ground & (np.arange(H)[:, None] <= np.median(ys))].mean())
  return out

SM = {}; DEC = {}
if __name__ == '__main__':
  Dk = {(s, v): darkness(s, v) for s in STYLES for v in VIEWS}
  DEC.update({(s, v): decisions(Dk[(s, v)], v) for s in STYLES for v in VIEWS})
  json.dump({f'{s}/{v}': DEC[(s, v)] for s in STYLES for v in VIEWS}, open(f'{base}/out/field/decisions.json', 'w'), indent=0)

  # ─── the measures ───
  SM.update({k: small(d) for k, d in Dk.items()})
  def m_pixel(a, b): return float(((SM[a] - SM[b]) ** 2).mean())
  def m_tone(a, b): return float(np.mean([((blur(SM[a], r) - blur(SM[b], r)) ** 2).mean() for r in (2, 5, 10)]))
  def m_dec(a, b):
    # (over the entries either has; one only the other view has counts as 0 here: it isn't in sight)
    ks = sorted(set(DEC[a]) | set(DEC[b])); x = np.array([DEC[a].get(k, 0) for k in ks]); y = np.array([DEC[b].get(k, 0) for k in ks])
    return float(((x - y) ** 2).mean())
  BLANK = {'pixel': lambda a: float((SM[a] ** 2).mean()), 'tone': lambda a: float(np.mean([(blur(SM[a], r) ** 2).mean() for r in (2, 5, 10)])), 'decisions': lambda a: float(np.mean(np.array(list(DEC[a].values())) ** 2))}
  MEAS = {'pixel': m_pixel, 'tone': m_tone, 'decisions': m_dec}

  def test(styles, label):
    print(f'\n{label} ({len(styles)} executions, {len(VIEWS)} views)')
    print(f'  {"measure":10s} {"finds the view":>15s} {"same view":>10s} {"other view":>11s} {"blank":>8s} {"same / blank":>13s}')
    for nm, m in MEAS.items():
      hit = n = 0; same = []; other = []; blank = []
      for s, t in itertools.permutations(styles, 2):
        for v in VIEWS:
          d = {w: m((s, v), (t, w)) for w in VIEWS}
          hit += min(d, key=d.get) == v; n += 1; same.append(d[v]); other += [d[w] for w in VIEWS if w != v]; blank.append(BLANK[nm]((s, v)))
      print(f'  {nm:10s} {hit:7d} of {n:3d} {np.mean(same) * 1000:10.2f} {np.mean(other) * 1000:11.2f} {np.mean(blank) * 1000:8.2f} {np.mean(same) / np.mean(blank):13.2f}')
  test(['sumi', 'sumi-bold', 'sumi-light'], 'three sumi executions')
  test(STYLES, 'all seven restyles')
  n_e = np.mean([sum(k.startswith(('crease', 'silhouette', 'line')) for k in d) for d in DEC.values()]); n_f = np.mean([sum(k.startswith(('face', 'ground')) for k in d) for d in DEC.values()])
  print(f'\na drawing as decisions: about {n_e:.0f} edges and {n_f:.0f} tones a view')
  # (do executions agree on the decisions themselves? the correlation of two executions' entries, same view)
  for grp, nm in ((['sumi', 'sumi-bold', 'sumi-light'], 'sumi executions'), (STYLES, 'all restyles')):
    cs = []
    for s, t in itertools.combinations(grp, 2):
      for v in VIEWS:
        ks = sorted(set(DEC[(s, v)]) & set(DEC[(t, v)])); x = np.array([DEC[(s, v)][k] for k in ks]); y = np.array([DEC[(t, v)][k] for k in ks])
        if x.std() > 0 and y.std() > 0: cs.append(np.corrcoef(x, y)[0, 1])
    print(f'  agreement on the decisions, {nm}: correlation {np.mean(cs):.2f} (from {np.min(cs):.2f} to {np.max(cs):.2f})')
