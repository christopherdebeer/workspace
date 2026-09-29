/**
 * The lantern keeper: a picture book told one line at a time, laid over the
 * river (NARRATIVE-DESIGN.md §4). At each pier someone is waiting — a heron
 * who has seen every fish, a frog who wants a lily of her own, an old turtle
 * who remembers the river before the piers — and each wants one thing that the
 * rest of the river already provides: the notebook, a planting, the lantern.
 * Nothing fails; a chapter that is not finished tonight waits.
 *
 * This file is the book: who the residents are, what they say, and what they
 * are waiting for. The world decides where they stand and when the boat has
 * arrived; the rest of the river decides whether they are content.
 */

export type ResidentKind = 'heron' | 'frog' | 'turtle';
export const RESIDENTS: ResidentKind[] = ['heron', 'frog', 'turtle'];

/** What the river can tell a resident. */
export interface RiverNow {
  /** Has the child's notebook got this species? */
  seen: (id: string) => boolean;
  /** The nearest planting to this true distance down the river, in days grown, or null. */
  plantingNear: (Y: number, within: number) => number | null;
  /** The lantern's warmth, 0 … 1.5. */
  lantern: number;
  /** 0 day … 1 night. */
  dusk: number;
}

export interface Chapter {
  /** Met: the resident has greeted this child. */
  met: boolean;
  /** Content: what they wanted has come. */
  done: boolean;
  /** How many times the child has visited them. */
  visits: number;
}

export interface StoryData {
  chapters: Partial<Record<ResidentKind, Chapter>>;
}

/** A line to say, and whether it closes the chapter. */
export interface Line {
  text: string;
  done?: boolean;
}

/** A resident's lines: the greeting, the ask, and the words when it is answered. */
const BOOK: Record<ResidentKind, { greet: string[]; ask: (r: RiverNow, Y: number) => Line; content: string[]; again: string[] }> = {
  heron: {
    greet: ['a heron, grey and still, watches the boat come in', 'the heron has stood here longer than the pier'],
    ask: (r) =>
      r.seen('koi') ? { text: '"so you have seen the koi too," says the heron. "few do."', done: true } : { text: '"have you seen the koi?" asks the heron. "it comes to the piers, in the evening."' },
    content: ['the heron nods, slowly, the way herons do', '"the river keeps its fish," says the heron, "and you keep your notebook."'],
    again: ['the heron is watching the water', 'the heron does not move. it is very good at that.'],
  },
  frog: {
    greet: ['a small frog sits at the end of the pier, hoping', '"oh! a boat," says the frog'],
    ask: (r, Y) => {
      const days = r.plantingNear(Y, 500);
      if (days !== null && days >= 0.5) return { text: '"a leaf! my own leaf!" says the frog, and hops onto it', done: true };
      if (days !== null) return { text: '"something is growing," says the frog. "I can wait. frogs are patient."' };
      return { text: '"I would so like a lily of my own," says the frog. "a spent flower has seeds…"' };
    },
    content: ['the frog is sitting on her leaf, very pleased', '"mine," says the frog, to nobody'],
    again: ['the frog is thinking about flies', '"still waiting," says the frog, cheerfully'],
  },
  turtle: {
    greet: ['an old turtle rests on the pier, half asleep', 'the turtle opens one eye. it has seen a great many boats.'],
    ask: (r) =>
      r.lantern >= 0.85
        ? { text: '"there," says the turtle. "that is the light I remember. before the piers."', done: true }
        : { text: '"the lanterns were brighter once," says the turtle. "dew, gathered well, keeps one bright."' },
    content: ['the turtle is asleep in the lantern light', '"go on, then," says the turtle. "the river is long."'],
    again: ['the turtle is asleep', 'the turtle is remembering something'],
  },
};

export class Story {
  chapters: Partial<Record<ResidentKind, Chapter>>;

  constructor(saved: StoryData | null = null) {
    this.chapters = saved?.chapters ?? {};
  }

  chapter(kind: ResidentKind): Chapter {
    return (this.chapters[kind] ??= { met: false, done: false, visits: 0 });
  }

  /**
   * The boat has come to a resident's pier: the lines to say, in order, a few
   * seconds apart. A first visit greets and asks; a later one asks again (or,
   * once content, says so). Marks the chapter as the lines decide.
   */
  visit(kind: ResidentKind, river: RiverNow, Y: number, pick: (n: number) => number = (n) => Math.floor(Math.random() * n)): Line[] {
    const ch = this.chapter(kind);
    const book = BOOK[kind];
    const lines: Line[] = [];
    ch.visits += 1;
    if (ch.done) {
      lines.push({ text: book.content[pick(book.content.length)] });
      return lines;
    }
    if (!ch.met) {
      ch.met = true;
      lines.push({ text: book.greet[pick(book.greet.length)] });
    } else lines.push({ text: book.again[pick(book.again.length)] });
    const ask = book.ask(river, Y);
    lines.push(ask);
    if (ask.done) {
      ch.done = true;
      lines.push({ text: book.content[0] });
    }
    return lines;
  }

  get told(): number {
    return RESIDENTS.filter((k) => this.chapters[k]?.done).length;
  }

  toJSON(): StoryData {
    return { chapters: this.chapters };
  }
}
