/**
 * The cell's tool surface — the val's 12 MCP tools plus the dashboard's
 * review/flag actions, served at /_tools and reachable as @c15r/regwatch.<x>.
 *
 * Authorization: the gateway already restricts callers to owner-or-granted;
 * here we only split owner-only mutations (collector/admin paths) from
 * reviewer actions. Grants are per-cell today, so this in-cell check is the
 * interim per-tool scope split docs/regwatch-port.md §4 calls for.
 */
import * as store from './store';

const OWNER = process.env.CELL_OWNER ?? 'c15r';
const OWNER_ONLY = new Set(['ingest', 'add_source', 'update_source', 'save_prompt', 'migrate']);

/* ── feedback analysis (port of admin.ts feedbackSummary) ───────── */

export async function feedbackSummary(): Promise<Record<string, unknown>> {
  const reviews = (await store.listReviews()) as Array<{
    relevance: string;
    category: string;
    source_id: string | null;
    relevance_signals: Record<string, unknown>;
  }>;

  const byRelevance: Record<string, number> = {};
  const catMap: Record<string, Record<string, number>> = {};
  const sourceMap: Record<string, Record<string, number>> = {};
  const signalStats: Record<string, { correct: number; incorrect: number }> = {};

  for (const r of reviews) {
    byRelevance[r.relevance] = (byRelevance[r.relevance] ?? 0) + 1;
    const cat = r.category ?? 'other';
    (catMap[cat] ??= {})[r.relevance] = (catMap[cat][r.relevance] ?? 0) + 1;
    const src = r.source_id ?? 'unknown';
    (sourceMap[src] ??= {})[r.relevance] = (sourceMap[src][r.relevance] ?? 0) + 1;
    if (r.relevance === 'high' || r.relevance === 'not_relevant') {
      for (const [key, val] of Object.entries(r.relevance_signals ?? {})) {
        if (key === 'action_deadline') continue;
        signalStats[key] ??= { correct: 0, incorrect: 0 };
        if (val === true && r.relevance === 'high') signalStats[key].correct++;
        if (val === true && r.relevance === 'not_relevant') signalStats[key].incorrect++;
      }
    }
  }

  const guidance: string[] = [];
  for (const [cat, rels] of Object.entries(catMap)) {
    if ((rels.not_relevant ?? 0) > (rels.high ?? 0) * 2) {
      guidance.push(`Items categorised as "${cat}" are frequently marked not relevant — consider deprioritising.`);
    }
    if ((rels.high ?? 0) > 3 && (rels.not_relevant ?? 0) === 0) {
      guidance.push(`Items categorised as "${cat}" are consistently rated high relevance — ensure thorough coverage.`);
    }
  }
  for (const [sig, s] of Object.entries(signalStats)) {
    const total = s.correct + s.incorrect;
    if (total >= 3 && s.incorrect > s.correct) {
      guidance.push(`The "${sig}" signal has low accuracy (${s.correct}/${total} correct) — review classification criteria.`);
    }
  }

  return {
    total_reviews: reviews.length,
    by_relevance: byRelevance,
    category_patterns: catMap,
    source_patterns: sourceMap,
    signal_accuracy: signalStats,
    guidance,
  };
}

/* ── runtime prompt (port of admin.ts buildRuntimePrompt) ───────── */

