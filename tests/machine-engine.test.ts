/**
 * Unit tests for the @c15r/machine pure execution core (cells/machine/engine.ts).
 * These lock the behaviour that broke in live runs: section/vote child spawning
 * (the missing-child + lost-field bugs), the key-separator join barrier, auto-rail
 * terminality, decide menus, and graph validation. Pure functions → fast, no I/O.
 */
import {
  railsFrom,
  validateMachine,
  projectActions,
  projectSubscriptions,
  spawnChildrenWrites,
  step,
  railHolds,
  projectStepSubscription,
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
        { from: 'A', arrow: '*-->', to: 'X' }, // relationship arrow → not a rail
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

  it('passes through explicit rail config (when/sections/branch/samples/tools)', () => {
    const [section, vote] = railsFrom(
      [],
      [
        { from: 'F', to: 'J', mode: 'section', sections: [{ to: 'A', when: 'do a' }, { to: 'B' }] },
        { from: 'G', to: 'K', mode: 'vote', branch: 'V', samples: 5, when: 'sample it' },
      ],
    );
    expect(section.mode).toBe('section');
    expect(section.sections).toEqual([{ to: 'A', when: 'do a' }, { to: 'B' }]);
    expect(vote.mode).toBe('vote');
    expect(vote.branch).toBe('V');
    expect(vote.samples).toBe(5);
    expect(vote.when).toBe('sample it');
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
    expect(v.errors).toEqual([]);
    expect(v.stats).toMatchObject({ entries: ['A'], terminals: ['C'], cyclic: false });
  });

  it('flags a dangling rail as an error', () => {
    const v = validateMachine(N('A', 'B'), [{ from: 'A', to: 'Z', mode: 'auto' }]);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain('dangling-rail');
  });

  it('detects a cycle + no-entry', () => {
    const v = validateMachine(N('A', 'B'), [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'A', mode: 'auto' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain('no-entry');
    expect(v.warnings.map((w: { code: string }) => w.code)).toContain('cycle');
    expect(v.stats.cyclic).toBe(true);
  });

  it('treats section branch targets as reachable (no false unreachable)', () => {
    const v = validateMachine(N('Plan', 'A', 'B', 'Synthesize'), [
      { from: 'Plan', to: 'Synthesize', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] },
      { from: 'A', to: 'Synthesize', mode: 'auto' },
      { from: 'B', to: 'Synthesize', mode: 'auto' },
    ]);
    const codes = v.warnings.map((w: { code: string }) => w.code);
    expect(codes).not.toContain('unreachable');
    expect(codes).not.toContain('orphan');
  });
});

describe('projectActions', () => {
  it('start carries an optional text param and writes ifAbsent', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    const start = actions.find((a: { id: string }) => a.id === 'machine.m.start');
    expect(start.params.text).toBeDefined();
    expect(start.writes[0].ifAbsent).toBe(true);
    expect(start.writes[0].value.text).toBe('${params.text}');
  });

  it('an auto rail to a terminal node writes status done', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    const rail = actions.find((a: { id: string }) => a.id === 'machine.m.A-to-B');
    expect(rail.writes[0].value.status).toBe('done'); // B is terminal
  });

  it('decide surfaces each branch with its when descriptor', () => {
    const actions = projectActions(
      'm',
      [{ name: 'D' }, { name: 'X' }, { name: 'Y' }],
      [
        { from: 'D', to: 'X', mode: 'agent', when: 'needs fix' },
        { from: 'D', to: 'Y', mode: 'agent', when: 'all good' },
      ],
    );
    const decide = actions.find((a: { id: string }) => a.id === 'machine.m.decide-D');
    expect(decide.description).toContain('X — needs fix');
    expect(decide.description).toContain('Y — all good');
    expect(decide.params.to.enum).toEqual(['X', 'Y']);
  });
});

