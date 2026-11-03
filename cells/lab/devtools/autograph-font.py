"""Autograph's font, second half: the hand's strokes widened into outlines and written as a font.

Run by devtools/autograph-font.mjs (which sets every letter by hand v2): python3 autograph-font.py <letters.json> <outdir>.

Each stroke is a centreline with the pen's width at every point. It's widened by those widths (a round pen, so each step
of the line is a capsule as wide as the pen was there) and every stroke of a letter is unioned into clean outlines. Then
the font: a glyph for each letter in each form and writing, and two sets of rules (OpenType `calt`, on by default):

- forms: a letter after one that went out low takes its joined form (its lead-in reaching back to meet it); after one
  that went out high, the form joined from above; otherwise (starting a word, after a lift) the form without a lead-in;
- writings: each glyph takes the writing after the one before it (1, 2, 3, 1 ...), spaces included, so a word never
  repeats a letter exactly and the cycle runs on across words.

Needs fontTools, shapely and brotli (pip install fonttools shapely brotli).
"""
import json, math, sys, os
import shapely
from shapely.geometry import LineString, Point
from shapely.geometry.polygon import orient
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
from fontTools.misc.timeTools import timestampFromString
import hashlib

VERSION = '0.4'          # the session that made it, as a version
XH = 430                 # the x-height, in font units (of 1000 to the em)
PEN = 0.13               # the pen's width at its usual weight, in x-heights
MIN_R = 7                # the finest the pen goes, half-width in units

data = json.load(open(sys.argv[1]))
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']


def base(ch):
    if ch == ' ':
        return 'space'
    if ch.isascii() and ch.isalpha():
        return ch
    if ch.isdigit():
        return DIGITS[int(ch)]
    return 'uni%04X' % ord(ch)


def name(g, form=None, alt=None):
    return '%s.%s%d' % (base(g['ch']), form or g['form'], alt or g['alt'])


def outline(strokes):
    """the strokes widened by the pen's widths and unioned: a list of polygons"""
    parts = []
    for s in strokes:
        pts = [(x * XH, y * XH, max(MIN_R, w * PEN * XH / 2)) for x, y, w in s]
        if len(pts) == 1:
            parts.append(Point(pts[0][0], pts[0][1]).buffer(pts[0][2], quad_segs=4))
            continue
        for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
            parts.append(LineString([(x0, y0), (x1, y1)]).buffer((r0 + r1) / 2, quad_segs=3))
    if not parts:
        return []
    u = shapely.union_all(parts).simplify(1.2, preserve_topology=True)
    polys = list(u.geoms) if hasattr(u, 'geoms') else [u]
    return [orient(p, -1.0) for p in polys if not p.is_empty]


def draw(polys):
    pen = TTGlyphPen(None)
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = []
            for x, y in list(ring.coords)[:-1]:
                q = (round(x), round(y))
                if not pts or q != pts[-1]:
                    pts.append(q)
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts.pop()
            if len(pts) < 3:
                continue
            pen.moveTo(pts[0])
            for q in pts[1:]:
                pen.lineTo(q)
            pen.closePath()
    return pen.glyph()


glyphs, order, adv, cmap = {}, ['.notdef'], {'.notdef': 500}, {}
glyphs['.notdef'] = TTGlyphPen(None).glyph()
for g in data['glyphs']:
    n = name(g)
    order.append(n)
    glyphs[n] = draw(outline(g['strokes']))
    adv[n] = max(0, round(g['adv'] * XH))
    if g['form'] == 'i' and g['alt'] == 1:
        cmap[g['code']] = n

