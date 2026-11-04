/**
 * The wheel: a joystick, in one of two places.
 *
 * - **Wherever you touch** (unless asked otherwise): there's nothing drawn; put your finger down anywhere on the sea and
 *   that's the middle of the stick for as long as it stays down: drag ahead to go, to one side to turn, back to slow and
 *   back off. While your finger's down a faint ring shows where you put it, and a dot where you've dragged to. Until
 *   you've steered, the ring shows lower down, its dot drifting up, to say how.
 * - **In a bottom corner** (the right or the left): a stick that stays put, so your thumb never covers the sea ahead.
 *   Touch anywhere on it (or near it) and drag.
 *
 * Either way it's the same stick: left and right steer, up goes faster, down slows and backs off. Push to one side alone
 * and the boat turns while going steadily on. Let go and the knob springs home and the boat eases to a stop, which is how
 * you come alongside a little boat. Keys do the same (arrows, or WASD).
 */
export type Steer = 'touch' | 'left' | 'right';
/** wherever you touch: how far (px) from where you put your finger is full stick */
const REACH = 64;

export class Joystick {
  x = 0; y = 0; held = false;
  private el: HTMLElement; private knob: HTMLElement; private ghost: HTMLElement; private id = -1;
  /** where a touch on the sea took hold (null: on the corner stick) */
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
  /** steer from wherever you touch on `surface`, while `ok` says so: where the touch starts is the stick's middle */
  anywhere(surface: HTMLElement, ok: () => boolean) {
    surface.addEventListener('pointerdown', (e) => { if (this.id === -1 && ok()) this.take(surface, e, [e.clientX, e.clientY]); });
    this.follow(surface);
  }
  /** until you've steered: the ring low down the screen, its dot drifting up (`on`) */
  hint(on: boolean) {
    if (this.grip) return;
    this.ghost.classList.toggle('on', on); this.ghost.classList.toggle('hint', on);
    if (on) { this.ghost.style.transform = `translate(${innerWidth / 2}px, ${innerHeight * 0.72}px)`; (this.ghost.firstChild as HTMLElement).style.transform = ''; }
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
    this.ghost.classList.toggle('on', !!this.grip); if (this.grip) this.ghost.classList.remove('hint');
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
