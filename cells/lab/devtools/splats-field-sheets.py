# Restyled wireframe sheets in as teachers (python3 cells/lab/devtools/splats-field-sheets.py <sheet.png> <style>): a
# sheet of the six wireframe views (ref, left / right, far-left / far-right, high), each redrawn by an image model in a
# style with its geometry kept. Each panel is cut out at the sheet's dark separators, its red label masked, then aligned
# to its wireframe (devtools/out/field/wire-<view>.png) by a small search over scale and shift (the darkness against
# the wire lines, both blurred), and written:
# - devtools/field-teachers/<style>/<view>.jpg, the aligned panel at 1024 × 683 (kept: the teacher itself);
# - devtools/out/field/ref-<style>-<view>.json, its darkness at the field's 192 × 128 with the view's camera.
import json, sys, os, numpy as np
from PIL import Image, ImageFilter
sheet, style = sys.argv[1], sys.argv[2]
# (an optional third argument: the teacher's width (its height two thirds of it); other than 192, written beside as ref-<style>-<view>@<width>.json)
RES = int(sys.argv[3]) if len(sys.argv) > 3 else 192
base = __file__.rsplit('/', 1)[0]
VIEWS = ['ref', 'left', 'right', 'far-left', 'far-right', 'high']
cams = {c['name']: c for c in json.load(open(f'{base}/out/field/wires.json'))}
S = Image.open(sheet).convert('RGB'); A = np.asarray(S, dtype=np.float32) / 255; G = A.mean(-1)
def bands(profile, n):
  # (the separators: runs of dark rows or columns; the panels are what lies between them and the edges)
  dark = profile < 0.45; runs = []; i = 0
  while i < len(dark):
    if dark[i]:
      j = i
      while j < len(dark) and dark[j]: j += 1
      runs.append((i, j)); i = j
    else: i += 1
  runs = [r for r in runs if 0.1 * len(dark) < (r[0] + r[1]) / 2 < 0.9 * len(dark)]
  cuts = [0] + [x for r in runs for x in r] + [len(dark)]
  spans = [(cuts[k], cuts[k + 1]) for k in range(0, len(cuts), 2)]
  return [s for s in spans if s[1] - s[0] > 0.2 * len(dark)][:n]
cols = bands(G[int(G.shape[0] * 0.1):int(G.shape[0] * 0.9)].mean(0), 2); rows = bands(G[:, int(G.shape[1] * 0.1):int(G.shape[1] * 0.9)].mean(1), 3)
assert len(cols) == 2 and len(rows) == 3, (cols, rows)
os.makedirs(f'{base}/field-teachers/{style}', exist_ok=True)
W, H, FW, FH = 1024, 683, RES, RES * 2 // 3
blur = lambda a, r: np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255
report = []
for i, view in enumerate(VIEWS):
  (x0, x1), (y0, y1) = cols[i % 2], rows[i // 2]
  P = S.crop((x0 + 2, y0 + 2, x1 - 2, y1 - 2)).resize((W, H), Image.LANCZOS)
  a = np.asarray(P.convert('L'), dtype=np.float32) / 255
  paper = np.percentile(a, 85); ink = np.percentile(a, 0.5)
  D = np.clip((paper - a) / (paper - ink + 1e-6), 0, 1)
  # (the red label, top left: masked to paper)
  rgb = np.asarray(P, dtype=np.float32) / 255; red = (rgb[..., 0] - rgb[..., 1] > 0.25) & (rgb[..., 0] > 0.5)
  lab = np.zeros_like(red); lab[:60, :160] = True; D[lab & red] = 0; D[:50, :130] = np.where(red[:50, :130] | (D[:50, :130] > 0.6), 0, D[:50, :130])
  # (alignment to the wireframe, at half size: scale about the centre and shift, both found by search)
  wire = 1 - np.asarray(Image.open(f'{base}/out/field/wire-{view}.png').convert('L').resize((W // 2, H // 2), Image.LANCZOS), dtype=np.float32) / 255
  Wb = blur(wire * 3, 3); Dh = np.asarray(Image.fromarray((D * 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS), dtype=np.float32) / 255
  ys, xs = np.mgrid[0:H // 2, 0:W // 2]
  def warp(img, s, tx, ty):
    h, w = img.shape; u = (xs - w / 2 - tx) / s + w / 2; v = (ys - h / 2 - ty) / s + h / 2
    ok = (u >= 0) & (u < w - 1) & (v >= 0) & (v < h - 1); u0 = np.clip(u.astype(int), 0, w - 2); v0 = np.clip(v.astype(int), 0, h - 2); fu, fv = u - u0, v - v0
    out = img[v0, u0] * (1 - fu) * (1 - fv) + img[v0, u0 + 1] * fu * (1 - fv) + img[v0 + 1, u0] * (1 - fu) * fv + img[v0 + 1, u0 + 1] * fu * fv
    return np.where(ok, out, 0)
  def score(s, tx, ty):
    d = blur(warp(Dh, s, tx, ty), 2); a1 = Wb - Wb.mean(); b1 = d - d.mean(); return float((a1 * b1).sum() / np.sqrt((a1 * a1).sum() * (b1 * b1).sum() + 1e-9))
  best = (score(1, 0, 0), 1, 0, 0); s0 = best[0]
  for s in np.arange(0.94, 1.061, 0.02):
    for tx in range(-14, 15, 2):
      for ty in range(-10, 11, 2):
        c = score(s, tx, ty)
        if c > best[0]: best = (c, s, tx, ty)
  c, s, tx, ty = best
  # (the aligned panel at full size, and its darkness at the field's)
  ysF, xsF = np.mgrid[0:H, 0:W]; u = (xsF - W / 2 - tx * 2) / s + W / 2; v = (ysF - H / 2 - ty * 2) / s + H / 2
  Pa = np.asarray(P, dtype=np.float32); u0 = np.clip(u.astype(int), 0, W - 1); v0 = np.clip(v.astype(int), 0, H - 1); okF = (u >= 0) & (u < W) & (v >= 0) & (v < H)
  Pal = np.where(okF[..., None], Pa[v0, u0], Pa[..., :].mean((0, 1))); Image.fromarray(Pal.astype(np.uint8)).save(f'{base}/field-teachers/{style}/{view}.jpg', quality=88)
  Dal = np.where(okF, D[v0, u0], 0)
  Df = np.asarray(Image.fromarray((Dal * 255).astype(np.uint8)).resize((FW, FH), Image.LANCZOS), dtype=np.float32) / 255
  C = cams[view]
  json.dump({'state': f'{style}-{view}', 'style': style, 'view': view, 'w': FW, 'h': FH, 'D': [round(float(x), 3) for x in Df.ravel()], 'camera': {'eye': C['eye'], 'target': C['target'], 'fov': C['fov'], 'up': 1}, 'align': {'scale': round(float(s), 3), 'shift': [int(tx * 2), int(ty * 2)], 'correlation': round(c, 3), 'unaligned': round(s0, 3)}}, open(f'{base}/out/field/ref-{style}-{view}' + ('' if RES == 192 else f'@{RES}') + '.json', 'w'))
  report.append(f'  {view:10s} scale {s:.2f} shift {tx * 2:+d},{ty * 2:+d} px  match {s0:.2f} → {c:.2f}  mean ink {Df.mean():.3f}')
print(f'{style}:'); print('\n'.join(report))
