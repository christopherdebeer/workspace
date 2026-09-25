/* Experiment — Discrete image by iterated parallel constraint judgment.
 * Prompt → N×N grid of palette symbols. Every free pixel is a choice;
 * host commits only high-confidence + locally consistent cells; iterate.
 * Pure discrete analogue of diffusion: local calibrated judgments → global coherence.
 */
import * as React from 'react';
import { decide, signIn, JevError } from '../lib/jev';
import { choiceOf, type Answers } from '../lib/types';
import { Panel, ErrorLine, Bar } from '../ui';

const { useState, useRef } = React;

const N = 8;
const PALETTE = ['.', '#', 'R', 'G', 'B', 'Y', 'O', 'P'] as const;
type Color = (typeof PALETTE)[number];
const COLORS: Record<Color, string> = {
  '.': '#0a0a0a',
  '#': '#f0f0f0',
  R: '#e74c3c',
  G: '#2ecc71',
  B: '#3498db',
  Y: '#f1c40f',
  O: '#e67e22',
  P: '#9b59b6',
};

const EXAMPLES = [
  'a simple yellow smiley face on black',
  'a red circle on black background',
  'a white cross on black',
  'a green tree silhouette',
  'blue sky over brown ground with a yellow sun',
];

type Grid = (Color | null)[][]; // null = free

function emptyGrid(): Grid {
  return Array.from({ length: N }, () => Array(N).fill(null));
}

function gridToStrings(g: Grid): string[] {
  return g.map((row) => row.map((c) => c ?? '?').join(''));
}

function neighbours(g: Grid, r: number, c: number): Color[] {
  const out: Color[] = [];
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const rr = r + dr,
      cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N && g[rr][cc] != null) out.push(g[rr][cc]!);
  }
  return out;
}

/** Simple local consistency: chosen colour matches majority of fixed 4-neighbours, or no neighbours yet. */
function consistent(g: Grid, r: number, c: number, choice: Color): boolean {
  const ns = neighbours(g, r, c);
  if (ns.length === 0) return true;
  const counts: Record<string, number> = {};
  for (const n of ns) counts[n] = (counts[n] ?? 0) + 1;
  const max = Math.max(...Object.values(counts));
  const majority = Object.keys(counts).filter((k) => counts[k] === max);
  // allow if it matches a majority colour, or if the cell is on an edge (majority split)
  return majority.includes(choice) || majority.length > 1;
}

function freeCells(g: Grid): [number, number][] {
  const free: [number, number][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] == null) free.push([r, c]);
  return free;
}

export default function ImageCS() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [theta, setTheta] = useState(0.55);
  const [grid, setGrid] = useState<Grid>(emptyGrid);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [lastAnswers, setLastAnswers] = useState<Answers | null>(null);
  const abort = useRef<AbortController | null>(null);

  const reset = () => {
    setGrid(emptyGrid());
    setRound(0);
    setLog([]);
    setLastAnswers(null);
    setError(null);
  };

  async function step(current: Grid, rnum: number): Promise<Grid> {
    const free = freeCells(current);
    if (!free.length) return current;

    // Cap questions per call to keep payload reasonable (~32)
    const batch = free.slice(0, 32);
    const questions: Record<string, ReturnType<typeof choiceOf>> = {};
    for (const [r, c] of batch) {
      const ns = neighbours(current, r, c);
      const neighDesc = ns.length ? `fixed neighbours: ${ns.join('')}` : 'no fixed neighbours yet';
      questions[`p_${r}_${c}`] = choiceOf(
        `Pixel (${r},${c}) of an ${N}×${N} image. Prompt: "${prompt}". ${neighDesc}. Choose the single best colour from the palette that fits the prompt and local continuity.`,
        [...PALETTE],
      );
    }

    const state = {
      prompt,
      N,
      palette: PALETTE,
      grid: gridToStrings(current),
      free: batch,
    };
    const { answers, ms, tokens } = await decide(state, questions, `image:round${rnum}`, abort.current?.signal);
    setLastAnswers(answers);

    const next = current.map((row) => [...row]);
    let committed = 0;
    for (const [r, c] of batch) {
      const a = answers[`p_${r}_${c}`];
      const choice = (a?.choice ?? null) as Color | null;
      const conf = a?.confidence ?? 0;
      if (choice && PALETTE.includes(choice) && conf >= theta && consistent(next, r, c, choice)) {
        next[r][c] = choice;
        committed++;
      }
    }
    setLog((l) => [...l, `round ${rnum}: ${batch.length} asked · ${committed} committed · ${ms} ms · ${tokens} tok`]);
    return next;
  }

  async function run() {
    reset();
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      let g = emptyGrid();
      for (let r = 1; r <= 10 && !ac.signal.aborted; r++) {
        setRound(r);
        g = await step(g, r);
        setGrid(g);
        if (freeCells(g).length === 0) break;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const free = freeCells(grid).length;
  const filled = N * N - free;

  return (
    <>
      <Panel
        title="Image CS"
        sub="Prompt → N×N discrete pixels by iterated parallel judgment. Each free cell is a choice; only high-confidence + locally consistent colours are committed. Diffusion’s problem, pure discrete."
      >
        <label className="field">
          <span>prompt</span>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && void run()} />
        </label>
        <div className="chips">
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => setPrompt(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="knobs">
          <label>
            θ = {theta.toFixed(2)}
            <input type="range" min={0.3} max={0.85} step={0.05} value={theta} onChange={(e) => setTheta(Number(e.target.value))} />
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !prompt.trim()} onClick={() => void run()}>
            {busy ? `round ${round}…` : 'fill'}
          </button>
          {busy ? (
            <button className="ghost" onClick={() => abort.current?.abort()}>
              stop
            </button>
          ) : (
            <button className="ghost" onClick={reset}>
              clear
            </button>
          )}
        </div>
        <ErrorLine error={error} />
        {log.length ? (
          <p className="sub">
            {filled}/{N * N} filled · {log[log.length - 1]}
          </p>
        ) : null}
      </Panel>

      <Panel title="Canvas" sub={`${N}×${N} · palette ${PALETTE.join(' ')}`}>
        <div
          className="img-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${N}, 1fr)`,
            gap: 2,
            maxWidth: 320,
            aspectRatio: '1',
            background: '#111',
            padding: 4,
            borderRadius: 6,
          }}
        >
          {grid.flatMap((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                title={`${r},${c} ${cell ?? 'free'}`}
                style={{
                  background: cell ? COLORS[cell] : '#1a1a1a',
                  border: cell ? 'none' : '1px dashed #333',
                  borderRadius: 2,
                }}
              />
            )),
          )}
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          {PALETTE.map((p) => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span style={{ width: 12, height: 12, background: COLORS[p], borderRadius: 2, display: 'inline-block' }} />
              {p}
            </span>
          ))}
        </div>
      </Panel>

      {log.length ? (
        <Panel title="Rounds">
          <ol className="mono small">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {lastAnswers ? (
        <Panel title="Last round confidences" sub="Top cells by confidence (sample)">
          {Object.entries(lastAnswers)
            .filter(([, a]) => a?.confidence != null)
            .sort((a, b) => (b[1]?.confidence ?? 0) - (a[1]?.confidence ?? 0))
            .slice(0, 12)
            .map(([k, a]) => (
              <Bar key={k} label={`${k} → ${a?.choice}`} p={a?.confidence ?? 0} />
            ))}
        </Panel>
      ) : null}
    </>
  );
}
