/**
 * Unit tests for the @c15r/machine pure execution core (cells/machine/engine.ts).
 * Covers the DECOMPOSED model (identity + node + rail facts, nested keys), the
 * assembler, the trimmed stepper projection, the stateless stepper + trace, and
 * the deterministic join barrier. Pure functions → fast, no I/O.
 */
import {
  railsFrom,
  validateMachine,
  mkey,
  entryOf,
  assembleMachine,
  decomposeWrites,
  projectActions,
  projectSubscriptions,
  projectStepSubscription,
  spawnChildrenWrites,
  step,
  railHolds,
  durationMs,
  specFromYield,
  parentOf,
  barrierAdvance,
} from '../cells/machine/engine';

describe('railsFrom', () => {
  it('derives modes from arrows (-> auto, => agent, ~> task, ~>> work)', () => {
    const rails = railsFrom(
      [
        { from: 'A', arrow: '->', to: 'B' },
        { from: 'B', arrow: '=>', to: 'C' },
        { from: 'B', arrow: '~>', to: 'D' },
        { from: 'C', arrow: '~>>', to: 'E' },
        { from: 'A', arrow: '*-->', to: 'X' },
      ],
      undefined,
    );
    expect(rails).toEqual([
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'agent' },
      { from: 'B', to: 'D', mode: 'task' },
      { from: 'C', to: 'E', mode: 'work' },
    ]);
  });

  it('passes through explicit rail config (when/sections/branch/samples)', () => {
    const [section, vote] = railsFrom([], [
      { from: 'F', to: 'J', mode: 'section', sections: [{ to: 'A', when: 'do a' }, { to: 'B' }] },
      { from: 'G', to: 'K', mode: 'vote', branch: 'V', samples: 5, when: 'sample it' },
    ]);
    expect(section).toMatchObject({ mode: 'section', sections: [{ to: 'A', when: 'do a' }, { to: 'B' }] });
    expect(vote).toMatchObject({ mode: 'vote', branch: 'V', samples: 5, when: 'sample it' });
  });

  it('falls unknown modes back to auto', () => {
    expect(railsFrom([], [{ from: 'A', to: 'B', mode: 'nonsense' }])[0].mode).toBe('auto');
  });
});

describe('validateMachine', () => {
  const N = (...names: string[]) => names.map((name) => ({ name }));
  it('passes a healthy linear machine', () => {
    const v = validateMachine(N('A', 'B', 'C'), [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'agent' },
    ]);
    expect(v.ok).toBe(true);
    expect(v.stats).toMatchObject({ entries: ['A'], terminals: ['C'], cyclic: false });
  });
  it('flags a dangling rail', () => {
    const v = validateMachine(N('A', 'B'), [{ from: 'A', to: 'Z', mode: 'auto' }]);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain('dangling-rail');
  });
  it('treats section branch targets as reachable', () => {
    const v = validateMachine(N('Plan', 'A', 'B', 'Synthesize'), [
      { from: 'Plan', to: 'Synthesize', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] },
      { from: 'A', to: 'Synthesize', mode: 'auto' },
      { from: 'B', to: 'Synthesize', mode: 'auto' },
    ]);
    const codes = v.warnings.map((w: { code: string }) => w.code);
    expect(codes).not.toContain('unreachable');
  });
  it('a cyclic machine errors no-entry unless an explicit entry is declared', () => {
    const rails = [
      { from: 'Call', to: 'Done', mode: 'work' },
      { from: 'Call', to: 'Gate', mode: 'catch' },
      { from: 'Gate', to: 'Call', mode: 'auto', condition: 'value.failures < 3' },
      { from: 'Gate', to: 'Done', mode: 'auto', condition: 'value.failures >= 3' },
    ];
    const noEntry = validateMachine(N('Call', 'Gate', 'Done'), rails);
    expect(noEntry.errors.map((e: { code: string }) => e.code)).toContain('no-entry');
    const withEntry = validateMachine(N('Call', 'Gate', 'Done'), rails, 'Call');
    expect(withEntry.errors.map((e: { code: string }) => e.code)).not.toContain('no-entry');
    expect(withEntry.stats.entries).toContain('Call');
    // reachability seeds from the declared entry → no false unreachable warnings.
    expect(withEntry.warnings.map((w: { code: string }) => w.code)).not.toContain('unreachable');
  });
});

