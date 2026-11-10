# The teacher's leaves, read one by one (python3 cells/lab/devtools/splats-leaves.py [--teach] [--board]).
#
# The room's fronds were taught by tone, at low resolution, against restyles whose leaves are where the image model put
# them: the fit faded them. Here nothing is asked of where a leaf is. Where the room has fronds in a view
# (devtools/splats-leaves.mjs: its strands' lines on the picture, and the scale there), the restyle's leaves are found
# one by one: the ink there with its thin stems worn away, in connected pieces of a leaf's size. Each piece is measured:
# - **length**, **width** (cm, by the scale of the nearest strand): four standard deviations along and across its axis;
# - **point**: how wide its two ends are against its middle (1 a bar, toward 0 pointed at both ends); **base up**: how
#   often its upper half is the wider; **dark**: how dark it is against the paper;
# - **angle**: its axis off straight down (degrees);
# - **a metre**: leaves to a metre of the room's strands there (how many it draws for the fronds there are);
# - **apart**: from a leaf to the nearest other, in leaf lengths (median); **bunched**: that distance against what
#   leaves scattered evenly at random over the same ground would give (under 1: in bunches).
# The room's own leaves are read the same way from the real renderer (out/leaves/ours-<view>.png, and dabs-<view>.png:
# a dab a leaf, as they were). --teach moves the leaf style (static/splats/leaf-style.json) toward the teacher's
# readings from the three views taught from: each number by the ratio of the teacher's reading to ours (one round;
# run the shots again and repeat). The other five views are read too: they've been used to choose things before, so
# they validate, they don't test. Writes out/leaves/read.json; --board: static/splats/b-leaves.jpg.
import json, os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = D + 'out/leaves/'; ST = D + '../static/splats/'
VIEWS = ['tunnel', 'between-tunnel-and-pool', 'pool', 'between-pool-and-canopy', 'canopy', 'between-canopy-and-tunnel', 'back-along-the-tunnel', 'sideways-from-the-stones']
TEACH = ['tunnel', 'pool', 'canopy']
strands = json.load(open(OUT + 'strands.json'))
W, H = 1536, 1024

def zone(view):
    """where the room has fronds in this view, the scale there (px a metre), and the strands' length there (m)"""
    near = np.full((H, W), 1e9, np.float32); scale = np.zeros((H, W), np.float32); metres = 0.0
    yy, xx = np.mgrid[0:H, 0:W]
    for s in strands[view]:
        P = s['pts']; vis = [q for q in P if 0 <= q[0] < W and 0 <= q[1] < H]; metres += s['L'] * len(vis) / max(1, len(P))
        for q in vis[::2]:
            r = max(18.0, 0.22 * q[3]); x0, x1, y0, y1 = int(max(0, q[0] - r)), int(min(W, q[0] + r + 1)), int(max(0, q[1] - r)), int(min(H, q[1] + r + 1))
            d = np.hypot(xx[y0:y1, x0:x1] - q[0], yy[y0:y1, x0:x1] - q[1]); sub = near[y0:y1, x0:x1]; better = (d < r) & (d < sub)
            sub[better] = d[better]; scale[y0:y1, x0:x1][better] = q[3]
    return near < 1e8, scale, metres

def pieces(img, view):
    """a picture's leaves where the room has fronds: each piece's measurements"""
    Z, scale, metres = zone(view)
    g = np.asarray(img.convert('L'), np.float32) / 255; paper = np.percentile(g, 90); dark = (g < 0.62 * paper) & Z
    # (thin stems worn away: a pixel stays if its 3×3 is all ink, then the pieces are grown back by one)
    e = dark.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1): e &= np.roll(np.roll(dark, dy, 0), dx, 1)
    o = e.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1): o |= np.roll(np.roll(e, dy, 0), dx, 1)
    o &= dark
    lab = np.zeros((H, W), np.int32); out = []; n = 0
    ys, xs = np.nonzero(o)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if lab[y0, x0]: continue
        n += 1; lab[y0, x0] = n; stack = [(y0, x0)]; pix = []
        while stack:
            y, x = stack.pop(); pix.append((x, y))
            for yy2, xx2 in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1), (y + 1, x + 1), (y - 1, x - 1), (y + 1, x - 1), (y - 1, x + 1)):
                if 0 <= yy2 < H and 0 <= xx2 < W and o[yy2, xx2] and not lab[yy2, xx2]: lab[yy2, xx2] = n; stack.append((yy2, xx2))
        if len(pix) < 9: continue
        P = np.array(pix, np.float32); c = P.mean(0); sc = scale[int(c[1]), int(c[0])]
        if sc <= 0: continue
        Q = P - c; cov = Q.T @ Q / len(P); ev, evec = np.linalg.eigh(cov); a = evec[:, 1] if evec[1, 1] >= 0 else -evec[:, 1]   # (its axis, pointing down the picture)
        L, Wd = 4 * math.sqrt(max(ev[1], 1e-6)), 4 * math.sqrt(max(ev[0], 1e-6))
        # (a leaf's size: between 2 and 30 cm long, under 8 cm wide, longer than wide; anything else is a limb, a blot or a stem's end)
        if not (0.02 * sc <= L <= 0.30 * sc and Wd <= 0.08 * sc and L >= 1.3 * Wd): continue
        t = Q @ a; b = Q @ np.array([-a[1], a[0]]); up, lo = b[t < 0], b[t >= 0]
        if len(up) < 3 or len(lo) < 3: continue
        wu, wl = up.std(), lo.std(); third = L / 6; ends, mid = b[np.abs(t) > third], b[np.abs(t) <= third]
        if len(ends) < 3 or len(mid) < 3: continue
        ink = float(np.mean([1 - g[int(q[1]), int(q[0])] / paper for q in pix]))
        out.append({'x': float(c[0]), 'y': float(c[1]), 'len': L / sc * 100, 'wid': Wd / sc * 100, 'lenpx': L, 'point': float(ends.std() / max(mid.std(), 1e-6)), 'dark': ink, 'baseup': 1.0 if wu > wl else 0.0, 'angle': math.degrees(math.atan2(abs(a[0]), abs(a[1])))})
    return out, int(Z.sum()), metres, o

