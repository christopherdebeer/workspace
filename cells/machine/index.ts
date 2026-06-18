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

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

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
      "Seed this cell's required facts (its renderer). Idempotent: re-writes _renderers/machine, a canvas ElementView that draws a machine fact as a mermaid diagram. Cell-required infrastructure, distinct from organic knowledge.",
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    scope: null,
  },
  {
    name: 'define_machine',
    description:
      'Record a DyGram machine as a substrate fact at machine/<name>. A machine is a named subgraph: typed nodes (Task/State/Context/…) and typed arrows. Arrows are stored in the value and meant to be projected to substrate edges via workspace.link (see ARROW_RELS). Pass `source` to keep the original .dy text.',
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

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

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
    return json(200, { bootstrapped: true, renderer: '_renderers/machine' });
  }

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const arrows = Array.isArray(a.arrows) ? a.arrows : [];
    const value = {
      title: a.title ?? a.name,
      ...(a.source ? { source: a.source } : {}),
      nodes,
      arrows: arrows.map((e) => ({ ...e, rel: ARROW_RELS[e.arrow] ?? 'flows-to' })),
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
    return json(200, { defined: true, key: `machine/${a.name}`, nodes: nodes.length, arrows: arrows.length });
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

  return json(404, { error: `no route for ${method} ${path}` });
};
