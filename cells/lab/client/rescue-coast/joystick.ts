/**
 * The wheel: a joystick, in one of two places.
 *
 * - **On your boat** (unless asked otherwise): there's nothing drawn; put your finger on your lifeboat and drag, and the
 *   boat is the stick's knob: drag ahead to go, to one side to turn, back to slow and back off. While your finger's down
 *   a faint ring shows where you took hold of it. A touch that starts anywhere else on the sea does nothing.
 * - **In a bottom corner** (the right or the left): a stick that stays put, so your thumb never covers the sea ahead.
 *   Touch anywhere on it (or near it) and drag.
 *
 * Either way it's the same stick: left and right steer, up goes faster, down slows and backs off. Push to one side alone
 * and the boat turns while going steadily on. Let go and the knob springs home and the boat eases to a stop, which is how
 * you come alongside a little boat. Keys do the same (arrows, or WASD).
 */
export type Steer = 'boat' | 'left' | 'right';
/** on the boat: how far (px) from where you took hold is full stick */
const REACH = 64;

export class Joystick {
  x = 0; y = 0; held = false;
  private el: HTMLElement; private knob: HTMLElement; private ghost: HTMLElement; private id = -1;
  /** where a touch on the boat took hold (null: on the corner stick) */
  private grip: [number, number] | null = null;
  private keys = new Set<string>();
  constructor(host: HTMLElement, ghost: HTMLElement) {
    this.el = host; this.ghost = ghost;
    host.innerHTML = '<div class="base"><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><div class="knob"></div></div>';
    this.knob = host.querySelector('.knob') as HTMLElement;
    ghost.innerHTML = '<i></i>';
    host.addEventListener('pointerdown', (e) => { if (this.id === -1) this.take(host, e, null); });
    this.follow(host);
    addEventListener('keydown', (e) => { if (/^(Arrow|Key[WASD])/.test(e.code)) { this.keys.add(e.code); e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  /** steer from the boat on `surface`: a touch there that `onBoat` says is on your boat takes hold of it */
  fromBoat(surface: HTMLElement, onBoat: (x: number, y: number) => boolean) {
    surface.addEventListener('pointerdown', (e) => { if (this.id === -1 && onBoat(e.clientX, e.clientY)) this.take(surface, e, [e.clientX, e.clientY]); });
    this.follow(surface);
  }
  private take(on: HTMLElement, e: PointerEvent, grip: [number, number] | null) {
    this.id = e.pointerId; on.setPointerCapture(e.pointerId); this.held = true; this.grip = grip; this.move(e); e.preventDefault();
  }
  private follow(on: HTMLElement) {
    on.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) this.move(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== this.id) return; this.id = -1; this.held = false; this.grip = null; this.x = this.y = 0; this.show(); };
    on.addEventListener('pointerup', up); on.addEventListener('pointercancel', up);
  }
  private move(e: PointerEvent) {
    let dx: number, dy: number;
    if (this.grip) { dx = (e.clientX - this.grip[0]) / REACH; dy = -(e.clientY - this.grip[1]) / REACH; }
    else {
      const r = (this.el.querySelector('.base') as HTMLElement).getBoundingClientRect(), R = r.width / 2;
      dx = (e.clientX - (r.left + R)) / (R * 0.72); dy = -(e.clientY - (r.top + R)) / (R * 0.72);
    }
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.x = dx; this.y = dy; this.show();
  }
  private show() {
    this.knob.style.transform = `translate(${this.x * 36}px, ${-this.y * 36}px)`; this.el.classList.toggle('held', this.held && !this.grip);
    // (on the boat: a faint ring where you took hold, a dot where the knob's got to)
    this.ghost.classList.toggle('on', !!this.grip);
    if (this.grip) { this.ghost.style.transform = `translate(${this.grip[0]}px, ${this.grip[1]}px)`; (this.ghost.firstChild as HTMLElement).style.transform = `translate(${this.x * REACH}px, ${-this.y * REACH}px)`; }
  }
  /** what the hand asks for: steer (right +) and throttle (ahead +) */
  read(): { steer: number; throttle: number; active: boolean } {
    let x = this.x, y = this.y;
    const k = this.keys;
    if (k.size) {
      x = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
      y = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 0.7 : 0);
    }
    const m = Math.min(1, Math.hypot(x, y));
    const throttle = y < -0.35 ? y * 0.6 : Math.max(y, m * 0.55);
    return { steer: Math.max(-1, Math.min(1, x)), throttle, active: m > 0.05 };
  }
  reset() { this.id = -1; this.held = false; this.grip = null; this.x = this.y = 0; this.keys.clear(); this.show(); }
}
