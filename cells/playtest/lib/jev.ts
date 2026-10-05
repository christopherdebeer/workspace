/* ---------------------------------------------------------------------------
 * Jev from inside a cell: the only path is the /mcp gateway with a bearer
 * (cells get no service identity). The token is the owner's, scoped to
 * @c15r/jev, stored write-only in this cell's table (SECRET#jev) — the same
 * custody jev keeps for its TypeSafe key.
 *
 * Batching: an eval plays many games concurrently. Each game's engine step is
 * synchronous, so between Jev calls every live game reaches its next decision
 * in the same tick; the batcher collects those and sends ONE decide_many per
 * tick (≤200 items) instead of one gateway round trip per move.
 * ------------------------------------------------------------------------- */
// Materialized from cells/kernel/static at push time (ADR-0076).
// eslint-disable-next-line import/no-unresolved
import { gwCall } from '../vendor/gateway-client.js';
import type { Answers, Questions } from './types';
import type { Decide } from './runner';

const GATEWAY = process.env.GATEWAY_MCP_URL || 'https://parc.land/mcp';
const MANY_MAX = 200;

interface Pending {
  state: unknown;
  questions: Questions;
  label: string;
  resolve: (v: { answers: Answers; tokens: number; ms: number }) => void;
  reject: (e: Error) => void;
}

export interface JevMeter {
  calls: number;
  items: number;
  tokens: number;
  ms: number;
}

export function jevClient(token: string) {
  const meter: JevMeter = { calls: 0, items: 0, tokens: 0, ms: 0 };
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flushChunk(chunk: Pending[]) {
    const t0 = Date.now();
    meter.calls++;
    meter.items += chunk.length;
    try {
      const res = (await gwCall(token, '@c15r/jev.decide_many', { items: chunk.map((p, i) => ({ id: i, state: p.state, questions: p.questions })), concurrency: 24 }, { url: GATEWAY, kind: 'act' })) as {
        results?: Array<{ id: number; answers?: Answers; usage?: { input_tokens?: number }; error?: string }>;
      };
      const ms = Date.now() - t0;
      meter.ms += ms;
      const byId = new Map((res.results ?? []).map((r) => [r.id, r]));
      chunk.forEach((p, i) => {
        const r = byId.get(i);
        if (r?.answers) {
          const tokens = r.usage?.input_tokens ?? 0;
          meter.tokens += tokens;
          p.resolve({ answers: r.answers, tokens, ms });
        } else p.reject(new Error(`${p.label}: ${r?.error ?? 'no answer'}`));
      });
    } catch (e) {
      chunk.forEach((p) => p.reject(e as Error));
    }
  }

  function flush() {
    timer = null;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += MANY_MAX) void flushChunk(batch.slice(i, i + MANY_MAX));
  }

  const decide: Decide = (state, questions, label) =>
    new Promise((resolve, reject) => {
      queue.push({ state, questions, label, resolve, reject });
      if (!timer) timer = setTimeout(flush, 5);
    });

  return { decide, meter };
}
