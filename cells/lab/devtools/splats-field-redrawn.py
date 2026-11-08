# A redrawn canvas as a teacher for the fitted field (python3 cells/lab/devtools/splats-field-redrawn.py <image> <view>
# [name]): an image of the composed scene redrawn over devtools/out/field/canvas-<view>.png (its geometry kept), its
# darkness at the field's resolution with the canvas's camera (canvases.json) → devtools/out/field/ref-<name>.json, for
# `splats-field-fit.mjs composed wash 200 --ref=<name>`.
import json, sys, numpy as np
from PIL import Image
img, view = sys.argv[1], sys.argv[2]; name = sys.argv[3] if len(sys.argv) > 3 else f'redrawn-{view}'
base = __file__.rsplit('/', 1)[0]
C = next(c for c in json.load(open(f'{base}/out/field/canvases.json')) if c['name'] == view)
W, H = 192, 128
a = np.asarray(Image.open(img).convert('L').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
paper, ink = np.percentile(a, 90), np.percentile(a, 0.5)
D = np.clip((paper - a) / (paper - ink), 0, 1)
json.dump({'state': name, 'w': W, 'h': H, 'D': [round(float(x), 3) for x in D.ravel()], 'camera': {'eye': C['eye'], 'target': C['target'], 'fov': C['fov'], 'up': 1}}, open(f'{base}/out/field/ref-{name}.json', 'w'))
print(f'{name}: from {img} at the {view} canvas\'s camera; paper {paper:.3f}, ink {ink:.3f}')
