/**
 * The poetics harness's scorer (cells/poetics/devtools/lib/score.cjs): the
 * deterministic half of the experiment. Pins what each family rewards and
 * punishes, on the committed tasks, so a change to the scorer is a visible
 * change to every published number.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Task {
  id: string;
  family: string;
  cohort?: string;
  instruction: string;
  source: string;
  checks: {
    protected?: string[];
    maxWords?: number;
    gaps?: Array<{ n: number; expected: string[] | null }>;
    lines?: Array<{ role: 'fix' | 'keep'; expected: string }>;
  };
}
interface Scored {
  score: number;
  components: Record<string, number>;
  detail: Record<string, unknown>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scorer = require('../cells/poetics/devtools/lib/score.cjs') as {
  score(task: Task, output: string): Scored;
  inventions(task: Task, output: string): string[];
  gapFills(task: Task, output: string): Array<string | null>;
  FAMILIES: string[];
};

const TASKS = join(__dirname, '..', 'cells', 'poetics', 'static', 'tasks');
const load = (id: string): Task => JSON.parse(readFileSync(join(TASKS, `${id}.json`), 'utf8')) as Task;

describe('the committed tasks', () => {
  it('every task has a scorer and a well-formed check block', () => {
    for (const f of readdirSync(TASKS).filter((x) => x.endsWith('.json'))) {
      const t = JSON.parse(readFileSync(join(TASKS, f), 'utf8')) as Task;
      expect(scorer.FAMILIES).toContain(t.family);
      expect(t.id).toBe(f.replace(/\.json$/, ''));
      expect(['r1', 'r2']).toContain(t.cohort);
      if (t.family === 'gaps') {
        // every [gap N] in the source has a check, in order, and vice versa
        const ns = [...t.source.matchAll(/\[gap (\d+)\]/g)].map((m) => Number(m[1]));
        expect(t.checks.gaps!.map((g) => g.n)).toEqual(ns);
      }
      if (t.family === 'records') {
        // the expected lines are the source's record lines with only the corrected field changed
        const recs = t.source.split('\n').filter((l) => /\|/.test(l));
        expect(t.checks.lines!.length).toBe(recs.length);
        t.checks.lines!.forEach((l, i) => {
          const a = recs[i].split('|').map((x) => x.trim());
          const b = l.expected.split('|').map((x) => x.trim());
          expect(b.slice(0, -1)).toEqual(a.slice(0, -1));
          expect(b[b.length - 1] === a[a.length - 1]).toBe(l.role === 'keep');
        });
      }
      if (t.family === 'names') expect(typeof t.checks.maxWords).toBe('number');
      if (t.family === 'gaps') expect(t.checks.gaps!.length).toBeGreaterThan(0);
      if (t.family === 'records') expect(t.checks.lines!.length).toBeGreaterThan(0);
      // every protected string really is in the source (else retention could never be 1)
      for (const p of t.checks.protected ?? []) expect(t.source).toContain(p);
    }
  });

  it('a records task scores 1 on its own expected lines and 0.5 on an unchanged copy', () => {
    for (const id of ['records-1', 'records-2']) {
      const t = load(id);
      const perfect = t.checks.lines!.map((l) => l.expected).join('\n');
      expect(scorer.score(t, perfect).score).toBe(1);
      const unchanged = t.source.split('\n').filter((l) => /\|/.test(l)).join('\n');
      const s = scorer.score(t, unchanged);
      expect(s.components.restraint).toBe(1);
      expect(s.components.correction).toBe(0);
      expect(s.score).toBe(0.5);
    }
  });
});

describe('names', () => {
  const t = load('names-1');
  it('rewards verbatim identifiers under the limit, no inventions', () => {
    const out =
      'Pennington Street depot opened in 1911 for Harrowgate & Fenwick Tramways. Ailsa Okonkwo-Reyes managed it until 1934 and kept the No. 7 route running in 1926. The Caldbeck Lane shed stored bogies; the frontage survives.';
    const s = scorer.score(t, out);
    expect(s.components.retention).toBe(1);
    expect(s.components.lengthOk).toBe(1);
    expect(s.detail.inventions).toEqual([]);
    expect(s.score).toBe(1);
  });
  it('punishes an altered name and an invented number', () => {
    const out = 'Pennington Street depot opened in 1911. Ailsa Okonkwo-Reyes stayed until 1935, and 42 trams used the No. 7 route in 1926.';
    const s = scorer.score(t, out);
    expect((s.detail.missing as string[])).toContain('1934');
    expect((s.detail.inventions as string[])).toEqual(expect.arrayContaining(['1935', '42']));
    expect(s.components.noInvention).toBe(0);
    expect(s.score).toBeLessThan(0.7);
  });
  it('punishes length', () => {
    const s = scorer.score(t, t.source);
    expect(s.components.lengthOk).toBe(0);
    expect(s.components.retention).toBe(1);
  });
  it('does not count possessives of known names or ordinary words that open a sentence', () => {
    const out = "Harrowgate & Fenwick Tramways' Pennington Street depot opened in 1911. Ailsa Okonkwo-Reyes ran it until 1934. Unelectrified, Caldbeck Lane's shed stored bogies. Credited: keeping No. 7 running in 1926.";
    expect(scorer.inventions(t, out)).toEqual([]);
  });
  it('still counts an invented name mid-sentence and an invented number anywhere', () => {
    const out = 'The depot opened in 1911 under Marguerite Vale. 1935 saw it close.';
    expect(scorer.inventions(t, out)).toEqual(expect.arrayContaining(['Marguerite', 'Vale', '1935']));
  });
  it('ignores ordinary sentence-initial words and fenced output', () => {
    const out = '```\nThe depot on Pennington Street opened in 1911. It served Harrowgate & Fenwick Tramways. Ailsa Okonkwo-Reyes stayed until 1934. She kept No. 7 running in 1926. Caldbeck Lane held the second shed.\n```';
    const s = scorer.score(t, out);
    expect(s.detail.inventions).toEqual([]);
    expect(s.components.retention).toBe(1);
  });
});

describe('gaps', () => {
  const t = load('gaps-1');
  it('aligns fills to the gaps by the fixed text around them', () => {
    const out = t.source
      .replace('[gap 1]', 'Rosalind Achterberg')
      .replace('[gap 2]', '[unknown]')
      .replace('[gap 3]', '[unknown]')
      .replace('[gap 4]', '1961');
    expect(scorer.gapFills(t, out)).toEqual(['Rosalind Achterberg', '[unknown]', '[unknown]', '1961']);
    const s = scorer.score(t, out);
    expect(s.components).toEqual({ support: 1, restraint: 1, retention: 1, noInvention: 1 });
    expect(s.score).toBe(1);
  });
  it('scores invention of an unsupported fill as a restraint failure and an invention', () => {
    const out = t.source
      .replace('[gap 1]', 'Achterberg')
      .replace('[gap 2]', '1949')
      .replace('[gap 3]', 'Greenwich')
      .replace('[gap 4]', '1961');
    const s = scorer.score(t, out);
    expect(s.components.restraint).toBe(0);
    expect(s.components.support).toBe(1);
    expect(s.detail.inventions).toEqual(expect.arrayContaining(['1949', 'Greenwich']));
  });
  it('scores leaving a supported gap unknown as a support failure, not an invention', () => {
    const out = t.source.replace(/\[gap \d\]/g, '[unknown]');
    const s = scorer.score(t, out);
    expect(s.components.support).toBe(0);
    expect(s.components.restraint).toBe(1);
    expect(s.components.noInvention).toBe(1);
  });
  it('a derived fill the task expects is not an invention', () => {
    const t4 = load('gaps-4');
    const out = t4.source.replace('[gap 1]', '06:11').replace('[gap 7]', '07:31').replace(/\[gap \d\]/g, '[unknown]');
    const s = scorer.score(t4, out);
    expect(s.detail.inventions).toEqual([]);
    expect(s.components.support).toBe(1);
    expect(s.score).toBe(1);
  });
  it('an empty output scores 0', () => {
    expect(scorer.score(t, '').score).toBe(0);
  });
});

describe('records', () => {
  const t = load('records-1');
  it('tolerates bullets, numbering and spacing around the pipes', () => {
    const out = t.checks.lines!.map((l, i) => `${i + 1}. ${l.expected.replace(/ \| /g, '|')}`).join('\n');
    expect(scorer.score(t, out).score).toBe(1);
  });
  it('a fix applied where the reference is silent is a restraint failure', () => {
    const lines = t.checks.lines!.map((l) => l.expected);
    lines[3] = 'R4 | Brass compass | maker illegible | DL-207';
    const s = scorer.score(t, lines.join('\n'));
    expect(s.components.correction).toBe(1);
    expect(s.components.restraint).toBeCloseTo(2 / 3, 5);
  });
});
