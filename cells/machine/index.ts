/**
 * @c15r/machine — DyGram's ideas as substrate-native facts.
 *
 * A tier-2 cell that makes the concepts of DyGram (christopherdebeer/machine)
 * first-class in the substrate: a machine is a named subgraph of typed nodes
 * and typed arrows an agent rides as rails. See docs/machine-cell.md for the
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

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readFile = (rel) => readFileSync(join(__dirname, rel), 'utf8');

/** The SPA's first-paint seed from the dispatch-proxied ssr.json reads (run AS
 *  the caller; present only on an authed top-level navigation to `/`). */
function buildBoot(user, ssr) {
  const s = ssr ?? {};
  const machines = ((s.machines && s.machines.entries) || []).filter((e) => !String(e.key).startsWith('_'));
  const runs = (s.runs && s.runs.entries) || [];
  return { session: { user: user ?? null }, machines, runs };
}

/** DyGram's seven arrows → substrate edge relations (see docs/machine-cell.md). */
const ARROW_RELS = {
  '->': 'flows-to',
  '-->': 'depends-on',
  '=>': 'causes',
  '<|--': 'inherits',
  '*-->': 'composes',
  'o-->': 'aggregates',
  '<-->': 'relates',
};

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
      'Record a DyGram machine as a fact at machine/<name> (typed nodes + arrows) AND project its rails into invokable, guarded declared actions: a `start`, an auto-rail advance per `->` flow, and a `decide-*` per `=>` agent node. Execution is then invoking those via workspace.invoke; the run fact (machine-run/<run>) advances, its revision history the trajectory. Pass explicit `rails` to override the arrow-derived ones, `project:false` to skip projection, `source` to keep the .dy text.',
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
          description: 'Arrows: [{ from, arrow, to, label? }] where arrow is one of -> --> => <|-- *--> o--> <-->',
          items: { type: 'object' },
        },
        rails: {
          type: 'array',
          description: 'Optional explicit rails: [{ from, to, mode: "auto"|"agent"|"task"|"work", condition?(CEL), prompt?, grants?, tools?, scope?, maxTurns? }]. Default derived from arrows (-> auto, => agent, ~> task, ~>> work). "work" SPAWNS @owner/models.agent at the node (machine-uses-agent): it runs `prompt` with scoped `grants` ({read,write[]}) and advances the run itself; `tools` is the allowlist of substrate tools it may call (the executor filters to it — docs/machine-agent-scopes.md). "task" parks a claimable hand-off for a DRIVING agent instead.',
          items: { type: 'object' },
        },
        project: { type: 'boolean', description: 'Project rails into declared actions (default true)' },
        reactive: { type: 'boolean', description: 'Also register subscriptions so auto rails advance themselves on run changes (default false — driven only)' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel?, runId? } that STARTS a run. runId templates the run id from the event (default "${keySuffix}"); use e.g. "${value.at}" so a recurring source like tending gets a fresh run each time.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    scope: null,
  },
  {
    name: 'record_idea',
    description:
      'Record a DyGram idea as a first-class fact: a concept (an explanatory note) or a claim ({statement, confidence 0..1, support[]}). Makes the *ideas*, not just machines, addressable, salience-ranked, and linkable.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Idea slug' },
        kind: { type: 'string', enum: ['concept', 'claim'], description: 'concept = note; claim = a confidence-bearing assertion' },
        statement: { type: 'string', description: 'The concept text or the claim statement' },
        confidence: { type: 'number', description: 'For a claim: calibrated belief in [0,1]' },
        support: { type: 'array', items: { type: 'string' }, description: 'For a claim: fact keys of the evidence' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'kind', 'statement'],
    },
    scope: null,
  },
  {
    name: 'register_meta_tool',
    description:
      'v4 — persist a tool constructed mid-run as a meta-tool fact (strategy: agent_backed | code_generation | composition), so the vocabulary grows during use, audited by provenance. If it carries a declared `action` ({id, writes[], if?, params?}), that action is also projected as cell-required vocabulary — instantly invocable.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name (becomes key meta-tool/<name>)' },
        strategy: { type: 'string', enum: ['agent_backed', 'code_generation', 'composition'] },
        implementation: { type: 'string', description: 'How the tool is realised (prose, code, or a composition spec)' },
        action: { type: 'object', description: 'Optional declared action to project: { id, writes[], if?, enabled?, params? }' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'strategy'],
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

