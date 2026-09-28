/**
 * The only words and marks over the water: the title (which fades once the
 * journey starts), the target drawn as dew-dots, a line of hint that comes and
 * goes, the sound toggle, and a polite live region for screen readers.
 *
 * The target is always its numeral; under it a fading scaffold carries the maths:
 *   line     • • • •            counting
 *   frames   ten-frames         adding past five and ten
 *   array    rows of equal dots equal groups — one row per leaf
 *   numeral  (no dots)          the product alone
 */
import type { Display, Target } from './numeracy';
import { numberWord } from './numeracy';

export class Overlay {
  private title = document.getElementById('title')!;
  private target = document.getElementById('target')!;
  private hint = document.getElementById('hint')!;
  private live = document.getElementById('live')!;
  private hintTimer = 0;
  private dots: HTMLElement[] = [];
  private bar: HTMLElement | null = null;
  private value = 0;

  fadeTitle() {
    this.title.classList.add('quiet');
  }

  /**
   * The ask is always the NUMERAL: reading "7" and gathering seven is the
   * skill (numeral ↔ quantity), not matching dots to drops. Under it, the
   * dots are a scaffold — a line, ten-frames, or an array of equal rows —
   * whose strength is `support` (1 while a form is new, fading as the child
   * grows past it). Once it has faded away a thin bar tracks the gathering.
   */
  setTarget(t: Target, display: Display, support = 1) {
    this.value = t.value;
    const el = this.target;
    el.className = 'target numeral';
    el.innerHTML = '';
    this.dots = [];
    this.bar = null;
    const num = document.createElement('b');
    num.textContent = String(t.value);
    el.appendChild(num);
    const dot = () => {
      const i = document.createElement('i');
      this.dots.push(i);
      return i;
    };
    if (support >= 0.12 && display !== 'numeral') {
      const sc = document.createElement('div');
      sc.className = 'scaffold ' + display;
      sc.style.opacity = String(Math.min(1, 0.25 + support * 0.75));
      if (display === 'line') {
        for (let k = 0; k < t.value; k++) sc.appendChild(dot());
      } else if (display === 'frames') {
        for (let f = 0; f < Math.ceil(t.value / 10); f++) {
          const frame = document.createElement('span');
          frame.className = 'frame';
          for (let k = 0; k < 10; k++) {
            const i = dot();
            if (f * 10 + k >= t.value) i.className = 'blank';
            frame.appendChild(i);
          }
          sc.appendChild(frame);
        }
        this.dots = this.dots.filter((d) => d.className !== 'blank');
      } else {
        const rows = t.rows ?? 1;
        const cols = t.cols ?? t.value;
        sc.style.setProperty('--cols', String(cols));
        for (let k = 0; k < rows * cols; k++) sc.appendChild(dot());
      }
      el.appendChild(sc);
    } else {
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('span');
      bar.appendChild(fill);
      el.appendChild(bar);
      this.bar = fill;
    }
    el.classList.add('arrive');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('arrive')));
    this.progress(0);
  }

  progress(n: number) {
    this.dots.forEach((d, i) => d.classList.toggle('on', i < n));
    if (this.bar) this.bar.style.width = `${Math.min(100, (n / Math.max(1, this.value)) * 100)}%`;
    this.live.textContent = `Gather ${numberWord(this.value)}. ${n} gathered.`;
  }

  /** Show a hint for `seconds` (0 = until replaced). */
  say(text: string, seconds = 6) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    window.clearTimeout(this.hintTimer);
    if (seconds) this.hintTimer = window.setTimeout(() => this.hint.classList.remove('show'), seconds * 1000);
  }

  quiet() {
    this.hint.classList.remove('show');
  }

  clearTarget() {
    this.target.innerHTML = '';
    this.dots = [];
    this.bar = null;
    this.value = 0;
  }

  announce(text: string) {
    this.live.textContent = text;
  }
}
