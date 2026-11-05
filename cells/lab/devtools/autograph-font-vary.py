"""Autograph's variable font (from 2.7, session 27): the hand in several states made one font, with axes between them.

Run by devtools/autograph-font.mjs, which sets every letter by the hand in each state (a master): python3
autograph-font-vary.py <masters.json> <outdir> <high letters>.

A variable font moves each outline's points from one master to the next, so every master's outline of a letter has to
have the same points, in the same order. The fonts before 2.7 unioned each letter's widened strokes into clean outlines
(autograph-font.py), and a union has as many points as its shape happens to need, different in every state. So here
each stroke is outlined on its own, as the pen's edge either side of the line and a round end at each end: the line
divided evenly along its length into as many steps as its longest master needs, so each master has the same points; and
divided first where the pen stops and turns back (a cusp: the top of an i, the foot of an n), so each part ends round
there. Strokes overlap where they meet, as a pen's do, and the font is filled where any stroke is (nonzero), which is
the union again. Every point is off the curve, so the outline runs smoothly through the middle of each pair of points.

Each master is built as a font by autograph-font.py from these outlines (the same rules, spacing and kerning), and
fontTools' varLib puts them together: the axes are pace (`wght`, the hand at its own pace, 400, and at the pace it
writes what's strong, 700, so an app's bold is the hand pressing) and wear (`WEAR`, 0 to 100: the letters as they
stand, and as practice for ease left them). Then the pair test, at every corner.
"""
import json, math, os, subprocess, sys, tempfile
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.designspaceLib import DesignSpaceDocument, AxisDescriptor, SourceDescriptor, InstanceDescriptor
from fontTools import varLib
from fontTools.varLib import instancer
from fontTools.otlLib.builder import buildStatTable

XH, PEN, MIN_R = 430, 0.13, 7          # as autograph-font.py: the x-height in units, the pen's width, its finest
SP = 0.06                              # the longest step along a stroke, in x-heights
CAP = 3                                # points round each end of a stroke, between its two sides
CUSP = 2.0                             # how sharply the line turns back (radians, over a few points) to count as a cusp

here = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(sys.argv[1]))
out = sys.argv[2]
HIGH = sys.argv[3] if len(sys.argv) > 3 else ''
masters = data['masters']


def turning(P):
    n = len(P)
    t = np.zeros(n)
    for i in range(n):
        a, b = P[max(0, i - 3)], P[min(n - 1, i + 3)]
        c, d = P[i] - a, b - P[i]
        if np.hypot(*c) < 1e-6 or np.hypot(*d) < 1e-6:
            continue
        t[i] = abs(math.atan2(c[0] * d[1] - c[1] * d[0], c[0] * d[0] + c[1] * d[1]))
    return t


def along(P):
    d = np.hypot(*np.diff(P, axis=0).T) if len(P) > 1 else np.zeros(0)
    return np.concatenate([[0], np.cumsum(d)])


def cusps(P):
    """where the line turns back on itself: one index for each run of sharp turning, away from the ends"""
    t, out_, run = turning(P), [], []
    for i in range(2, len(P) - 2):
        if t[i] > CUSP:
            run.append(i)
        elif run:
            out_.append(max(run, key=lambda j: t[j])); run = []
    if run:
        out_.append(max(run, key=lambda j: t[j]))
    return out_


def splits(Ps):
    """the same cusps in every master: found in the first, and in each other at the sharpest turn near the same place"""
    ref = Ps[0]
    s0 = along(ref)
    fr = [s0[i] / max(1e-9, s0[-1]) for i in cusps(ref)]
    res = []
    for P in Ps:
        s = along(P)
        f = s / max(1e-9, s[-1])
        t = turning(P)
        idx, last = [], 0
        for f0 in fr:
            near = [i for i in range(len(P)) if abs(f[i] - f0) < 0.08 and last < i < len(P) - 1]
            i = max(near, key=lambda j: t[j]) if near else min(range(last + 1, len(P) - 1), key=lambda j: abs(f[j] - f0), default=None)
            if i is None or i <= last:
                continue
            idx.append(i); last = i
        res.append(idx)
    k = min(len(r) for r in res)
    return [[0] + r[:k] + [len(P) - 1] for r, P in zip(res, Ps)]