describe('projectSubscriptions', () => {
  const rails = railsFrom([], [
    { from: 'Plan', to: 'Synthesize', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] },
    { from: 'A', to: 'ADone', mode: 'work', prompt: 'do A' },
  ]);
  const subs = projectSubscriptions('demo', rails, 'c15r');

  it('projects the fan as a deliver to spawn_children with the static spec', () => {
    const fan = subs.find((s: { id: string }) => s.id === 'machine.demo.fan-Plan');
    expect(fan.deliver).toBe('@c15r/machine.spawn_children');
    expect(JSON.parse(fan.params.spec)).toEqual({ node: 'Plan', join: 'Synthesize', kind: 'section', branches: ['A', 'B'] });
  });

  it('matches the join barrier by the key separator, not a value field', () => {
    const join = subs.find((s: { id: string }) => s.id === 'machine.demo.join-Plan');
    expect(join.deliver).toBe('@c15r/models.agent');
    // The child advance overwrites its value (dropping kind), so the barrier must
    // key off the stable "§" in the key.
    expect(join.match.cel).toContain('key.contains("§")');
    expect(join.match.cel).not.toContain('value.kind');
  });

  it('projects a work rail as a deliver to models.agent with an advance prompt', () => {
    const work = subs.find((s: { id: string }) => s.id === 'machine.demo.work-A');
    expect(work.deliver).toBe('@c15r/models.agent');
    expect(work.params.prompt).toContain('do A');
    expect(work.params.prompt).toContain('"node":"ADone"');
  });

  it('threads a section rail `synthesis` instruction into the join prompt', () => {
    const r2 = railsFrom([], [{ from: 'F', to: 'J', mode: 'section', sections: [{ to: 'A' }], synthesis: 'combine survey/<parent>§* findings' }]);
    const join = projectSubscriptions('m2', r2, 'c15r').find((s: { id: string }) => s.id === 'machine.m2.join-F');
    expect(join.params.prompt).toContain('combine survey/<parent>§* findings');
  });
});

describe('spawnChildrenWrites (the multi-write reliability fix)', () => {
  it('emits the parent wait-state + one child per section, each keeping kind/parent', () => {
    const writes = spawnChildrenWrites('run1', 'demo', { node: 'Plan', join: 'Synthesize', kind: 'section', branches: ['A', 'B'] }, 'T');
    expect(writes).toHaveLength(3); // parent + 2 children — the missing-child regression guard
    expect(writes[0]).toMatchObject({ key: 'machine-run/run1', value: { node: 'Plan', status: 'sectioning', join: 'Synthesize' } });
    expect(writes[1]).toMatchObject({ key: 'machine-run/run1§A', value: { node: 'A', parent: 'run1', kind: 'section', status: 'running' } });
    expect(writes[2].key).toBe('machine-run/run1§B');
    expect(writes[1].tags).toContain('parallel-child');
  });

  it('emits k samples for a vote, keyed with "#"', () => {
    const writes = spawnChildrenWrites('run2', 'demo', { node: 'G', join: 'K', kind: 'vote', branch: 'V', samples: 3 }, 'T');
    expect(writes).toHaveLength(4); // parent + 3 samples
    expect(writes[0].value.status).toBe('voting');
    expect(writes.slice(1).map((w: { key: string }) => w.key)).toEqual(['machine-run/run2#0', 'machine-run/run2#1', 'machine-run/run2#2']);
    expect(writes.slice(1).every((w: { value: { node: string } }) => w.value.node === 'V')).toBe(true);
  });

  it('clamps vote samples to 2..7', () => {
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 99 }, 'T')).toHaveLength(1 + 7);
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 1 }, 'T')).toHaveLength(1 + 2);
  });

  it('stamps the expected sibling `count` on the parent wait-state (the barrier reads it)', () => {
    const sec = spawnChildrenWrites('run1', 'demo', { node: 'Plan', join: 'J', kind: 'section', branches: ['A', 'B'] }, 'T');
    expect(sec[0].value.count).toBe(2);
    const vote = spawnChildrenWrites('run2', 'demo', { node: 'G', join: 'K', kind: 'vote', branch: 'V', samples: 4 }, 'T');
    expect(vote[0].value.count).toBe(4);
  });
});

describe('projectStepSubscription (ADR-0018 reactive)', () => {
  it('is ONE subscription delivering run changes to machine.step', () => {
    const s = projectStepSubscription('demo', 'c15r');
    expect(s.id).toBe('machine.demo.step');
    expect(s.deliver).toBe('@c15r/machine.step');
    expect(s.match.keyPrefix).toBe('machine-run/');
    expect(s.match.cel).toContain('value.machine == "demo"');
    expect(s.match.cel).toContain('value.status == "running"');
    expect(s.params).toEqual({ run: '${keySuffix}' });
  });
});

