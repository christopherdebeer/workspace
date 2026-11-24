/**
 * Sumi: the same features as stroke gouache (strokes.ts), and most of the coverage left out. The paper carries the
 * walls, the roofs, the street and the sky. What's kept: a loaded ink lip where a roof meets an alley (the darkest of
 * it where the course's line crosses, so the planted shoe meets the strongest part of the stroke), a shorter answering
 * mark on the lower lip across from it, the lightest wash hung from a lip down the shaded wall that turns the plane;
 * elsewhere a lip only now and then, as a short stroke off a corner. The runner: a torso and hips in ink, the head a
 * dab, thin limbs pressed at the joint, the hand and shoe the darkest small marks (the shoe that bears weight heavier);
 * its shadow a pale wash where it falls.
 */
import type { LookDef } from '../looks';
import { TAG } from '../city';
import type { Mark, StrokeRules, V } from '../strokes';
import { EDGE, K, LAYER, add, cross, dot, hashKey, len, lipsOf, onLine, onto, planesOf, rng, scale, sub, unit } from '../strokes';

const SUN: V = [-0.55, 0.6, 0.58], S = unit(SUN);
const INK: V = [0.07, 0.065, 0.065], GREY: V = [0.36, 0.36, 0.39];
const lipped = new Set<number>([TAG.BUILDING, TAG.HUT, TAG.RIM, TAG.STEP]);

