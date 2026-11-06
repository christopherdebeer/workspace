"""Autograph's font, second half: the hand's strokes widened into outlines and written as a font.

Run by devtools/autograph-font.mjs (which sets every letter by the hand it names): python3 autograph-font.py <letters.json> <outdir>.

Each stroke is a centreline with the pen's width at every point. It's widened by those widths (a round pen, so each step
of the line is a capsule as wide as the pen was there) and every stroke of a letter is unioned into clean outlines. Then
the font: a glyph for each letter in each form and writing, and two sets of rules (OpenType `calt`, on by default):

- forms: a letter after one that went out low takes its joined form (its lead-in reaching back to meet it); after one
  that went out high, the form joined from above; otherwise (starting a word, after a lift) the form without a lead-in;
- writings: each glyph takes the writing a step on from the one before it (one step or three, by the letter: both
  coprime with four, and from 3.5 with eight, so a run of one letter goes through all of them), spaces included, so neighbours never match, the
  turns don't fall into a rhythm, and it all runs on across words.

And from 1.8, kerning (OpenType `kern`, on by default): a letter the hand sets nearer the one before it inside a word is
kerned nearer after anything inked, and only then, so starting a word (after a space, or at a line's start) it isn't.

Needs fontTools, shapely and brotli (pip install fonttools shapely brotli).
"""
import json, math, sys, os
import shapely
from shapely.geometry import LineString, Point
from shapely.geometry.polygon import orient
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen, TTGlyphPointPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
from fontTools.misc.timeTools import timestampFromString
import hashlib

XH = 430                 # the x-height, in font units (of 1000 to the em)
PEN = 0.13               # the pen's width at its usual weight, in x-heights
MIN_R = 7                # the finest the pen goes, half-width in units

data = json.load(open(sys.argv[1]))
VERSION = data['version']   # the session that made it, as a version
FACE, FILE = data.get('face', 'Regular'), data.get('file', '')   # (from 1.2: Regular, or Pressed, the family's bold)
PRESSED = FACE == 'Pressed'
# (from 3.5, a still face of its own beside them: Hurried, lighter than Regular, as the moving font's hurried end is;
# an app lists it with the family, and it installs as its own family where an app knows only regular and bold)
LINKED = FACE in ('Regular', 'Pressed')
WEIGHT = {'Hurried': 200, 'Regular': 400, 'Pressed': 700}.get(FACE, 400)
# (where the hand writes an underline and a strike (hands/v7.ts): an underline a fifth of an x-height under the line,
# a strike through the middle of the letters; both quick strokes, a little finer than the letters. The tables give the
# top of each stroke)
MARK = round(0.75 * PEN * XH)
UNDER = round(-0.22 * XH) + MARK // 2
STRIKE = round(0.43 * XH) + MARK // 2
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


def draw_q(contours):
    """(from 2.7) contours given already, every point off the curve, so the outline runs smoothly through the middle of
    each pair of points: the masters of the variable font, which have to share their points (autograph-font-vary.py)"""
    # (point by point: a pen drops a contour's last point when it lands on its first, and a writing font's stroke not yet
    # begun is all one point, which every master has to keep)
    pen = TTGlyphPointPen(None)
    for c in contours:
        pen.beginPath()
        for q in c:
            pen.addPoint(tuple(q), segmentType=None)
        pen.endPath()
    return pen.glyph()


glyphs, order, adv, cmap = {}, ['.notdef'], {'.notdef': 500}, {}
glyphs['.notdef'] = TTGlyphPen(None).glyph()
for g in data['glyphs']:
    n = name(g)
    order.append(n)
    glyphs[n] = draw_q(g['contours']) if 'contours' in g else draw(outline(g['strokes']))
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
# (from 3.7, a face that doesn't join, printed letter by letter, has no joined forms and so no rules for them)
JOINS = bool(joinable)
if JOINS:
    fea += ['@LOW = %s;' % cls(low), '@HIGH = %s;' % cls(high), '@JOINABLE = %s;' % cls([name(g) for g in joinable])]
    fea += ['@TOJ = %s;' % cls([name(g, 'j') for g in joinable]), '@TOH = %s;' % cls([name(g, 'h') for g in joinable])]
fea += ['@ALL = %s;' % cls([name(g) for g in G])]
for k in range(1, data['alts'] + 1):
    fea += ['@ALL%d = %s;' % (k, cls([name(g, None, k) for g in G])), '@A%d = %s;' % (k, cls([name(g) for g in G if g['alt'] == k]))]
if JOINS:
    fea += ['lookup toJ { sub @JOINABLE by @TOJ; } toJ;', 'lookup toH { sub @JOINABLE by @TOH; } toH;']
for k in range(1, data['alts'] + 1):
    fea += ['lookup to%d { sub @ALL by @ALL%d; } to%d;' % (k, k, k)]
if JOINS:
    fea += ['lookup forms { sub @LOW @JOINABLE\' lookup toJ; sub @HIGH @JOINABLE\' lookup toH; } forms;']
n = data['alts']
steps = sorted(set(g['step'] for g in G))
for s_ in steps:
    fea += ['@STEP%d = %s;' % (s_, cls([name(g) for g in G if g['step'] == s_]))]
