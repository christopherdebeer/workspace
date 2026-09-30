import { equation, slot, say, sayAnswer, shown, SYLLABI, type Challenge, type Expr, type Gathered, type SyllabusId } from './challenges';

/**
 * The question at the top of the river: one clear equation, as large and
 * plain as the counting numeral, its blanks filling with the dew gathered.
 * Under it, while a skill is new, a picture of the relationship in dots that
 * fills as the dew does (fading as the child learns it). No instructions, no
 * error sentences: a gathering that is too much shakes its blank, and the
 * river lets the last leaf go.
 *
 * Two small marks, no words: help (the question read aloud and the picture
 * shown; again, and it is worked through with these numbers, aloud) and
 * another (a different question). Screen readers get the words the eye does
 * not.
 *
 * The school year is a grown-up's choice, in a panel a child does not stumble
 * into (press and hold the title).
 */
export class ChallengeUI {
  private root = document.createElement('section');
  private eq = document.createElement('div');
  private model = document.createElement('div');
  private tools = document.createElement('div');
  private grown = document.createElement('div');
  private live = document.getElementById('live')!;
  private blanks: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private rings: HTMLElement[] = [];
  private current: Challenge | null = null;
  private gathered: Gathered = [];
  private helpStep = 0;
  private visible = false;
  private solved = false;
  private helpButton: HTMLButtonElement;
  onHelp: (step: number) => void = () => {};
  onSkip: () => void = () => {};
  onYear: (year: number) => void = () => {};
  onSyllabus: (id: SyllabusId) => void = () => {};