/** A safe `_actions/` id segment — declared-action ids must not contain "/". */
const seg = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Rails from arrows (when not declared explicitly): a plain flow (`->`) is a
 * deterministic (auto) transition; a causation arrow (`=>`) is an agent-decision
 * rail — the doc's "escalate when reasoning needed". Other arrows (`-->`, `*-->`,
 * …) are structure, not transitions, so they don't become rails.
 */
function railsFrom(arrows, explicit) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((r) => ({
      from: r.from,
      to: r.to,
      mode: r.mode === 'agent' ? 'agent' : r.mode === 'task' ? 'task' : r.mode === 'work' ? 'work' : 'auto',
      ...(r.condition ? { condition: r.condition } : {}),
      // A `work` rail SPAWNS an agent (the machine uses an agent) — it carries the
      // brief the spawned @owner/models.agent runs with: the prompt, scoped grants,
      // and turn budget. (Distinct from `task`, which parks a claimable hand-off
      // for a DRIVING agent.)
      ...(r.prompt ? { prompt: r.prompt } : {}),
      ...(r.grants ? { grants: r.grants } : {}),
      ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
      // The agent's tool allowlist (a subset of the substrate MCP vocabulary the
      // spawned/driving agent may call) — see docs/machine-agent-scopes.md. The
      // executor filters its toolbox to this; the full token-scoped model slots
      // in here later. `grants`/`scope` bound which facts those tools may touch.
      ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
      ...(r.scope ? { scope: r.scope } : {}),
    }));
  }
  const rails = [];
  for (const e of arrows) {
    if (e.arrow === '->') rails.push({ from: e.from, to: e.to, mode: 'auto' });
    else if (e.arrow === '=>') rails.push({ from: e.from, to: e.to, mode: 'agent' });
    else if (e.arrow === '~>') rails.push({ from: e.from, to: e.to, mode: 'task' });
    else if (e.arrow === '~>>') rails.push({ from: e.from, to: e.to, mode: 'work' });
  }
  return rails;
}

/**
 * Project a machine's rails into cell-required declared actions in the owner's
 * slice (now permitted on the organ path). Each rail becomes an invokable,
 * guarded transition over a `machine-run/<run>` fact — execution IS invoking
 * these via the gateway, and the run fact's revision history is the trajectory
 * (effects-as-data). Spend reasoning only at agent rails:
 *   - start              seed a run at the entry node (no incoming rail)
 *   - <from>-to-<to>      auto rail: advance when the run is at `from`, no LLM
 *   - decide-<from>       agent rail: record the chosen branch as a `claim`,
 *                         then advance — the only place a model is invoked
 */
