/** Afterword's comprehension check: passages made from a seed, each sentence from a template whose facts are known, so
 * every question has one right answer. Each sentence is a small structure to be held (who gave whom how many, what is
 * where, an order of arrival, a job and a city, a negation, a day): a reader has to have taken it in, not only seen the
 * words. The wrong answers are of the same kind (names from the same passage among them), so none is ruled out by type. */
export type Question = { q: string; options: string[]; answer: number };
export type Passage = { seed: number; text: string; questions: Question[] };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NAMES = ['Mira', 'Tomas', 'Ines', 'Ravi', 'Odile', 'Kofi', 'Hana', 'Lars', 'Noor', 'Pablo', 'Yuki', 'Ada', 'Bram', 'Selin', 'Emeka', 'Freya', 'Iris', 'Jonah'];
const OBJECTS = ['apples', 'letters', 'keys', 'coins', 'books', 'lanterns', 'shells', 'maps', 'pears', 'stamps'];
const COLOURS = ['red', 'blue', 'green', 'yellow', 'white', 'black', 'grey', 'orange'];
const THINGS = ['box', 'jar', 'cup', 'bag', 'lamp', 'kite', 'bowl', 'clock'];
const PLACES = ['shelf', 'table', 'bench', 'windowsill', 'piano', 'chair', 'stove', 'step'];
const CITIES = ['Lisbon', 'Oslo', 'Kyoto', 'Lagos', 'Quito', 'Hanoi', 'Dublin', 'Tunis', 'Perth', 'Riga'];
const JOBS = ['baker', 'pilot', 'nurse', 'carpenter', 'teacher', 'gardener', 'tailor', 'chemist', 'potter', 'sailor'];
const RIDES = ['bus', 'train', 'ferry', 'tram', 'taxi', 'bicycle'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEET = ['market', 'library', 'station', 'harbour', 'bakery', 'museum'];
const NUMS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** a passage of five sentences (one of each of five kinds, in a shuffled order) and a question on each */
export function makePassage(seed: number): Passage {
  const r = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const names = shuffle(NAMES), used: string[] = [];
  const who = () => { const n = names.pop()!; used.push(n); return n; };
  /** four options: the answer and three others of its kind (preferring `near`, things the passage mentions) */
  const ask = (q: string, answer: string, pool: string[], near: string[] = []): Question => {
    const others = shuffle([...near.filter((x) => x !== answer), ...shuffle(pool.filter((x) => x !== answer && !near.includes(x)))]);
    const options = shuffle([answer, ...others.slice(0, 3)]);
    return { q, options, answer: options.indexOf(answer) };
  };
  type Made = { s: string; q: () => Question };
  const kinds: (() => Made)[] = [
    () => { const a = who(), b = who(), n = pick(NUMS), o = pick(OBJECTS);
      return r() < 0.5
        ? { s: `${a} gave ${b} ${n} ${o}.`, q: () => ask(`How many ${o} did ${a} give ${b}?`, n, NUMS) }
        : { s: `${a} gave ${b} ${n} ${o}.`, q: () => ask(`Who did ${a} give the ${o} to?`, b, NAMES, used) }; },
    () => { const c = pick(COLOURS), t = pick(THINGS), p = pick(PLACES);
      return r() < 0.5
        ? { s: `The ${c} ${t} is on the ${p}.`, q: () => ask(`Where is the ${c} ${t}?`, `on the ${p}`, PLACES.map((x) => `on the ${x}`)) }
        : { s: `The ${c} ${t} is on the ${p}.`, q: () => ask(`What colour is the ${t} on the ${p}?`, c, COLOURS) }; },
    () => { const a = who(), b = who(), c = who();
      return r() < 0.5
        ? { s: `${a} arrived after ${b} but before ${c}.`, q: () => ask('Who arrived first?', b, NAMES, [a, b, c]) }
        : { s: `${a} arrived after ${b} but before ${c}.`, q: () => ask('Who arrived last?', c, NAMES, [a, b, c]) }; },
    () => { const a = who(), j = pick(JOBS), city = pick(CITIES);
      return r() < 0.5
        ? { s: `${a} works as a ${j} in ${city}.`, q: () => ask(`What does ${a} do?`, j, JOBS) }
        : { s: `${a} works as a ${j} in ${city}.`, q: () => ask(`Where does ${a} work?`, city, CITIES) }; },
    () => { const a = who(), [t1, t2] = shuffle(RIDES);
      return { s: `${a} did not take the ${t1}; ${a} took the ${t2} instead.`, q: () => ask(`How did ${a} travel?`, `by ${t2}`, RIDES.map((x) => `by ${x}`), [`by ${t1}`]) }; },
    () => { const a = who(), b = who(), d = pick(DAYS), m = pick(MEET);
      return r() < 0.5
        ? { s: `On ${d}, ${a} met ${b} at the ${m}.`, q: () => ask(`When did ${a} meet ${b}?`, `on ${d}`, DAYS.map((x) => `on ${x}`)) }
        : { s: `On ${d}, ${a} met ${b} at the ${m}.`, q: () => ask(`Where did ${a} meet ${b}?`, `at the ${m}`, MEET.map((x) => `at the ${x}`)) }; },
  ];
  const made = shuffle(kinds).slice(0, 5).map((k) => k());
  // (the questions asked once all the names are in, so a name from the passage can stand among the wrong answers)
  return { seed, text: made.map((m) => m.s).join(' '), questions: made.map((m) => m.q()) };
}
