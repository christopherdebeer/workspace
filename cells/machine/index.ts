/**
 * @c15r/machine — DyGram's ideas as substrate-native facts.
 *
 * A tier-2 cell that makes the concepts of DyGram (christopherdebeer/machine)
 * first-class in the substrate: a machine is a named subgraph of typed nodes
 * and typed arrows an agent rides as rails. See docs/machine.md for the
 * full design and the DyGram→substrate mapping.
 *
 * Minimal cell contract (mirrors cells/reef-writer): GET /_tools advertises the
 * vocabulary; POST /_tools/<name> dispatches; writes go through the organ path
 * (substrate.write.requested), so the workspace applies them as facts in the
 * owner's slice with this cell as the attested writer. Edges (the 7 arrow rels)
 * and reads are the gateway's job (workspace.link / workspace.query type:machine).
 */
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './client/app';
import { installBridge } from './client/bridge';
import { seg, railsFrom, validateMachine, projectActions, projectSubscriptions, spawnChildrenWrites, step, specFromYield, parentOf, barrierAdvance, mkey, assembleMachine, decomposeWrites } from './engine';
// The shared SERVER-side substrate client (ADR-0017) — read/query/emit/supersede
// over the owner's slice. VENDORED here (not a URL import): the forge bundler
// only bundles relative imports within the cell dir + esm.sh-declared deps; a
// server-side `https://` import HANGS the bundler (the browser kernel's URL is
// browser-fetched, never server-bundled). Canonical source: cells/kernel/static/
// substrate.js — kept in sync until it's published as an npm package (ADR-0017).
import { createSubstrate } from './substrate';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readFile = (rel) => readFileSync(join(__dirname, rel), 'utf8');

/** The SPA's first-paint seed from the dispatch-proxied ssr.json reads (run AS
 *  the caller; present only on an authed top-level navigation to `/`). */
function buildBoot(user, ssr) {
  const s = ssr ?? {};
  const ent = (k) => (s[k] && s[k].entries) || [];
  // Identities only (bare `machine/<name>`); node/rail/run facts are separate types.
  const machines = ent('machines').filter((e) => String(e.key).startsWith('machine/') && String(e.key).slice('machine/'.length).indexOf('/') < 0);
  return { session: { user: user ?? null }, machines, nodes: ent('nodes'), rails: ent('rails'), runs: ent('runs') };
}


/**
 * The cell-required `_renderers/machine` source (a canvas ElementView): adapts a
 * machine fact's value (spread onto the element as el.nodes / el.arrows by the
 * canvas storage seam) into mermaid and renders it via the mermaid CDN — the
 * same engine the viewers cell uses. Backtick-free so it nests cleanly here.
 * Seeded by the `bootstrap` tool — a cell seeding its own required facts, which
 * is categorically distinct from organic knowledge accretion (see docs).
 */
const RENDERER_SRC = `
let M;
function loadMermaid(){
  if(!M){ M = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function(m){ m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'}); return m.default; }); }
  return M;
}
function sid(s){ return String(s||'n').replace(/[^A-Za-z0-9_]/g,'_'); }
function toMermaid(el){
  var nodes = Array.isArray(el.nodes)?el.nodes:[];
  var arrows = Array.isArray(el.arrows)?el.arrows:[];
  var lines = ['graph TD'];
  for(var i=0;i<nodes.length;i++){ var n=nodes[i]||{}; lines.push('  '+sid(n.name)+'["'+String(n.title||n.name||'').replace(/"/g,"'")+'"]'); }
  for(var j=0;j<arrows.length;j++){ var a=arrows[j]||{}; lines.push('  '+sid(a.from)+' -->|'+String(a.rel||a.arrow||'').replace(/[|"\\n]/g,'')+'| '+sid(a.to)); }
  return lines.join('\\n');
}
var seq=0;
function render(host,el){
  try{
    host.textContent='…';
    var src=toMermaid(el);
    loadMermaid().then(function(m){ return m.render('mm'+(++seq), src); }).then(function(r){ host.innerHTML=r.svg; }).catch(function(e){ host.textContent='machine: '+((e&&e.message)||e); });
  }catch(e){ host.textContent='machine render error'; }
}
function size(el,h){ var s=el.scale||1; if(typeof el.width==='number') h.style.width=(el.width*s)+'px'; if(typeof el.height==='number') h.style.height=(el.height*s)+'px'; }
export const view = {
  mount: function(el){ var h=document.createElement('div'); h.className='content'; size(el,h); render(h,el); return h; },
  update: function(el,dom){ if(!dom) return; size(el,dom); render(dom,el); }
};
`;