def resample(P, W, n):
    s = along(P)
    if s[-1] < 1e-9:
        return np.repeat(P[:1], n + 1, axis=0), np.repeat(W[:1], n + 1)
    u = np.linspace(0, s[-1], n + 1)
    return np.stack([np.interp(u, s, P[:, 0]), np.interp(u, s, P[:, 1])], axis=1), np.interp(u, s, W)


def outline_piece(C, R):
    """the pen's edge along one part of a stroke and round both its ends: one closed contour, every point off the curve"""
    n = len(C) - 1
    T = np.zeros_like(C)
    for i in range(n + 1):
        a, b = C[max(0, i - 1)], C[min(n, i + 1)]
        d = b - a
        L = np.hypot(*d)
        T[i] = d / L if L > 1e-9 else (T[i - 1] if i else np.array([1.0, 0.0]))
    if n and np.hypot(*T[0]) < 0.5:
        T[0] = T[1]
    N = np.stack([-T[:, 1], T[:, 0]], axis=1)
    left, right = C + R[:, None] * N, C - R[:, None] * N
    k = 1 / math.cos(math.pi / (2 * (CAP + 1)))
    end = [C[n] + k * R[n] * (N[n] * math.cos(f) + T[n] * math.sin(f)) for f in (math.pi * j / (CAP + 1) for j in range(1, CAP + 1))]
    start = [C[0] + k * R[0] * (-N[0] * math.cos(f) - T[0] * math.sin(f)) for f in (math.pi * j / (CAP + 1) for j in range(1, CAP + 1))]
    pts = list(left) + end + list(right[::-1]) + start
    return [[int(round(x)), int(round(y))] for x, y in pts]


def contours(strokes_by_master):
    """one glyph's contours in every master, point for point"""
    per = [[] for _ in strokes_by_master]
    for j in range(len(strokes_by_master[0])):
        Ps = [np.array([[x * XH, y * XH] for x, y, w in sm[j]], dtype=float) for sm in strokes_by_master]
        Ws = [np.array([max(MIN_R, w * PEN * XH / 2) for x, y, w in sm[j]], dtype=float) for sm in strokes_by_master]
        if min(len(P) for P in Ps) < 2:
            # (a dot: a round mark as wide as the pen)
            for m, (P, W) in enumerate(zip(Ps, Ws)):
                c, r = P.mean(axis=0), W.max() / math.cos(math.pi / 8)
                per[m].append([[int(round(c[0] + r * math.cos(a))), int(round(c[1] + r * math.sin(a)))] for a in (-2 * math.pi * q / 8 for q in range(8))])
            continue
        cut = splits(Ps)
        for k in range(len(cut[0]) - 1):
            parts = [(P[c[k]:c[k + 1] + 1], W[c[k]:c[k + 1] + 1]) for P, W, c in zip(Ps, Ws, cut)]
            steps = max(1, max(math.ceil(along(p)[-1] / (SP * XH)) for p, _ in parts))
            for m, (p, w) in enumerate(parts):
                C, R = resample(p, w, steps)
                per[m].append(outline_piece(C, R))
    return per


# (the outlines, every master's at once)
G = len(masters[0]['glyphs'])
assert all(len(m['glyphs']) == G for m in masters)
for gi in range(G):
    cs = contours([m['glyphs'][gi]['strokes'] for m in masters])
    for m, c in zip(masters, cs):
        m['glyphs'][gi]['contours'] = c

# (each master a font, by the same builder as every font before it)
tmp = tempfile.mkdtemp(prefix='autograph-vary-')
ds = DesignSpaceDocument()
named = lambda loc: {next(a[1] for a in data['axes'] if a[0] == t): v for t, v in loc.items()}   # (a designspace places by axis name)
for tag, name, lo, df, hi in data['axes']:
    a = AxisDescriptor()
    a.tag, a.name, a.minimum, a.default, a.maximum = tag, name, lo, df, hi
    ds.addAxis(a)
for i, m in enumerate(masters):
    d = {k: v for k, v in data.items() if k not in ('masters', 'axes', 'instances')}
    d.update({'glyphs': m['glyphs'], 'face': 'Regular', 'file': '', 'name': 'master-%d' % i})
    jp = os.path.join(tmp, 'master-%d.json' % i)
    json.dump(d, open(jp, 'w'))
    subprocess.run(['python3', os.path.join(here, 'autograph-font.py'), jp, tmp], check=True)
    src = SourceDescriptor()
    src.path, src.name, src.location = os.path.join(tmp, 'master-%d.ttf' % i), m['name'], named(m['loc'])
    ds.addSource(src)
