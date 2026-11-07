"""Autograph's writing font (from 3.2, session 32): the hand's letters as the pen wrote them, moment by moment.

Run by devtools/autograph-font-writing.mjs, which sets every letter by the hand with the time the pen reached each point:
python3 autograph-font-writing.py <letters.json> <outdir>.

A font can't move, but a variable font can be set anywhere between its masters, and a page can move that setting. So this
font has an axis of progress (PROG, 0 to 100): each of its masters is every letter as the pen had written it by a moment,
in equal steps of that letter's own writing time, so the pen's slowing on a curve and its stop where it turns back are
in the font as they were in the hand. What isn't written yet is gathered at the pen's tip, as wide as the pen is there;
a stroke not yet begun is gathered at its start, as wide as nothing. A setting between two masters is the letter between
those moments. At 100, its default, every letter is finished, so anything that doesn't move the axis sets finished
letters. With pace (wght) as the variable font has it: 400 the hand's own pace, 700 pressed.

The outlines are the variable font's (autograph-font-vary.py): each stroke outlined on its own, divided evenly along its
length and at the pen's turns, the same points in every master; the moments are carried along with the points. Each master
is built as a font by autograph-font.py (its rules, spacing and kerning, and from 3.2 its joined forms on request, ss01 and
ss02, for a page that sets each letter on its own), and fontTools' varLib puts them together.
"""
import importlib.util, json, math, os, subprocess, sys, tempfile
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.designspaceLib import DesignSpaceDocument, AxisDescriptor, SourceDescriptor
from fontTools import varLib
from fontTools.otlLib.builder import buildStatTable

here = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True   # (no cache beside the tools: the cell takes only what's made on purpose)
spec = importlib.util.spec_from_file_location('vary', os.path.join(here, 'autograph-font-vary.py'))
vary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vary)
XH, PEN, MIN_R, SP = vary.XH, vary.PEN, vary.MIN_R, vary.SP
# (from 3.8, the outline's points spaced a little wider if asked, so the font fits what the cell can take: the least that does)
SP = SP * float(os.environ.get('SP_SCALE', '1'))


def resample_t(P, W, T, n):
    """as the variable font resamples a stroke, evenly along it, and the moment the pen was at each new point"""
    s = vary.along(P)
    if s[-1] < 1e-9:
        return np.repeat(P[:1], n + 1, axis=0), np.repeat(W[:1], n + 1), np.repeat(T[:1], n + 1)
    u = np.linspace(0, s[-1], n + 1)
    return (np.stack([np.interp(u, s, P[:, 0]), np.interp(u, s, P[:, 1])], axis=1), np.interp(u, s, W), np.interp(u, s, T))


def at(C, R, T, tau):
    """one part of a stroke as the pen had written it by the moment tau: what's written stays; the rest is gathered at the
    pen's tip, or, if the part isn't begun (or begins just then), at its start and as wide as nothing"""
    if T[0] >= tau:
        return np.repeat(C[:1], len(C), axis=0), np.zeros(len(C))
    if T[-1] <= tau:
        return C, R
    k = int(np.searchsorted(T, tau, side='right'))
    u = (tau - T[k - 1]) / max(1e-9, T[k] - T[k - 1])
    tip, rt = C[k - 1] + (C[k] - C[k - 1]) * u, R[k - 1] + (R[k] - R[k - 1]) * u
    C2, R2 = C.copy(), R.copy()
    C2[k:] = tip
    R2[k:] = rt
    return C2, R2


def glyph_masters(g, steps):
    """one glyph's contours at every step of its writing, at the hand's own pace and (from 3.4) hurried, each by its own
    moments; and pressed, finished"""
    def arrays(key):
        return ([np.array([[x * XH, y * XH] for x, y, w in s], dtype=float) for s in g[key]],
                [np.array([max(MIN_R, w * PEN * XH / 2) for x, y, w in s], dtype=float) for s in g[key]])
    S, W = arrays('strokes')
    Sp, Wp = arrays('pstrokes')
    hurried = bool(g.get('hstrokes'))
    Sh, Wh = arrays('hstrokes') if hurried else (S, W)
    T = [np.array(t, dtype=float) for t in g['times']]
    Th = [np.array(t, dtype=float) for t in g['htimes']] if hurried else T
    total = max([t[-1] for t in T] or [0])
    totalh = max([t[-1] for t in Th] or [0])
    prog, hprog, pressed = [[] for _ in range(steps + 1)], [[] for _ in range(steps + 1)], []

    def dot(P, Wd, t0, tot, k):
        # (a dot is there from the moment after it's made; at the end, always)
        c, r = P.mean(axis=0), (Wd.max() if k == steps or t0 < tot * k / steps else 0) / math.cos(math.pi / 8)
        return [[int(round(c[0] + r * math.cos(a))), int(round(c[1] + r * math.sin(a)))] for a in (-2 * math.pi * q / 8 for q in range(8))]

    for j in range(len(S)):
        if min(len(S[j]), len(Sp[j]), len(Sh[j])) < 2:
            for k in range(steps + 1):
                prog[k].append(dot(S[j], W[j], T[j][0], total, k))
                hprog[k].append(dot(Sh[j], Wh[j], Th[j][0], totalh, k))
            pressed.append(dot(Sp[j], Wp[j], 0, 0, steps))
            continue
        cut = vary.splits([S[j], Sp[j], Sh[j]])
        for q in range(len(cut[0]) - 1):
            a0, a1 = cut[0][q], cut[0][q + 1]
            b0, b1 = cut[1][q], cut[1][q + 1]
            c0, c1 = cut[2][q], cut[2][q + 1]
            parts = [S[j][a0:a1 + 1], Sp[j][b0:b1 + 1], Sh[j][c0:c1 + 1]]
            n = max(1, max(math.ceil(vary.along(p)[-1] / (SP * XH)) for p in parts))
            C, R, Tq = resample_t(S[j][a0:a1 + 1], W[j][a0:a1 + 1], T[j][a0:a1 + 1], n)
            Ch, Rh, Thq = resample_t(Sh[j][c0:c1 + 1], Wh[j][c0:c1 + 1], Th[j][c0:c1 + 1], n)
            for k in range(steps + 1):
                Ck, Rk = at(C, R, Tq, total * k / steps)
                prog[k].append(vary.outline_piece(Ck, Rk))
                Ck, Rk = at(Ch, Rh, Thq, totalh * k / steps)
                hprog[k].append(vary.outline_piece(Ck, Rk))
            Cp, Rp = vary.resample(Sp[j][b0:b1 + 1], Wp[j][b0:b1 + 1], n)
            pressed.append(vary.outline_piece(Cp, Rp))
    return prog, pressed, hprog


