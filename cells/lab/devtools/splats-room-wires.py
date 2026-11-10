# The room's wireframes drawn (python3 cells/lab/devtools/splats-room-wires.py), from splats-room-wires.mjs: thin even
# lines on white. The solids' outlines are where the nearest solid changes from one pixel to the next; the rest are the
# lines as they were projected. A wash's outline is dashed (it's a volume of tone, not an edge); a leaf is a short tick.
# Written to devtools/conservatory/wires2/<n>-<view>.png, at 1536 x 1024.
import json, os, glob, numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = f'{HERE}/out/wires/'; OUT = f'{HERE}/conservatory/wires2/'; os.makedirs(OUT, exist_ok=True)
K = 2
for f in sorted(glob.glob(SRC + '*.json')):
  name = os.path.basename(f)[:-5]; J = json.load(open(f)); W, H = J['w'], J['h']
  ids = np.fromfile(SRC + name + '.ids', np.uint8).reshape(H, W)
  im = Image.new('L', (W * K, H * K), 255); dr = ImageDraw.Draw(im)
  wide = {'line': 2, 'plank': 2, 'post': 4, 'strand': 2, 'veil': 2, 'leaf': 2, 'wash': 2}
  for L in J['lines']:
    P = [(x * K, y * K) for x, y in L['pts']]
    if L['kind'] == 'dot': x, y = P[0]; dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=40); continue
    if L['kind'] == 'wash':
      for i in range(0, len(P) - 1, 2): dr.line(P[i:i + 2], fill=150, width=2)
      continue
    dr.line(P, fill=110 if L['kind'] in ('leaf', 'veil') else 60, width=wide.get(L['kind'], 2), joint='curve')
  # (the solids' outlines)
  e = np.zeros((H, W), bool); e[:, :-1] |= ids[:, :-1] != ids[:, 1:]; e[:-1, :] |= ids[:-1, :] != ids[1:, :]
  edge = Image.fromarray((e * 255).astype(np.uint8)).resize((W * K, H * K), Image.NEAREST).filter(ImageFilter.MaxFilter(3))
  im = Image.fromarray(np.minimum(np.asarray(im), 255 - (np.asarray(edge) > 0) * 215).astype(np.uint8))
  im = im.resize((W, H), Image.LANCZOS); im.save(OUT + name + '.png'); print(name, im.size)
