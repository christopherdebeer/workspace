/* Experiment — Discrete image by iterated parallel constraint judgment.
 * Prompt → N×N grid of palette symbols. Every free pixel is a choice;
 * host commits only high-confidence + locally consistent cells; iterate.
 * Pure discrete analogue of diffusion: local calibrated judgments → global coherence.
 *
 * (Contributed by client:grok, 2026-09-25 — kept as the `pixels` baseline.)
 * `recognise` (the default) inverts it after measurement: per-pixel choices
 * are noise (mean confidence 0.39, 1/32 cells above θ=0.55), whole-picture
 * recognition is sharp (0.82 vs 0.01) — so code renders typed scenes and Jev
 * scores whole pictures in parallel (lib/image.ts).
 */
import * as React from 'react';
import { decide, decideMany, signIn, JevError } from '../lib/jev';
import { draw, COLOR_NAMES, type Grid as IGrid, type ImageEvent, type Scored } from '../lib/image';
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
/** Colours for the recognise palette (adds brown). */
const RCOLORS: Record<string, string> = { ...COLORS, N: '#8b5a2b' };

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
  const [mode, setMode] = useState<'recognise' | 'pixels'>('recognise');
  const [rec, setRec] = useState<{ best: Scored; top: Scored[]; scene: string; ms: number } | null>(null);
  const [recLog, setRecLog] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  const reset = () => {
    setRec(null);
    setRecLog([]);
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

  async function runRecognise() {
    reset();
    setBusy(true);
    const t0 = performance.now();
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      let scene = '';
      const r = await draw(
        prompt,
        { decide: async (st, q, label) => (await decide(st, q, label)).answers, decideMany: (items, label) => decideMany(items, label) },
        (e: ImageEvent) => {
          if (e.type === 'scene') {
            scene = [`${COLOR_NAMES[e.scene.bg]} background`, ...e.scene.layers.map((l) => `${COLOR_NAMES[l.color]} ${l.shape}`)].join(' + ');
            setRecLog((l) => [...l, `scene: ${scene}`]);
          } else setRecLog((l) => [...l, `${e.name}: ${e.tried} pictures scored · best ${Math.round((e.best[0]?.score ?? 0) * 100)}%`]);
        },
      );
      setRec({ ...r, scene, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (mode === 'recognise') return runRecognise();
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
        <div className="seg" role="tablist" aria-label="method">
          {(['recognise', 'pixels'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'recognise' ? 'recognise (typed scenes)' : 'pixels (baseline)'}
            </button>
          ))}
        </div>
        <p className="sub">
          {mode === 'recognise'
            ? 'Jev picks a typed scene (background + shapes + colours); code renders hundreds of placements; Jev scores whole pictures in parallel, then the best are mutated and re-scored. ~3 round trips.'
            : 'The original loop: each free pixel is a palette choice, committed when confident and locally consistent.'}
        </p>
        {mode === 'pixels' ? (
          <div className="knobs">
            <label>
              θ = {theta.toFixed(2)}
              <input type="range" min={0.3} max={0.85} step={0.05} value={theta} onChange={(e) => setTheta(Number(e.target.value))} />
            </label>
          </div>
        ) : null}
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

      {mode === 'recognise' && (rec || recLog.length) ? (
        <Panel title="Picture" sub={rec ? `${rec.scene} · ${(rec.ms / 1000).toFixed(1)} s` : 'drawing…'}>
          {rec ? (
            <>
              <Pixels grid={rec.best.grid} size={320} />
              <Bar label="recognised" p={rec.best.score} hint="Jev: does this picture clearly depict the prompt?" />
              <div className="thumbs">
                {rec.top.slice(1).map((t, i) => (
                  <div key={i} title={`${Math.round(t.score * 100)}%`}>
                    <Pixels grid={t.grid} size={64} />
                    <span className="sub">{Math.round(t.score * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <ol className="mono small">
            {recLog.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {mode === 'pixels' ? (
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

      ) : null}

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

/** A palette grid drawn as coloured cells. */
function Pixels({ grid, size }: { grid: IGrid; size: number }) {
  const n = grid.length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: size > 100 ? 2 : 1, width: size, maxWidth: '100%', aspectRatio: '1', background: '#111', padding: size > 100 ? 4 : 2, borderRadius: 6 }}>
      {grid.flatMap((row, r) => row.map((c, x) => <div key={`${r}-${x}`} style={{ background: RCOLORS[c] ?? '#000', borderRadius: size > 100 ? 2 : 0 }} />))}
    </div>
  );
}