export async function buildRuntimePrompt(): Promise<string> {
  const collector = await store.getActivePrompt('collector');
  if (!collector) return 'ERROR: No active collector prompt found.';

  const sources = (await store.listSources()).filter((s) => s.active !== false);
  sources.sort((a, b) => `${a.category}${a.name}`.localeCompare(`${b.category}${b.name}`));
  const sourceBlock = sources
    .map((s) => {
      const queries = (s.search_queries as string[]) ?? [];
      const urls = (s.fetch_urls as string[]) ?? [];
      return `- **${s.name}** (${s.id}, ${s.frequency})\n  URL: ${s.url}\n  Search queries: ${queries.join('; ') || 'none'}\n  Direct URLs: ${urls.join('; ') || 'none'}`;
    })
    .join('\n');

  const feedback = await feedbackSummary();
  let feedbackBlock = '';
  if ((feedback.total_reviews as number) > 0) {
    feedbackBlock = `\n\n## Reviewer feedback (${feedback.total_reviews} reviews to date)\n\n`;
    const guidance = feedback.guidance as string[];
    feedbackBlock += guidance.length
      ? guidance.map((g) => `- ${g}`).join('\n')
      : 'No strong patterns yet — continue with default classification.';
    feedbackBlock += '\n\nUse this feedback to calibrate relevance signals. When in doubt, still classify conservatively (include rather than exclude).';
  }

  // Resolved = guidance, dismissed = "stop asking about this kind of thing".
  const closed = (await store.listNotes('resolved')).slice(0, 20);
  let notesBlock = '';
  if (closed.length > 0) {
    const answered = closed.filter((n) => n.status === 'resolved');
    const dismissed = closed.filter((n) => n.status === 'dismissed');
    notesBlock =
      "\n\n## Previous exchanges with reviewer\n\nNotes you have raised in past runs and how the reviewer responded. Use these as guidance for what's worth surfacing vs leaving alone.\n";
    if (answered.length) {
      notesBlock += '\n### Notes the reviewer engaged with (substantive responses)\n';
      notesBlock += answered.map((n) => `- You asked: "${n.content}"\n  Reviewer replied: "${n.resolution}"`).join('\n');
    }
    if (dismissed.length) {
      notesBlock +=
        "\n\n### Notes the reviewer dismissed without response\n(Treat these as signal that this kind of note isn't useful — be more selective about raising similar ones.)\n";
      notesBlock += dismissed.map((n) => `- "${n.content}"`).join('\n');
    }
  }

  return `${collector.prompt_text}

## Sources to check

${sourceBlock}
${feedbackBlock}${notesBlock}

## Raising notes to the reviewer

If during this run you encounter something worth surfacing to the reviewer — coverage gaps, classification uncertainty, source suggestions, broken sources, anything ambiguous — call the post_note tool with a single focused observation. Keep each note to one thing. Prefer raising fewer, higher-value notes over many low-value ones; past dismissals (above) indicate what to avoid.

Note content supports markdown and is rendered on the reviewer's dashboard. Use it:
- **Bullet lists** for structured content like coverage summaries or per-source counts
- **Bold** for the key claim at the top of a longer note
- Inline \`code\` for URLs, source IDs, error codes
- Headings sparingly, only if the note has distinct sections

Blank lines separate paragraphs; single newlines become line breaks.

---

Prompt version: collector v${collector.version}
`;
}

/* ── tool definitions ───────────────────────────────────────────── */

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
});

const ITEM_SCHEMA = obj(
  {
    title: { type: 'string' },
    url: { type: 'string' },
    source_id: { type: 'string' },
    published_at: { type: 'string', description: 'ISO date' },
    category: {
      type: 'string',
      enum: ['consultation', 'policy_statement', 'enforcement', 'guidance', 'speech', 'market_report', 'press_release', 'final_notice', 'discussion_paper', 'other'],
    },
    summary: { type: 'string', description: '2-3 sentence executive summary' },
    body_md: { type: 'string', description: 'Paraphrased content with inline citations. Never verbatim.' },
    relevance_signals: {
      type: 'object',
      description: 'Boolean flags: depository_relevant, custody_relevant, fund_admin_relevant, transfer_agency_relevant, fund_manager_relevant, retail_relevant, operational_resilience, cross_cutting. Plus action_deadline (string or null).',
    },
    meta: { type: 'object' },
  },
  ['title', 'url'],
);