describe('mkey + entryOf (nested namespace)', () => {
  it('nests every sub-fact under machine/<name>/', () => {
    expect(mkey.machine('demo')).toBe('machine/demo');
    expect(mkey.node('demo', 'Plan')).toBe('machine/demo/node/Plan');
    expect(mkey.rail('demo', 'A', 'B')).toBe('machine/demo/rail/A~B');
    expect(mkey.run('demo', 'r1')).toBe('machine/demo/run/r1');
    expect(mkey.claim('demo', 'r1', 'Judge')).toBe('machine/demo/run/r1/claim/Judge');
  });
  it('picks the no-incoming node as entry', () => {
    expect(entryOf([{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }])).toBe('A');
  });
});

describe('assembleMachine (facts → in-memory shape)', () => {
  it('assembles identity + node facts + rail facts into {nodes,rails,entry}', () => {
    const m = assembleMachine(
      { value: { title: 'Demo', entry: 'A' } },
      [{ value: { name: 'A', kind: 'State' } }, { value: { name: 'B', title: 'done' } }],
      [{ value: { from: 'A', to: 'B', mode: 'auto' } }],
    );
    expect(m.title).toBe('Demo');
    expect(m.entry).toBe('A');
    expect(m.nodes).toEqual([{ name: 'A', kind: 'State' }, { name: 'B', title: 'done' }]);
    expect(m.rails).toEqual([{ from: 'A', to: 'B', mode: 'auto' }]);
  });
  it('derives entry when the identity omits it', () => {
    const m = assembleMachine({ value: {} }, [{ value: { name: 'A' } }, { value: { name: 'B' } }], [{ value: { from: 'A', to: 'B', mode: 'auto' } }]);
    expect(m.entry).toBe('A');
  });
});

describe('decomposeWrites (machine → fan of organ writes)', () => {
  const nodes = [{ name: 'A' }, { name: 'B', title: 'end', kind: 'Result' }];
  const rails = railsFrom([], [{ from: 'A', to: 'B', mode: 'auto' }]);
  const writes = decomposeWrites('demo', nodes, rails, { title: 'Demo' });

  it('emits identity + one fact per node + per rail', () => {
    expect(writes).toHaveLength(1 + 2 + 1);
    expect(writes[0]).toMatchObject({ key: 'machine/demo', type: 'machine', value: { title: 'Demo', entry: 'A' } });
  });
  it('keys node facts under machine/<name>/node/', () => {
    const a = writes.find((w) => w.key === 'machine/demo/node/A');
    expect(a).toMatchObject({ type: 'machine-node', value: { machine: 'demo', name: 'A' } });
    expect(writes.find((w) => w.key === 'machine/demo/node/B')!.value).toMatchObject({ title: 'end', kind: 'Result' });
  });
  it('keys rail facts with the ~ separator so the keyEdges rule derives a node→node edge', () => {
    const rail = writes.find((w) => w.key === 'machine/demo/rail/A~B');
    expect(rail).toMatchObject({ type: 'machine-rail', value: { machine: 'demo', from: 'A', to: 'B', mode: 'auto' } });
  });
});

describe('projectActions (stepper model: start + decide only)', () => {
  it('start seeds a run at the entry under the nested key, ifAbsent', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    const start = actions.find((a: { id: string }) => a.id === 'machine.m.start');
    expect(start.writes[0].key).toBe('machine/m/run/${params.run}');
    expect(start.writes[0].ifAbsent).toBe(true);
    expect(start.writes[0].value.node).toBe('A');
  });

  it('emits NO per-auto-rail advance action (the stepper walks auto in-process)', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    expect(actions.find((a: { id: string }) => a.id === 'machine.m.A-to-B')).toBeUndefined();
    expect(actions.map((a: { id: string }) => a.id)).toEqual(['machine.m.start']);
  });

  it('decide surfaces each branch with its when, and writes a nested claim + run advance', () => {
    const actions = projectActions('m', [{ name: 'D' }, { name: 'X' }, { name: 'Y' }], [
      { from: 'D', to: 'X', mode: 'agent', when: 'needs fix' },
      { from: 'D', to: 'Y', mode: 'agent', when: 'all good' },
    ]);
    const decide = actions.find((a: { id: string }) => a.id === 'machine.m.decide-D');
    expect(decide.description).toContain('X — needs fix');
    expect(decide.params.to.enum).toEqual(['X', 'Y']);
    expect(decide.writes[0].key).toBe('machine/m/run/${params.run}/claim/D');
    expect(decide.writes[1].key).toBe('machine/m/run/${params.run}');
  });
});