export const sumiRules: StrokeRules = {
  paper: [0.95, 0.93, 0.885], grain: 1.3, haze: [0.95, 0.93, 0.885], hazeNear: 0.08, fadeToPaper: 1, sun: SUN,
  city(c, city, put, keeps) {
    void keeps;
    for (const l of lipsOf(c, city)) {
      if (!l.box || !lipped.has(l.box.tag) || l.box.y1 - l.box.y0 < 2) continue;
      const r = rng(hashKey(l.key)), alley = l.across < 7, line = onLine(city, l.a, l.b), d = sub(l.b, l.a);
      let u0: number, u1: number, heart: number, width: number, rank: number;
      if (alley && l.a[1] >= l.acrossH - 0.3) { u0 = 0.02 + r() * 0.03; u1 = 0.97 - r() * 0.04; heart = line ?? 0.3 + r() * 0.4; width = 0.14; rank = 1; }
      else if (alley) {
        // (the answering mark: shorter, about where the other lip is strongest)
        const k = line ?? 0.35 + r() * 0.3, half = 0.2 + r() * 0.1; u0 = Math.max(0, k - half); u1 = Math.min(1, k + half); heart = (k - u0) / (u1 - u0); width = 0.1; rank = 0.9;
      } else {
        if (r() < 0.55 || l.len < 2) continue;
        // (now and then: off a corner, short)
        const from = r() < 0.5, s = 0.2 + r() * 0.25; [u0, u1] = from ? [0, s] : [1 - s, 1]; heart = from ? 0.08 : 0.92; width = 0.085; rank = 0.45;
      }
      const a = add(l.a, scale(d, u0)), b = add(l.a, scale(d, u1)), fwd = heart < 0.5;
      put({ layer: LAYER.EDGE, kind: K.INK + EDGE, a: fwd ? a : b, b: fwd ? b : a, width, col: INK, alpha: 0.95, dry: 0.55, heart: fwd ? heart : 1 - heart, rank, key: `${l.key}/ink`, taper: [0.06, Math.min(1.5, (u1 - u0) * l.len * 0.35)] });
      // (the lightest wash, hung from the lip down the shaded wall it turns)
      if (alley && dot(l.n, S) < 0.15) {
        const H = l.box.y1 - l.box.y0, reach = Math.min(H, 2.5 + r() * 3), plane = planesOf(l.box, city.boxesNear(l.a[0], l.a[2], 1)).find((p) => !p.top && dot(p.n, l.n) > 0.9);
        if (plane) {
          const down: V = [0, -reach / 2, 0], dir = unit(d), across = cross(l.n, dir), flip = across[1] < 0;
          const w0 = add(add(l.a, scale(d, Math.max(0, u0 - 0.05))), down), w1 = add(add(l.a, scale(d, Math.min(1, u1 + 0.05))), down);
          put({ layer: LAYER.BROAD, kind: K.HANG, a: flip ? w1 : w0, b: flip ? w0 : w1, n: l.n, width: reach, col: GREY, alpha: 0.17, rank: 0.62, key: `${l.key}/wash`, clip: plane.clip, taper: [0.6, 1.2] });
        }
      }
    }
    // (an authored sill or bar, which can be taken: a short mark of it)
    if (city.course) for (const h of c.holds) if (h.kind === 'sill' || h.kind === 'bar') put({ layer: LAYER.ACCENT, kind: K.INK + EDGE, a: [h.ax, h.ay, h.az], b: [h.bx, h.by, h.bz], width: 0.06, col: INK, alpha: 0.9, dry: 0.4, heart: 0.3, rank: 0.8, key: `${h.kind}:${h.ax},${h.ay},${h.az}` });
    for (const b of c.props) if (b.tag === TAG.BAR) {
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0, y = (b.y0 + b.y1) / 2, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      const a: V = alongX ? [b.x0, y, mz] : [mx, y, b.z0], e: V = alongX ? [b.x1, y, mz] : [mx, y, b.z1];
      put({ layer: LAYER.EDGE, kind: K.INK + EDGE, a, b: e, width: 0.05, col: INK, alpha: 0.85, dry: 0.5, heart: 0.2, rank: 0.7, key: `bar:${a.join(',')}` });
    }
  },
  figure(parts, _palette, put) {
    const body: Mark[] = [], accents: Mark[] = [];
    for (const p of parts) {
      const m = (o: Partial<Mark>): Mark => ({ layer: 0, kind: K.INK, a: p.a, b: p.b, side: p.side, width: p.width, col: INK, alpha: 0.95, dry: 0.3, heart: 0.3, rank: 1, key: `fig:${p.name}`, ...o });
      if (p.endOn > 0.5 && !['head', 'foreArm', 'upperArm', 'thigh', 'shin', 'worn'].includes(p.kind)) { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.4); body.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: p.girth * 0.8, key: `fig:${p.name}/end` })); }
      // (a limb seen end-on: a short pressed mark of its girth, not a line that has vanished)
      if (p.endOn > 0.6 && ['upperArm', 'foreArm', 'thigh', 'shin'].includes(p.kind)) { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.35); body.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: Math.min(p.girth, 0.1), key: `fig:${p.name}/end` })); }
      switch (p.kind) {
        case 'torso': body.push(m({ width: p.width * 0.8, heart: 0.75, dry: 0.35, taper: [0.08, 0.12] })); break;
        case 'pelvis': body.push(m({ width: p.width * 0.75, heart: 0.5, dry: 0.2, taper: [0.05, 0.06] })); break;
        case 'head': body.push(m({ kind: K.DAB, width: p.width * 0.85, alpha: 0.92 })); break;
        case 'foot': accents.push(m({ width: p.planted ? 0.11 : 0.085, dry: p.planted ? 0 : 0.4, heart: 0.5, alpha: p.planted ? 1 : 0.85, taper: [0.02, 0.04] })); break;
        case 'worn': break;
        default: {
          body.push(m({ width: Math.min(p.width, 0.075), heart: 0.1, dry: 0.45, taper: [0.02, 0.1] }));
          if (p.kind === 'foreArm') {
            const d = unit(sub(p.b, p.a)), s = p.gripping ? 0.065 : 0.08;
            accents.push(m({ kind: K.DAB, a: sub(p.b, scale(d, s * 0.3)), b: add(p.b, scale(d, s * 0.9)), width: s, alpha: p.gripping ? 1 : 0.8, key: `fig:${p.name}/hand` }));
          }
        }
      }
    }
    for (const m of [...body, ...accents]) put(m);
  },
  shadow(parts, rs, put) {
    for (const r of rs) {
      if (r.strength <= 0.02) continue;
      for (const p of parts) {
        if (!['torso', 'pelvis', 'thigh', 'shin', 'head'].includes(p.kind)) continue;
        const a = onto(p.a, r, SUN), b = onto(p.b, r, SUN);
        if (!a || !b || len(sub(b, a)) < 0.02) continue;
        put({ layer: 0, kind: K.WASH, a, b, n: r.n, side: unit(cross(r.n, unit(sub(b, a)))), width: Math.max(0.1, p.width * 1.2), col: GREY, alpha: 0.2 * r.strength + 0.05, rank: 1, key: `shadow:${p.name}`, clip: r.clip });
      }
    }
  },
};

export const sumi: LookDef = {
  name: 'sumi', fog: sumiRules.paper, sun: SUN, shadow: 'none', guides: false, strokes: sumiRules,
  glsl: `vec3 look(Surf s) { return clayOf(s); }`,
};
