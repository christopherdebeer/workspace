"""Autograph's pair test (run by devtools/autograph-font.mjs after every build): every pair of letters, figures and common
marks set side by side as the font sets them (joined where the font would join them, and kerned where it kerns them, from
1.8), and any place two touch other than
at a join is a collision. A font with any collision fails its build: no two letters may touch except where they join.

Needs fontTools and shapely. python3 autograph-pairs.py <font.ttf>
"""
import sys, itertools
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
import numpy as np
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union, polygonize
from shapely.affinity import translate

f = TTFont(sys.argv[1])
# (the letters that go out high, so the letter after them is joined from above: given by the build from the hand itself
# (from 2.6, where the f went out high too); b, o, v, w and r before that)
HIGH = sys.argv[2] if len(sys.argv) > 2 else 'bovwr'
gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f['hmtx']
XH = f['OS/2'].sxHeight


class Flat(BasePen):
    """a glyph's contours as rings of points, its curves followed in short straight steps"""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.rings, self.cur = [], []

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _qCurveToOne(self, p1, p2):
        p0 = self._getCurrentPoint()
        for t in (0.25, 0.5, 0.75, 1):
            u = 1 - t
            self.cur.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))

    def _curveToOne(self, p1, p2, p3):
        p0 = self._getCurrentPoint()
        for t in (0.25, 0.5, 0.75, 1):
            u = 1 - t
            self.cur.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))

    def _closePath(self):
        if len(self.cur) > 2:
            self.rings.append(self.cur)
        self.cur = []

    _endPath = _closePath


def winding(pt, rings):
    """how many times the contours wind round a point (the font is filled wherever it isn't nought)"""
    px, py, w = pt[0], pt[1], 0
    for r in rings:
        a = np.asarray(r)
        b = np.roll(a, -1, axis=0)
        x0, y0, x1, y1 = a[:, 0], a[:, 1], b[:, 0], b[:, 1]
        left = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)
        w += int(np.sum((y0 <= py) & (y1 > py) & (left > 0))) - int(np.sum((y1 <= py) & (y0 > py) & (left < 0)))
    return w


_polys = {}


def poly(name, dx=0):
    """a glyph's outline as one shape, filled as a renderer fills it (from 2.7 its strokes overlap, each its own
    contour), and its counters filled: it's touching from outside that matters"""
    if name not in _polys:
        pen = Flat(gs)
        gs[name].draw(pen)
        rings = pen.rings
        if not rings:
            _polys[name] = None
        else:
            faces = polygonize(unary_union([LineString(list(r) + [r[0]]) for r in rings]))
            keep = [fc for fc in faces if fc.area > 1 and winding(fc.representative_point().coords[0], rings) != 0]
            u = unary_union(keep) if keep else None
            if u is not None:
                parts = list(u.geoms) if hasattr(u, 'geoms') else [u]
                u = unary_union([Polygon(q.exterior) for q in parts])
            _polys[name] = u
    p = _polys[name]
    return None if p is None else translate(p, dx, 0)


def kerning():
    """the font's kerning, pair by pair as it applies it (class pairs, from 1.8): a function of the two glyphs"""
    subs = []
    if 'GPOS' in f:
        for lk in f['GPOS'].table.LookupList.Lookup:
            if lk.LookupType == 2:
                subs += lk.SubTable
    def kern(a, b):
        for st in subs:
            if a not in st.Coverage.glyphs:
                continue
            if st.Format == 1:
                for pv in st.PairSet[st.Coverage.glyphs.index(a)].PairValueRecord:
                    if pv.SecondGlyph == b:
                        return getattr(pv.Value1, 'XAdvance', 0) or 0
            else:
                c1, c2 = st.ClassDef1.classDefs.get(a, 0), st.ClassDef2.classDefs.get(b, 0)
                v = st.Class1Record[c1].Class2Record[c2].Value1
                if v is not None and getattr(v, 'XAdvance', 0):
                    return v.XAdvance
        return 0
    return kern


kern = kerning()
names = {chr(c): n for c, n in cmap.items()}
letters = [c for c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?\'"()' if c in names]
hits = []
for a, b in itertools.product(letters, letters):
    na, nb = names[a], names[b]
    # (as the font sets them: b joined from a, from below or above, where a goes out and b can be joined into)
    for form in ('j', 'h'):
        alt = nb.replace('.i1', '.%s2' % form)
        if alt in gs and ((form == 'j' and a.islower() and a not in HIGH + 's') or (form == 'h' and a in HIGH)):
            nb = alt
            break
    pa, pb = poly(na), poly(nb, hmtx[na][0] + kern(na, nb))
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