def read(leaves, ground, metres):
    if len(leaves) < 5: return None
    med = lambda k: float(np.median([l[k] for l in leaves])); C = np.array([[l['x'], l['y']] for l in leaves]); L = np.array([l['lenpx'] for l in leaves])
    d = np.sqrt(((C[:, None, :] - C[None, :, :]) ** 2).sum(-1)); np.fill_diagonal(d, 1e9); nn = d.min(1)
    return {'leaves': len(leaves), 'length': med('len'), 'width': med('wid'), 'point': med('point'), 'dark': med('dark'), 'baseup': float(np.mean([l['baseup'] for l in leaves])), 'angle': med('angle'), 'metre': len(leaves) / max(0.1, metres), 'apart': float(np.median(nn / L)), 'bunched': float(nn.mean() / (0.5 / math.sqrt(len(leaves) / max(1, ground))))}

KEYS = ['leaves', 'length', 'width', 'point', 'dark', 'baseup', 'angle', 'metre', 'apart', 'bunched']
def over(kind, views):
    """a kind of picture (the teacher's, ours, the dabs) read over some views: all their leaves together"""
    allv, ground, metres = [], 0, 0.0
    for v in views:
        f = D + f"conservatory/teachers2/{VIEWS.index(v) + 1}-{v}.jpg" if kind == 'teacher' else f'{OUT}{kind}-{v}.png'
        if not os.path.exists(f): return None
        lv, g, m, _ = pieces(Image.open(f).convert('RGB').resize((W, H)), v); allv += lv; ground += g; metres += m
    return read(allv, ground, metres)
fmt = lambda r: '  '.join(f"{k} {r[k]:.0f}" if k == 'leaves' else f"{k} {r[k]:.2f}" if k in ('point', 'dark', 'baseup', 'apart', 'bunched') else f"{k} {r[k]:.1f}" for k in KEYS) if r else '(not drawn yet)'
others = [v for v in VIEWS if v not in TEACH]; res = {}
for kind, label in (('teacher', 'the teacher'), ('dabs', 'a dab a leaf'), ('ours', 'formed leaves')):
    res[kind] = {'taught': over(kind, TEACH), 'others': over(kind, others)}
    print(f"{label:14s} taught from: {fmt(res[kind]['taught'])}\n{'':14s} the others:  {fmt(res[kind]['others'])}")
json.dump(res, open(OUT + 'read.json', 'w'), indent=1)

if '--teach' in sys.argv and res['ours']['taught']:
    f = ST + 'leaf-style.json'; J = json.load(open(f)); S = J['leaf']; T, O = res['teacher']['taught'], res['ours']['taught']
    step = lambda k, a, b, lo, hi, gain=0.7: S.__setitem__(k, round(min(hi, max(lo, S[k] * (T[a] / max(1e-6, O[a])) ** (gain * b))), 4))
    step('len', 'length', 1, 0.03, 0.25); step('width', 'width', 1, 0.008, 0.06); step('angle', 'angle', 1, 0.1, 1.2)
    # (how close along a strand: more to a metre where ours stand further apart than the teacher's, in leaf lengths)
    S['per'] = round(min(16, max(3, S['per'] * (O['apart'] / T['apart']) ** 0.7)), 2)
    # (a narrower tip where ours read blunter; drawn together more where ours read more evenly spread; more ink where paler)
    S['taper'] = round(min(0.95, max(0.1, S['taper'] + 0.8 * (O['point'] - T['point']))), 3); S['cluster'] = round(min(0.95, max(0, S['cluster'] + 0.6 * (O['bunched'] - T['bunched']))), 3); S['ink'] = round(min(4, max(-1, S['ink'] + 4 * (T['dark'] - O['dark']))), 3)
    json.dump(J, open(f, 'w')); print('taught:', json.dumps(S))