def main():
    data = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    steps = data['steps']
    glyphs = data['glyphs']
    per = [glyph_masters(g, steps) for g in glyphs]
    tmp = tempfile.mkdtemp(prefix='autograph-writing-')
    ds = DesignSpaceDocument()
    hurried = bool(glyphs and glyphs[0].get('hstrokes') is not None)
    for tag, name, lo, df, hi in [('wght', 'Weight', 200 if hurried else 400, 400, 700), ('PROG', 'Progress', 0, 100, 100)]:
        a = AxisDescriptor()
        a.tag, a.name, a.minimum, a.default, a.maximum = tag, name, lo, df, hi
        ds.addAxis(a)
    base = {k: v for k, v in data.items() if k not in ('glyphs', 'steps')}
    masters = [('Pressed', {'Weight': 700, 'Progress': 100}, [p[1] for p in per])]
    # (and pressed before anything's written, which is nothing, as at any pace: without it, a word's pace would add the
    # pressed pen's width to strokes not yet begun, and they'd show as specks ahead of the writing)
    masters += [('Pressed, not yet', {'Weight': 700, 'Progress': 0}, [p[0][0] for p in per])]
    masters += [('Step %d' % k, {'Weight': 400, 'Progress': 100 * k / steps}, [p[0][k] for p in per]) for k in range(steps + 1)]
    # (from 3.4, and hurried, step by step by its own moments)
    if hurried:
        masters += [('Hurried, step %d' % k, {'Weight': 200, 'Progress': 100 * k / steps}, [p[2][k] for p in per]) for k in range(steps + 1)]
    for i, (name, loc, contours) in enumerate(masters):
        # (the builder only needs to know which glyphs have ink, for the s's kerning)
        gl = [dict({kk: vv for kk, vv in g.items() if kk not in ('strokes', 'pstrokes', 'times', 'hstrokes', 'htimes')}, contours=c, strokes=[1] if g['strokes'] else []) for g, c in zip(glyphs, contours)]
        d = dict(base, glyphs=gl, face='Regular', file='', name='writing-%d' % i)
        jp = os.path.join(tmp, 'writing-%d.json' % i)
        json.dump(d, open(jp, 'w'))
        subprocess.run(['python3', os.path.join(here, 'autograph-font.py'), jp, tmp], check=True, stdout=subprocess.DEVNULL)
        src = SourceDescriptor()
        src.path, src.name, src.location = os.path.join(tmp, 'writing-%d.ttf' % i), name, loc
        ds.addSource(src)
    vf, _, _ = varLib.build(ds)
    glyf = vf['glyf']
    for gn in vf.getGlyphOrder():
        g = glyf[gn]
        if getattr(g, 'numberOfContours', 0) > 0:
            g.flags[0] |= 0x40
    buildStatTable(vf, [
        {'tag': 'wght', 'name': 'Weight', 'values': ([{'value': 200, 'name': 'Hurried'}] if hurried else []) + [{'value': 400, 'name': 'Regular', 'flags': 0x2}, {'value': 700, 'name': 'Pressed'}]},
        {'tag': 'PROG', 'name': 'Progress', 'values': [{'value': 100, 'name': 'Written', 'flags': 0x2}, {'value': 0, 'name': 'Not yet'}]},
    ])
    V = data['version']
    ttf = os.path.join(tmp, 'claude-hand-writing-%s.ttf' % V)
    vf.save(ttf)
    f = TTFont(ttf)
    f.flavor = 'woff2'
    woff = os.path.join(out, 'claude-hand-writing-%s.woff2' % V)
    f.save(woff)
    pts = sum(len(getattr(glyf[x], 'coordinates', [])) for x in vf.getGlyphOrder())
    print('writing: %d glyphs, %d outline points, %d masters (%d steps of the hand\'s time%s, and pressed, finished and not yet); woff2 %d KB' % (len(vf.getGlyphOrder()), pts, len(masters), steps, ', at its own pace and hurried' if hurried else '', os.path.getsize(woff) // 1024))
    return ttf


if __name__ == '__main__':
    main()
