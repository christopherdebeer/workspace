# The room's teachers (python3 cells/lab/devtools/splats-room-targets.py): an image model's sparse sumi-e restyles of the
# six underdrawings round the route (devtools/conservatory/wires: the room drawn plain from each view), kept as
# devtools/conservatory/teachers/<n>-<view>.jpg. Written for the fitter (devtools/out/room/teach.json): each as darkness
# (the most any channel is darkened from its own paper) at 384 x 256; and how well each lines up with its underdrawing:
# their blurred darkness's correlation, and the shift (within 24 px of the 384) that would raise it most.
import json, os, numpy as np
from PIL import Image, ImageFilter
# (the second set: restyles of the solid room's geometry as wireframes (devtools/conservatory/wires2), eight views: the
# six, and back along the tunnel and sideways from the stones. The first set, restyles of the room in its own marks,
# is kept in devtools/conservatory/teachers and wires.)
HERE = os.path.dirname(os.path.abspath(__file__)); T = f'{HERE}/conservatory/teachers2/'; Wd = f'{HERE}/conservatory/wires2/'; OUT = f'{HERE}/out/room/'
VIEWS = ['tunnel', 'between-tunnel-and-pool', 'pool', 'between-pool-and-canopy', 'canopy', 'between-canopy-and-tunnel', 'back-along-the-tunnel', 'sideways-from-the-stones']
TEACH = ['tunnel', 'pool', 'canopy']
W, H = 384, 256
def dark(f):
  a = np.asarray(Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS), np.float32) / 255; paper = np.percentile(a.reshape(-1, 3), 92, axis=0)
  D = np.clip(((paper - a) / (paper - 0.12)).max(-1), 0, 1); D[D < 0.03] = 0; return D
blur = lambda D, r: np.asarray(Image.fromarray((D * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
out = {}
for i, v in enumerate(VIEWS):
  t = dark(f'{T}{i + 1}-{v}.jpg'); w = dark(f'{Wd}{i + 1}-{v}.jpg'); a, b = blur(t, 4), blur(w, 4)
  best = (-1, 0, 0)
  for dy in range(-24, 25, 4):
    for dx in range(-24, 25, 4):
      c = np.corrcoef(np.roll(np.roll(a, dy, 0), dx, 1).ravel(), b.ravel())[0, 1]
      if c > best[0]: best = (c, dx, dy)
  c0 = np.corrcoef(a.ravel(), b.ravel())[0, 1]
  out[v] = dict(w=W, h=H, teach=v in TEACH, D=[round(float(x), 3) for x in t.ravel()])
  print(f'{v:26s} {"to teach from" if v in TEACH else "reserved":14s} ink {t.mean():.3f} (underdrawing {w.mean():.3f})  lines up at {c0:.2f}; best {best[0]:.2f} shifted by {best[1:]}')
json.dump(out, open(OUT + 'teach.json', 'w'))
