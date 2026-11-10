# What a taught root is (python3 cells/lab/devtools/splats-pool-read.py): the pool's strokes (splats-pool.py) read in
# their own frame. Each strip's profile across the limb is taken as the median along it (marks that cross it, leaves
# and other limbs, drop out; what runs along it stays), turned so that the side that's up on the screen is the same for
# all. From each profile: where its darkest line is (in the limb's half-widths, 0 its spine, +1 its upper edge as the
# scene draws it), how thick and dark that line is, and how much tone lies beside it below and above (the wash).
# Prints the pool's medians by role, writes devtools/out/pool/read.json and a picture of the mean profiles.
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = f'{HERE}/out/pool/'
meta = json.load(open(OUT + 'pool.json')); Z = np.load(OUT + 'pool.npz'); spines = {(s['view'], s['key']): s for s in json.load(open(OUT + 'spines.json'))}
VN, VR = 61, 2.5; v = np.linspace(-VR, VR, VN); rows = []; profs = []
for k, m in enumerate(meta):
  S = Z[f's{k}']; P = spines[(m['view'], m['key'])]['pts']; n = len(P); a, b = int(m['u0'] * n), int(m['u1'] * n); run = np.array([p[:2] for p in P[a:b + 1] if p], np.float32)
  tx, ty = run[-1] - run[0]; up = tx > 0   # (+v is (-ty, tx): up on the screen (y down) when the stroke runs to the left... so: flip unless it does)
  # (+v points along (-ty, tx)/|t|; on a screen whose y runs down, that's up when tx < 0)
  if abs(tx) < abs(ty) * 0.6: side = 'upright'
  else: side = 'level'
  prof = np.median(S, axis=0)
  if tx > 0: prof = prof[::-1]
  i = int(np.argmax(prof * (np.abs(v) <= 1.6))); peak = float(prof[i]); base = float(np.percentile(prof[np.abs(v) <= 1.6], 20))
  half = base + (peak - base) / 2; lo = i
  while lo > 0 and prof[lo] > half: lo -= 1
  hi = i
  while hi < VN - 1 and prof[hi] > half: hi += 1
  thick = (hi - lo) * (2 * VR / (VN - 1)); below = float(prof[(v < v[i] - thick) & (v > v[i] - thick - 1.0)].mean()) if i > 14 else float('nan'); above = float(prof[(v > v[i] + thick) & (v < v[i] + thick + 1.0)].mean()) if i < VN - 14 else float('nan')
  # (how firm the line's two edges are: the steepest fall on each side, in darkness a pixel)
  g = np.gradient(prof, (2 * VR / (VN - 1)) * m['hw'])
  rows.append(dict(key=m['key'], view=m['view'], role=m['role'], side=side, hw=m['hw'], at=round(float(v[i]), 2), peak=round(peak, 2), thick=round(thick, 2), thick_px=round(thick * m['hw'], 1), below=round(below, 3), above=round(above, 3), firm_up=round(float(-g[i:min(VN, i + 8)].min()), 3), firm_down=round(float(g[max(0, i - 8):i + 1].max()), 3)))
  profs.append(prof)
json.dump(rows, open(OUT + 'read.json', 'w'))
med = lambda xs: float(np.nanmedian(xs)); q = lambda xs, p: float(np.nanpercentile(xs, p))
print(f'{len(rows)} strokes; level {sum(r["side"] == "level" for r in rows)}, upright {sum(r["side"] == "upright" for r in rows)}')
for name, sel in [('all level', [r for r in rows if r['side'] == 'level']), ('arches', [r for r in rows if r['role'] == 'arch' and r['side'] == 'level']), ('lesser limbs', [r for r in rows if r['role'] == 'limb' and r['side'] == 'level']), ('wide (half-width over 25 px)', [r for r in rows if r['hw'] > 25]), ('narrow (under 15 px)', [r for r in rows if r['hw'] < 15])]:
  if not sel: continue
  f = lambda k: [r[k] for r in sel]
  print(f'{name:30s} n={len(sel):2d}  line at {med(f("at")):+.2f} half-widths (quartiles {q(f("at"), 25):+.2f}, {q(f("at"), 75):+.2f}); darkness {med(f("peak")):.2f}; thick {med(f("thick")):.2f} half-widths = {med(f("thick_px")):.0f} px; tone below it {med(f("below")):.2f}, above it {med(f("above")):.2f}; edge fall, upper {med(f("firm_up")):.3f} lower {med(f("firm_down")):.3f} a px')
# (the mean profiles, level strokes: all, wide, narrow)
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except Exception: F = None
groups = [('all level strokes', [k for k, r in enumerate(rows) if r['side'] == 'level']), ('wide: half-width over 25 px', [k for k, r in enumerate(rows) if r['side'] == 'level' and r['hw'] > 25]), ('narrow: under 15 px', [k for k, r in enumerate(rows) if r['side'] == 'level' and r['hw'] < 15])]
W, H = 330, 230; B = Image.new('RGB', (len(groups) * W + 10, H + 10), (250, 247, 240)); dr = ImageDraw.Draw(B)
for gi, (name, ks) in enumerate(groups):
  x0 = 10 + gi * W; dr.text((x0, 4), f'{name} ({len(ks)})', fill=(40, 36, 30), font=F)
  X = lambda t: x0 + 12 + (t + VR) / (2 * VR) * (W - 40); Y = lambda d: H - 20 - d * (H - 60)
  for t in (-1, 0, 1): dr.line([(X(t), 26), (X(t), H - 20)], fill=(205, 198, 186)); dr.text((X(t) - 8, H - 18), ['lower edge', 'spine', 'upper edge'][t + 1][:5 if t else 5], fill=(120, 110, 98), font=F)
  for k in ks: dr.line([(X(t), Y(d)) for t, d in zip(v, profs[k])], fill=(196, 188, 176))
  if ks: dr.line([(X(t), Y(d)) for t, d in zip(v, np.mean([profs[k] for k in ks], 0))], fill=(40, 36, 30), width=3)
B.save(OUT + 'profiles.png'); print(OUT + 'profiles.png')
