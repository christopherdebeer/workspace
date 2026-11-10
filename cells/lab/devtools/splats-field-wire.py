# Draws the wireframes (run by splats-field-wire.mjs): per view, the meshes' creases (faces meeting at more than 40°)
# and silhouettes (a face toward the eye beside one away), the seam and the culms' nodes, each line kept only where it's
# seen (a depth buffer of the meshes), the ground's horizon faint; black on white, 1024 × 683.
import json, numpy as np
from PIL import Image, ImageDraw
base = __file__.rsplit('/', 1)[0]
M = json.load(open(f'{base}/out/field/wire-mesh.json'))
T = np.array(M['tris'], float).reshape(-1, 3, 3)
def norm(a): return a / (np.linalg.norm(a, axis=-1, keepdims=True) + 1e-12)
N = norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]))
# (each edge's faces, by its endpoints rounded)
key = lambda p: tuple(np.round(p, 3))
edges = {}
for t in range(len(T)):
  for a, b in ((0, 1), (1, 2), (2, 0)):
    k = tuple(sorted((key(T[t, a]), key(T[t, b]))))
    edges.setdefault(k, []).append(t)
out = []
for cam in M['cams']:
  W, H = cam['w'], cam['h']; E = np.array(cam['eye']); f = norm(np.array(cam['target']) - E); r = norm(np.cross(f, [0, 1, 0])); u = np.cross(r, f); fy = H / (2 * np.tan(cam['fov'] / 2))
  def proj(P):
    q = np.asarray(P) - E; z = q @ f
    return np.stack([W / 2 + fy * (q @ r) / z, H / 2 - fy * (q @ u) / z, z], -1)
  # (the depth buffer)
  zb = np.full((H, W), np.inf)
  for t in range(len(T)):
    s = proj(T[t])
    if (s[:, 2] < 0.05).any(): continue
    x0, x1 = int(max(0, np.floor(s[:, 0].min()))), int(min(W - 1, np.ceil(s[:, 0].max()))); y0, y1 = int(max(0, np.floor(s[:, 1].min()))), int(min(H - 1, np.ceil(s[:, 1].max())))
    if x1 < x0 or y1 < y0: continue
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = s
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-9: continue
    l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den; l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den; l3 = 1 - l1 - l2
    inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0); z = l1 * az + l2 * bz + l3 * cz
    sub = zb[y0:y1 + 1, x0:x1 + 1]; np.copyto(sub, np.where(inside & (z < sub), z, sub))
  im = Image.new('L', (W, H), 255); d = ImageDraw.Draw(im)
  # (the horizon, faint: where the ground meets the sky)
  hz = H / 2 - fy * (np.array([0, 0, 0]) - E + f * 1e4) @ u / ((f * 1e4) @ f)
  d.line([(0, hz), (W, hz)], fill=215, width=1)
  def seen_segments(P, width, fill):
    # (a polyline cut where it's hidden: sampled finely, each sample tested against the depth buffer)
    P = np.asarray(P, float); pts = []
    for i in range(len(P) - 1):
      for k in range(8): pts.append(P[i] + (P[i + 1] - P[i]) * k / 8)
    pts.append(P[-1]); s = proj(np.array(pts)); run = []
    for x, y, z in s:
      ix, iy = int(x), int(y); vis = z > 0.05 and 0 <= ix < W and 0 <= iy < H and z <= zb[iy, ix] + max(0.015, 0.006 * z)
      if vis: run.append((x, y))
      elif len(run) > 1: d.line(run, fill=fill, width=width); run = []
      else: run = []
    if len(run) > 1: d.line(run, fill=fill, width=width)
  view = lambda t: (E - T[t, 0]) @ N[t]
  for k, ts in edges.items():
    a, b = np.array(k[0]), np.array(k[1])
    if len(ts) == 1: seen_segments([a, b], 2, 0); continue
    n1, n2 = N[ts[0]], N[ts[1]]; crease = np.dot(n1, n2) < np.cos(np.radians(40)); sil = (view(ts[0]) > 0) != (view(ts[1]) > 0)
    if crease or sil: seen_segments([a, b], 2, 0)
  for L in M['lines']: seen_segments(L['pts'], 2 if L['name'] == 'seam' else 2, 0)
  im.save(f'{base}/out/field/wire-{cam["name"]}.png')
  out.append({k: cam[k] for k in ('name', 'yaw', 'pitch', 'dist', 'target', 'eye', 'fov', 'up', 'w', 'h')} | {'file': f'wire-{cam["name"]}.png'})
  print(f'wire-{cam["name"]}.png')
json.dump(out, open(f'{base}/out/field/wires.json', 'w'), indent=1)
