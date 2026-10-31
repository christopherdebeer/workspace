/**
 * Staying with it: what you can actually perceive of the presence (presence.ts), and so whether the chase goes on.
 *
 * Contact, with some give:
 * - **seen**: some of its body in view and readable. Not behind the land, a stone or the culms between you, large
 *   enough on the screen to make out, and somewhere the drawing still describes it (its colour or its ink reaches there,
 *   as the renderer judges it, `legible`);
 * - **traced**: hidden, but its route can still be followed. You heard it (only if you can hear: the sound's on, and
 *   not drowned by a gust or your own running), or you saw the grove move where it passed (stems still swaying, leaves
 *   settling) in view, not behind anything, and drawn. You hold a belief of where it is: where the last of these came
 *   from, carried on the way you've seen it going, never the way it's really going unseen;
 * - **searching**: the cues have stopped. The last of them is fading; there's still time to find it again;
 * - **lost**: you no longer have a credible direction. Not final while it's still somewhere near: see it or hear it
 *   again and the chase is on again. It ends once it's well away (or long gone);
 * - **met**: it stopped somewhere (a fox lying up, a runner come where they were going) and let you come up to it.
 */
import type { Footings } from './footing';
import type { Cue, Presence } from './presence';

export type Contact = 'seen' | 'traced' | 'searching' | 'lost' | 'met';
/** how far each cue carries (metres, at loudness 1, in quiet) */
const HEAR = { step: 20, land: 28, rustle: 22, stir: 30 } as const;
/** what's needed to perceive: where you look from and how wide; how many radians a pixel is; whether the drawing
 * describes a point (0 … 1); whether you can hear, and how much of it's drowned */
export interface Senses {
  eye: [number, number, number]; yaw: number; pitch: number; hx: number; hy: number; px: number;
  legible: (x: number, y: number, z: number) => number;
  hearing: boolean; mask: number;
}

export class Chase {
  state: Contact = 'seen';
  /** seconds since the last cue (sight, sound, the grove moving) */
  since = 0;
  /** where you believe it is, and when that was last true; the way you've seen it going */
  belief = { x: 0, z: 0, t: 0 }; vel = { x: 0, z: 0 };
  /** what the chase has been */
  time = 0; run = 0; regained = 0; seenTime = 0; tracedTime = 0; searchTime = 0; farthest = 0; lostAt = -1;
  /** this moment: seen, and what was heard or seen moving (main.ts plays the sounds from where they were) */
  seen = false; heard: Cue[] = []; glimpsed = 0;
  /** ended for good (met, or lost and it's gone well away) */
  ended = false;
  private look = 0; private wasSeen = true; private unseenAt = 0; private lastCue = -1; private lastSeen: { x: number; z: number; t: number } | null = null;
  constructor(readonly it: Presence, readonly feet: Footings) { this.belief = { x: it.x, z: it.z, t: 0 }; this.lastCue = it.t; }
  get over() { return this.ended; }

