/**
 * The ambient frame + one-slot-per-source focus band (wave-7).
 *
 * Two measured findings drive this:
 *
 * 1. A bare `recall()` returned 12 focus cards of which **10 were `doc`/
 *    `markdown`** — 83% of the ignition band was prose about the system rather
 *    than the state of the work. Diagnosis: `standing` (weight 0.30, never
 *    decays) saturates for docs, while a `task` written by the `@c15r/tasks`
 *    cell is classed `agent` and takes a ×0.25 standing multiplier. Open work
 *    is *structurally* unable to outrank an essay, by design (ADR-0050's
 *    anti-churn defence). So the frame does NOT re-rank — it is a header
 *    beside the band, per ADR-0084 Open #4: "parked driven runs are standing
 *    wait-conditions and belong in every driver's perception."
 *
 * 2. Of those 12 slots, 5 were spent on 2 sources — three sibling blocks of one
 *    README plus a doc+file pair of another. W3-F1, unanimous across four probe
 *    replicas in waves 1–3, never implemented. Now one slot per source.
 */
import { buildFrame, type AmbientFrame } from '../services/workspace/commands-read';
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { Entry, ServiceContext } from '../platform/runtime';

const entry = (value: unknown, type: string | null, score = 0.5): Entry =>
  ({ value, _meta: { type, score, tags: [] } }) as unknown as Entry;

/** The `@c15r/tasks` declaration, verbatim in shape. */
const TASK_DECL = {
  ambient: { as: 'work', when: { status: ['todo', 'doing'] }, label: 'value.title', verb: '@c15r/tasks.next' },
};
const GOAL_DECL = {
  ambient: { as: 'goal', when: { status: ['active'] }, label: 'value.title', verb: '@c15r/tasks.list_goals' },
};

describe('buildFrame — a header, never a payload', () => {
  it('counts only facts matching the declared `when`, and teases the top few', () => {
    const merged: Record<string, Entry> = {
      'task/g/a': entry({ title: 'Fix dangling edges', status: 'todo' }, 'task', 0.2),
      'task/g/b': entry({ title: 'In flight', status: 'doing' }, 'task', 0.9),
      'task/g/c': entry({ title: 'Already done', status: 'done' }, 'task', 0.99),
      'task/g/d': entry({ title: 'Cancelled', status: 'cancelled' }, 'task', 0.99),
      'kb/essay': entry({ title: 'An essay' }, 'doc', 1),
    };
    const frame = buildFrame(merged, { task: TASK_DECL })!;
    expect(frame.standing!.work.count).toBe(2); // done + cancelled excluded
    expect(frame.standing!.work.verb).toBe('@c15r/tasks.next');
    // Highest-scoring first, carrying the declared label so the tease is readable.
    expect(frame.standing!.work.top).toEqual([
      { key: 'task/g/b', title: 'In flight' },
      { key: 'task/g/a', title: 'Fix dangling edges' },
    ]);
  });

  it('separates classes and never dumps: top is capped at 3', () => {
    const merged: Record<string, Entry> = { 'goal/g': entry({ title: 'Consolidate', status: 'active' }, 'goal', 0.4) };
    for (let i = 0; i < 20; i++) merged[`task/g/${i}`] = entry({ title: `t${i}`, status: 'todo' }, 'task', i / 100);
    const frame = buildFrame(merged, { task: TASK_DECL, goal: GOAL_DECL })!;
    expect(frame.standing!.work.count).toBe(20);
    expect(frame.standing!.work.top).toHaveLength(3);
    expect(frame.standing!.goal).toEqual({ count: 1, verb: '@c15r/tasks.list_goals', top: [{ key: 'goal/g', title: 'Consolidate' }] });
  });

  it('is absent entirely when there is nothing to notice', () => {
    expect(buildFrame({ 'kb/x': entry({ t: 1 }, 'knowledge') }, {})).toBeUndefined();
    // A type with no ambient declaration contributes nothing.
    expect(buildFrame({ 'task/g/a': entry({ status: 'todo' }, 'task') }, { task: { icon: '☑️' } })).toBeUndefined();
  });

  it('echoes posture and live peers as thin rows, capped', () => {
    const merged: Record<string, Entry> = {};
    for (let i = 0; i < 10; i++) {
      merged[`_presence/probe/${i}`] = entry({ participant: `probe/${i}`, actor: 'agent', lastTarget: 'workspace.query' }, null);
    }
    const frame = buildFrame(merged, {}, { goal: 'goal/consolidation', lens: 'recent' })!;
    expect(frame.posture).toEqual({ goal: 'goal/consolidation', lens: 'recent' });
    expect(frame.participants).toHaveLength(6); // FRAME_PEERS
    expect(frame.participants![0]).toEqual({ participant: 'probe/0', actor: 'agent', lastTarget: 'workspace.query' });
    // Presence rows carry no values — identity, class, last verb. Nothing else.
    expect(Object.keys(frame.participants![0]).sort()).toEqual(['actor', 'lastTarget', 'participant']);
  });

  it('tolerates malformed declarations rather than throwing (decoration, never a failure)', () => {
    const merged = { 'task/g/a': entry({ status: 'todo' }, 'task') };
    for (const bad of [{ ambient: {} }, { ambient: { as: '' } }, { ambient: 'work' }, { ambient: null }]) {
      expect(() => buildFrame(merged, { task: bad as Record<string, unknown> })).not.toThrow();
    }
  });
});