function projectionActions(name, nodes, rails) {
  const m = seg(name);
  const runKey = 'machine-run/${params.run}';
  const tags = ['machine', `machine:${name}`];
  const hasOut = (node) => rails.some((r) => r.from === node);
  const hasIn = (node) => rails.some((r) => r.to === node);
  const entry = (nodes.find((n) => !hasIn(n.name)) ?? nodes[0])?.name;
  const actions = [];

  if (entry) {
    actions.push({
      id: `machine.${m}.start`,
      description: `Start a run of "${name}" at ${entry}.`,
      params: { run: { type: 'string', required: true, description: 'Run id → machine-run/<run>' } },
      writes: [{ key: runKey, value: { machine: name, node: entry, status: 'running', startedAt: '${now}' }, type: 'machine-run', tags, ifAbsent: true }],
    });
  }

  for (const r of rails.filter((x) => x.mode === 'auto')) {
    const ifConds = [{ key: runKey, path: 'node', op: 'eq', value: r.from }];
    if (r.condition) ifConds.push({ cel: r.condition, key: runKey });
    actions.push({
      id: `machine.${m}.${seg(r.from)}-to-${seg(r.to)}`,
      description: `Auto rail ${r.from} → ${r.to}${hasOut(r.to) ? '' : ' (terminal)'}.`,
      params: { run: { type: 'string', required: true } },
      if: ifConds,
      writes: [{ key: runKey, value: { machine: name, node: r.to, status: hasOut(r.to) ? 'running' : 'done', at: '${now}', via: `${r.from}->${r.to}` }, type: 'machine-run', tags }],
    });
  }

  // Agent (`=>`) and task (`~>`) rails both resolve at `from` by recording a
  // chosen branch as a claim + advancing — the same completion action, whether
  // the chooser is a model (agent) or a claimant working an open task (task).
  const isDecision = (x) => x.mode === 'agent' || x.mode === 'task';
  for (const from of [...new Set(rails.filter(isDecision).map((x) => x.from))]) {
    const branches = rails.filter((x) => isDecision(x) && x.from === from).map((x) => x.to);
    // The advance can't know the runtime-chosen branch's terminality, but when
    // every branch is terminal the result is `done` regardless of choice — the
    // common "decide/task → a terminal Result" case (mixed nodes resolve `done`
    // correctly via models.decide, which sees the chosen branch).
    const decisionStatus = branches.every((b) => !hasOut(b)) ? 'done' : 'running';
    actions.push({
      id: `machine.${m}.decide-${seg(from)}`,
      description: `Decision at ${from}: record the chosen branch as a claim and advance. Branches: ${branches.join(', ')}.`,
      params: {
        run: { type: 'string', required: true },
        to: { type: 'string', required: true, enum: branches, description: 'The chosen branch' },
        statement: { type: 'string', description: 'Why this branch — becomes the claim' },
        confidence: { type: 'number', description: 'Calibrated belief 0..1' },
      },
      if: [{ key: runKey, path: 'node', op: 'eq', value: from }],
      writes: [
        { key: 'claims/${params.run}.' + seg(from), value: { statement: '${params.statement}', confidence: '${params.confidence}', machine: name, at: from, chose: '${params.to}' }, type: 'claim', tags: ['claim', 'machine', 'dygram'] },
        { key: runKey, value: { machine: name, node: '${params.to}', status: decisionStatus, at: '${now}', via: `${from}=>decision` }, type: 'machine-run', tags },
      ],
    });
  }
  return actions;
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
 * Subscriptions that make a machine reactive:
 *  - one per AUTO rail: invoke the transition action in-process; its `if` guard
 *    fires only the rail whose `from` = the run's current node, so the
 *    deterministic prefix advances itself.
 *  - one per AGENT node: when a run reaches it, deliver to `@owner/models.decide`
 *    — the model picks a branch and writes the decision back (re-triggering the
 *    rails), or, with no provider configured, leaves a claimable `task` fact for
 *    any substrate agent to complete. Reasoning is spent only here.
 */
function projectionSubscriptions(name, rails) {
  const m = seg(name);
  const subs = [];
  for (const r of rails.filter((x) => x.mode === 'auto')) {
    const id = `machine.${m}.${seg(r.from)}-to-${seg(r.to)}`;
    subs.push({
      id,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)}` },
      invoke: id,
      params: { run: '${keySuffix}' },
    });
  }
  // Decision nodes deliver to the model. `=>` agent rails let it decide (falling
  // back to a claimable task if no provider); `~>` task rails always defer to a
  // claimable task. The `status != awaiting-decision` guard makes the run fire
  // the decision once on arrival, not again when it parks awaiting a claimant.
  const agentNodes = new Set(rails.filter((x) => x.mode === 'agent').map((x) => x.from));
  const taskNodes = new Set(rails.filter((x) => x.mode === 'task').map((x) => x.from));
  for (const from of new Set([...agentNodes, ...taskNodes])) {
    const defer = taskNodes.has(from) && !agentNodes.has(from);
    subs.push({
      id: `machine.${m}.decide-${seg(from)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.node == ${JSON.stringify(from)} && value.status != "awaiting-decision"` },
      deliver: `@${OWNER}/models.decide`,
      params: defer ? { run: '${keySuffix}', defer: 'true' } : { run: '${keySuffix}' },
    });
  }
  // `work` rails SPAWN an agent: when a run reaches the node, deliver it to
  // @owner/models.agent (the substrate tool-loop) with the rail's brief + scoped
  // grants. The agent DOES the work and advances the run itself (it writes
  // machine-run/<run> to the next node) — the run completes instead of parking.
  // `status == "running"` makes it fire once on arrival.
  for (const r of rails.filter((x) => x.mode === 'work')) {
    const advance = `When the work is complete, advance the run by writing fact "machine-run/\${keySuffix}" = {"machine":${JSON.stringify(name)},"node":${JSON.stringify(r.to)},"status":"done","via":${JSON.stringify(`${r.from}~>>work`)}} (type machine-run, tags ["machine",${JSON.stringify(`machine:${name}`)}]).`;
    const prompt = (r.prompt ? `${r.prompt}\n\n` : `Do the work for node "${r.from}" of machine "${name}", run \${keySuffix}.\n\n`) + advance;
    subs.push({
      id: `machine.${m}.work-${seg(r.from)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.node == ${JSON.stringify(r.from)} && value.status == "running"` },
      deliver: `@${OWNER}/models.agent`,
      params: {
        prompt,
        // Grants default to the run fact only (so it can advance) + read-all;
        // a rail widens write within the cell's standing as needed.
        grants: r.grants ?? { read: true, write: ['machine-run/'] },
        // Optional tool allowlist — the executor filters its toolbox to this
        // (docs/machine-agent-scopes.md). Omitted = the executor's full default set.
        ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
        ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
        factKey: `machine-work/${m}.\${keySuffix}`,
        tags: ['machine', `machine:${name}`, 'work'],
      },
    });
  }
  return subs;
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

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const arrows = Array.isArray(a.arrows) ? a.arrows : [];
    const rails = railsFrom(arrows, a.rails);
    const value = {
      title: a.title ?? a.name,
      ...(a.source ? { source: a.source } : {}),
      nodes,
      arrows: arrows.map((e) => ({ ...e, rel: ARROW_RELS[e.arrow] ?? 'flows-to' })),
      rails,
      // Substrate keys a decision at an agent rail should read for context
      // (e.g. a tending machine points at `tending/latest`). models.decide
      // includes their current values in the prompt.
      ...(Array.isArray(a.context) ? { context: a.context } : {}),
      nodeCount: nodes.length,
      arrowCount: arrows.length,
    };
    await emit({
      key: `machine/${a.name}`,
      value,
      type: 'machine',
      tags: [...new Set(['machine', 'dygram', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.define_machine',
    });
    // Project the rails into invokable, guarded declared actions (v2 → v3).
    // The run advances by invoking these; agent rails surface as `decide-*`.
    let projected = [];
    const subscriptions = [];
    if (a.project !== false && rails.length) {
      projected = projectionActions(a.name, nodes, rails);
      for (const def of projected) await emitAction(def, a.name);
      // Opt-in reactivity: subscribe each auto rail to this machine's runs, so
      // the deterministic prefix advances itself. Without `reactive`, the same
      // actions remain drivable by hand via workspace.invoke.
      if (a.reactive) {
        for (const s of projectionSubscriptions(a.name, rails)) {
          await emitSubscription(s, a.name);
          subscriptions.push(s.id);
        }
      }
      // Optional trigger: a fact pattern that STARTS a run (e.g. a new capture,
      // or a tending audit). `runId` templates the run id from the event so each
      // occurrence gets its own run (default `${keySuffix}`); point it at a
      // unique field (e.g. `${value.at}`) for a recurring source like tending.
      if (a.trigger && typeof a.trigger === 'object') {
        const { runId, ...match } = a.trigger;
        const trig = { id: `machine.${seg(a.name)}.trigger`, match, invoke: `machine.${seg(a.name)}.start`, params: { run: typeof runId === 'string' ? runId : '${keySuffix}' } };
        await emitSubscription(trig, a.name);
        subscriptions.push(trig.id);
      }
    }
    return json(200, {
      defined: true,
      key: `machine/${a.name}`,
      nodes: nodes.length,
      arrows: arrows.length,
      rails: rails.length,
      actions: projected.map((d) => d.id),
      reactive: !!a.reactive,
      subscriptions,
    });
  }

  if (method === 'POST' && path === '/_tools/record_idea') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.id || !a.kind || !a.statement) return json(400, { error: 'id, kind, and statement are required' });
    const key = a.kind === 'claim' ? `claims/${a.id}` : `concept/${a.id}`;
    const value =
      a.kind === 'claim'
        ? { statement: a.statement, ...(a.confidence != null ? { confidence: a.confidence } : {}), ...(Array.isArray(a.support) ? { support: a.support } : {}) }
        : { content: a.statement };
    await emit({
      key,
      value,
      type: a.kind,
      tags: [...new Set([a.kind, 'dygram', 'machine', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.record_idea',
    });
    return json(200, { recorded: true, key });
  }

  if (method === 'POST' && path === '/_tools/register_meta_tool') {
    // v4 — meta-tools as registered substrate tools: a tool constructed during
    // a run persists as a `meta-tool` fact, and (when it carries a declared
    // `action`) is projected as a cell-required declared action, so the
    // vocabulary grows during use, audited by provenance.
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name || !a.strategy) return json(400, { error: 'name and strategy are required' });
    await emit({
      key: `meta-tool/${seg(a.name)}`,
      value: { name: a.name, strategy: a.strategy, ...(a.implementation ? { implementation: a.implementation } : {}) },
      type: 'meta-tool',
      tags: [...new Set(['meta-tool', 'dygram', 'machine', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.register_meta_tool',
    });
    let action;
    if (a.action && a.action.id && Array.isArray(a.action.writes)) {
      action = a.action.id;
      await emitAction(a.action, a.name);
    }
    return json(200, { registered: true, key: `meta-tool/${seg(a.name)}`, ...(action ? { action } : {}) });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