export const TOOLS = [
  {
    name: 'get_instructions',
    kind: 'read',
    description:
      'Fetch the current runtime prompt for the scheduled collector. Combines the active prompt version with current source list, accumulated reviewer feedback, and past collector↔reviewer exchanges. The scheduled task calls this first to know what to search for.',
    inputSchema: obj({}),
  },
  {
    name: 'ingest',
    kind: 'act',
    description: 'Submit regulatory items found during collection. Duplicates (by URL) are skipped. Owner-only (the collector runs as the owner).',
    inputSchema: obj({ items: { type: 'array', items: ITEM_SCHEMA } }, ['items']),
  },
  {
    name: 'list_items',
    kind: 'read',
    description: 'List recently collected items (newest first), optionally filtered by status (unreviewed/reviewed/flagged/archived) or since date. Returns summaries, not full bodies — use get_item for the full text.',
    inputSchema: obj({
      status: { type: 'string', enum: ['unreviewed', 'reviewed', 'flagged', 'archived'] },
      since: { type: 'string', description: 'ISO date — only items collected after this' },
      limit: { type: 'number', description: 'Max results (default 50, max 200)' },
    }),
  },
  {
    name: 'get_item',
    kind: 'read',
    description: 'Fetch one item in full (body_md included) plus its review, if any.',
    inputSchema: obj({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'review',
    kind: 'act',
    description: "Submit the reviewer's triage of an item: relevance (high/medium/low/not_relevant), optional applicability, notes, action_required. Marks the item reviewed. The caller's identity is recorded as the reviewer.",
    inputSchema: obj(
      {
        item_id: { type: 'string' },
        relevance: { type: 'string', enum: ['high', 'medium', 'low', 'not_relevant'] },
        applicability: { type: 'object', description: 'Client segments: custody, fund_admin, depository, transfer_agency, …' },
        notes: { type: 'string' },
        action_required: { type: 'boolean' },
      },
      ['item_id', 'relevance'],
    ),
  },
  {
    name: 'flag',
    kind: 'act',
    description: 'Flag an item for follow-up action (sets status to flagged).',
    inputSchema: obj({ item_id: { type: 'string' } }, ['item_id']),
  },
  {
    name: 'stats',
    kind: 'read',
    description: 'Overview statistics: total items, breakdown by status/category/source, recent review activity, open collector notes.',
    inputSchema: obj({}),
  },
  {
    name: 'feedback',
    kind: 'read',
    description: 'Current reviewer feedback summary: triage patterns by category and source, signal accuracy, auto-generated calibration guidance.',
    inputSchema: obj({}),
  },
  {
    name: 'post_note',
    kind: 'act',
    description:
      "Surface an observation to the reviewer that doesn't belong in the item inbox — coverage gaps, classification uncertainty, source suggestions, broken sources. Keep each note focused on a single topic; markdown supported.",
    inputSchema: obj({ content: { type: 'string' } }, ['content']),
  },
  {
    name: 'list_notes',
    kind: 'read',
    description: "List collector notes. Defaults to open notes awaiting reviewer response. Pass status='resolved' or 'all' for history.",
    inputSchema: obj({ status: { type: 'string', enum: ['open', 'resolved', 'all'], default: 'open' } }),
  },
  {
    name: 'resolve_note',
    kind: 'act',
    description: 'Close a collector note. With a resolution text it becomes "resolved" (guidance for future runs); without, "dismissed" (signal to stop raising similar notes).',
    inputSchema: obj({ id: { type: 'string' }, resolution: { type: 'string' } }, ['id']),
  },
  {
    name: 'list_sources',
    kind: 'read',
    description: 'List all configured sources with their search queries, URLs, frequency, and active status.',
    inputSchema: obj({}),
  },
  {
    name: 'add_source',
    kind: 'act',
    description: 'Register a new source to be monitored. Owner-only.',
    inputSchema: obj(
      {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        search_queries: { type: 'array', items: { type: 'string' } },
        fetch_urls: { type: 'array', items: { type: 'string' } },
        frequency: { type: 'string', enum: ['daily', 'weekly'] },
        category: { type: 'string', enum: ['primary', 'secondary', 'commentary'] },
      },
      ['id', 'name', 'url'],
    ),
  },
  {
    name: 'update_source',
    kind: 'act',
    description: 'Update an existing source: any of name, url, search_queries, fetch_urls, frequency, category, active. Owner-only.',
    inputSchema: obj({ id: { type: 'string' }, updates: { type: 'object' } }, ['id', 'updates']),
  },
  {
    name: 'get_prompt',
    kind: 'read',
    description: 'Get the active prompt and version history for a named prompt (collector or classifier).',
    inputSchema: obj({ name: { type: 'string', enum: ['collector', 'classifier'], default: 'collector' } }),
  },
  {
    name: 'save_prompt',
    kind: 'act',
    description: 'Save a new version of a prompt; deactivates the previous version. Include notes explaining what changed. Owner-only.',
    inputSchema: obj(
      {
        name: { type: 'string', enum: ['collector', 'classifier'] },
        prompt_text: { type: 'string' },
        notes: { type: 'string' },
      },
      ['name', 'prompt_text'],
    ),
  },
  {
    name: 'migrate',
    kind: 'act',
    description:
      "Bulk import from the val.town predecessor, preserving original ids/timestamps/statuses. Either pass arrays of items/sources/prompts/notes directly, or pass url to fetch the val's /api/export JSON server-side (val-shaped rows: JSON-string fields and 0/1 booleans are normalized here). Owner-only.",
    inputSchema: obj({
      url: { type: 'string', description: "The val's export endpoint (fetched server-side; nothing flows through the caller)" },
      items: { type: 'array' },
      sources: { type: 'array' },
      prompts: { type: 'array' },
      notes: { type: 'array' },
    }),
  },
];

/* ── dispatch ───────────────────────────────────────────────────── */

export async function toolCall(name: string, args: Record<string, unknown>, caller: string): Promise<unknown> {
  if (OWNER_ONLY.has(name) && caller !== OWNER) {
    throw new Error(`tool "${name}" is owner-only (caller: ${caller})`);
  }

  switch (name) {
    case 'get_instructions':
      return { prompt: await buildRuntimePrompt() };

    case 'ingest': {
      const items = (args.items as Record<string, unknown>[]) ?? [];
      let inserted = 0;
      for (const item of items) if (await store.insertItem(item)) inserted++;
      return { inserted, total: items.length };
    }

    case 'list_items':
      return store.listItems({ status: args.status as string, since: args.since as string, limit: args.limit as number });

    case 'get_item': {
      const item = await store.getItem(String(args.id ?? ''));
      if (!item) throw new Error(`unknown item "${args.id}"`);
      return { item, review: await store.getReview(item.id) };
    }

    case 'review': {
      const item = await store.getItem(String(args.item_id ?? ''));
      if (!item) throw new Error(`unknown item "${args.item_id}"`);
      const review = await store.putReview(
        item,
        {
          relevance: String(args.relevance),
          applicability: args.applicability,
          notes: args.notes as string,
          action_required: args.action_required as boolean,
        },
        caller,
      );
      await store.setItemStatus(item.id, 'reviewed');
      return { ok: true, review };
    }

    case 'flag':
      await store.setItemStatus(String(args.item_id ?? ''), 'flagged');
      return { ok: true };

    case 'stats':
      return store.stats();

    case 'feedback':
      return feedbackSummary();

    case 'post_note': {
      const content = String(args.content ?? '').trim();
      if (!content) return { ok: false, error: 'content required' };
      const note: store.Note = { id: store.newId(), content, status: 'open', resolution: '', created_at: store.now(), resolved_at: null };
      await store.putNote(note);
      return { ok: true, id: note.id };
    }

    case 'list_notes':
      return store.listNotes((args.status as 'open' | 'resolved' | 'all') ?? 'open');

    case 'resolve_note':
      return store.resolveNote(String(args.id ?? ''), String(args.resolution ?? ''));

    case 'list_sources':
      return store.listSources();

    case 'add_source':
      await store.putSource({
        id: String(args.id),
        name: String(args.name),
        url: String(args.url),
        search_queries: (args.search_queries as string[]) ?? [],
        fetch_urls: (args.fetch_urls as string[]) ?? [],
        frequency: (args.frequency as string) ?? 'weekly',
        category: (args.category as string) ?? 'secondary',
        active: true,
      });
      return { ok: true, id: args.id };

    case 'update_source': {
      const existing = await store.getSource(String(args.id ?? ''));
      if (!existing) throw new Error(`unknown source "${args.id}"`);
      const updates = (args.updates as Record<string, unknown>) ?? {};
      const allowed = ['name', 'url', 'frequency', 'category', 'active', 'search_queries', 'fetch_urls'];
      for (const k of Object.keys(updates)) {
        if (allowed.includes(k)) (existing as unknown as Record<string, unknown>)[k] = updates[k];
      }
      await store.putSource(existing);
      return { ok: true };
    }

    case 'get_prompt': {
      const name_ = String(args.name ?? 'collector');
      const active = await store.getActivePrompt(name_);
      const history = (await store.listPromptVersions(name_)).map((p) => ({
        name: p.name,
        version: p.version,
        notes: p.notes,
        created_at: p.created_at,
        active: p.active,
        prompt_length: p.prompt_text.length,
      }));
      return { active, history };
    }

    case 'save_prompt':
      return store.createPromptVersion(String(args.name), String(args.prompt_text), String(args.notes ?? ''));

    case 'migrate': {
      let { items, sources, prompts, notes } = args as {
        items?: Record<string, unknown>[];
        sources?: Record<string, unknown>[];
        prompts?: Record<string, unknown>[];
        notes?: Record<string, unknown>[];
      };
      if (typeof args.url === 'string' && args.url) {
        const res = await fetch(args.url);
        if (!res.ok) throw new Error(`export fetch failed: HTTP ${res.status}`);
        const dump = (await res.json()) as Record<string, Record<string, unknown>[]>;
        const parse = (v: unknown): unknown => {
          if (typeof v !== 'string') return v;
          try { return JSON.parse(v); } catch { return v; }
        };
        items = (dump.items ?? []).map((i) => ({ ...i, relevance_signals: parse(i.relevance_signals), meta: parse(i.meta) }));
        sources = (dump.sources ?? []).map((s) => ({
          ...s,
          search_queries: parse(s.search_queries) ?? [],
          fetch_urls: parse(s.fetch_urls) ?? [],
          active: s.active === 1 || s.active === true,
        }));
        prompts = (dump.prompt_versions ?? []).map((p) => ({
          name: p.name,
          version: Number(p.version),
          prompt_text: String(p.prompt_text ?? ''),
          notes: String(p.notes ?? ''),
          created_at: String(p.created_at ?? store.now()),
          active: p.active === 1 || p.active === true,
        }));
        notes = (dump.collector_notes ?? []).map((n) => ({
          id: String(n.id),
          content: String(n.content ?? ''),
          status: (n.status as string) ?? 'open',
          resolution: String(n.resolution ?? ''),
          created_at: String(n.created_at ?? store.now()),
          resolved_at: (n.resolved_at as string) ?? null,
        }));
      }
      const out: Record<string, number> = {};
      for (const s of (sources as unknown as store.Source[]) ?? []) {
        await store.putSource(s);
        out.sources = (out.sources ?? 0) + 1;
      }
      for (const p of (prompts as unknown as store.PromptVersion[]) ?? []) {
        await store.putPromptVersion(p);
        out.prompts = (out.prompts ?? 0) + 1;
      }
      for (const n of (notes as unknown as store.Note[]) ?? []) {
        await store.putNote(n);
        out.notes = (out.notes ?? 0) + 1;
      }
      // Items in modest parallel chunks — ~900 writes must fit the invoke window.
      const itemList = items ?? [];
      for (let i = 0; i < itemList.length; i += 10) {
        const results = await Promise.all(
          itemList.slice(i, i + 10).map((it) => store.insertItem(it, String(it.collected_at))),
        );
        for (const ok of results) {
          if (ok) out.items = (out.items ?? 0) + 1;
          else out.skipped = (out.skipped ?? 0) + 1;
        }
      }
      return out;
    }

    default:
      throw new Error(`unknown tool "${name}"`);
  }
}