if '--board' in sys.argv:
    try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15); FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    except Exception: F = FS = ImageFont.load_default()
    INK, GREY = (40, 36, 32), (110, 104, 96)
    path = lambda kind, v: D + f"conservatory/teachers2/{VIEWS.index(v) + 1}-{v}.jpg" if kind == 'teacher' else f'{OUT}{kind}-{v}.png'
    def window(kind, v, cw, ch):
        """the window of a view holding most of a picture's leaves"""
        lv, _, _, _ = pieces(Image.open(path(kind, v)).convert('RGB').resize((W, H)), v); P = np.array([[l['x'], l['y']] for l in lv]) if lv else np.zeros((0, 2)); best = (-1, W // 2, H // 2)
        for cx in range(cw // 2, W - cw // 2 + 1, 32):
            for cy in range(ch // 2, H - ch // 2 + 1, 32):
                k = int(((abs(P[:, 0] - cx) < cw / 2) & (abs(P[:, 1] - cy) < ch / 2)).sum()) if len(P) else 0
                if k > best[0]: best = (k, cx, cy)
        return best
    # ─── one cluster, close to: the teacher's (where its canopy view has most leaves), and the walk's patch from 2.6 m ───
    T = 460; tiles = []
    _, cx, cy = window('teacher', 'canopy', 300, 300); tiles.append(('the teacher', 'a cluster from its\nrestyle of the canopy', Image.open(path('teacher', 'canopy')).convert('RGB').resize((W, H)).crop((cx - 150, cy - 150, cx + 150, cy + 150)).resize((T, T), Image.LANCZOS)))
    for label, sub, f in (('a dab a leaf', 'as it was: one canopy\npatch from 2.6 m', 'walk-dabs'), ('formed leaves', 'the same patch, its leaves\nin the style read off the teacher\'s', 'walk-ours')):
        if os.path.exists(f'{OUT}{f}.png'): im = Image.open(f'{OUT}{f}.png').convert('RGB'); w, h = im.size; tiles.append((label, sub, im.crop((w // 2 - 330, h // 2 - 400, w // 2 + 330, h // 2 + 260)).resize((T, T), Image.LANCZOS)))
    B = Image.new('RGB', (len(tiles) * (T + 6) - 6, T + 58), (255, 255, 255)); dr = ImageDraw.Draw(B)
    for c, (label, sub, im) in enumerate(tiles): B.paste(im, (c * (T + 6), 58)); dr.text((c * (T + 6) + 4, 4), label, fill=INK, font=F); dr.multiline_text((c * (T + 6) + 4, 24), sub, fill=GREY, font=FS, spacing=2)
    B.save(ST + 'b-frond.jpg', quality=88); print(ST + 'b-frond.jpg', B.size)
    # ─── in the room: two of the views taught from, and the other view with most of our leaves; the window with most of them ───
    counts = {v: window('ours', v, 420, 420) for v in VIEWS if os.path.exists(path('ours', v))}
    cols = [v for v in ('tunnel', 'canopy') if v in counts] + sorted([v for v in counts if v not in TEACH], key=lambda v: -counts[v][0])[:1]
    CW, CH, PAD, LEFT, TOP = 420, 420, 6, 150, 44; rows = [('the teacher', 'teacher'), ('a dab a leaf\n(as it was)', 'dabs'), ('formed leaves', 'ours')]
    B = Image.new('RGB', (LEFT + len(cols) * (CW + PAD), TOP + len(rows) * (CH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
    for c, v in enumerate(cols):
        dr.text((LEFT + c * (CW + PAD) + 6, 6), v.replace('-', ' '), fill=INK, font=F); dr.text((LEFT + c * (CW + PAD) + 6, 26), 'taught from' if v in TEACH else 'not taught from', fill=GREY, font=FS)
        _, cx, cy = counts[v]; box = (cx - CW // 2, cy - CH // 2, cx + CW // 2, cy + CH // 2)
        for r, (label, kind) in enumerate(rows):
            if os.path.exists(path(kind, v)): B.paste(Image.open(path(kind, v)).convert('RGB').resize((W, H)).crop(box), (LEFT + c * (CW + PAD), TOP + r * (CH + PAD)))
            if c == 0: dr.multiline_text((8, TOP + r * (CH + PAD) + 8), label, fill=INK, font=F, spacing=4)
    dr.multiline_text((8, TOP + 40), 'the same window\nof its restyle:\nits fronds are\nwhere it put them', fill=GREY, font=FS, spacing=3)
    B.save(ST + 'b-leaves.jpg', quality=88); print(ST + 'b-leaves.jpg', B.size)
