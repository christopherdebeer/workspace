/**
 * The wheel: a joystick that stays put in a bottom corner, so your thumb never covers the sea ahead.
 *
 * Touch anywhere on it (or near it) and drag: left and right steer, up goes faster, down slows and backs off. Push
 * to one side alone and the boat turns while going steadily on. Let go and the knob springs home and the boat eases to
 * a stop, which is how you come alongside a little boat.
 *
 * Keys do the same (arrows, or WASD). Left-handed? It goes in the other corner (`?hand=right`, or the switch on the
 * line-up).
 */
export class Joystick {
  x = 0; y = 0; held = false;
  private el: HTMLElement; private knob: HTMLElement; private id = -1;
  private keys = new Set<string>();
  constructor(host: HTMLElement) {
    this.el = host;
    host.innerHTML = '<div class="base"><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><div class="knob"></div></div>';
    this.knob = host.querySelector('.knob') as HTMLElement;
    host.addEventListener('pointerdown', (e) => {
      if (this.id !== -1) return;
      this.id = e.pointerId; host.setPointerCapture(e.pointerId); this.held = true; this.move(e); e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) this.move(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== this.id) return; this.id = -1; this.held = false; this.x = this.y = 0; this.show(); };
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    addEventListener('keydown', (e) => { if (/^(Arrow|Key[WASD])/.test(e.code)) { this.keys.add(e.code); e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  private move(e: PointerEvent) {
    const r = (this.el.querySelector('.base') as HTMLElement).getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / (R * 0.72), dy = -(e.clientY - (r.top + R)) / (R * 0.72);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.x = dx; this.y = dy; this.show();
  }
  private show() { this.knob.style.transform = `translate(${this.x * 36}px, ${-this.y * 36}px)`; this.el.classList.toggle('held', this.held); }
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
  reset() { this.id = -1; this.held = false; this.x = this.y = 0; this.keys.clear(); this.show(); }
}