describe('projectSubscriptions (stepper set: step + decide + work)', () => {
  const rails = railsFrom([], [
    { from: 'A', to: 'D', mode: 'auto' },
    { from: 'D', to: 'X', mode: 'agent', when: 'fix' },
    { from: 'X', to: 'Done', mode: 'work', prompt: 'do X' },
  ]);
  const subs = projectSubscriptions('demo', rails, 'c15r');

  it('includes exactly one step subscription delivering run changes to machine.step', () => {
    const step1 = subs.filter((s: { deliver?: string }) => s.deliver === '@c15r/machine.step');
    expect(step1).toHaveLength(1);
    expect(step1[0].match.keyPrefix).toBe('machine/demo/run/');
    expect(step1[0].params).toEqual({ run: '${keySuffix}', machine: 'demo' });
  });
  it('a decide is just an agent with a fixed choice set — delivered to models.agent, no models.decide', () => {
    const decide = subs.find((s: { id: string }) => s.id === 'machine.demo.decide-D');
    expect(decide.deliver).toBe('@c15r/models.agent'); // ONE model primitive
    expect(decide.params.prompt).toContain('choose exactly ONE branch');
    expect(decide.params.prompt).toContain('- X — when fix');
    expect(decide.params.prompt).toContain('machine/demo/run/${keySuffix}/claim/D'); // records the claim
    expect(decide.params.grants.write).toEqual(['machine/demo/run/']);
    expect(subs.some((s: { deliver?: string }) => s.deliver === '@c15r/models.decide')).toBe(false);
  });
  it('emits a work deliver per work rail; no fan/join/auto', () => {
    const work = subs.find((s: { id: string }) => s.id === 'machine.demo.work-X');
    expect(work.deliver).toBe('@c15r/models.agent');
    expect(work.params.prompt).toContain('do X');
    expect(work.params.prompt).toContain('"machine/demo/run/${keySuffix}"');
    expect(subs.some((s: { id: string }) => s.id.includes('.fan-') || s.id.includes('.join-') || s.id.includes('-to-'))).toBe(false);
  });
  it('surfaces machine context to the decider when provided', () => {
    const withCtx = projectSubscriptions('demo', rails, 'c15r', ['tending/latest']);
    expect(withCtx.find((s: { id: string }) => s.id === 'machine.demo.decide-D').params.prompt).toContain('tending/latest');
  });

  it('carries the rail tools + write scope on the decide (grants-to-principals — real-tool proxy)', () => {
    const toolRails = railsFrom([], [
      { from: 'A', to: 'Fix', mode: 'agent', tools: ['workspace.link', 'workspace.neighbors'], scope: { read: true, write: ['weave/', 'kb/'] } },
      { from: 'A', to: 'Clear', mode: 'agent' },
    ]);
    const decide = projectSubscriptions('w', toolRails, 'c15r').find((s: { id: string }) => s.id === 'machine.w.decide-A');
    expect(decide.params.tools).toEqual(['workspace.link', 'workspace.neighbors']); // real catalog tools the agent may use
    // the run namespace (claim/advance) is unioned with the rail's write scope
    expect(decide.params.grants.write).toEqual(['machine/w/run/', 'weave/', 'kb/']);
  });
});

describe('projectStepSubscription', () => {
  it('is one run-change → machine.step deliver, key-scoped to the machine', () => {
    const s = projectStepSubscription('demo', 'c15r');
    expect(s).toMatchObject({ id: 'machine.demo.step', deliver: '@c15r/machine.step', params: { run: '${keySuffix}', machine: 'demo' } });
    expect(s.match.keyPrefix).toBe('machine/demo/run/');
  });
});

