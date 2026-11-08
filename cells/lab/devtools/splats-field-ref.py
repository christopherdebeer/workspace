# A reference study's darkness, as a teacher for the fitted field (python3 cells/lab/devtools/splats-field-ref.py
# [resolved|intermediate|sparse]): the whole study at the field's resolution (192 × 128, its own 3:2), 0 paper … 1 ink,
# its paper and ink levels from its own lightness. It isn't warped: it's given its own camera instead
# (splats-field-refcam.mjs, from landmarks). Writes devtools/out/field/ref-<state>-raw.json.
import json, sys, numpy as np
from PIL import Image
state = sys.argv[1] if len(sys.argv) > 1 else 'resolved'
base = __file__.rsplit('/', 1)[0]
W, H = 192, 128
im = Image.open(f'{base}/splats/targets/composed-{state}.jpg').convert('L')
a = np.asarray(im.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
paper, ink = np.percentile(a, 90), np.percentile(a, 0.5)
D = np.clip((paper - a) / (paper - ink), 0, 1)
json.dump({'state': state, 'w': W, 'h': H, 'D': [round(float(x), 3) for x in D.ravel()], 'paper': round(float(paper), 3), 'ink': round(float(ink), 3)}, open(f'{base}/out/field/ref-{state}-raw.json', 'w'))
print(f'{state}: paper {paper:.3f}, ink {ink:.3f}, mean darkness {D.mean():.3f}')
