"""Autograph's pair test (run by devtools/autograph-font.mjs after every build): every pair of letters, figures and common
marks set side by side as the font sets them (joined where the font would join them), and any place two touch other than
at a join is a collision. A font with any collision fails its build: no two letters may touch except where they join.

Needs fontTools and shapely. python3 autograph-pairs.py <font.ttf>
"""
import sys, itertools
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from shapely.geometry import Polygon
from shapely.ops import unary_union

f = TTFont(sys.argv[1])
gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f['hmtx']
XH = f['OS/2'].sxHeight


def poly(name, dx=0):
    """a glyph's outline as one shape (its counters filled: it's touching from outside that matters)"""
    pen = RecordingPen()
    gs[name].draw(pen)
    rings, cur = [], []
    for op, args in pen.value:
        if op == 'moveTo':
            cur = [args[0]]
        elif op in ('lineTo', 'qCurveTo', 'curveTo'):
            cur.append(args[-1])
        elif op in ('closePath', 'endPath'):
            if len(cur) > 2:
                rings.append(Polygon([(x + dx, y) for x, y in cur]).buffer(0))
            cur = []
    return unary_union(rings) if rings else None


names = {chr(c): n for c, n in cmap.items()}
letters = [c for c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?\'"()' if c in names]
hits = []
for a, b in itertools.product(letters, letters):
    na, nb = names[a], names[b]
    # (as the font sets them: b joined from a, from below or above, where a goes out and b can be joined into)
    for form in ('j', 'h'):
        alt = nb.replace('.i1', '.%s2' % form)
        if alt in gs and ((form == 'j' and a.islower() and a not in 'bovwrs') or (form == 'h' and a in 'bovwr')):
            nb = alt
            break
    pa, pb = poly(na), poly(nb, hmtx[na][0])
    if pa is None or pb is None:
        continue
    x = pa.intersection(pb)
    if x.is_empty or x.area < 40:
        continue
    # (overlap where a join is, low or high, is meant; anywhere else is a collision)
    parts = list(x.geoms) if hasattr(x, 'geoms') else [x]
    bad = [p for p in parts if p.area > 40 and not any(abs(p.centroid.y - h * XH) < 0.2 * XH for h in (0.14, 0.87))]
    if bad:
        hits.append((a + b, round(sum(p.area for p in bad)), round(bad[0].centroid.y / XH, 2)))
hits.sort(key=lambda h: -h[1])
print('pairs: %d of %d touch other than at a join%s' % (len(hits), len(letters) ** 2, (': ' + ' '.join(h[0] for h in hits[:30])) if hits else ''))
sys.exit(1 if hits else 0)