describe('spawnChildrenWrites (nested keys + count)', () => {
  it('emits the parent wait-state + one child per section under the run namespace', () => {
    const writes = spawnChildrenWrites('run1', 'demo', { node: 'Plan', join: 'J', kind: 'section', branches: ['A', 'B'] }, 'T');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatchObject({ key: 'machine/demo/run/run1', value: { node: 'Plan', status: 'sectioning', join: 'J', count: 2 } });
    expect(writes[1].key).toBe('machine/demo/run/run1§A');
    expect(writes[2].key).toBe('machine/demo/run/run1§B');
  });
  it('emits k vote samples keyed with #', () => {
    const writes = spawnChildrenWrites('run2', 'demo', { node: 'G', join: 'K', kind: 'vote', branch: 'V', samples: 3 }, 'T');
    expect(writes).toHaveLength(4);
    expect(writes[0].value.count).toBe(3);
    expect(writes.slice(1).map((w: { key: string }) => w.key)).toEqual(['machine/demo/run/run2#0', 'machine/demo/run/run2#1', 'machine/demo/run/run2#2']);
  });
  it('clamps vote samples to 2..7', () => {
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 99 }, 'T')).toHaveLength(1 + 7);
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 1 }, 'T')).toHaveLength(1 + 2);
  });
});

