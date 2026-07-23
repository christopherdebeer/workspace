/**
 * Home cell client — parc.land's two faces, stripped to the essentials
 * (owner direction, 2026-07-10).
 *
 * Signed out: the trailhead — a painted dusk valley, the wordmark, and the
 * passkey door. Signed in: TWO objects, nothing else — the 3D/2D substrate
 * GRAPH (the whole slice as a full-viewport map; the graph IS the workspace)
 * and the FIELD COMPUTER (the read/act console in its floating palette,
 * ⌘K at hand). The legacy section dashboard is gone; refinement effort goes
 * into making these two excellent rather than many things adequate.
 *
 * Everything still speaks the same `mcpCall` vocabulary an agent does; the
 * park language lives in copy, never in targets.
 */
import * as React from 'react';
import { Page, theme, type TypeDecl } from '@parc/ui';
import { useAuth, type Session } from './lib';
import { Landing, Wordmark, SkyGradient, HERO_VH } from './dashboard';
import { FullGraph, type GraphNode } from './graph';
import { Palette } from './palette';
import { SkyBackdrop } from './sky';
import { setTypeDecls, loadTypeDecls, FactDetailHost } from './facts';
import { readHashState, writeHashState } from './urlstate';
import { ink } from './ink';

// The public surface: index.ts (SSR) and main.tsx (hydration) import from here.
export type { Session } from './lib';
export { typeDeclsFrom, setTypeDecls, loadTypeDecls, typeIcon } from './facts';

const { useState, useEffect, useCallback } = React;

/**
 * The landing-with-sky — the trailhead EVERYONE arrives at, signed in or not.
 * Renders the sky dome (stars + atmosphere) as a full-viewport backdrop behind
 * the landing content; the hero painting sits at the bottom, fading upward
 * into the live sky. The one CTA adapts: signed out it starts the passkey
 * flow, signed in it steps through into the graph. Scroll/swipe also enters
 * (the "walk into the sky" gesture).
 */
function LandingWithSky({ session, onEnter, featured }: {
  session: Session & { signIn: () => void };
  onEnter?: () => void; // present when authed: fade out, then reveal the graph
  featured?: FeaturedDoc[];
}): React.JSX.Element {
  const [entering, setEntering] = useState(false);
  const onExplore = useCallback(() => {
    setEntering(true);
    // Let the fade play before handing over (sign-in navigates away; enter unmounts us).
    setTimeout(() => (onEnter ? onEnter() : session.signIn()), 600);
  }, [session, onEnter]);
  // Scroll or swipe also walks into the sky (authed only — signed-out visitors
  // must deliberately tap the passkey button, not trip into WebAuthn).
  useEffect(() => {
    if (!onEnter || entering) return;
    let startY: number | null = null;
    // A peek sheet (or any modal) captures the gesture: scrolling/swiping to
    // READ inside it must not trip the walk-into-the-sky. Bail whenever a
    // dialog is mounted — robust regardless of event propagation.
    const modalOpen = (): boolean => typeof document !== 'undefined' && !!document.querySelector('[role="dialog"]');
    const wheel = (e: WheelEvent): void => { if (!modalOpen() && e.deltaY > 24) onExplore(); };
    const touchStart = (e: TouchEvent): void => { startY = modalOpen() ? null : (e.touches[0]?.clientY ?? null); };
    const touchMove = (e: TouchEvent): void => {
      if (modalOpen()) return;
      const y = e.touches[0]?.clientY;
      if (startY !== null && y !== undefined && startY - y > 48) onExplore();
    };
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchmove', touchMove, { passive: true });
    return () => {
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchmove', touchMove);
    };
  }, [onEnter, entering, onExplore]);
  return (
    <>
      {/* Unauthed has no real graph, so a decorative star dome stands in — but it
          gets the SAME dusk-gradient screen-treatment and BODY-SCROLL model as
          the authed trailhead (both fixed behind the flowing content, hero-height;
          the content scrolls the document natively — iOS-robust). */}
      <SkyBackdrop heroHeight={entering ? undefined : HERO_VH} />
      <SkyGradient fade={entering ? 0 : 1} heroOnly={!entering} />
      <div
        className='Landing'
        style={{
          position: 'relative',
          zIndex: 20,
          pointerEvents: 'none',
          opacity: entering ? 0 : 1,
          transition: 'opacity 0.6s ease-out',
        }}
      >
        <Landing session={{ ...session, signIn: onExplore }} onExplore={onExplore} authed={!!onEnter} featured={featured} />
      </div>
    </>
  );
}