const TOOLS = [
  {
    name: 'bootstrap',
    description:
      "Seed this cell's required facts. Idempotent: re-writes _renderers/machine (a canvas ElementView drawing a machine as a mermaid diagram) and _views/machine-runs (the runs dashboard). Cell-required infrastructure — versioned with the cell, distinct from organic knowledge.",
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    scope: null,
  },
  {
    name: 'define_machine',
    description:
      'Define a DyGram machine in DECOMPOSED form — like a canvas board or doc, the machine is an identity fact `machine/<name>` plus one `machine-node/*` fact per node and one `machine-rail/*` fact per rail (all nested under `machine/<name>/`). The rail facts carry mode/condition/prompt and their keys derive node→node graph edges (so neighbors/$graph/canvas render the machine for free). Also projects the run vocabulary: a `start` action + a `decide-*` per agent/task node, the single `step` subscription (the stateless stepper walks deterministic rails + runs the join barrier), and model deliveries for agent/work rails. Pass explicit `rails` to override arrow-derived ones, `project:false` to skip the run vocabulary, `reactive:false` for driven-only (drive with the `step` tool), `dryRun` to preview.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine slug (becomes key machine/<name>)' },
        title: { type: 'string', description: 'Human title' },
        source: { type: 'string', description: 'Optional original .dy source text' },
        nodes: {
          type: 'array',
          description: 'Nodes: [{ name, kind, title?, attributes? }] (kind = Task/State/Input/Output/Context/Resource/Process/Concept/Implementation/Result/tool/…)',
          items: { type: 'object' },
        },
        arrows: {
          type: 'array',
          description: 'Arrows: [{ from, arrow, to, label? }]. DyGram\'s relationship/rendering arrows are -> --> => <|-- *--> o--> <--> (stored as edge `rel`s; see ARROW_RELS). `~>`/`~>>` are NOT DyGram arrows — they are substrate-only rail syntax we add for task/work rails (see docs/machine.md).',
          items: { type: 'object' },
        },
        rails: {
          type: 'array',
          description: 'Optional explicit rails: [{ from, to, mode: "auto"|"agent"|"task"|"work"|"catch", condition?(CEL), prompt?, grants?, tools?, scope?, maxTurns?, maxMs? }]. `condition` (auto rails) is CEL over `{ value:<run>, now, nowMs }` — so an edge can gate on machine state AND time, e.g. `value.deadline < now` or `nowMs - value.startedMs > 300000` (a deadline/wait). `maxMs` is a soft per-step wall-clock budget (ms) the spawned work agent honours — bounds a step below the models cell Lambda ceiling (default ≈285s). A `catch` rail from a node fires only when that node`s work/agent step FAILED (`status:"failed"`), routing the run to a recovery node — the error-handling primitive (machine.md §13). NB: making rail mode explicit data — and the arrow→mode default below — is a substrate-only design choice, NOT a DyGram port: DyGram has no rail-mode enum and infers auto-vs-agent dynamically from node-type/out-degree/annotations (its `=>` is causation *styling*, not an agent marker). Our arrow→mode default: -> ⇒ auto, => ⇒ agent, ~> ⇒ task, ~>> ⇒ work. "work" SPAWNS @owner/models.agent at the node (machine-uses-agent): it runs `prompt` with scoped `grants` ({read,write[]}) and advances the run itself; `tools` is the allowlist of substrate tools it may call (the executor filters to it — docs/machine.md). "task" parks a claimable hand-off for a DRIVING agent instead.',
          items: { type: 'object' },
        },
        dryRun: { type: 'boolean', description: 'Validate + preview the decomposition facts + projected action/subscription ids WITHOUT writing anything.' },
        project: { type: 'boolean', description: 'Project the run vocabulary (start + decide actions, step + model-delivery subscriptions, triggers). Default true.' },
        reactive: { type: 'boolean', description: 'Register the step subscription so runs self-drive on change (default true). Pass false for a driven-only machine you advance by hand with the `step` tool.' },
        context: { type: 'array', items: { type: 'string' }, description: 'Substrate keys a decision should read for context (e.g. tending/latest); stored on the identity fact.' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel?, runId? } that STARTS a run. runId templates the run id from the event (default "${keySuffix}"); use e.g. "${value.at}" so a recurring source like tending gets a fresh run each time.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    scope: null,
  },
  {
    name: 'trigger_run',
    description:
      'Fire a run of a machine by name — the canonical "scheduled routine / API trigger" entry (mirrors Claude Code Routines\' API trigger). Writes machine/<machine>/trigger/<run>; the machine\'s standing internal-trigger subscription starts the run at its entry node, injecting `text` as run context. Auto-generates `run` if omitted. The machine must have been define_machine\'d with projection on.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
        run: { type: 'string', description: 'Optional run id (auto-generated if omitted)' },
        text: { type: 'string', description: 'Trigger-context body (like a Routine `text` payload) — stored on the run for the entry agent' },
      },
      required: ['machine'],
    },
    scope: null,
  },
  {
    name: 'step',
    description:
      'Advance a machine run STATELESSLY (ADR-0018, the stateless stepper). Assembles the machine from its decomposed facts, reads machine/<machine>/run/<run>, follows deterministic `auto` rails IN-PROCESS (CEL-guarded, no per-hop fact-write), and emits at most ONE advanced run fact (carrying the execution `trace`). Returns the `yield`: the non-deterministic point where a decision is owed — `{kind:"agent"|"task"|"work"|"section"|"vote", node, choices}` — or null when the run completed. On a section/vote yield it spawns the children; when a child completes it runs the DETERMINISTIC join barrier (reads the siblings, advances the parent once all are done — no model). The driven counterpart to the reactive step subscription. Idempotent: a run already parked at its yield emits nothing.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
        run: { type: 'string', description: 'Run id → machine/<machine>/run/<run>' },
      },
      required: ['machine', 'run'],
    },
    scope: null,
  },
];