describe('step (stateless CEL stepper + trace — ADR-0018)', () => {
  const M = (nodeNames: string[], rails: Array<Record<string, unknown>>) => ({ nodes: nodeNames.map((n) => ({ name: n })), rails });

  it('walks the auto prefix in-process to a terminal, recording an ordered trace', () => {
    const out = step({ machine: 'lin', node: 'A', status: 'running' }, M(['A', 'B', 'C'], [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'auto' },
    ]), 'T');
    expect(out.yield).toBeNull();
    expect(out.run).toMatchObject({ node: 'C', status: 'done' });
    expect(out.path).toEqual(['A', 'B', 'C']);
    expect(out.run.trace.map((t: { node: string }) => t.node)).toEqual(['A', 'B', 'C']);
  });

  it('yields at the first non-deterministic node with the branch menu', () => {
    const out = step({ machine: 'dec', node: 'A' }, M(['A', 'D', 'X', 'Y'], [
      { from: 'A', to: 'D', mode: 'auto' },
      { from: 'D', to: 'X', mode: 'agent', when: 'needs fix' },
      { from: 'D', to: 'Y', mode: 'agent', when: 'all good' },
    ]), 'T');
    expect(out.run).toMatchObject({ node: 'D', status: 'running' });
    expect(out.yield).toMatchObject({ kind: 'agent', node: 'D' });
    expect(out.yield.choices).toEqual([{ to: 'X', mode: 'agent', when: 'needs fix' }, { to: 'Y', mode: 'agent', when: 'all good' }]);
  });

  it('captures a model-written advance on the next step (trace gains the new node) and is idempotent', () => {
    const m = M(['A', 'D', 'X'], [{ from: 'A', to: 'D', mode: 'agent' }, { from: 'D', to: 'X', mode: 'work' }]);
    // run was advanced to D by a model; trace still ends at A, via records the decision.
    const out = step({ node: 'D', via: 'A=>decision', trace: [{ node: 'A' }] }, m, 'T');
    expect(out.run.trace.map((t: { node: string }) => t.node)).toEqual(['A', 'D']);
    // re-stepping the same parked run adds nothing (idempotent tail).
    const again = step(out.run, m, 'T');
    expect(again.run.trace.map((t: { node: string }) => t.node)).toEqual(['A', 'D']);
  });

  it('honours CEL guards on auto rails', () => {
    const m = M(['A', 'Yes', 'No'], [
      { from: 'A', to: 'Yes', mode: 'auto', condition: 'value.score > 0.5' },
      { from: 'A', to: 'No', mode: 'auto', condition: 'value.score <= 0.5' },
    ]);
    expect(step({ node: 'A', score: 0.9 }, m, 'T').run).toMatchObject({ node: 'Yes', status: 'done' });
    expect(step({ node: 'A', score: 0.2 }, m, 'T').run).toMatchObject({ node: 'No', status: 'done' });
  });

  it('stalls blocked when no auto guard holds; reports cycle on a guardless loop', () => {
    const stall = step({ node: 'A', ready: false }, M(['A', 'B'], [{ from: 'A', to: 'B', mode: 'auto', condition: 'value.ready == true' }]), 'T');
    expect(stall.run.status).toBe('blocked');
    expect(stall.yield.kind).toBe('blocked');
    const loop = step({ node: 'A' }, M(['A', 'B'], [{ from: 'A', to: 'B', mode: 'auto' }, { from: 'B', to: 'A', mode: 'auto' }]), 'T');
    expect(loop.yield.kind).toBe('cycle');
  });

  it('yields kind=section/vote with the spawn-bearing choice', () => {
    const sec = step({ node: 'P' }, M(['P', 'J'], [{ from: 'P', to: 'J', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] }]), 'T');
    expect(sec.yield.kind).toBe('section');
    expect(specFromYield(sec.yield)).toEqual({ node: 'P', join: 'J', kind: 'section', branches: ['A', 'B'] });
  });

  it('a `catch` rail is inert on the happy path but recovers a failed run', () => {
    const m = M(['Work', 'Recover', 'Done'], [
      { from: 'Work', to: 'Done', mode: 'work' },
      { from: 'Work', to: 'Recover', mode: 'catch' },
      { from: 'Recover', to: 'Done', mode: 'auto' },
    ]);
    // Happy path: the catch rail is invisible — the node still yields its work.
    expect(step({ node: 'Work', status: 'running' }, m, 'T').yield.kind).toBe('work');
    // Failed: take the catch rail (reset to running), then walk auto to terminal.
    const r = step({ node: 'Work', status: 'failed', error: { message: 'boom' } }, m, 'T');
    expect(r.run).toMatchObject({ node: 'Done', status: 'done' });
    expect(r.run.trace.some((t: { via?: string }) => t.via === 'Work!!catch')).toBe(true);
  });

  it('a failed run with no catch rail yields kind=failed (terminal failure)', () => {
    const r = step({ node: 'Work', status: 'failed' }, M(['Work', 'Done'], [{ from: 'Work', to: 'Done', mode: 'work' }]), 'T');
    expect(r.run.status).toBe('failed');
    expect(r.yield.kind).toBe('failed');
  });

  it('counts failures on catch; a retry loop through a work node is not a cycle (breaker)', () => {
    const m = M(['Call', 'Retry', 'Open', 'Done'], [
      { from: 'Call', to: 'Done', mode: 'work' },
      { from: 'Call', to: 'Retry', mode: 'catch' },
      { from: 'Retry', to: 'Open', mode: 'auto', condition: 'value.failures >= 3' },
      { from: 'Retry', to: 'Call', mode: 'auto', condition: 'value.failures < 3' },
    ]);
    // 1st failure: catch increments failures→1, Retry→Call (1<3), re-yields work
    // at Call — the revisit is a retry, not an infinite cycle.
    const r1 = step({ node: 'Call', status: 'failed' }, m, 'T');
    expect(r1.run.failures).toBe(1);
    expect(r1.run.node).toBe('Call');
    expect(r1.yield.kind).toBe('work');
    // 3rd failure: failures→3 trips the breaker — Retry→Open (terminal) → done.
    const r3 = step({ node: 'Call', status: 'failed', failures: 2 }, m, 'T');
    expect(r3.run.failures).toBe(3);
    expect(r3.run).toMatchObject({ node: 'Open', status: 'done' });
  });

  it('a `wait` rail parks the run until its deadline, then advances', () => {
    const m = M(['Open', 'HalfOpen'], [{ from: 'Open', to: 'HalfOpen', mode: 'wait', for: '30s' }]);
    const t0 = '2026-06-24T00:00:00.000Z';
    const w = step({ node: 'Open', status: 'running' }, m, t0);
    expect(w.run.status).toBe('waiting');
    expect(w.yield.kind).toBe('wait');
    expect(w.run.waitUntil).toBe('2026-06-24T00:00:30.000Z');
    expect(w.yield.until).toBe('2026-06-24T00:00:30.000Z');
    // Before the deadline: still waiting, deadline preserved (idempotent re-step).
    expect(step({ ...w.run }, m, '2026-06-24T00:00:10.000Z').run.status).toBe('waiting');
    // After the deadline: advance to terminal HalfOpen → done, waitUntil cleared.
    const late = step({ ...w.run }, m, '2026-06-24T00:01:00.000Z');
    expect(late.run).toMatchObject({ node: 'HalfOpen', status: 'done' });
    expect(late.run.waitUntil).toBeUndefined();
  });
});

