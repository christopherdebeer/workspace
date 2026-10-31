/**
 * Staying with it: what you can perceive of the presence (presence.ts), and so whether the chase goes on.
 *
 * Contact has some give. It's one of three:
 * - **seen**: some of its body in view, not hidden behind the land or the culms between;
 * - **traced**: hidden, but its route can still be followed. You heard a footfall, a landing, a rustle, or saw the
 *   canopy shake where it passed. You hold a belief of where it is (where the last cue came from, carried on a little
 *   the way it was going). Hearing it to your side counts; you don't have to be looking at it;
 * - **lost**: the cues have stopped long enough (or it's got too far) that you no longer have a credible direction.
 *   That ends the chase. It isn't a failure: you stop, the grove settles, and you see where it brought you.
 *
 * And sometimes it stops somewhere (a fox lying up, a runner come where they were going), and lets you come: within a
 * few metres, that's **met**, the other ending.
 */
import type { Footings } from './footing';
import type { Cue, Presence } from './presence';

export type Contact = 'seen' | 'traced' | 'lost' | 'met';
/** how far each cue carries (metres, at loudness 1) */
const HEAR = { step: 20, land: 26, rustle: 24, stir: 30 } as const;

export class Chase {
  state: Contact = 'seen';
  /** seconds since the last cue (sight, sound, a shaking canopy) */
  since = 0;
  /** where you believe it is, and when that was last true */
  belief = { x: 0, z: 0, t: 0 };
  /** what the chase has been: how long, how far you ran, how often you found it again after losing sight */
  time = 0; run = 0; regained = 0; seenTime = 0; tracedTime = 0; farthest = 0;
  /** what you perceived this moment: seen, and what was heard or seen moving (for main.ts: which way it sounded from) */
  seen = false; heard: Cue[] = [];
  private look = 0; private wasSeen = true; private unseenAt = 0; private lastCue = 0; private vx = 0; private vz = 0; private px = 0; private pz = 0;
  constructor(readonly it: Presence, readonly feet: Footings) { this.belief = { x: it.x, z: it.z, t: 0 }; this.px = it.x; this.pz = it.z; }
  get over() { return this.state === 'lost' || this.state === 'met'; }

  /** perceive, for `dt` seconds, from `eye` looking along `yaw`/`pitch` with half-angles `hx`, `hy` (radians) */
  update(dt: number, eye: [number, number, number], yaw: number, pitch: number, hx: number, hy: number, ran: number) {
    if (this.over) return;
    const it = this.it;
    this.time += dt; this.run += ran; this.since += dt;
    this.vx += ((it.x - this.px) / Math.max(dt, 1e-3) - this.vx) * Math.min(1, dt * 3); this.vz += ((it.z - this.pz) / Math.max(dt, 1e-3) - this.vz) * Math.min(1, dt * 3);
    this.px = it.x; this.pz = it.z;
    const d = Math.hypot(it.x - eye[0], it.z - eye[2]);
    this.farthest = Math.max(this.farthest, d);
    // (what it's left since last time: heard if near enough for how loud it was; the canopy's shaking seen if in view)
    this.heard = [];
    for (const c of it.cues) {
      if (c.t <= this.lastCue) continue;
      const dc = Math.hypot(c.x - eye[0], c.y - eye[1], c.z - eye[2]);
      const range = HEAR[c.kind] * c.loud;
      if (dc < range || (c.kind === 'stir' && this.inView(eye, yaw, pitch, hx, hy, c.x, c.y, c.z) && dc < 55)) {
        this.heard.push(c); this.since = 0;
        // (you know about where, not exactly)
        this.belief = { x: c.x, z: c.z, t: this.time };
      }
    }
    this.lastCue = it.t;
    // (sight, ten times a second)
    this.look -= dt;
    if (this.look <= 0) { this.look = 0.1; this.seen = it.kind !== 'stir' && d < 85 && this.sees(eye, yaw, pitch, hx, hy); }
    if (this.seen) { if (!this.wasSeen && this.state === 'traced' && this.time - this.unseenAt > 2) this.regained++; this.since = 0; this.belief = { x: it.x, z: it.z, t: this.time }; }
    else if (this.wasSeen) this.unseenAt = this.time;
    this.wasSeen = this.seen;
    // (the chase: seen; traced while the cues keep coming, with some give; lost when they stop, or it's far away)
    if (it.mode === 'rest' && d < 4.5) { this.state = 'met'; return; }
    if (this.seen) this.state = 'seen';
    else if (d > 110 || this.since > (d < 45 ? 9 : 6)) this.state = 'lost';
    else this.state = 'traced';
    if (this.state === 'seen') this.seenTime += dt; else if (this.state === 'traced') this.tracedTime += dt;
  }
  /** where you'd guess it is now: the belief, carried on the way it was going for as long as it's been unseen (capped) */
  guess(): [number, number] {
    const a = Math.min(4, this.time - this.belief.t);
    return [this.belief.x + this.vx * a * 0.6, this.belief.z + this.vz * a * 0.6];
  }

  private inView(eye: number[], yaw: number, pitch: number, hx: number, hy: number, x: number, y: number, z: number) {
    const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2], h = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) - yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
    return Math.abs(a) < hx && Math.abs(Math.atan2(dy, h) - pitch) < hy;
  }
  /** some of its body in view and not hidden: by the land (the ground rising over the line to it) or the culms */
  private sees(eye: [number, number, number], yaw: number, pitch: number, hx: number, hy: number) {
    const it = this.it, F = this.feet, body = it.parts();
    const pts = body.length ? [body[0], body[1], body[3] ?? body[2]] : [];
    let posts: ReturnType<Footings['posts']> | null = null;
    for (const p of pts) {
      if (!this.inView(eye, yaw, pitch, hx, hy, p.x, p.y, p.z)) continue;
      const dx = p.x - eye[0], dy = p.y - eye[1], dz = p.z - eye[2], L = Math.hypot(dx, dz);
      let hidden = false;
      for (let s = 1; s < L && !hidden; s += 1) { const f = s / L; if (F.groundAt(eye[0] + dx * f, eye[2] + dz * f) > eye[1] + dy * f + 0.05) hidden = true; }
      if (hidden) continue;
      posts ??= F.posts((eye[0] + it.x) / 2, (eye[2] + it.z) / 2, Math.hypot(it.x - eye[0], it.z - eye[2]) / 2 + 2);
      const ux = dx / L, uz = dz / L;
      for (const q of posts) {
        const rx = q.x - eye[0], rz = q.z - eye[2], al = rx * ux + rz * uz;
        if (al <= 0.3 || al >= L - 0.2) continue;
        const yAt = eye[1] + dy * (al / L), gy = F.groundAt(q.x, q.z);
        if (yAt - gy < q.lo || yAt - gy > q.hi) continue;
        if (Math.abs(-rx * uz + rz * ux) < q.r + 0.03) { hidden = true; break; }
      }
      if (!hidden) return true;
    }
    return false;
  }
}