async function emit(detail) {
  const client = new EventBridgeClient({});
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: process.env.SERVICE_NAME,
          DetailType: 'substrate.write.requested',
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
}

/** Emit one cell-required declared action through the organ path. */
async function emitAction(def, name) {
  await emit({ key: `_actions/${def.id}`, value: def, type: 'action', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/** Emit one cell-required reaction subscription through the organ path. */
async function emitSubscription(def, name) {
  await emit({ key: `_subscriptions/${def.id}`, value: def, type: 'subscription', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/** The owner whose slice this cell serves — used to address sibling cells. */
const OWNER = process.env.CELL_OWNER ?? 'c15r';

/**
 * Drive one run forward (ADR-0018). Reads the run + its machine def via the
 * shared substrate client, runs the pure `step`, and applies the result:
 *  - emits the advanced run (only when it actually changed — idempotent, so a
 *    reactive deliver to this tool on a parked run is a cheap no-op, no loop);
 *  - on a section/vote yield, spawns the children (reliable per-child writes);
 *  - on a completed run, runs the deterministic join barrier against its parent.
 * Pure decisions live in engine.ts; this is the thin I/O shell around them.
 */
/** Assemble a machine's in-memory def from its DECOMPOSED facts (identity + node +
 *  rail facts, all under the `machine/<name>/` namespace). Returns null if absent. */
async function loadMachine(sub, machineName) {
  const idFact = await sub.read(mkey.machine(machineName));
  if (!idFact) return null;
  const base = mkey.machine(machineName);
  const [nodeFacts, railFacts] = await Promise.all([
    sub.query({ prefix: `${base}/node/` }),
    sub.query({ prefix: `${base}/rail/` }),
  ]);
  return assembleMachine(idFact, nodeFacts, railFacts);
}

async function stepRun(machineName, runId) {
  const sub = createSubstrate({ owner: OWNER, via: 'machine.step' });
  const now = new Date().toISOString();
  const runKey = mkey.run(machineName, runId);
  const runFact = await sub.read(runKey);
  if (!runFact) return { error: `no run ${runKey}` };
  const runValue = runFact.value || {};
  const mName = runValue.machine || machineName;
  const machine = await loadMachine(sub, mName);
  if (!machine) return { error: `no machine ${mkey.machine(mName)}` };

  const result = step(runValue, machine, now);

  // A section/vote yield spawns children; the spawn writes include the parent's
  // wait-state (which supersedes the plain advance), so don't also emit `result.run`.
  if (result.yield && (result.yield.kind === 'section' || result.yield.kind === 'vote')) {
    const spec = specFromYield(result.yield);
    const writes = spawnChildrenWrites(runId, mName, spec, now);
    await sub.emit(writes);
    return { run: runId, machine: mName, node: result.yield.node, yield: result.yield, spawned: writes.slice(1).map((w) => w.key) };
  }

  // Emit the advance only if the meaningful state changed (idempotent — so a
  // reactive deliver to a parked run is a cheap no-op, no loop). trace always rides.
  const changed = result.run.node !== runValue.node || result.run.status !== runValue.status || JSON.stringify(result.run.trace) !== JSON.stringify(runValue.trace);
  if (changed) {
    await sub.emit([{ key: runKey, value: result.run, type: 'machine-run', tags: ['machine', `machine:${mName}`] }]);
  }

  let barrier;
  if (result.run.status === 'done') {
    barrier = await advanceParentBarrier(sub, mName, runId, result.run, machine, now);
  }

  return { run: runId, machine: mName, node: result.run.node, status: result.run.status, changed, yield: result.yield ?? null, path: result.path, ...(barrier ? { barrier } : {}) };
}

/**
 * The deterministic join barrier shell: if `childRunId` is a section/vote child,
 * read the parent + all siblings (under the machine's run namespace) and let the
 * pure `barrierAdvance` decide whether to advance the parent.
 */
async function advanceParentBarrier(sub, machineName, childRunId, childRun, machine, now) {
  const rel = parentOf(childRunId);
  if (!rel) return null;
  const parent = await sub.read(mkey.run(machineName, rel.parent));
  if (!parent) return null;
  const siblings = await sub.query({ prefix: `${mkey.run(machineName, rel.parent)}${rel.sep}` });
  // Organ writes are async: the child-done write that triggered this step may not
  // have applied yet, so the just-completed child can read back stale. Overlay its
  // fresh value (and ensure it's present) so the barrier counts it.
  const childKey = mkey.run(machineName, childRunId);
  let sawChild = false;
  const merged = siblings.map((s) => {
    if (s.key === childKey) { sawChild = true; return { ...s, value: childRun }; }
    return s;
  });
  if (!sawChild) merged.push({ key: childKey, value: childRun });
  const decision = barrierAdvance(rel.parent, parent.value, merged, machine, now);
  if (!decision.advance) return { parent: rel.parent, waiting: true, done: decision.done, expected: decision.expected, reason: decision.reason };
  await sub.emit([decision.advance]);
  return { parent: rel.parent, advanced: true, node: decision.advance.value.node, done: decision.done, expected: decision.expected };
}


export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  // ── the SSR React SPA (the user frontend) ──────────────────────────────
  if (method === 'GET' && path === '/app.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*' }, body: readFile('app.js') };
  }
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '')) {
    try {
      const caller = event.headers && event.headers['x-cell-caller'];
      const authed = !!caller && caller !== 'anonymous';
      const boot = buildBoot(authed ? caller : null, event.ssrData);
      // SSR'd cross-cell links must match the client's; a host-aware stub keeps
      // hydration clean (only cellUrl is used during render).
      installBridge({ cellUrl: (o, n, rest = '') => `/@${o}/${n}${rest}` });
      const inner = renderToString(createElement(App, { initial: boot }));
      const state = JSON.stringify(boot).replace(/</g, '\\u003c');
      const shell = readFile('static/index.html')
        .replace('<div id="root"></div>', `<div id="root" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="machine-state" type="application/json">${state}</script>\n  <script type="module"`);
      return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: shell };
    } catch (err) {
      // SSR is best-effort — fall back to the cold-mount shell, never a 500.
      try { return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: readFile('static/index.html') }; } catch { /* fall through */ }
    }
  }

  if (method === 'GET' && path === '/_tools') {
    return json(200, { tools: TOOLS });
  }

  if (method === 'POST' && path === '/_tools/bootstrap') {
    await emit({
      key: '_renderers/machine',
      value: { type: 'machine', source: RENDERER_SRC },
      type: 'renderer',
      tags: ['_renderers', 'machine-cell', 'cell-required'],
      via: 'machine.bootstrap',
    });
    // A cell-required VIEW over runs — the executor's dashboard. Cells seed
    // their own actions/views now, the same as their renderers.
    await emit({
      key: '_views/machine-runs',
      value: { id: 'machine-runs', description: 'Machine runs — active and completed', query: { type: 'machine-run', rankBy: 'recency', limit: 50 }, render: { type: 'fields' } },
      via: 'machine.bootstrap',
    });
    // Generic claimable-task vocabulary (not machine-specific): an atomic,
    // lease-bound claim — sync's canonical hand-off — so one agent works a task
    // at a time, plus the queue of runs awaiting a decision/work.
    await emit({
      key: '_actions/task.claim',
      value: {
        id: 'task.claim',
        description: 'Atomically claim an awaiting task (a machine run in awaiting-decision) with a 5-minute lease, so only one agent works it. Fails if a live claim already exists; the lease auto-expires so a crashed claimant releases it.',
        params: { run: { type: 'string', required: true, description: 'the run id (task) to claim' }, by: { type: 'string', required: true, description: 'who is claiming' } },
        writes: [{ key: 'task-claim/${params.run}', ifAbsent: true, value: { by: '${params.by}', at: '${now}' }, type: 'task-claim', timer: { ms: 300000, effect: 'delete' } }],
      },
      type: 'action',
      tags: ['cell-required', 'machine', 'tasks'],
      via: 'machine.bootstrap',
    });
    await emit({
      key: '_views/open-tasks',
      value: { id: 'open-tasks', description: 'Runs awaiting a decision or work — the claimable task queue', query: { tag: 'awaiting', rankBy: 'recency', limit: 50 }, render: { type: 'fields' } },
      via: 'machine.bootstrap',
    });
    return json(200, { bootstrapped: true, renderer: '_renderers/machine', views: ['_views/machine-runs', '_views/open-tasks'], actions: ['task.claim'] });
  }

  if (method === 'POST' && path === '/_tools/trigger_run') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.machine) return json(400, { error: 'machine is required' });
    const run = a.run || `${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await emit({
      key: mkey.trigger(a.machine, run),
      value: { at: new Date().toISOString(), ...(a.text ? { text: a.text } : {}) },
      type: 'machine-trigger',
      tags: ['machine', `machine:${a.machine}`, 'trigger'],
      via: 'machine.trigger_run',
    });
    return json(200, { triggered: true, machine: a.machine, run, key: mkey.trigger(a.machine, run) });
  }

  if (method === 'POST' && path === '/_tools/step') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.run || !a.machine) return json(400, { error: 'run and machine are required' });
    try {
      const out = await stepRun(a.machine, a.run);
      return json(out.error ? 404 : 200, out);
    } catch (err) {
      return json(500, { error: (err && err.message) || String(err) });
    }
  }

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const rails = railsFrom(Array.isArray(a.arrows) ? a.arrows : [], a.rails);
    const validation = validateMachine(nodes, rails);
    const project = a.project !== false;
    const reactive = a.reactive !== false; // stepper-on by default; pass reactive:false for driven-only

    // The DECOMPOSED definition fan: identity + one fact per node + per rail.
    const writes = decomposeWrites(a.name, nodes, rails, { title: a.title, source: a.source, ...(a.kind ? { kind: a.kind } : {}) });
    if (Array.isArray(a.context)) writes[0].value.context = a.context; // decide reads these
    writes[0].value.reactive = reactive; // surfaced to the UI toggle
    if (Array.isArray(a.tags)) writes[0].tags = [...new Set([...writes[0].tags, ...a.tags])];

    const actions = project ? projectActions(a.name, nodes, rails) : [];
    const subs = project && reactive ? projectSubscriptions(a.name, rails, OWNER, a.context) : [];
    const sub = createSubstrate({ owner: OWNER, via: 'machine.define_machine' });

    // Which prior definition facts / projected vocabulary this re-definition would
    // retire (full-replace semantics — see the reconcile sweep below). Computed up
    // front so `dryRun` can preview the cleanup, not just the writes.
    const keepFacts = new Set(writes.map((w) => w.key));
    const keepActionKeys = new Set(actions.map((d) => `_actions/${d.id}`));
    // `subs` ⊂ the final projected sub set; itrigger/trigger are added at emit time
    // below, so include their ids here too or the preview would over-report them.
    const projectedSubIds = [
      ...subs.map((s) => s.id),
      ...(project ? [`machine.${seg(a.name)}.itrigger`] : []),
      ...(project && a.trigger && typeof a.trigger === 'object' ? [`machine.${seg(a.name)}.trigger`] : []),
    ];
    const keepSubKeys = new Set(projectedSubIds.map((id) => `_subscriptions/${id}`));
    const findStale = async (prefix, keep) => {
      let existing = [];
      try { existing = await sub.query({ prefix, limit: 200 }); } catch { return []; }
      return existing.map((f) => f.key).filter((k) => !keep.has(k));
    };
    const stalePrefixes = [
      [`${mkey.machine(a.name)}/node/`, keepFacts],
      [`${mkey.machine(a.name)}/rail/`, keepFacts],
      [`_actions/machine.${seg(a.name)}.`, keepActionKeys],
      [`_subscriptions/machine.${seg(a.name)}.`, keepSubKeys],
    ];

    if (a.dryRun) {
      const stale = (await Promise.all(stalePrefixes.map(([p, k]) => findStale(p, k)))).flat();
      return json(200, { dryRun: true, validation, facts: writes.map((w) => w.key), actions: actions.map((d) => d.id), subscriptions: subs.map((s) => s.id), wouldSupersede: stale });
    }

    // 1. Emit the decomposition fan reliably (FailedEntryCount-checked).
    await sub.emit(writes);
    // 2. Project declared actions (start + decide) + the stepper subscriptions.
    const subscriptions = [];
    for (const def of actions) await emitAction(def, a.name);
    for (const s of subs) { await emitSubscription(s, a.name); subscriptions.push(s.id); }
    // 3. Triggers: the internal `machine/<name>/trigger/<run>` start, plus any
    //    optional fact-pattern trigger (e.g. a tending audit) — always, when projecting.
    if (project) {
      const itrig = {
        id: `machine.${seg(a.name)}.itrigger`,
        match: { keyPrefix: `${mkey.machine(a.name)}/trigger/` },
        invoke: `machine.${seg(a.name)}.start`,
        params: { run: '${keySuffix}', text: '${value.text}' },
      };
      await emitSubscription(itrig, a.name);
      subscriptions.push(itrig.id);
      if (a.trigger && typeof a.trigger === 'object') {
        const { runId, ...match } = a.trigger;
        const trig = { id: `machine.${seg(a.name)}.trigger`, match, invoke: `machine.${seg(a.name)}.start`, params: { run: typeof runId === 'string' ? runId : '${keySuffix}' } };
        await emitSubscription(trig, a.name);
        subscriptions.push(trig.id);
      }
    }
    // 4. Reconcile — a re-definition is a full replace, so supersede the prior
    //    definition facts and projected vocabulary this one no longer includes
    //    (a removed node/rail, or a branch whose mode flipped agent⇄work, would
    //    otherwise leave an orphan node/rail fact or a stale decide-/work- sub
    //    that double-fires). Scoped to this machine's `/node/` + `/rail/` facts
    //    and its `_actions`/`_subscriptions` only; run/trigger/decide/work/claim
    //    execution facts are run history and are never swept. (Same prefixes the
    //    dryRun preview used; subscriptions[] now holds the emitted itrigger/trigger.)
    const keepSubsFinal = new Set(subscriptions.map((id) => `_subscriptions/${id}`));
    const sweepSets = [
      [`${mkey.machine(a.name)}/node/`, keepFacts],
      [`${mkey.machine(a.name)}/rail/`, keepFacts],
      [`_actions/machine.${seg(a.name)}.`, keepActionKeys],
      [`_subscriptions/machine.${seg(a.name)}.`, keepSubsFinal],
    ];
    const superseded = [];
    for (const [prefix, keep] of sweepSets) {
      for (const key of await findStale(prefix, keep)) {
        try { await sub.supersede(key); superseded.push(key); } catch { /* best-effort */ }
      }
    }
    return json(200, {
      defined: true,
      key: mkey.machine(a.name),
      facts: writes.map((w) => w.key),
      nodes: nodes.length,
      rails: rails.length,
      actions: actions.map((d) => d.id),
      reactive,
      subscriptions,
      superseded,
      validation,
    });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
