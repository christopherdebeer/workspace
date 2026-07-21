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
import { Landing, Wordmark, SkyGradient } from './dashboard';
import { FullGraph } from './graph';
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
function LandingWithSky({ session, onEnter }: {
  session: Session & { signIn: () => void };
  onEnter?: () => void; // present when authed: fade out, then reveal the graph
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
    const wheel = (e: WheelEvent): void => { if (e.deltaY > 24) onExplore(); };
    const touchStart = (e: TouchEvent): void => { startY = e.touches[0]?.clientY ?? null; };
    const touchMove = (e: TouchEvent): void => {
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
      <SkyBackdrop />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          display: 'grid',
          gridTemplateRows: '1fr auto',
          overflow: 'hidden',
          opacity: entering ? 0 : 1,
          transition: 'opacity 0.6s ease-out',
          pointerEvents: entering ? 'none' : 'auto',
        }}
      >
        <Landing session={{ ...session, signIn: onExplore }} onExplore={onExplore} authed={!!onEnter} />
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
export interface Boot {
  session: Session;
  types?: Record<string, TypeDecl>;
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
  const [, setTypeEpoch] = useState(0);
  useEffect(() => {
    if (!authed) return;
    let live = true;
    void loadTypeDecls().then(() => {
      if (live) setTypeEpoch((v) => v + 1);
    });
    return () => { live = false; };
  }, [authed]);
  // App owns selection BY KEY (not node object): the palette's neighbour chips
  // and the graph's taps both funnel here, and the graph pans to any selection
  // it didn't originate (ADR-0047 v2).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
      if (s) setSelectedKey(s);
      return;
    }
    writeHashState({ selected: selectedKey ?? undefined });
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
  const enter = useCallback(() => {
    try { sessionStorage.setItem('parc.home.entered', '1'); } catch { /* private mode */ }
    setLeaving(true);
    setTimeout(() => setEntered(true), 900);
  }, []);
  // Return to the trailhead from the graph (wordmark click). Re-mounts the
  // landing overlay + dusk sky over the still-live graph and clears the flag.
  const toLanding = useCallback(() => {
    try { sessionStorage.removeItem('parc.home.entered'); } catch { /* private mode */ }
    setLeaving(false);
    setEntered(false);
  }, []);
  // ── ELASTIC PULL-TO-ENTER (drag-to-refresh, inverted: pull UP at the top) ──
  // The overlay is a scroll container: wheel/scrollbar scrolls the taller landing
  // (hero → content-below). At the very top, pulling UP further (overscroll) does
  // NOT scroll — it lifts the whole overlay elastically with a "release to enter"
  // hint; past PULL_COMMIT it dissolves to the graph, otherwise it springs back.
  // Bare pointer-drags aren't handled here at all — they fall through the
  // pointer-events:none overlay to the live graph beneath, which spins natively.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = useState(0);           // px the overlay is lifted (0 = rest)
  const pullRef = React.useRef(0); pullRef.current = pull;
  const PULL_COMMIT = 140;                        // lift past this → enter
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !authed || entered || leaving) return;
    let touchY: number | null = null;
    let springTimer: ReturnType<typeof setTimeout> | null = null;
    const atTop = (): boolean => el.scrollTop <= 0;
    const commitOrSpring = (): void => {
      if (pullRef.current >= PULL_COMMIT) enter();
      else setPull(0); // CSS transition springs it back
    };
    let lastTouchY: number | null = null;
    const touchStart = (e: TouchEvent): void => {
      touchY = lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const touchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (touchY === null || y === undefined || lastTouchY === null) return;
      // Match the wheel handler's metaphor: the SKY is up, so entering it is an
      // OVER-SCROLL UP — at the top, a finger dragging DOWN (content follows the
      // finger down, revealing more sky above) is the pull-to-enter. A finger
      // dragging UP is the ordinary "scroll down to the content below the hero"
      // gesture and must NOT enter (that was the bug: swipe-up fired the enter,
      // so you could never reach the content below).
      const downTotal = y - touchY;    // >0 = finger dragged DOWN from the start (into the sky)
      const dyStep = y - lastTouchY;   // >0 = finger down this frame
      lastTouchY = y;
      if (downTotal > 0 && atTop() && pullRef.current === 0) {
        // At the top, dragging DOWN → elastic lift into the sky (release-to-enter).
        e.preventDefault();
        setPull(Math.min(PULL_COMMIT * 1.4, downTotal * 0.8));
      } else if (pullRef.current > 0) {
        // Continue (finger down) / relax (finger up) the pull.
        e.preventDefault();
        setPull((p) => Math.max(0, Math.min(PULL_COMMIT * 1.4, p + dyStep * 0.8)));
      } else {
        // Finger up (dyStep<0) → scrollTop increases → scroll DOWN to the content.
        el.scrollTop -= dyStep;
      }
    };
    const touchEnd = (): void => { touchY = null; commitOrSpring(); };
    // CAPTURE-PHASE wheel on window: intercept BEFORE the graph canvas sees it
    // (otherwise scroll would zoom the graph). We consume every wheel while the
    // trailhead is up — driving page-scroll or the elastic pull ourselves — and
    // stop it reaching the graph. Pointer-DRAGS still fall through (spin the sky);
    // only wheel is intercepted.
    const wheelWin = (e: WheelEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY < 0 && atTop()) {
        setPull((p) => Math.min(PULL_COMMIT * 1.4, p - e.deltaY * 0.6));
        if (springTimer) clearTimeout(springTimer);
        springTimer = setTimeout(commitOrSpring, 140);
      } else if (pullRef.current > 0 && e.deltaY > 0) {
        setPull((p) => Math.max(0, p - e.deltaY * 0.6));
      } else {
        el.scrollTop += e.deltaY; // scroll the (pointer-events:none) container
      }
    };
    window.addEventListener('wheel', wheelWin, { passive: false, capture: true });
    window.addEventListener('touchstart', touchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', touchMove, { passive: false, capture: true });
    window.addEventListener('touchend', touchEnd, { passive: true, capture: true });
    return () => {
      if (springTimer) clearTimeout(springTimer);
      window.removeEventListener('wheel', wheelWin, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchstart', touchStart, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', touchMove, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchend', touchEnd, { capture: true } as EventListenerOptions);
    };
  }, [authed, entered, leaving, enter]);

  if (!session.ready) return <Page>{null}</Page>;

  if (!authed) {
    return <LandingWithSky session={session} />;
  }

  // ── AUTHED: the graph IS the sky ──
  // The real graph mounts immediately (data starts streaming), behind the
  // landing overlay. "Entering" just fades the overlay away — no remount,
  // no loading flash, no second render. The user sees their live substrate
  // as the trailhead's starfield from the moment the page loads.
  return (
    <>
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
        <FullGraph selectedKey={selectedKey} onSelect={(n) => setSelectedKey(n?.key ?? null)} />
        {entered && <Palette authed={authed} selectedKey={selectedKey} onSelectKey={setSelectedKey} onClear={() => setSelectedKey(null)} />}
        {/* Persistent top bar: the wordmark sits top-left in BOTH the landing and
            the graph (consistent anchor). In the graph it's a link back to the
            trailhead. Sign-out + session chrome only once entered. */}
        <div style={{ position: 'fixed', top: 'max(10px, env(safe-area-inset-top))', left: 12, right: 12, zIndex: 30, pointerEvents: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={entered ? toLanding : undefined}
            title={entered ? 'Back to the trailhead' : undefined}
            style={{
              pointerEvents: entered ? 'auto' : 'none',
              background: 'none', border: 'none', padding: 0, margin: 0,
              cursor: entered ? 'pointer' : 'default',
              filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))',
            }}
          >
            <Wordmark light />
          </button>
          {entered && (
            <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              {session.error ? <span title={session.error} role="status" style={{ color: ink.danger, fontFamily: ink.mono, fontSize: '0.68rem' }}>session warning</span> : null}
              <button
                onClick={() => { try { sessionStorage.removeItem('parc.home.entered'); } catch {} session.signOut(); }}
                title={session.user ? `signed in as ${session.user}` : 'sign out'}
                style={{ background: 'rgba(10,12,12,0.72)', color: ink.text, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.35rem 0.65rem', cursor: 'pointer', fontFamily: ink.mono, fontSize: '0.7rem', backdropFilter: 'blur(8px)' }}
              >
                sign out
              </button>
            </div>
          )}
        </div>
      </GraphBoundary>
      {/* The dusk-sky wash sits DIRECTLY over the graph canvas (sibling, not
          inside the overlay) so mix-blend-mode:screen tints the dark sky while
          the live stars punch through. Fades to clear night as you enter. */}
      {!entered && <SkyGradient fade={leaving ? 0 : 1} />}
      {/* The landing overlay (painted valley + content). It's a SCROLL CONTAINER
          (wheel/scrollbar scrolls the taller page); bare areas are
          pointer-events:none so drags fall through to the graph and spin it.
          `pull` lifts it elastically on overscroll-up (release-to-enter); on
          commit the whole thing dissolves (day → night) before unmounting. */}
      {!entered && (
        <div
          ref={scrollRef}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            // pointer-events:none so a DRAG on the bare hero falls through to the
            // graph (spin the sky); the Landing's islands (buttons/cards/links)
            // re-enable pointer events for themselves. Scroll is driven by the
            // window wheel/touch handlers above, not native scrolling.
            pointerEvents: 'none',
            opacity: leaving ? 0 : 1,
            transform: pull ? `translateY(${-pull}px)` : undefined,
            transition: leaving ? 'opacity 0.9s ease-in' : (pull ? 'none' : 'transform 0.35s cubic-bezier(.22,1,.36,1)'),
          }}
        >
          <Landing session={{ ...session, signIn: enter }} onExplore={enter} authed selectedKey={selectedKey} />
          {/* Release-to-enter hint, revealed by the elastic lift */}
          <div aria-hidden style={{
            position: 'fixed', left: 0, right: 0, bottom: 8, textAlign: 'center',
            fontFamily: ink.mono, fontSize: '0.72rem', color: ink.accent,
            opacity: Math.min(1, pull / PULL_COMMIT), pointerEvents: 'none',
            transition: 'opacity 0.15s',
          }}>
            {pull >= PULL_COMMIT ? 'release to enter ↑' : 'keep pulling to enter ↑'}
          </div>
        </div>
      )}
      <FactDetailHost />
    </>
  );
}