fea += ['lookup cycle { %s } cycle;' % ' '.join('sub @A%d @STEP%d\' lookup to%d;' % (k, s_, (k - 1 + s_) % n + 1) for k in range(1, n + 1) for s_ in steps)]
fea += ['feature calt { %slookup cycle; } calt;' % ('lookup forms; ' if JOINS else '')]
# (from 3.2, for a font whose letters are set one at a time, each in its own run, so the font can't see the letter before:
# the joined forms on request, ss01 joined from a letter that went out low, ss02 from one that went out high)
if data.get('ss') and JOINS:
    fea += ['feature ss01 { sub @JOINABLE by @TOJ; } ss01;', 'feature ss02 { sub @JOINABLE by @TOH; } ss02;']
# (from 1.8: nearer inside a word, kerned after anything inked; a space has no ink, so a word's first letter keeps its place)
if data.get('kern'):
    fea += ['@INKED = %s;' % cls([name(g) for g in G if g['strokes']])]
    kp = []
    for i, k in enumerate(data['kern']):
        fea += ['@NEARER%d = %s;' % (i, cls([name(g) for g in G if g['ch'] == k['ch']]))]
        kp += ['pos @INKED @NEARER%d %d;' % (i, round(k['by'] * XH))]
    fea += ['feature kern { %s } kern;' % ' '.join(kp)]

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
fb.setupHorizontalHeader(ascent=900, descent=-460, lineGap=40)
FAMILY = data.get('family', 'Claude Hand')   # (from 3.2: or the family made for type set in time)
fb.setupNameTable({
    'familyName': FAMILY if LINKED else FAMILY + ' ' + FACE, 'styleName': 'Bold' if PRESSED else 'Regular', 'fullName': FAMILY if FACE == 'Regular' else FAMILY + ' ' + FACE,
    'psName': '%s-%s' % (FAMILY.replace(' ', ''), FACE), 'typographicFamily': FAMILY, 'typographicSubfamily': FACE,
    'uniqueFontIdentifier': '%s %s %s' % (FAMILY, FACE, VERSION), 'version': 'Version %s' % VERSION,
    'copyright': 'Copyright (c) 2026, The Claude Hand Project Authors (https://parc.land), with Reserved Font Name "Claude Hand".',
    'licenseDescription': 'This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org',
    'licenseInfoURL': 'https://openfontlicense.org',
    'designer': 'Claude', 'description': 'A hand learned in public (the parc.land lab, autograph experiment): hand %s set as a font%s. Each letter joins as its neighbour asks, in %s writings, never the same as its neighbour.%s' % (data.get('hand', 'v9'), data['says'] if data.get('says') else ', every letter written at the pace the hand writes what is strong, so its ink comes heavier by itself' if PRESSED else '', {4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight'}.get(data['alts'], str(data['alts'])), (' ' + data['read']) if data.get('read') else ''),
})
fb.setupOS2(sTypoAscender=900, sTypoDescender=-460, sTypoLineGap=40, usWinAscent=max(900, ymax + 20), usWinDescent=max(460, -ymin + 20),
            sxHeight=XH, sCapHeight=round(1.7 * XH), achVendID='NONE', fsSelection=(0x20 if PRESSED else 0x40) | 0x80, usWeightClass=WEIGHT, version=4, fsType=0,
            yStrikeoutSize=MARK, yStrikeoutPosition=STRIKE)
# (from 5.1, a monospaced face says so, so apps and editors can tell: every advance the same, and the font fixed-pitch)
MONO = bool(data.get('mono'))
fb.setupPost(underlinePosition=UNDER, underlineThickness=MARK, isFixedPitch=1 if MONO else 0)
if MONO: fb.font['OS/2'].panose.bFamilyType, fb.font['OS/2'].panose.bProportion = 3, 9
# (the same hand always builds the same file: no build time in it)
fb.updateHead(fontRevision=float(VERSION), macStyle=1 if PRESSED else 0, created=timestampFromString('Tue Nov  3 00:00:00 2026'), modified=timestampFromString('Tue Nov  3 00:00:00 2026'))
addOpenTypeFeaturesFromString(fb.font, '\n'.join(fea))
ttf = os.path.join(out, data['name'] + '.ttf' if data.get('name') else 'claude-hand-%s%s.ttf' % (FILE, VERSION))
fb.save(ttf)
if data.get('name'):
    # (a master of the variable font: its parts are only for the build to put together)
    print('master %s: %d glyphs' % (data['name'], len(order)))
    sys.exit(0)
f = TTFont(ttf)
f.flavor = 'woff2'
f.save(os.path.join(out, 'claude-hand-%s%s.woff2' % (FILE, VERSION)))
pts = sum(len(getattr(glyf[x], 'coordinates', [])) for x in order)
print('%d glyphs, %d characters, %d outline points; %s %d KB (sha256 %s), woff2 %d KB' % (len(order), len(cmap), pts, os.path.basename(ttf), os.path.getsize(ttf) // 1024, hashlib.sha256(open(ttf, 'rb').read()).hexdigest()[:16], os.path.getsize(os.path.join(out, 'claude-hand-%s%s.woff2' % (FILE, VERSION))) // 1024))