/**
 * The graph shell's parachute. A render error anywhere under the graph/palette
 * would otherwise rethrow inside react-dom's cross-origin (esm.sh) frames and
 * reach window.onerror as a masked "Script error." with no detail — a boundary
 * receives the REAL error in-JS, so we can show it and keep the page usable.
 */
class GraphBoundary extends React.Component<
  { fallback: (err: Error) => React.ReactNode; children: React.ReactNode },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err };
  }
  componentDidCatch(err: Error): void {
    console.error('[home graph]', err);
  }
  render(): React.ReactNode {
    return this.state.err ? this.props.fallback(this.state.err) : this.props.children;
  }
}

/**
 * The server's first-paint seed: the resolved session plus the canonical type
 * vocabulary ($types/describeTypes), seeded so icons/titles/routing paint
 * server-side identically to the client. The graph and the field computer load
 * their own data live (they are the interactive surface, not a snapshot).
 */
export interface FeaturedDoc { key: string; title: string; summary?: string }
export interface Boot {
  session: Session;
  types?: Record<string, TypeDecl>;
  /** Curated PUBLIC docs (title+summary), server-read tokenlessly for anonymous
   *  visitors (see cells/home/index.ts). The signed-out trailhead shows these
   *  instead of the generic pitch — a real read-only slice of the substrate. */
  featured?: FeaturedDoc[];
  /** The long-lived READ-ONLY `@guest` token, injected on EVERY boot (it is
   *  public-safe by construction — `@guest` can only ever see the owner's
   *  public-granted slice). The client attaches it to data reads (never
   *  identity) so the signed-out graph/search/doc-reads return live public
   *  content, and so a stale session credential disproven mid-page degrades
   *  to the public view instead of a page of 401s. */
  guestToken?: string;
  /** The default ground fact — a landing doc rendered in place of the pitch for
   *  BOTH authed and anon (configurable via `_config/home-landing`). */
  landingKey?: string;
  /** The landing doc's markdown body, SSR'd from the PUBLIC `file/docs/*.md`
   *  mirror — the first paint renders the real doc, not a "reading…" spinner. */
  landingBody?: string;
  /** ADR-0090: a `/r/<key>` visit — the fact address from the PATH, seeded
   *  server-side so selection survives refresh and hydration matches. */
  selectedKey?: string;
  /** The SSR-peeked entry for `selectedKey` (dispatch ran it as the caller). */
  selectedFact?: { key: string; value?: unknown; _meta?: Record<string, unknown> };
  /** The deep-linked doc's markdown body (public file mirror) — anonymous
   *  visitors get a server-painted body too. */
  selectedMd?: string;
}

