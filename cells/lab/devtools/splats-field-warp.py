# The study warped onto the scene (python3 cells/lab/devtools/splats-field-warp.py [resolved]): after its camera
# (splats-field-refcam.mjs), what's left of the landmarks' disagreement is the study's own geometry (its stone larger
# against the corner, its culm leaning). A thin-plate spline through the landmarks' residuals moves the study so each
# landmark lands where the scene's lies from that camera, smoothly between them. Rewrites the darkness in
# devtools/out/field/ref-<state>.json (keeping the unwarped as D0) and writes ref-<state>-warped.png.
import json, sys, numpy as np
from PIL import Image
state = sys.argv[1] if len(sys.argv) > 1 else 'resolved'
base = __file__.rsplit('/', 1)[0]
R = json.load(open(f'{base}/out/field/ref-{state}.json')); W, H = R['w'], R['h']
K = 4
im = Image.open(f'{base}/splats/targets/composed-{state}.jpg').convert('L')
a = np.asarray(im.resize((W * K, H * K), Image.LANCZOS), dtype=np.float32) / 255
paper, ink = np.percentile(a, 90), np.percentile(a, 0.5)
S4 = np.clip((paper - a) / (paper - ink), 0, 1)
# (the spline maps a scene-picture point to where the study has it: control points at the scene's landmarks, values the
# study's; plus the image's corners held still, so the warp doesn't run away at the edges)
src = [l['scene'] for l in R['landmarks']] + [[0, 0], [W, 0], [0, H], [W, H]]
dst = [l['study'] for l in R['landmarks']] + [[0, 0], [W, 0], [0, H], [W, H]]
src, dst = np.array(src, float), np.array(dst, float)
U = lambda r2: np.where(r2 > 0, r2 * np.log(r2 + 1e-12), 0)
n = len(src); Kd = U(((src[:, None] - src[None]) ** 2).sum(-1)) + np.eye(n) * 2.0
P = np.hstack([np.ones((n, 1)), src]); L = np.zeros((n + 3, n + 3)); L[:n, :n] = Kd; L[:n, n:] = P; L[n:, :n] = P.T
coef = np.linalg.solve(L, np.vstack([dst, np.zeros((3, 2))]))
ys, xs = np.mgrid[0:H, 0:W]; q = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], -1)
mapped = U(((q[:, None] - src[None]) ** 2).sum(-1)) @ coef[:n] + coef[n] + q @ coef[n + 1:]
u = mapped[:, 0] * K - 0.5; v = mapped[:, 1] * K - 0.5
ok = (u >= 0) & (u < W * K - 1) & (v >= 0) & (v < H * K - 1)
u0 = np.clip(np.floor(u).astype(int), 0, W * K - 2); v0 = np.clip(np.floor(v).astype(int), 0, H * K - 2); fu = u - u0; fv = v - v0
D = S4[v0, u0] * (1 - fu) * (1 - fv) + S4[v0, u0 + 1] * fu * (1 - fv) + S4[v0 + 1, u0] * (1 - fu) * fv + S4[v0 + 1, u0 + 1] * fu * fv
D = np.where(ok, D, 0)
R['D0'] = R.get('D0', R['D']); R['D'] = [round(float(x), 3) for x in D]; R['ok'] = [int(x) for x in ok]
res = [np.hypot(*(U(((np.array([s]) - src[None]) ** 2).sum(-1)) @ coef[:n] + coef[n] + np.array([s]) @ coef[n + 1:] - d)[0]) for s, d in zip(src[:7], dst[:7])]
R['warpResidualPx'] = round(float(np.sqrt(np.mean(np.square(res)))), 2)
json.dump(R, open(f'{base}/out/field/ref-{state}.json', 'w'))
Image.fromarray(((1 - D.reshape(H, W) * 0.9) * 255).astype(np.uint8)).resize((W * 4, H * 4), Image.NEAREST).save(f'{base}/out/field/ref-{state}-warped.png')
print(f'{state}: warped; landmarks now within {R["warpResidualPx"]} px rms (camera alone: {R["landmarkErrorPx"]})')