  constructor() {
    this.root.id = 'relationship';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Maths question');
    this.eq.className = 'equation';
    this.model.className = 'model';
    this.tools.className = 'math-tools';
    const icon = (label: string, html: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon';
      b.setAttribute('aria-label', label);
      b.innerHTML = html;
      b.onclick = fn;
      this.tools.append(b);
      return b;
    };
    // a small speaker: help is heard first, then seen
    this.helpButton = icon(
      'Help: hear the question',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      () => this.help(),
    );
    icon('Another question', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.5 3.8v4h-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>', () => this.onSkip());
    this.root.append(this.eq, this.model, this.tools);
    (document.querySelector('header') ?? document.getElementById('ui')!).append(this.root);

    this.grown.id = 'grownups';
    this.grown.hidden = true;
    this.grown.setAttribute('role', 'dialog');
    this.grown.setAttribute('aria-label', 'For grown-ups');
    document.getElementById('ui')!.append(this.grown);
    this.grown.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeGrownUps();
    });
  }

  show(c: Challenge) {
    this.current = c;
    this.solved = false;
    this.visible = true;
    this.root.hidden = false;
    this.root.classList.remove('answered', 'helped');
    this.root.classList.add('arrive');
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('arrive')));
    this.helpStep = 0;
    this.eq.replaceChildren();
    this.blanks = [];
    const render = (e: Expr, parent: HTMLElement) => {
      if (typeof e === 'number') {
        const n = document.createElement('span');
        n.textContent = String(e);
        parent.append(n);
        return;
      }
      if ('slot' in e) {
        const blank = document.createElement('span');
        blank.className = 'blank';
        blank.textContent = '?';
        this.blanks[e.slot] = blank;
        parent.append(blank);
        return;
      }
      render(e.a, parent);
      const sign = document.createElement('span');
      sign.className = 'sign';
      sign.textContent = e.op;
      parent.append(sign);
      render(e.b, parent);
    };
    if (c.dots) {
      // how many? — the quantity as dots, as large as a numeral: a dice pattern while the
      // child is learning it, loose once it is known (the numeral is on the leaves)
      this.eq.append(this.pattern(c.dots, c.form >= 2));
    } else if (c.seq) {
      // the numbers in order, one missing
      c.seq.forEach((n, i) => {
        if (i) {
          const gap = document.createElement('span');
          gap.className = 'gap';
          this.eq.append(gap);
        }
        if (n === null) render(slot(), this.eq);
        else render(n, this.eq);
      });
    } else {
      render(c.left, this.eq);
      const is = document.createElement('span');
      is.className = 'sign';
      is.textContent = '=';
      this.eq.append(is);
      render(c.right, this.eq);
    }
    this.drawModel(c);
    this.progress([]);
    this.live.textContent = say(c);
  }

  hide() {
    this.visible = false;
    this.root.hidden = true;
    this.current = null;
  }

  suspend(value: boolean) {
    this.root.hidden = value || !this.visible;
  }

  /** A quantity as dots: dice patterns to six, five-and-some beyond, or a loose scatter. */
  private pattern(n: number, loose: boolean): HTMLElement {
    const box = document.createElement('span');
    box.className = 'dots';
    const dice: Record<number, Array<[number, number]>> = {
      1: [[1, 1]],
      2: [[0, 0], [2, 2]],
      3: [[0, 0], [1, 1], [2, 2]],
      4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
      6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
    };
    const place = (x: number, y: number) => {
      const i = document.createElement('i');
      i.style.left = `${x}em`;
      i.style.top = `${y}em`;
      box.append(i);
    };
    if (loose) {
      // a loose scatter (seeded by n, so it holds still)
      let s = n * 97 + 13;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const pts: Array<[number, number]> = [];
      for (let tries = 0; pts.length < n && tries < 400; tries++) {
        const p: [number, number] = [rnd() * 2.6, rnd() * 1.4];
        if (pts.every(([x, y]) => Math.hypot(x - p[0], y - p[1]) > 0.52)) pts.push(p);
      }
      pts.forEach(([x, y]) => place(x, y));
      box.style.width = '3em';
      box.style.height = '1.8em';
    } else if (n <= 6) {
      dice[n].forEach(([x, y]) => place(x * 0.55, y * 0.55));
      box.style.width = '1.5em';
      box.style.height = '1.5em';
    } else {
      dice[5].forEach(([x, y]) => place(x * 0.55, y * 0.55));
      dice[n - 5].forEach(([x, y]) => place(1.9 + x * 0.55, y * 0.55));
      box.style.width = '3.4em';
      box.style.height = '1.5em';
    }
    return box;
  }

  /** The picture of the relationship, in dots. */
  private drawModel(c: Challenge) {
    this.model.replaceChildren();
    this.dots = [];
    this.rings = [];
    this.model.className = 'model';
    if (c.mode === 'pick') {
      this.model.style.opacity = '0';
      return;
    }
    const dot = (cls = '') => {
      const i = document.createElement('i');
      if (cls) i.className = cls;
      return i;
    };
    if (c.mode === 'groups') {
      // an array: a row a group, lighting as equal leaves are gathered
      const cols = c.skill === 'pairs' ? Math.min(6, c.total) : c.b;
      this.model.classList.add('array');
      this.model.style.setProperty('--cols', String(cols));
      for (let k = 0; k < c.total; k++) this.model.append((this.dots[k] = dot()));
    } else if (c.mult) {
      // equal groups whose size is the unknown: every ring holds what is gathered
      this.model.classList.add('rings');
      for (let k = 0; k < c.a; k++) {
        const ring = document.createElement('span');
        ring.className = 'ring';
        this.rings.push(ring);
        this.model.append(ring);
      }
    } else {
      // a whole of known and unknown parts, in fives; the unknown lights as dew is gathered
      const answer = c.answers[0];
      const whole = Math.max(c.total, answer);
      const known = whole - answer;
      const taken = c.skill === 'subtract' && answer === c.b;
      this.model.classList.add('line');
      for (let k = 0; k < whole; k++) {
        if (k && k % 5 === 0) this.model.append(document.createElement('b'));
        const i = dot(k < known ? (taken ? 'taken' : 'known') : '');
        if (k >= known) this.dots.push(i);
        this.model.append(i);
      }
    }
    this.model.style.opacity = String(c.support > 0.05 ? 0.3 + 0.7 * c.support : 0);
  }

  /** What is gathered so far: into the blanks, and into the picture. */
  progress(g: Gathered) {
    const c = this.current;
    if (!c || this.solved) return;
    this.gathered = g;
    const v = shown(c, g);
    this.blanks.forEach((el, i) => {
      el.textContent = v[i] ? String(v[i]) : '?';
      el.classList.toggle('filling', !!v[i]);
    });
    const lit = c.mode === 'groups' ? (g[0] ?? 0) * (g[1] ?? 0) : g[0] ?? 0;
    this.dots.forEach((d, i) => d.classList.toggle('on', i < lit));
    for (const ring of this.rings) {
      while (ring.childElementCount < Math.min(12, lit)) ring.append(document.createElement('i'));
      while (ring.childElementCount > Math.min(12, lit)) ring.lastChild!.remove();
    }
    this.live.textContent = `${equation(c, v)}.`;
  }

  /** Too much for the relationship: the blank shakes (the page lets the last leaf go). */
  over() {
    this.root.classList.remove('over');
    void this.root.offsetWidth;
    this.root.classList.add('over');
    this.live.textContent = 'Too many. One leaf goes back.';
  }

  complete(g: Gathered) {
    const c = this.current;
    if (!c) return;
    this.solved = true;
    const v = shown(c, g);
    this.blanks.forEach((el, i) => (el.textContent = String(v[i])));
    this.dots.forEach((d) => d.classList.add('on'));
    this.root.classList.add('answered');
    this.live.textContent = `${equation(c, v)}. Yes.`;
  }

  private speak(text: string) {
    try {
      const s = window.speechSynthesis;
      if (!s) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.85;
      u.pitch = 1.05;
      s.speak(u);
    } catch {
      /* no voice: the picture still helps */
    }
  }

  /** Help: first the question heard and the picture shown; then the answer worked through, aloud. */
  private help() {
    const c = this.current;
    if (!c || this.solved) return;
    this.helpStep = Math.min(2, this.helpStep + 1);
    this.onHelp(this.helpStep);
    this.root.classList.add('helped');
    this.model.style.opacity = '1';
    if (this.helpStep === 1) {
      this.speak(say(c));
      this.live.textContent = say(c);
      this.helpButton.setAttribute('aria-label', 'Help: work it through');
    } else {
      // worked through with these numbers: the unknown's dots count themselves in
      this.model.classList.add('reveal');
      const unknown = c.mode === 'groups' ? this.dots : this.dots.length ? this.dots : [];
      unknown.forEach((d, i) => d.style.setProperty('--i', String(i)));
      if (c.mult && c.mode === 'sum') {
        for (const ring of this.rings) {
          ring.replaceChildren();
          for (let k = 0; k < Math.min(12, c.b); k++) ring.append(document.createElement('i'));
        }
      }
      this.speak(sayAnswer(c));
      this.live.textContent = sayAnswer(c);
    }
  }

  // ─── for grown-ups ──────────────────────────────────────────────────────────

  openGrownUps(syllabus: SyllabusId, year: number | undefined, now: string) {
    const g = this.grown;
    g.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'For grown-ups';
    const p = document.createElement('p');
    p.textContent = 'Where does this child go to school, and which year are they in? The river starts there, moves on when answers hold on more than one day, and steps back if a level is not holding yet.';
    const systems = document.createElement('div');
    systems.className = 'systems';
    (Object.keys(SYLLABI) as SyllabusId[]).forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = SYLLABI[id].name;
      b.setAttribute('aria-pressed', String(id === syllabus));
      b.onclick = () => {
        this.onSyllabus(id);
        this.openGrownUps(id, year, now);
      };
      systems.append(b);
    });
    const row = document.createElement('div');
    row.className = 'years';
    SYLLABI[syllabus].years.forEach(([label], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(i === year));
      b.onclick = () => {
        this.onYear(i);
        this.closeGrownUps();
      };
      row.append(b);
    });
    const at = document.createElement('p');
    at.className = 'now';
    at.textContent = `Now: ${now}.`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = 'close';
    close.onclick = () => this.closeGrownUps();
    g.append(h, p, systems, row, at, close);
    g.hidden = false;
    ((row.querySelector('[aria-pressed=true]') as HTMLElement | null) ?? (row.firstElementChild as HTMLElement))?.focus();
  }

  closeGrownUps() {
    this.grown.hidden = true;
  }
}
