# Do the fitter and the renderer draw the same picture? (python3 cells/lab/devtools/splats-field-agree.py <dump> <dump> …)
# Each a picture of one field from one view, as darkness (the fitters' --dump: the optimiser's own picture; or
# splats-field-browser.mjs: the real renderer's). Prints each one's mean darkness, and each one's tone error against the
# first (blurred at three scales, at 192 x 128, x 1000: the measure fields are scored by).
import json, sys, numpy as np
from PIL import Image, ImageFilter
def load(f):
  d = json.load(open(f)); C = np.array(d['C'], np.float32).reshape(d['h'], d['w'])
  return np.asarray(Image.fromarray((np.clip(C, 0, 1) * 255).astype(np.uint8)).resize((192, 128), Image.LANCZOS), dtype=np.float32) / 255, C.mean(), d['w']
blur = lambda a, r: np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255
tone = lambda a, b: float(np.mean([((blur(a, r) - blur(b, r)) ** 2).mean() for r in (2, 5, 10)])) * 1000
ref = None
for f in sys.argv[1:]:
  a, m, w = load(f)
  if ref is None: ref = a
  print(f'{f.split("/")[-1][:64]:64s} {w:5d} wide  mean darkness {m:.4f}  tone error against the first {tone(a, ref):6.3f}')