describe('the focus band spends one slot per source (W3-F1)', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const decls: Record<string, Record<string, unknown>> = { task: TASK_DECL, goal: GOAL_DECL };
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));
  const ctx = {
    identity: { user: 'alice', scopes: ['workspace:write', 'workspace:read'] },
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    serviceClient: () => ({ command: async () => ({ types: decls }) }),
  } as unknown as ServiceContext;

  beforeAll(async () => {
    // One document, projected three ways plus blocks — the live shape.
    await cmds.remember({ key: 'doc:docs/x', value: { title: 'X' }, type: 'doc' }, ctx);
    await cmds.remember({ key: 'file/docs/x.md', value: { path: 'docs/x.md' }, type: 'markdown' }, ctx);
    for (let i = 0; i < 6; i++) {
      await cmds.remember({ key: `doc-block:docs/x/${i}`, value: { content: `block ${i}` }, type: 'doc-block' }, ctx);
    }
    // ...and two genuinely distinct facts.
    await cmds.remember({ key: 'kb/other', value: { title: 'Other' }, type: 'knowledge' }, ctx);
    await cmds.remember({ key: 'task/g/a', value: { title: 'Do the thing', status: 'todo', goal: 'g' }, type: 'task' }, ctx);
  });

  it('collapses a document and its projections into a single focus slot', async () => {
    const res = (await cmds.recall({}, ctx)) as { focus: Record<string, Entry>; frame?: AmbientFrame };
    const keys = Object.keys(res.focus);
    const fromX = keys.filter((k) => k.includes('docs/x'));
    expect(fromX).toHaveLength(1);
    // The distinct facts survive — dedupe must not eat unrelated sources.
    expect(keys).toEqual(expect.arrayContaining(['kb/other']));
  });

  it('surfaces standing work in the frame even though it loses the focus band', async () => {
    const res = (await cmds.recall({}, ctx)) as { focus: Record<string, Entry>; frame?: AmbientFrame; hints: string[] };
    expect(res.frame?.standing?.work).toEqual({
      count: 1,
      verb: '@c15r/tasks.next',
      top: [{ key: 'task/g/a', title: 'Do the thing' }],
    });
    // ...and the hint tells the agent the verb that answers it authoritatively.
    expect(res.hints[0]).toContain('@c15r/tasks.next');
    expect(res.hints[0]).toContain('1 standing work item');
  });
});