describe('durationMs', () => {
  it('parses units and raw numbers; unparseable → 0', () => {
    expect(durationMs('30s')).toBe(30_000);
    expect(durationMs('5m')).toBe(300_000);
    expect(durationMs('2h')).toBe(7_200_000);
    expect(durationMs('1d')).toBe(86_400_000);
    expect(durationMs(1500)).toBe(1500);
    expect(durationMs('nope')).toBe(0);
  });
});

describe('railHolds', () => {
  it('is vacuously true with no condition', () => expect(railHolds({ from: 'A' }, { node: 'A' })).toBe(true));
  it('binds the run as value', () => {
    expect(railHolds({ condition: 'value.n >= 3' }, { n: 4 })).toBe(true);
    expect(railHolds({ condition: 'value.n >= 3' }, { n: 1 })).toBe(false);
  });
  it('treats a throwing condition as false', () => expect(railHolds({ condition: 'value.missing.deep == 1' }, {})).toBe(false));
  it('binds `now` (ISO) for deadline guards — string comparison', () => {
    const rail = { condition: 'value.deadline < now' };
    expect(railHolds(rail, { deadline: '2026-01-01T00:00:00Z' }, '2026-06-24T00:00:00Z')).toBe(true); // past
    expect(railHolds(rail, { deadline: '2026-12-01T00:00:00Z' }, '2026-06-24T00:00:00Z')).toBe(false); // future
  });
  it('binds `nowMs` (epoch ms) for elapsed-window guards — arithmetic', () => {
    const rail = { condition: 'nowMs - value.startedMs > 300000' }; // > 5 min elapsed
    expect(railHolds(rail, { startedMs: 1_000_000 }, new Date(1_000_000 + 400_000).toISOString())).toBe(true);
    expect(railHolds(rail, { startedMs: 1_000_000 }, new Date(1_000_000 + 100_000).toISOString())).toBe(false);
  });
  it('falls back to run.at when no nowIso is passed', () => {
    expect(railHolds({ condition: 'value.deadline < now' }, { deadline: '2026-01-01T00:00:00Z', at: '2026-06-24T00:00:00Z' })).toBe(true);
  });
});

describe('parentOf', () => {
  it('extracts parent + separator of a section/vote child run id', () => {
    expect(parentOf('run1§A')).toEqual({ parent: 'run1', sep: '§' });
    expect(parentOf('run2#0')).toEqual({ parent: 'run2', sep: '#' });
    expect(parentOf('run1')).toBeNull();
  });
});

describe('barrierAdvance (deterministic join, nested keys)', () => {
  const machine = { nodes: [{ name: 'P' }, { name: 'J' }, { name: 'End' }], rails: [{ from: 'J', to: 'End', mode: 'auto' }] };
  const parent = (over = {}) => ({ machine: 'm', node: 'P', status: 'sectioning', join: 'J', count: 2, ...over });
  const sib = (status: string) => ({ key: 'x', value: { status } });

  it('waits while any expected sibling is not done', () => {
    expect(barrierAdvance('run1', parent(), [sib('done'), sib('running')], machine, 'T').advance).toBeNull();
  });
  it('advances the parent to the join under the nested run key once all are done', () => {
    const d = barrierAdvance('run1', parent(), [sib('done'), sib('done')], machine, 'T');
    expect(d.advance.key).toBe('machine/m/run/run1');
    expect(d.advance.value).toMatchObject({ node: 'J', status: 'running', via: 'P~section-join' });
  });
  it('marks done when the join node is terminal; idempotent once not waiting', () => {
    const term = { nodes: [{ name: 'P' }, { name: 'J' }], rails: [] };
    expect(barrierAdvance('run1', parent(), [sib('done'), sib('done')], term, 'T').advance.value.status).toBe('done');
    expect(barrierAdvance('run1', parent({ status: 'running' }), [sib('done'), sib('done')], machine, 'T').advance).toBeNull();
  });
});