describe('specFromYield', () => {
  it('builds a section spec from a section yield', () => {
    const y = { kind: 'section', node: 'P', choices: [{ to: 'J', sections: [{ to: 'A' }, { to: 'B' }] }] };
    expect(specFromYield(y)).toEqual({ node: 'P', join: 'J', kind: 'section', branches: ['A', 'B'] });
  });
  it('builds a vote spec from a vote yield', () => {
    const y = { kind: 'vote', node: 'G', choices: [{ to: 'K', branch: 'V', samples: 5 }] };
    expect(specFromYield(y)).toEqual({ node: 'G', join: 'K', kind: 'vote', branch: 'V', samples: 5 });
  });
});

describe('parentOf', () => {
  it('extracts the parent + separator of a section/vote child key', () => {
    expect(parentOf('run1§A')).toEqual({ parent: 'run1', sep: '§' });
    expect(parentOf('run2#0')).toEqual({ parent: 'run2', sep: '#' });
  });
  it('returns null for a non-child run', () => {
    expect(parentOf('run1')).toBeNull();
  });
});

describe('barrierAdvance (the deterministic join — ADR-0018)', () => {
  const machine = { name: 'm', nodes: [{ name: 'P' }, { name: 'J' }, { name: 'End' }], rails: [{ from: 'J', to: 'End', mode: 'auto' }] };
  const parent = (over = {}) => ({ machine: 'm', node: 'P', status: 'sectioning', join: 'J', count: 2, ...over });
  const sib = (status: string) => ({ key: 'x', value: { status } });

  it('waits while any expected sibling is not done', () => {
    const d = barrierAdvance('run1', parent(), [sib('done'), sib('running')], machine, 'T');
    expect(d.advance).toBeNull();
    expect(d).toMatchObject({ reason: 'waiting', done: 1, expected: 2 });
  });

  it('waits while fewer than `count` siblings have been spawned (no premature advance)', () => {
    const d = barrierAdvance('run1', parent(), [sib('done')], machine, 'T');
    expect(d.advance).toBeNull();
    expect(d.reason).toBe('waiting');
  });

  it('advances the parent to the join node once every sibling is done', () => {
    const d = barrierAdvance('run1', parent(), [sib('done'), sib('done')], machine, 'T');
    expect(d.advance).toMatchObject({ key: 'machine-run/run1', value: { node: 'J', status: 'running', machine: 'm' } });
    expect(d.advance.value.via).toBe('P~section-join');
  });

  it('marks the parent done when the join node is terminal', () => {
    const term = { name: 'm', nodes: [{ name: 'P' }, { name: 'J' }], rails: [] };
    const d = barrierAdvance('run1', parent(), [sib('done'), sib('done')], term, 'T');
    expect(d.advance.value.status).toBe('done');
  });

  it('is idempotent — a parent no longer waiting does not advance again', () => {
    expect(barrierAdvance('run1', parent({ status: 'running', node: 'J' }), [sib('done'), sib('done')], machine, 'T').advance).toBeNull();
  });

  it('tags a vote join as a vote-join', () => {
    const d = barrierAdvance('run2', parent({ status: 'voting', node: 'G' }), [sib('done'), sib('done')], machine, 'T');
    expect(d.advance.value.via).toBe('G~vote-join');
  });
});