# (the rules)
G = data['glyphs']
low = [name(g) for g in G if g['exit'] == 'low']
high = [name(g) for g in G if g['exit'] == 'high']
joinable = [g for g in G if g['form'] in 'ijh' and any(h['ch'] == g['ch'] and h['form'] == 'j' for h in G)]
cls = lambda names: '[' + ' '.join(names) + ']'
fea = ['languagesystem DFLT dflt;', 'languagesystem latn dflt;']
fea += ['@LOW = %s;' % cls(low), '@HIGH = %s;' % cls(high), '@JOINABLE = %s;' % cls([name(g) for g in joinable])]
fea += ['@TOJ = %s;' % cls([name(g, 'j') for g in joinable]), '@TOH = %s;' % cls([name(g, 'h') for g in joinable])]
fea += ['@ALL = %s;' % cls([name(g) for g in G])]
for k in range(1, data['alts'] + 1):
    fea += ['@ALL%d = %s;' % (k, cls([name(g, None, k) for g in G])), '@A%d = %s;' % (k, cls([name(g) for g in G if g['alt'] == k]))]
fea += ['lookup toJ { sub @JOINABLE by @TOJ; } toJ;', 'lookup toH { sub @JOINABLE by @TOH; } toH;']
for k in range(1, data['alts'] + 1):
    fea += ['lookup to%d { sub @ALL by @ALL%d; } to%d;' % (k, k, k)]
fea += ['lookup forms { sub @LOW @JOINABLE\' lookup toJ; sub @HIGH @JOINABLE\' lookup toH; } forms;']
n = data['alts']
fea += ['lookup cycle { %s } cycle;' % ' '.join('sub @A%d @ALL\' lookup to%d;' % (k, k % n + 1) for k in range(1, n + 1))]
fea += ['feature calt { lookup forms; lookup cycle; } calt;']

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
glyf = fb.font['glyf']
ymax, ymin, metrics = 0, 0, {}
for n_ in order:
    gl = glyf[n_]
    gl.recalcBounds(glyf)
    has = getattr(gl, 'numberOfContours', 0) > 0
    metrics[n_] = (adv[n_], gl.xMin if has else 0)
    if has:
        ymax, ymin = max(ymax, gl.yMax), min(ymin, gl.yMin)
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=860, descent=-420, lineGap=60)
fb.setupNameTable({
    'familyName': 'Claude Hand', 'styleName': 'Regular', 'fullName': 'Claude Hand', 'psName': 'ClaudeHand-Regular',
    'uniqueFontIdentifier': 'Claude Hand Regular %s' % VERSION, 'version': 'Version %s' % VERSION,
    'designer': 'Claude', 'description': 'A hand learned in public (the parc.land lab, autograph experiment): hand v2 set as a font. Each letter joins as its neighbour asks, in three writings taken in turn.',
})
fb.setupOS2(sTypoAscender=860, sTypoDescender=-420, sTypoLineGap=60, usWinAscent=max(860, ymax + 20), usWinDescent=max(420, -ymin + 20),
            sxHeight=XH, sCapHeight=round(1.7 * XH), achVendID='NONE', fsSelection=0x40 | 0x80, usWeightClass=400, version=4)
fb.setupPost()
# (the same hand always builds the same file: no build time in it)
fb.updateHead(created=timestampFromString('Tue Nov  3 00:00:00 2026'), modified=timestampFromString('Tue Nov  3 00:00:00 2026'))
addOpenTypeFeaturesFromString(fb.font, '\n'.join(fea))
ttf = os.path.join(out, 'claude-hand.ttf')
fb.save(ttf)
f = TTFont(ttf)
f.flavor = 'woff2'
f.save(os.path.join(out, 'claude-hand.woff2'))
pts = sum(len(getattr(glyf[x], 'coordinates', [])) for x in order)
print('%d glyphs, %d characters, %d outline points; %s %d KB (sha256 %s), woff2 %d KB' % (len(order), len(cmap), pts, os.path.basename(ttf), os.path.getsize(ttf) // 1024, hashlib.sha256(open(ttf, 'rb').read()).hexdigest()[:16], os.path.getsize(os.path.join(out, 'claude-hand.woff2')) // 1024))
