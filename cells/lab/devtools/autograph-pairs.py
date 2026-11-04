"""Autograph's pair test (run by devtools/autograph-font.mjs after every build): every pair of letters, figures and common
marks set side by side as the font sets them (joined where the font would join them, and kerned where it kerns them, from
1.8), and any place two touch other than
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
        if alt in gs and ((form == 'j' and a.islower() and a not in 'bovwrs') or (form == 'h' and a in 'bovwr')):
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
