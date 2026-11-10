# Teacher marks, cut from the sparse conservatory studies (python3 cells/lab/devtools/splats-marks-targets.py).
#
# Each is one mark a teacher made: a root stroke, a spray of leaf dabs on its strand, a canopy wash, a veil. Its place
# was read off the study by eye: a box, and the points its spine runs through (or its outline, for a wash). What's
# written for the fitter (devtools/out/marks/targets.json), per mark:
# - its picture as darkness (the most any channel is darkened from the paper, so an olive dab counts as much as ink),
#   at half the study's size, with everything outside the mark's own neighbourhood made paper (a band round its spine,
#   or its outline grown a little): other marks cross the box, and none of the three ways of drawing should be asked to
#   draw them;
# - its colour (the mean of its darkest pixels);
# - its spine or outline, in the picture's pixels, and the marks to lay on it.
# Scene units: the study's height is 1; the picture's middle is the origin; the marks lie on the plane z = 0.
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = f'{HERE}/conservatory/studies/'; OUT = f'{HERE}/out/marks/'; os.makedirs(OUT, exist_ok=True)
SCALE = 0.5
INK, OLIVE = None, 'olive'
T = [
  # name, study, box, kind, points, band (px in the study), marks: (role, width px, rows, count)
  dict(name='root-a', study='tunnel-sparse', box=(400, 0, 980, 230), kind='stroke', pts=[(455, 170), (520, 110), (610, 72), (700, 75), (780, 115), (860, 95), (930, 40)], band=52, marks=[dict(role='root', width=46, rows=7, count=294)]),
  dict(name='root-b', study='tunnel-sparse', box=(0, 10, 440, 360), kind='stroke', pts=[(25, 325), (100, 250), (190, 200), (270, 185), (330, 110), (400, 45)], band=48, marks=[dict(role='root', width=40, rows=7, count=294)], of='root-a'),
  dict(name='root-c', study='tunnel-sparse', box=(100, 240, 500, 470), kind='stroke', pts=[(135, 440), (200, 355), (300, 320), (400, 300), (465, 270)], band=46, marks=[dict(role='root', width=50, rows=7, count=217)], of='root-a'),
  dict(name='root-d', study='canopy-sparse', box=(570, 30, 880, 180), kind='stroke', pts=[(600, 150), (700, 118), (770, 98), (850, 55)], band=28, marks=[dict(role='root', width=22, rows=7, count=161)], of='root-a'),
  dict(name='spray-a', study='canopy-sparse', box=(775, 30, 885, 290), kind='stroke', pts=[(843, 50), (835, 110), (822, 180), (815, 265)], band=36, marks=[dict(role='strand', width=3, rows=1, count=24), dict(role='dabs', width=9, rows=1, count=14, colour=OLIVE)]),
  dict(name='spray-b', study='canopy-sparse', box=(1405, 20, 1515, 270), kind='stroke', pts=[(1462, 40), (1458, 100), (1450, 170), (1437, 245)], band=36, marks=[dict(role='strand', width=3, rows=1, count=24), dict(role='dabs', width=9, rows=1, count=14, colour=OLIVE)], of='spray-a'),
  dict(name='wash-a', study='canopy-sparse', box=(510, 340, 750, 500), kind='wash', pts=[(545, 450), (560, 415), (590, 385), (630, 372), (670, 378), (700, 395), (715, 430), (700, 465), (640, 478), (580, 475)], band=16, marks=[dict(role='wash', count=48)]),
  dict(name='wash-b', study='tunnel-sparse', box=(260, 310, 730, 610), kind='wash', pts=[(310, 500), (400, 420), (480, 370), (560, 350), (640, 350), (700, 332), (695, 392), (640, 410), (560, 440), (480, 470), (420, 505), (360, 560), (300, 590), (285, 540)], band=14, marks=[dict(role='wash', count=96)], of='wash-a'),
  dict(name='veil-a', study='pool-sparse', box=(100, 60, 220, 600), kind='stroke', pts=[(160, 95), (160, 250), (160, 400), (160, 560)], band=40, marks=[dict(role='veil', width=58, rows=4, count=72)]),
]
def catmull(P, per=12):
  out = []
  for i in range(len(P) - 1):
    p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
    for k in range(per + (1 if i == len(P) - 2 else 0)):
      t = k / per; out.append(tuple(0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t ** 3) for a in (0, 1)))
  return out
res = []
for t in T:
  im = Image.open(SRC + t['study'] + '.jpg').convert('RGB'); x0, y0, x1, y1 = t['box']
  full = np.asarray(im, np.float32) / 255; paper = np.percentile(full.reshape(-1, 3), 92, axis=0)
  w, h = int((x1 - x0) * SCALE), int((y1 - y0) * SCALE)
  a = np.asarray(im.crop(t['box']).resize((w, h), Image.LANCZOS), np.float32) / 255
  D = np.clip(((paper - a) / (paper - 0.12)).max(-1), 0, 1); D[D < 0.03] = 0
  # (its own neighbourhood: a band round its spine, or its outline grown)
  m = Image.new('L', (w, h), 0); dr = ImageDraw.Draw(m); loc = [((x - x0) * SCALE, (y - y0) * SCALE) for x, y in t['pts']]
  if t['kind'] == 'stroke':
    b = t['band'] * SCALE
    for x, y in catmull(loc, 40): dr.ellipse([x - b, y - b, x + b, y + b], fill=255)
  else: dr.polygon(loc, fill=255); m = m.filter(ImageFilter.MaxFilter(int(t['band'] * SCALE) * 2 + 1))
  roi = np.asarray(m.filter(ImageFilter.GaussianBlur(2)), np.float32) / 255
  D = D * roi
  dark = D > np.percentile(D[D > 0.05], 60) if (D > 0.05).any() else D > 1
  # (an olive mark's pigment: its darker pixels' colour unmixed from the paper, taking them as two thirds covered)
  col = np.clip((paper - (paper - a[dark].mean(0)) / 0.66) * 255, 0, 255).round().astype(int).tolist() if dark.any() else [36, 31, 27]
  res.append(dict(name=t['name'], study=t['study'], box=t['box'], kind=t['kind'], of=t.get('of'), w=w, h=h, unit=1024 * SCALE, colour=col, pts=[[round(x, 2), round(y, 2)] for x, y in loc], band=t['band'] * SCALE,
                  marks=[dict(m, width=m.get('width', 0) * SCALE) for m in t['marks']], D=[round(float(v), 3) for v in D.ravel()], roi=[round(float(v), 2) for v in roi.ravel()]))
  Image.fromarray(((1 - D) * 255).astype(np.uint8)).save(f'{OUT}target-{t["name"]}.png')
  print(f'{t["name"]:8s} {w:4d} x {h:3d}  mean darkness {D.mean():.3f}  colour {col}')
json.dump(res, open(OUT + 'targets.json', 'w'))