  update(dt: number, s: Senses, ran: number) {
    if (this.ended) return;
    const it = this.it, eye = s.eye;
    this.time += dt; this.run += ran; this.since += dt;
    const d = Math.hypot(it.x - eye[0], it.z - eye[2]);
    this.farthest = Math.max(this.farthest, d);
    // ─── what you hear of it, and what of the grove you see move ───
    this.heard = [];
    for (const c of it.cues) {
      if (c.t <= this.lastCue) continue;
      const dc = Math.hypot(c.x - eye[0], c.y - eye[1], c.z - eye[2]);
      const range = HEAR[c.kind] * c.loud * (1 - Math.min(0.8, s.mask));
      if (s.hearing && dc < range) { this.heard.push(c); this.know(c.x, c.z); }
    }
    for (const k of it.shakes) {
      if (k.t <= this.lastCue) continue;
      const gy = this.feet.groundAt(k.x, k.z) + (it.kind === 'stir' ? 7 : 1.2), dk = Math.hypot(k.x - eye[0], k.z - eye[2]);
      if (dk < 45 && this.inView(s, k.x, gy, k.z) && s.legible(k.x, gy, k.z) > 0.35 && it.clear(eye, [k.x, gy, k.z])) { this.glimpsed++; this.know(k.x, k.z); }
    }
    this.lastCue = it.t;
    // ─── sight, ten times a second ───
    this.look -= dt;
    if (this.look <= 0) { this.look = 0.1; this.seen = it.kind !== 'stir' && d < 90 && this.sees(s, d); }
    if (this.seen) {
      if (!this.wasSeen && this.time - this.unseenAt > 2 && this.state !== 'seen') this.regained++;
      // (its way, from where you've seen it go)
      if (this.lastSeen && this.time - this.lastSeen.t > 0.05 && this.time - this.lastSeen.t < 0.8) {
        const h = this.time - this.lastSeen.t;
        this.vel.x += ((it.x - this.lastSeen.x) / h - this.vel.x) * 0.5; this.vel.z += ((it.z - this.lastSeen.z) / h - this.vel.z) * 0.5;
      }
      this.lastSeen = { x: it.x, z: it.z, t: this.time };
      this.since = 0; this.belief = { x: it.x, z: it.z, t: this.time };
    } else if (this.wasSeen) this.unseenAt = this.time;
    this.wasSeen = this.seen;
    // ─── where the chase stands ───
    if (it.mode === 'rest' && d < 4.5 && this.seen && it.alarm < 0.6) { this.state = 'met'; this.ended = true; return; }
    const grace = d < 45 ? 7 : 5;
    if (this.seen) this.state = 'seen';
    else if (this.since < grace) this.state = 'traced';
    else if (this.since < grace + 9 && d < 110) this.state = 'searching';
    else { if (this.state !== 'lost') this.lostAt = this.time; this.state = 'lost'; }
    if (this.state === 'seen') this.seenTime += dt; else if (this.state === 'traced') this.tracedTime += dt; else if (this.state === 'searching') this.searchTime += dt;
    if (this.state === 'lost' && (d > 110 || this.time - this.lostAt > 20)) this.ended = true;
  }
  /** a cue's where you now believe it is; its way from the last two, if close enough in time */
  private know(x: number, z: number) {
    const h = this.time - this.belief.t;
    if (!this.seen && h > 0.2 && h < 3) { this.vel.x += ((x - this.belief.x) / h - this.vel.x) * 0.3; this.vel.z += ((z - this.belief.z) / h - this.vel.z) * 0.3; }
    this.belief = { x, z, t: this.time }; this.since = 0;
  }
  /** where you'd guess it is now: the belief carried on the way you've seen it going (capped) */
  guess(): [number, number] {
    const a = Math.min(3, this.time - this.belief.t);
    return [this.belief.x + this.vel.x * a * 0.7, this.belief.z + this.vel.z * a * 0.7];
  }

  private inView(s: Senses, x: number, y: number, z: number) {
    const dx = x - s.eye[0], dy = y - s.eye[1], dz = z - s.eye[2], h = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) - s.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
    return Math.abs(a) < s.hx && Math.abs(Math.atan2(dy, h) - s.pitch) < s.hy;
  }
  /** some of its body: in view, big enough on the screen to make out, drawn there, and not hidden */
  private sees(s: Senses, d: number) {
    const it = this.it, body = it.parts();
    if (!body.length) return false;
    // (how big it is on the screen: a fox's body seen at this distance, in pixels; under eight, it's a fleck, not a fox)
    const size = (it.kind === 'fox' ? 0.75 : 1.8) / Math.max(0.5, d) / s.px;
    if (size < 8) return false;
    const pts = [body[0], body[4] ?? body[1], body[body.length - 1]];
    for (const p of pts) {
      if (!this.inView(s, p.x, p.y, p.z) || s.legible(p.x, p.y, p.z) < 0.35) continue;
      if (it.clear(s.eye, [p.x, p.y, p.z])) return true;
    }
    return false;
  }
}