export function App({ initial }: { initial?: Boot } = {}): React.JSX.Element {
  // Seed exactly once for hydration, then refresh the shared vocabulary from
  // live substrate state so newly published type declarations appear promptly.
  const seededTypes = React.useRef(false);
  if (!seededTypes.current && initial?.types) {
    setTypeDecls(initial.types);
    seededTypes.current = true;
  }
  const session = useAuth(initial?.session);
  const authed = !!session.user;
  // A signed-out visitor with the public @guest token can ALSO walk into the sky
  // — the graph reads live (read-only) public content through that token. So the
  // trailhead's graph backdrop + pull-to-enter are gated on "can explore" (authed
  // OR a guest token), while the hero CTA stays gated on `authed` alone (auth in
  // is a button; entering the sky is a gesture — for everyone who can read).
  const canExplore = authed || !!initial?.guestToken;
  const [, setTypeEpoch] = useState(0);
  useEffect(() => {
    // The type vocabulary ($types) is global + public, so an anonymous explorer
    // needs it too (icons/labels for the public graph) — load whenever we can read.
    if (!canExplore) return;
    let live = true;
    void loadTypeDecls().then(() => {
      if (live) setTypeEpoch((v) => v + 1);
    });
    return () => { live = false; };
  }, [canExplore]);
  // App owns selection BY KEY (not node object): the palette's neighbour chips
  // and the graph's taps both funnel here, and the graph pans to any selection
  // it didn't originate (ADR-0047 v2).
  // ADR-0090: seeded from the /r/<key> PATH via boot — the server rendered
  // with the same value, so this is hydration-safe (unlike the old hash).
  const [selectedKey, setSelectedKey] = useState<string | null>(initial?.selectedKey ?? null);
  // The trailhead GROUND content is a SEPARATE selection from the graph's.
  // Direct trailhead selection (tap a star) fills the ground AND the graph; but
  // the peek SHEET drives only the graph (so drilling in the sheet re-orients
  // the map without hijacking the main content behind it — owner direction).
  const [groundKey, setGroundKey] = useState<string | null>(initial?.selectedKey ?? null);
  // ALSO hold the selected NODE (title/type/score) the graph already has, so the
  // trailhead can paint the head instantly on the way back — no peek round-trip,
  // no "reading…" flash — while the body streams in. Cleared when selection is
  // cleared or set by key alone (palette/deep-link, where we have no node yet).
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const selectByNode = useCallback((n: GraphNode | null) => {
    setSelectedNode(n);
    setSelectedKey(n?.key ?? null);
    setGroundKey(n?.key ?? null);
  }, []);
  // Selection is shareable view-state (urlstate.ts). We DON'T seed useState from
  // the hash — that would diverge from the server's null and break hydration.
  // Instead: after mount, read the hash once and apply it; from then on, mirror
  // selection changes back into the hash (merged with zoom/query the graph and
  // console own). The ref skips the write on that first restoring pass.
  const hashSelHydrated = React.useRef(false);
  useEffect(() => {
    if (!hashSelHydrated.current) {
      hashSelHydrated.current = true;
      const s = readHashState().selected;
      if (s) { setSelectedKey(s); setGroundKey(s); }
      return;
    }
    writeHashState({ selected: selectedKey ?? undefined });
    // If the key no longer matches the held node (palette pick, deep-link, clear),
    // drop the stale node so the trailhead peeks fresh rather than showing a
    // mismatched head.
    setSelectedNode((n) => (n && n.key === selectedKey ? n : null));
  }, [selectedKey]);
  // The landing is the trailhead for EVERYONE (owner direction 2026-07-20):
  // authed visitors see it too, and step through into the graph (scroll,
  // swipe, or the button). Session-sticky so an in-app reload after entering
  // doesn't bounce back to the trailhead; a fresh visit (new tab) does land.
  const [entered, setEntered] = useState(() => {
    try { return sessionStorage.getItem('parc.home.entered') === '1'; } catch { return false; }
  });
  // `leaving` drives the day→night DISSOLVE: on enter, the dusk-sky + landing
  // overlay fades to 0 over ~0.9s (revealing the night graph beneath at full
  // strength), THEN unmounts. Not just an opacity pop — the sky washes away.
  const [leaving, setLeaving] = useState(false);
  // `returning` drives the REVERSE dissolve (exit → trailhead): the graph shrinks
  // full→hero and the landing overlay fades back IN over the same beat, instead
  // of an instant swap. `returnLit` is the two-frame opacity/height TARGET flag —
  // the overlay mounts at 0 / full, then flips to 1 / hero on the next paint so
  // the transition actually animates rather than starting already-arrived.
  const [returning, setReturning] = useState(false);
  const [returnLit, setReturnLit] = useState(false);
  // How far the overlay is peeled DOWN on over-scroll-up (0 = rest). Declared up
  // here so toLanding can snap it back synchronously with the re-mount.
  const [pull, setPull] = useState(0);
  const enter = useCallback(() => {
    try { sessionStorage.setItem('parc.home.entered', '1'); } catch { /* private mode */ }
    setLeaving(true);
    setTimeout(() => setEntered(true), 900);
  }, []);
  // Return to the trailhead from the graph (wordmark click). Re-mounts the
  // landing overlay + dusk sky over the still-live graph and clears the flag —
  // snapping the peel back to rest in the SAME batch so it never re-mounts mid-peel
  // (a committed/partial pull was surviving the round-trip and staying peeled).
  const toLanding = useCallback(() => {
    try { sessionStorage.removeItem('parc.home.entered'); } catch { /* private mode */ }
    setPull(0);
    setLeaving(false);
    // Reverse dissolve: mount the overlay at opacity 0 with the graph still full,
    // then (two rAFs later, once that start frame has painted) flip to lit + hero
    // so the fade-in and the shrink actually animate. Clear the flags after.
    setReturning(true);
    setReturnLit(false);
    setEntered(false);
    setDomeNonce((n) => n + 1); // vantage glides back under the dome with the settle
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => setReturnLit(true)));
    } else {
      setReturnLit(true);
    }
    setTimeout(() => { setReturning(false); setReturnLit(false); }, 620);
  }, []);
  // ── THE MIRROR EXIT (owner: "as refined as enter") ────────────────────────
  // Exit is enter played backwards, and GESTURE-TRACKED like enter: pulling the
  // palette grip UP (with a fact peeked) drives `exitPull` px live — the graph
  // shrinks full→preview following the finger, the landing overlay fades in and
  // slides up into place, the dusk-sky wash returns and un-deepens, the palette
  // fades away, and the vantage glides back under the dome. Release past the
  // commit finishes the settle; release early springs everything back to the
  // graph. The wordmark tap plays the same choreography discretely (toLanding).
  const [exitPull, setExitPull] = useState(0);
  const exitPullRef = React.useRef(0); exitPullRef.current = exitPull;
  const [domeNonce, setDomeNonce] = useState(0);
  // A CANCELED exit (released short of the commit) must SPRING back, not pop:
  // `exitGhost` keeps the half-arrived overlay/sky mounted for one more beat
  // while their opacity/height transition back to the graph, then unmounts.
  const [exitGhost, setExitGhost] = useState(false);
  const ghostTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExitPull = useCallback((px: number): void => {
    const next = Math.max(0, Math.min(196, px)); // PULL_CAP mirror
    const prev = exitPullRef.current;
    if (prev === 0 && next > 0) {
      // First movement of the gesture: start the vantage gliding home to the
      // dome, so the sky is re-curling around you as the valley returns.
      setDomeNonce((n) => n + 1);
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      setExitGhost(false);
    }
    if (prev > 0 && next === 0) {
      setExitGhost(true);
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      ghostTimer.current = setTimeout(() => setExitGhost(false), 420);
    }
    setExitPull(next);
  }, []);
  // Commit from the gesture: the overlay is ALREADY partly arrived (mounted,
  // opacity/transform mid-flight), so do NOT restart from the two-frame dark
  // mount — flip straight into the lit `returning` settle; CSS transitions the
  // rest of the way from current computed values. Same batch clears the pull.
  const finishExitFromGesture = useCallback((): void => {
    try { sessionStorage.removeItem('parc.home.entered'); } catch { /* private mode */ }
    setPull(0);
    setLeaving(false);
    setReturning(true);
    setReturnLit(true);
    setExitPull(0);
    setEntered(false);
    setTimeout(() => { setReturning(false); setReturnLit(false); }, 620);
  }, []);
  // ── PULL-TO-ENTER, cleanly separated from scroll ──────────────────────────
  // The trailhead scrolls NATIVELY (hero → content below) — no hijacked scroll,
  // no capture-phase window handlers, no manual scrollTop. We intercept ONE edge
  // only: an over-scroll UP at the very top. There, a finger dragging down (or
  // wheel-up) peels the whole overlay DOWN, revealing the live sky/graph above
  // through the gap — a TOP peep that grows to a "release to enter", then
  // dissolves. The graph is a non-interactive BACKDROP while the trailhead is up
  // (the overlay owns input); it becomes interactive only once you've entered.
  // Two clean modes, no tangle of graph-spin ⇄ scroll ⇄ zoom.
  const pullRef = React.useRef(0); pullRef.current = pull;
  const PULL_COMMIT = 140;                        // peel past this → enter
  const PULL_CAP = PULL_COMMIT * 1.4;
  // ENTER lives on the CONTENT-SHEET GRIP now (owner): a down-drag on the grip
  // peels the overlay down and grows the graph — "pull down to explore". Because
  // enter no longer rides a window over-scroll, a down-drag ON THE GRAPH just
  // spins it — graph touches are free for spin/tap. (Desktop keeps the wheel-up
  // shortcut below.) These handlers are handed to the Landing grip.
  const gripY = React.useRef<number | null>(null);
  const onGripDown = useCallback((e: React.PointerEvent): void => {
    gripY.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no capture */ }
  }, []);
  const onGripMove = useCallback((e: React.PointerEvent): void => {
    if (gripY.current == null) return;
    const down = e.clientY - gripY.current; // >0 = dragging DOWN → pull down to explore
    setPull(Math.max(0, Math.min(PULL_CAP, down * 0.9)));
  }, [PULL_CAP]);
  const onGripUp = useCallback((): void => {
    if (gripY.current == null) return;
    gripY.current = null;
    if (pullRef.current >= PULL_COMMIT) enter();
    else setPull(0); // CSS transition springs it back
  }, [enter]);
  useEffect(() => {
    if (!canExplore || entered || leaving || returning) return;
    // Snap back to rest on (re)mount — a committed peel must not survive
    // entering — and reset the document scroll so the trailhead opens at the top.
    setPull(0);
    try { window.scrollTo(0, 0); } catch { /* SSR/none */ }
    const atTop = (): boolean => window.scrollY <= 0;
    let wheelReset: ReturnType<typeof setTimeout> | null = null;
    const release = (): void => { if (pullRef.current >= PULL_COMMIT) enter(); else setPull(0); };
    // DESKTOP wheel keeps the over-scroll-up-to-enter shortcut. TOUCH enter has
    // moved to the grip, so the graph's own drag (spin) is never stolen — no
    // window touch handlers fight it any more.
    const onWheel = (e: WheelEvent): void => {
      if (atTop() && e.deltaY < 0) {
        e.preventDefault();
        setPull((p) => Math.min(PULL_CAP, p - e.deltaY * 0.6));
        if (wheelReset) clearTimeout(wheelReset);
        wheelReset = setTimeout(release, 160);
      } else if (pullRef.current > 0 && e.deltaY > 0) {
        e.preventDefault();
        setPull((p) => Math.max(0, p - e.deltaY * 0.6));
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (wheelReset) clearTimeout(wheelReset);
      window.removeEventListener('wheel', onWheel);
    };
  }, [canExplore, entered, leaving, returning, enter, PULL_CAP]);

  // Pull-to-enter GROWS the graph from the hero band toward full height, so a
  // commit finds it already full (no snap). Height eases out with the pull (an
  // elastic feel); an active drag tracks the finger (no CSS transition) while
  // rest/release springs the height. During the dissolve (`leaving`) it holds
  // full; once `entered` the graph owns the whole viewport (bottom:0 / 100%).
  const HERO_N = parseFloat(HERO_VH); // the hero band as a bare number (svh)
  // The live GRAPH is a smaller preview than the hero band — 2/3 of it at rest —
  // and it grows to FULL tracking the drag DIRECTLY: a linear percent between the
  // rest height and full (owner: no easing, the graph follows the finger 1:1).
  const GRAPH_REST_N = HERO_N * (2 / 3); // ≈ 44.44svh
  const GRAPH_REST = `${GRAPH_REST_N.toFixed(2)}svh`;
  const pullProgress = Math.min(1, pull / PULL_COMMIT);
  // The exit gesture's progress (0 = in the graph, 1 = trailhead arrived) and
  // its "virtual pull" — the enter-pull position the exit is rewinding through,
  // so every surface reuses its OWN enter formula, just run backwards.
  const exitP = Math.min(1, exitPull / PULL_COMMIT);
  const exitActive = entered && exitPull > 0;
  const exitVirtualPull = (1 - exitP) * PULL_COMMIT;
  const graphHeroHeight = exitActive
    ? `${(GRAPH_REST_N + (100 - GRAPH_REST_N) * (1 - exitP)).toFixed(2)}svh` // the enter track, rewound
    : entered
      // Ghost beat after a canceled exit: an explicit 100svh (not '100%') so the
      // height transition has an interpolable svh→svh pair to spring back over.
      ? (exitGhost ? '100svh' : undefined)
      : leaving
        ? '100svh'
        : returning
          ? (returnLit ? GRAPH_REST : '100svh') // exit settle: shrink full→preview strip
          : pull > 0
            ? `${(GRAPH_REST_N + (100 - GRAPH_REST_N) * pullProgress).toFixed(2)}svh` // LINEAR track
            : GRAPH_REST;
  const graphHeroSpring = pull === 0 && exitPull === 0; // track the finger while pulling; spring at rest (incl. the settle)
  // The sky wash GROWS with the pull too (owner): its height rides down with the
  // descending landscape (which translates by `pull`), so the horizon stays put
  // against the painting, and its opacity DEEPENS toward the night graph as you
  // pull. `instant` while a live pull is on so the deepen tracks the finger; the
  // commit dissolve (`leaving`) then completes the fade with its own transition.
  // The exit runs the same formulas at the rewinding virtual pull, scaled by the
  // gesture's own arrival (exitP) so the wash fades IN from the night.
  const skyHeroHeight = exitActive
    ? `calc(${HERO_VH} + ${exitVirtualPull.toFixed(1)}px)`
    : entered
      ? '100svh' // ghost beat — springing back toward the full night
      : leaving
        ? '100svh'
        : returning
          ? (returnLit ? HERO_VH : '100svh')
          : pull > 0
            ? `calc(${HERO_VH} + ${pull.toFixed(1)}px)`
            : HERO_VH;
  const skyFade = exitActive
    ? exitP * (1 - 0.55 * (1 - exitP)) // arrive × the enter deepen, rewound
    : entered
      ? 0 // ghost beat — the wash fades back out to the night
      : leaving ? 0 : returning ? (returnLit ? 1 : 0) : (1 - 0.55 * pullProgress);
  const skyInstant = (pull > 0 || exitActive) && !leaving && !returning;
  // The settle beat (returning) moves every surface on ONE clock so the mirror
  // reads as a single motion: overlay opacity+transform, sky, and graph height
  // all arrive together (the graph's own heroSpring transition is 0.55s too).
  const SETTLE = '0.55s cubic-bezier(.22,1,.36,1)';
  const skyTransition = returning
    ? `opacity ${SETTLE}, height ${SETTLE}`
    : entered && exitGhost && !exitActive
      ? 'opacity 0.35s ease, height 0.35s ease' // the cancel spring-back
      : undefined;

  if (!session.ready) return <Page>{null}</Page>;

  // Only when there's NOTHING live to show (signed out AND no guest token) do we
  // fall back to the decorative star dome. Otherwise the real graph is the sky.
  if (!canExplore) {
    return <LandingWithSky session={session} featured={initial?.featured} />;
  }

  // ── CAN EXPLORE: the graph IS the sky ──
  // Authed → their own live substrate. Signed-out-with-guest → the owner's public
  // slice, read-only. Same trailhead, same enter gesture; the hero CTA still forks
  // on `authed` (sign-in button for anon, gesture-only for authed).
  // The real graph mounts immediately (data starts streaming), behind the
  // landing overlay. "Entering" just fades the overlay away — no remount,
  // no loading flash, no second render. The user sees their live substrate
  // as the trailhead's starfield from the moment the page loads.
  return (
    <>
      {/* NIGHT BACKDROP behind the graph host (owner: "the hero landscape needs a
          back background"): the graph canvas is only the preview strip on the
          landing, so when the painted hero fades during a pull its bottom edge
          showed as a hard seam against the page. A hero-band strip of the SAME
          night colour sits behind everything — the canvas edge lands on identical
          ink and disappears. Behind the graph via DOM order (painted first). */}
      {(!entered || returning || exitActive || exitGhost) && (
        <div aria-hidden style={{ position: 'fixed', top: 0, left: 0, right: 0, height: HERO_VH, background: ink.sceneBg, pointerEvents: 'none' }} />
      )}
      <GraphBoundary
        fallback={(err) => (
          <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: ink.sceneBg, color: ink.text, padding: '1rem' }}>
            <div style={{ maxWidth: 640 }}>
              <p style={{ fontFamily: ink.mono }}>the graph hit an error:</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: ink.danger, maxHeight: '40vh', overflowY: 'auto' }}>{err.message}{'\n'}{err.stack?.split('\n').slice(0, 8).join('\n')}</pre>
              <button
                onClick={() => window.location.reload()}
                style={{ background: 'none', color: ink.accent, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}
              >
                reload
              </button>
            </div>
          </div>
        )}
      >
        <FullGraph selectedKey={selectedKey} onSelect={selectByNode} preview={!entered} heroHeight={graphHeroHeight} heroSpring={graphHeroSpring} domeNonce={domeNonce} />
        {/* The palette stays mounted through the settle so it can FADE out with
            the arriving trailhead (mirror of how it wasn't there before enter),
            instead of popping away the instant `entered` flips. */}
        {(entered || returning) && (
          <Palette
            authed={authed}
            selectedKey={selectedKey}
            onSelectKey={setSelectedKey}
            onClear={() => setSelectedKey(null)}
            exitProgress={returning ? 1 : exitP}
            onExitPull={onExitPull}
            onExitCommit={() => {
              if (selectedKey) setGroundKey(selectedKey);
              if (exitPullRef.current > 0) finishExitFromGesture();
              else toLanding();
            }}
          />
        )}
        {/* Persistent top bar: the wordmark sits top-left in BOTH the landing and
            the graph (consistent anchor). In the graph it's a link back to the
            trailhead. Sign-out + session chrome only once entered. */}
        <div className="TopBar" style={{ position: 'fixed', top: 'max(10px, env(safe-area-inset-top))', left: 12, right: 12, zIndex: 30, pointerEvents: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <button
            // Entered: back to the trailhead. On the trailhead: deselect, so a
            // selected star's read gives way to the default pitch (home = the top).
            onClick={entered ? toLanding : (groundKey ? () => selectByNode(null) : undefined)}
            title={entered ? 'Back to the trailhead' : (groundKey ? 'Back to the trailhead pitch' : undefined)}
            style={{
              pointerEvents: entered || groundKey ? 'auto' : 'none',
              background: 'none', border: 'none', padding: 0, margin: 0,
              cursor: entered || groundKey ? 'pointer' : 'default',
              filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))',
            }}
          >
            <Wordmark light />
          </button>
          {/* Sign-out sits top-right on BOTH the trailhead and the graph (consistent
              chrome) — auth out is always here, never a CTA in the hero. */}
          <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            {session.error ? <span title={session.error} role="status" style={{ color: ink.danger, fontFamily: ink.mono, fontSize: '0.68rem' }}>session warning</span> : null}
            {authed ? (
              <button
                onClick={() => { try { sessionStorage.removeItem('parc.home.entered'); } catch {} session.signOut(); }}
                title={`signed in as ${session.user}`}
                style={{ background: 'rgba(10,12,12,0.72)', color: ink.text, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.35rem 0.65rem', cursor: 'pointer', fontFamily: ink.mono, fontSize: '0.7rem', backdropFilter: 'blur(8px)' }}
              >
                sign out
              </button>
            ) : (
              // Anonymous explorer (reading the public sky via the @guest token):
              // offer sign-in, never sign-out — the consistent top-right chrome.
              <button
                onClick={() => session.signIn()}
                title="Sign in or register a passkey"
                style={{ background: 'rgba(10,12,12,0.72)', color: ink.text, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.35rem 0.65rem', cursor: 'pointer', fontFamily: ink.mono, fontSize: '0.7rem', backdropFilter: 'blur(8px)' }}
              >
                sign in
              </button>
            )}
          </div>
        </div>
      </GraphBoundary>
      {/* The dusk-sky wash sits DIRECTLY over the graph canvas (sibling, not
          inside the overlay) so mix-blend-mode:screen tints the dark sky while
          the live stars punch through. Fades to clear night as you enter. */}
      {(!entered || exitActive || exitGhost) && <SkyGradient fade={skyFade} height={skyHeroHeight} instant={skyInstant} transition={skyTransition} />}
      {/* The landing content flows in the NORMAL DOCUMENT — the BODY scrolls
          natively (hero → content below). iOS-robust: WebKit refuses to
          native-scroll a pointer-events:none overflow:auto container, so we don't
          use one; body scroll is immune. The wrapper is pointer-events:none so
          bare-sky drags fall through to the fixed graph behind (ISLANDS model:
          HeroContent/Content/top-bar re-enable pointer events) — nothing `auto`
          sits between the hero and the graph. `pull` peels it DOWN on
          over-scroll-up; past commit it dissolves (day → night). */}
      {(!entered || exitActive || exitGhost) && (
        <div
          className='Landing'
          style={{
            position: 'relative',
            zIndex: 20,
            pointerEvents: 'none',
            // The mirror exit: while the gesture is live the overlay ARRIVES —
            // opacity fades in with exitP and it slides up the last ~90px into
            // place (the peel, rewound). The `returning` settle then finishes on
            // the shared SETTLE clock; CSS transitions pick up mid-flight values,
            // so a gesture-commit never restarts from dark. A canceled gesture
            // (entered, ghost beat) springs back out the way it came.
            opacity: leaving ? 0 : returning ? (returnLit ? 1 : 0) : exitActive ? exitP : entered ? 0 : 1,
            transform: pull
              ? `translateY(${pull}px)`
              : returning
                ? (returnLit ? 'translateY(0px)' : 'translateY(90px)')
                : exitActive
                  ? `translateY(${((1 - exitP) * 90).toFixed(1)}px)`
                  : entered
                    ? 'translateY(90px)' // ghost — receding back down
                    : undefined,
            transition: leaving
              ? 'opacity 0.9s ease-in'
              : returning
                ? `opacity ${SETTLE}, transform ${SETTLE}`
                : exitActive || pull
                  ? 'none'
                  : entered
                    ? 'opacity 0.35s ease, transform 0.35s ease' // the cancel spring-back
                    : 'transform 0.35s cubic-bezier(.22,1,.36,1)',
          }}
        >
          <Landing session={{ ...session, signIn: authed ? enter : session.signIn }} onExplore={enter} authed={authed} canEnter selectedKey={exitActive && selectedKey ? selectedKey : groundKey} selectedNode={(exitActive && selectedKey ? selectedKey : groundKey) === selectedNode?.key ? selectedNode : null} featured={authed ? undefined : initial?.featured} landingKey={initial?.landingKey} landingBody={initial?.landingBody} initialFact={initial?.selectedFact as import('./facts').ListEntry | undefined} selectedMd={initial?.selectedMd} enterGrip={{ onDown: onGripDown, onMove: onGripMove, onUp: onGripUp,
            // During the mirror exit the landing is REWINDING the enter pull, so
            // its internal pull-driven styling (hero fade, sheet parallax, grip
            // pill) runs at the virtual pull position — the painting brightens
            // from dusk back to day as you arrive, parallax settling with it.
            progress: exitActive ? (1 - exitP) : Math.min(1, pull / PULL_COMMIT) }} />
        </div>
      )}
      {/* Release-to-enter hint — a SIBLING pinned to the viewport top, so it sits
          in the peeled-open gap (the revealed sky) rather than riding the overlay
          down with it. */}
      {!entered && pull > 0 && (
        <div aria-hidden style={{
          position: 'fixed', left: 0, right: 0, top: 'max(10px, env(safe-area-inset-top))',
          zIndex: 21, textAlign: 'center', fontFamily: ink.mono, fontSize: '0.72rem',
          color: ink.accent, opacity: Math.min(1, pull / PULL_COMMIT), pointerEvents: 'none',
        }}>
          {pull >= PULL_COMMIT ? 'release to enter ↑' : 'keep pulling ↑'}
        </div>
      )}
      {/* The mirror hint — same voice, same slot, for the exit gesture. */}
      {exitActive && (
        <div aria-hidden style={{
          position: 'fixed', left: 0, right: 0, top: 'max(10px, env(safe-area-inset-top))',
          zIndex: 21, textAlign: 'center', fontFamily: ink.mono, fontSize: '0.72rem',
          color: ink.accent, opacity: exitP, pointerEvents: 'none',
        }}>
          {exitP >= 1 ? 'release to step back ↓' : 'keep pulling ↑'}
        </div>
      )}
      {/* The peek sheet takes the SUMMONING surface's tone: paper on the
          trailhead (stacks over the cream Content), ink once you've entered the
          graph (a parchment sheet over the night scene reads as a theme flip). */}
      {/* Selection sync (owner direction): the fact you're reading in the sheet
          IS the selection, so the graph re-orients to it behind the sheet and
          closing leaves you there. Folded `owner/key` sheet keys match the
          graph's folded node ids, so the pan lands. */}
      <FactDetailHost tone={entered ? 'dark' : 'light'} onCurrent={(k) => { if (k) setSelectedKey(k); }} />
    </>
  );
}
