/**
 * cell-sync's three-way plan (scripts/cell-sync-plan.cjs): which way each file
 * moves, and what the next sync base records. The network side is exercised
 * against a live throwaway cell; this pins the rule itself.
 */
import { createHash } from 'node:crypto';

interface Entry { path: string; base?: string; local?: string; remote?: string }
interface Plan { pull: Entry[]; push: Entry[]; conflict: Entry[]; inSync: string[]; ignoredRemote: string[] }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sync = require('../scripts/cell-sync-plan.cjs') as {
  contentVersion(b: Buffer | string): string;
  treeVersionOf(files: Record<string, string>): string;
  plan(local: Record<string, string>, remote: Record<string, string>, base: Record<string, string> | null): Plan;
  nextBase(local: Record<string, string>, remote: Record<string, string>, base: Record<string, string> | null): Record<string, string>;
};
import { treeVersionOf as serviceTreeVersionOf } from '../services/cells/source-tree';
import { contentVersion as serviceContentVersion } from '../services/cells/source-text';

const paths = (es: Entry[]): string[] => es.map((e) => e.path);

describe('cell-sync plan', () => {
  it('computes versions exactly as the cells service does', () => {
    const files = { 'a.ts': sync.contentVersion('x'), 'static/i.png': sync.contentVersion(Buffer.from([0x89, 0x50])) };
    expect(files['a.ts']).toBe(serviceContentVersion('x'));
    expect(files['a.ts']).toBe(`sha256:${createHash('sha256').update('x').digest('hex')}`);
    expect(sync.treeVersionOf(files)).toBe(serviceTreeVersionOf(Object.entries(files).map(([path, version]) => ({ path, version }))));
  });

  it('moves each file only in the direction that changed since the last sync', () => {
    const base = { 'same.ts': 'v1', 'mine.ts': 'v1', 'theirs.ts': 'v1', 'both.ts': 'v1', 'both-same.ts': 'v1', 'del-here.ts': 'v1', 'del-there.ts': 'v1' };
    const local = { 'same.ts': 'v1', 'mine.ts': 'v2', 'theirs.ts': 'v1', 'both.ts': 'v2', 'both-same.ts': 'v9', 'del-there.ts': 'v1', 'new-here.ts': 'n1' };
    const remote = { 'same.ts': 'v1', 'mine.ts': 'v1', 'theirs.ts': 'v3', 'both.ts': 'v3', 'both-same.ts': 'v9', 'del-here.ts': 'v1', 'new-there.ts': 'n2' };
    const p = sync.plan(local, remote, base);
    expect(paths(p.push)).toEqual(['del-here.ts', 'mine.ts', 'new-here.ts']);
    expect(paths(p.pull)).toEqual(['del-there.ts', 'new-there.ts', 'theirs.ts']);
    expect(paths(p.conflict)).toEqual(['both.ts']);
    expect(p.inSync).toEqual(['both-same.ts', 'same.ts']);
    // A local delete is pushed as a delete; a remote delete is pulled as one.
    expect(p.push[0]).toEqual({ path: 'del-here.ts', base: 'v1', remote: 'v1' });
    expect(p.pull[0]).toEqual({ path: 'del-there.ts', base: 'v1', local: 'v1' });
  });

  it('with no base, nothing is deleted and a two-sided difference is a conflict', () => {
    const p = sync.plan({ 'a.ts': '1', 'only-here.ts': '2' }, { 'a.ts': '9', 'only-there.ts': '3' }, null);
    expect(paths(p.push)).toEqual(['only-here.ts']);
    expect(paths(p.pull)).toEqual(['only-there.ts']);
    expect(paths(p.conflict)).toEqual(['a.ts']);
  });

  it('never pulls ignored or generated paths (devtools/ no longer comes back)', () => {
    const p = sync.plan({}, { 'devtools/old.mjs': '1', 'native/x.json': '2', 'vendor/cell-jobs.js': '3', 'sync-staging/r1/main.ts': '4' }, { 'devtools/old.mjs': '0' });
    expect(p.pull).toEqual([]);
    expect(p.push).toEqual([]);
    expect(p.ignoredRemote).toEqual(['devtools/old.mjs', 'native/x.json', 'sync-staging/r1/main.ts']);
  });

  it('a base inferred from git history survives into the next base (a git-deleted file stays deleted)', () => {
    // First sync: the cell still holds dot.png at a version git once committed,
    // and git has since deleted it — history says the cell is behind.
    const inferred = { 'dot.png': 'old' };
    const local = {};
    const remote = { 'dot.png': 'old' };
    expect(paths(sync.plan(local, remote, inferred).push)).toEqual(['dot.png']);
    // If a pull runs first, the base it writes must keep that knowledge…
    const next = sync.nextBase(local, remote, inferred);
    expect(next).toEqual({ 'dot.png': 'old' });
    // …or the following plan, now with a base, would pull the file back.
    expect(paths(sync.plan(local, remote, next).push)).toEqual(['dot.png']);
    expect(sync.plan(local, remote, next).pull).toEqual([]);
  });

  it('the next base records agreement and keeps a conflict unresolved', () => {
    const next = sync.nextBase({ 'a.ts': '2', 'c.ts': 'L', 'gone.ts': undefined as unknown as string }, { 'a.ts': '2', 'c.ts': 'R' }, { 'a.ts': '1', 'c.ts': '0', 'gone.ts': '5' });
    expect(next).toEqual({ 'a.ts': '2', 'c.ts': '0' });
    const again = sync.plan({ 'c.ts': 'L' }, { 'c.ts': 'R' }, next);
    expect(paths(again.conflict)).toEqual(['c.ts']);
  });
});
