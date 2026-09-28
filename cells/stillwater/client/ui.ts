/**
 * The only words and marks over the water: the title (which fades once the
 * journey starts), the target drawn as dew-dots, a line of hint that comes and
 * goes, the sound toggle, and a polite live region for screen readers.
 *
 * The target's SHAPE carries the maths without saying it:
 *   line     • • • •            counting
 *   frames   ten-frames         adding past five and ten
 *   array    rows of equal dots equal groups — one row per leaf
 *   numeral  18                 the product alone
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

  setTarget(t: Target, display: Display) {
    this.value = t.value;
    const el = this.target;
    el.className = 'target ' + display;
    el.innerHTML = '';
    this.dots = [];
    this.bar = null;
    const dot = () => {
      const i = document.createElement('i');
      this.dots.push(i);
      return i;
    };
    if (display === 'line') {
      for (let k = 0; k < t.value; k++) el.appendChild(dot());
    } else if (display === 'frames') {
      for (let f = 0; f < Math.ceil(t.value / 10); f++) {
        const frame = document.createElement('span');
        frame.className = 'frame';
        for (let k = 0; k < 10; k++) {
          const i = dot();
          if (f * 10 + k >= t.value) i.className = 'blank';
          frame.appendChild(i);
        }
        el.appendChild(frame);
      }
      this.dots = this.dots.filter((d) => d.className !== 'blank');
    } else if (display === 'array') {
      const rows = t.rows ?? 1;
      const cols = t.cols ?? t.value;
      el.style.setProperty('--cols', String(cols));
      for (let k = 0; k < rows * cols; k++) el.appendChild(dot());
    } else {
      const num = document.createElement('b');
      num.textContent = String(t.value);
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('span');
      bar.appendChild(fill);
      el.append(num, bar);
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

  announce(text: string) {
    this.live.textContent = text;
  }
}
