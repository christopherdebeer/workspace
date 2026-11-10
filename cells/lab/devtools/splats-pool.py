# The pool of teacher strokes, part two (python3 cells/lab/devtools/splats-pool.py): each limb the teacher drew, cut
# out of its restyle and straightened along the limb's own spine (splats-pool.mjs says where that falls), at the
# restyle's full size. A stroke here is a strip: along it a pixel a step; across it from -2.5 to +2.5 of the limb's
# half-width as the scene draws it (61 steps), so strokes of different widths and distances are in one frame.
# Kept: runs of a limb that are in the picture, not hidden by a nearer limb or a solid, at least 220 px long and 5 px in
# half-width. Written to devtools/out/pool/pool.npz (the strips, as darkness) and pool.json (what each is); and a sheet
# of them, devtools/out/pool/sheet.jpg. Also printed: how far the teacher's ink sits from the scene's spine, across (in
# half-widths), for every strip: whether a limb's place in the restyle is the scene's.
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); T = f'{HERE}/conservatory/teachers/'; OUT = f'{HERE}/out/pool/'
ORDER = ['tunnel', 'between-tunnel-and-pool', 'pool', 'between-pool-and-canopy', 'canopy', 'between-canopy-and-tunnel']
VN, VR = 61, 2.5
def dark(view):
  a = np.asarray(Image.open(f'{T}{ORDER.index(view) + 1}-{view}.jpg').convert('RGB'), np.float32) / 255; paper = np.percentile(a.reshape(-1, 3), 92, axis=0)
  return np.clip(((paper - a) / (paper - 0.12)).max(-1), 0, 1)
def sample(D, x, y):
  x0 = np.floor(x - 0.5).astype(int); y0 = np.floor(y - 0.5).astype(int); fx = x - 0.5 - x0; fy = y - 0.5 - y0; H, W = D.shape
  g = lambda i, j: np.where((i >= 0) & (i < W) & (j >= 0) & (j < H), D[np.clip(j, 0, H - 1), np.clip(i, 0, W - 1)], 0)
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy
spines = json.load(open(OUT + 'spines.json')); imgs = {}; strips = []; meta = []; geo = []
for s in spines:
  P = s['pts']; ok = [p is not None and 0 <= p[0] < 1536 and 0 <= p[1] < 1024 and not p[4] for p in P]
  i = 0
  while i < len(P):
    if not ok[i]: i += 1; continue
    j = i
    while j < len(P) and ok[j]: j += 1
    run = np.array([P[k][:4] for k in range(i, j)], np.float32); i0, i1 = i, j; i = j
    if len(run) < 8: continue
    seg = np.hypot(np.diff(run[:, 0]), np.diff(run[:, 1])); L = seg.sum()
    if L < 220 or run[:, 2].mean() < 5: continue
    if s['view'] not in imgs: imgs[s['view']] = dark(s['view'])
    # (a pixel a step along it)
    cum = np.concatenate([[0], np.cumsum(seg)]); n = int(L); at = (np.arange(n) + 0.5); x = np.interp(at, cum, run[:, 0]); y = np.interp(at, cum, run[:, 1]); hw = np.interp(at, cum, run[:, 2])
    tx = np.gradient(x); ty = np.gradient(y); tl = np.hypot(tx, ty) + 1e-9; nx, ny = -ty / tl, tx / tl
    v = np.linspace(-VR, VR, VN)
    strip = sample(imgs[s['view']], x[:, None] + nx[:, None] * v[None, :] * hw[:, None], y[:, None] + ny[:, None] * v[None, :] * hw[:, None]).astype(np.float32)
    geo.append(np.stack([x, y, nx, ny, hw]).astype(np.float32))
    strips.append(strip); meta.append(dict(view=s['view'], key=s['key'], role=s['role'], u0=round((i0 + 0.5) / len(P), 3), u1=round((i1 - 0.5) / len(P), 3), length=n, hw=round(float(hw.mean()), 1), depth=round(float(run[:, 3].mean()), 1)))
np.savez_compressed(OUT + 'pool.npz', **{f's{k}': s for k, s in enumerate(strips)})
# (and for the fitter, as plain 32-bit floats: each strip's stations (x, y, the way across, the half-width: five rows of
# its length) then the strip itself, a row a station; `at` says where each starts)
off = 0; parts = []
for m, g, st in zip(meta, geo, strips): m['at'] = off; parts += [g.ravel(), st.ravel()]; off += g.size + st.size
np.concatenate(parts).astype('<f4').tofile(OUT + 'pool.bin'); json.dump(meta, open(OUT + 'pool.json', 'w'))
# (where the teacher's ink sits across each strip: its centre and how much of it lies within the limb as the scene draws it)
print(f'{len(strips)} strokes of {len(set(m["key"] for m in meta))} limbs')
v = np.linspace(-VR, VR, VN)
for m, s in zip(meta, strips):
  prof = s.mean(0); ink = prof.sum() + 1e-9; m['centre'] = round(float((prof * v).sum() / ink), 2); m['within'] = round(float(prof[np.abs(v) <= 1.25].sum() / ink), 2); m['ink'] = round(float(s[:, np.abs(v) <= 1.25].mean()), 3)
json.dump(meta, open(OUT + 'pool.json', 'w'))
c = np.array([m['centre'] for m in meta]); w = np.array([m['within'] for m in meta]); k = np.array([m['ink'] for m in meta])
print(f'ink within 1.25 half-widths of the spine: median {np.median(w):.2f} (quartiles {np.percentile(w, 25):.2f}, {np.percentile(w, 75):.2f}); its centre off the spine by a median {np.median(np.abs(c)):.2f} half-widths; mean darkness in the band: median {np.median(k):.2f}')
# (the sheet: each strip lying along the page, its limb and view beside it, the longest first; the limb as the scene draws it between the two ticks)
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
except Exception: F = None
order = sorted(range(len(strips)), key=lambda k: -meta[k]['ink'] * 0 - meta[k]['length'])[:int(os.environ.get('N', 36))]
Wd = 1500; rows = []; x = 0; y = 0; cells = []
for k in order:
  s = strips[k]; im = Image.fromarray(((1 - s.T) * 255).astype(np.uint8)).resize((min(700, s.shape[0]), 96), Image.LANCZOS)
  if x + im.width + 8 > Wd: x = 0; y += 96 + 20
  cells.append((x, y, im, meta[k])); x += im.width + 8
B = Image.new('L', (Wd, y + 96 + 22), 250); dr = ImageDraw.Draw(B)
for x, y, im, m in cells:
  B.paste(im, (x, y + 16)); dr.text((x + 2, y + 2), f'{m["key"]} · {m["view"]} · {m["hw"]:.0f} px', fill=60, font=F)
  for t in (-1, 1): yy = y + 16 + int((t / VR * 0.5 + 0.5) * 96); dr.line([(x, yy), (x + 5, yy)], fill=120)
B.save(OUT + 'sheet.jpg', quality=88); print(OUT + 'sheet.jpg', B.size)