for name, loc in data['instances']:
    ins = InstanceDescriptor()
    ins.familyName, ins.styleName, ins.location = 'Claude Hand', name, named(loc)
    ds.addInstance(ins)
vf, _, _ = varLib.build(ds)

def passes(font, loc, label):
    ip = os.path.join(tmp, 'corner-%d-%d.ttf' % (loc['wght'], loc['WEAR']))
    instancer.instantiateVariableFont(TTFont(font) if isinstance(font, str) else font, loc).save(ip)
    print('%s %s: ' % (label, loc), end='', flush=True)
    return subprocess.run(['python3', os.path.join(here, 'autograph-pairs.py'), ip, HIGH]).returncode == 0


# (the pair test at every corner. Pace has to pass at both ends. Wear runs as far as it can with no two letters touching
# except where they join, at either pace: to the worn letters (100) if it can, else to the furthest of three quarters,
# half and a quarter of the way to them; that end is where the axis stops)
full = os.path.join(tmp, 'full.ttf')
vf.save(full)
if not (passes(full, {'wght': 400, 'WEAR': 0}, 'Regular') & passes(full, {'wght': 700, 'WEAR': 0}, 'Pressed')):
    sys.exit(1)
END = None
for wear in (100, 75, 50, 25):
    if passes(full, {'wght': 400, 'WEAR': wear}, 'Worn') & passes(full, {'wght': 700, 'WEAR': wear}, 'Worn Pressed'):
        END = wear
        break
if END is None:
    print('wear: no quarter of the way passes the pair test')
    sys.exit(1)
print('wear ends at %d' % END)
if END < 100:
    vf = instancer.instantiateVariableFont(TTFont(full), {'WEAR': (0, END)})
    fvar = vf['fvar']
    from fontTools.ttLib.tables._f_v_a_r import NamedInstance
    for name, loc in (('Worn', {'wght': 400, 'WEAR': END}), ('Worn Pressed', {'wght': 700, 'WEAR': END})):
        ni = NamedInstance()
        ni.subfamilyNameID = vf['name'].addMultilingualName({'en': name}, vf, mac=False)
        ni.coordinates = {k: float(v) for k, v in loc.items()}
        if not any(i.coordinates == ni.coordinates for i in fvar.instances):
            fvar.instances.append(ni)

# (strokes overlap where they meet: say so, so every renderer fills them as one)
glyf = vf['glyf']
for gn in vf.getGlyphOrder():
    g = glyf[gn]
    if getattr(g, 'numberOfContours', 0) > 0:
        g.flags[0] |= 0x40
buildStatTable(vf, [
    {'tag': 'wght', 'name': 'Weight', 'values': [{'value': 400, 'name': 'Regular', 'flags': 0x2}, {'value': 700, 'name': 'Pressed'}]},
    {'tag': 'WEAR', 'name': 'Wear', 'values': [{'value': 0, 'name': 'As it stands', 'flags': 0x2}, {'value': END, 'name': 'Worn'}]},
])
VERSION = data['version']
ttf = os.path.join(tmp, 'claude-hand-%s.ttf' % VERSION)
vf.save(ttf)
f = TTFont(ttf)
f.flavor = 'woff2'
f.save(os.path.join(out, 'claude-hand-%s.woff2' % VERSION))
# (a TTF too big for the cell isn't kept: the web font is)
kept = os.path.getsize(ttf) < 700 * 1024
if kept:
    import shutil
    shutil.copy(ttf, os.path.join(out, 'claude-hand-%s.ttf' % VERSION))
pts = sum(len(getattr(glyf[x], 'coordinates', [])) for x in vf.getGlyphOrder())
print('variable: %d glyphs, %d outline points, %d masters, wght 400-700, WEAR 0-%d; TTF %d KB%s, woff2 %d KB' % (len(vf.getGlyphOrder()), pts, len(masters), END, os.path.getsize(ttf) // 1024, '' if kept else ' (too big for the cell: not kept)', os.path.getsize(os.path.join(out, 'claude-hand-%s.woff2' % VERSION)) // 1024))
print('final corners:')
ok = all([passes(ttf, {'wght': w, 'WEAR': e}, 'final') for w in (400, 700) for e in (0, END)])
sys.exit(0 if ok else 1)