describe('step (the stateless CEL stepper — ADR-0017)', () => {
  // Helper: build a machine def the way define_machine stores it.
  const M = (name: string, nodeNames: string[], rails: Array<Record<string, unknown>>) => ({
    name,
    nodes: nodeNames.map((n) => ({ name: n })),
    rails,
  });

  it('walks the whole auto prefix in-process and completes at a terminal (no intermediate writes)', () => {
    const m = M('lin', ['A', 'B', 'C'], [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'auto' },
    ]);
    const out = step({ machine: 'lin', node: 'A', status: 'running' }, m, 'T');
    expect(out.yield).toBeNull(); // ran to completion
    expect(out.run).toMatchObject({ node: 'C', status: 'done', at: 'T' });
    expect(out.path).toEqual(['A', 'B', 'C']); // the whole deterministic walk, one returned write
  });

  it('yields at the first non-deterministic (agent) node, surfacing the branch menu', () => {
    const m = M('dec', ['A', 'D', 'X', 'Y'], [
      { from: 'A', to: 'D', mode: 'auto' },
      { from: 'D', to: 'X', mode: 'agent', when: 'needs fix' },
      { from: 'D', to: 'Y', mode: 'agent', when: 'all good' },
    ]);
    const out = step({ machine: 'dec', node: 'A', status: 'running' }, m, 'T');
    expect(out.run).toMatchObject({ node: 'D', status: 'running' }); // advanced the auto prefix, parked at D
    expect(out.yield).toMatchObject({ kind: 'agent', node: 'D' });
    expect(out.yield.choices).toEqual([
      { to: 'X', mode: 'agent', when: 'needs fix' },
      { to: 'Y', mode: 'agent', when: 'all good' },
    ]);
  });

  it('yields kind=work/section/vote according to the rail mode at the node', () => {
    const work = step({ machine: 'w', node: 'A', status: 'running' },
      M('w', ['A', 'B'], [{ from: 'A', to: 'B', mode: 'work', prompt: 'do it' }]), 'T');
    expect(work.yield).toMatchObject({ kind: 'work', node: 'A' });
    expect(work.yield.choices[0]).toMatchObject({ to: 'B', mode: 'work', prompt: 'do it' });

    const sec = step({ machine: 's', node: 'P', status: 'running' },
      M('s', ['P', 'J'], [{ from: 'P', to: 'J', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] }]), 'T');
    expect(sec.yield).toMatchObject({ kind: 'section', node: 'P' });
    expect(sec.yield.choices[0].sections).toEqual([{ to: 'A' }, { to: 'B' }]);

    const vote = step({ machine: 'v', node: 'G', status: 'running' },
      M('v', ['G', 'K'], [{ from: 'G', to: 'K', mode: 'vote', branch: 'V', samples: 5 }]), 'T');
    expect(vote.yield).toMatchObject({ kind: 'vote', node: 'G' });
    expect(vote.yield.choices[0]).toMatchObject({ branch: 'V', samples: 5 });
  });

  it('honours CEL conditions on auto rails — takes the first whose guard holds', () => {
    const m = M('guard', ['A', 'Yes', 'No'], [
      { from: 'A', to: 'Yes', mode: 'auto', condition: 'value.score > 0.5' },
      { from: 'A', to: 'No', mode: 'auto', condition: 'value.score <= 0.5' },
    ]);
    expect(step({ machine: 'guard', node: 'A', score: 0.9 }, m, 'T').run).toMatchObject({ node: 'Yes', status: 'done' });
    expect(step({ machine: 'guard', node: 'A', score: 0.2 }, m, 'T').run).toMatchObject({ node: 'No', status: 'done' });
  });

  it('stalls (status=blocked) when no auto rail guard is satisfied', () => {
    const m = M('stall', ['A', 'B'], [{ from: 'A', to: 'B', mode: 'auto', condition: 'value.ready == true' }]);
    const out = step({ machine: 'stall', node: 'A', ready: false }, m, 'T');
    expect(out.run).toMatchObject({ node: 'A', status: 'blocked' });
    expect(out.yield).toMatchObject({ kind: 'blocked', node: 'A' });
  });

  it('does not spin on a guardless auto cycle — reports kind=cycle', () => {
    const m = M('loop', ['A', 'B'], [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'A', mode: 'auto' },
    ]);
    const out = step({ machine: 'loop', node: 'A' }, m, 'T');
    expect(out.yield.kind).toBe('cycle');
    expect(out.run.status).toBe('blocked');
  });

  it('derives rails from arrows when the def carries no precomputed rails', () => {
    const out = step(
      { machine: 'arr', node: 'A' },
      { name: 'arr', nodes: [{ name: 'A' }, { name: 'B' }], arrows: [{ from: 'A', arrow: '->', to: 'B' }] },
      'T',
    );
    expect(out.yield).toBeNull();
    expect(out.run).toMatchObject({ node: 'B', status: 'done' });
  });
});

describe('railHolds', () => {
  it('is vacuously true with no condition', () => {
    expect(railHolds({ from: 'A', to: 'B' }, { node: 'A' })).toBe(true);
  });
  it('binds the run as `value`', () => {
    expect(railHolds({ condition: 'value.n >= 3' }, { n: 4 })).toBe(true);
    expect(railHolds({ condition: 'value.n >= 3' }, { n: 1 })).toBe(false);
  });
  it('treats an invalid/throwing condition as false (rail does not fire)', () => {
    expect(railHolds({ condition: 'value.missing.deep == 1' }, { node: 'A' })).toBe(false);
  });
});
