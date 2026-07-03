import { interpret } from 'xstate';
import { gestureMachine } from './lib/gesture-machine/gestureMachine.ts';
import { installPointerAdapter } from './lib/gesture-machine/pointerAdapter.ts';
import { createGestureHelpers } from './lib/gesture-machine/gesture-helpers.ts';
import { buildContextMenu } from './lib/context-menu';
import { installCommandPalette } from './lib/cmd-palette/command-palette.ts';
import { generateContent, regenerateImage } from './lib/network/generation.ts';
import { loadInitialCanvas, saveCanvas, saveCanvasLocalOnly, beginBoardPriming } from './lib/network/storage.ts';
import { showModal, closeModal } from './lib/modal.ts';
import { enterFull, exitFull } from './lib/network/inspectorPanel.ts';
import { elementRegistry } from './lib/elements/elementRegistry.ts';
import { registerSubstrateTypes } from './lib/elements/substrateTypes.ts';
import { installFrameNav } from './lib/network/frameNav.ts';
import { installFrameOverlay } from './lib/network/frameOverlay.ts';
import { installEdgeInspector } from './lib/network/edgeInspect.ts';
import { installSelectionInspector } from './lib/network/selectionInspector.ts';
import { CrdtAdapter } from './lib/network/crdt.ts';
import { canvasPath, boardFromPath } from './lib/url.ts';
import { sanitizeElementGeometry, isFiniteNum } from './lib/geometry.ts';
import { uid } from './lib/uid.ts';
import { fitRegion, type BBox } from '../shared/frame.ts';
import type { CanvasState, CanvasElement, ViewState, Edge } from './types.ts';

class CanvasController {
    canvasState: CanvasState;
    crdt: CrdtAdapter;
    selectedElementIds: Set<string>;
    selectedElementId: string | null;
    selectionBox: HTMLElement | null;
    activeEditTab: string;
    viewState: ViewState;
    elementRegistry: any;
    elementNodesMap: Record<string, HTMLElement>;
    edgeNodesMap: Record<string, SVGLineElement>;
    edgeLabelNodesMap?: Record<string, SVGTextElement>;
    edgeHitNodesMap?: Record<string, SVGLineElement>;
    selectedEdgeIds?: Set<string>;
    canvas: HTMLElement;
    container: HTMLElement;
    staticContainer: HTMLElement;
    contextMenu: HTMLElement;
    modeBtn: HTMLElement;
    drillUpBtn: HTMLElement;
    edgesLayer: SVGSVGElement;
    groupBox: HTMLElement;
    MAX_SCALE: number;
    MIN_SCALE: number;
    codeMirrorContent: any;
    codeMirrorSrc: any;
    tokenKey: string;
    modes: string[];
    mode: string;
    _undo: any[];
    _redo: any[];
    _maxHistory: number;
    fsmService: any;
    uninstallAdapter: () => void;
    uninstallCommandPalette: () => void;
    _renderQueued: boolean;
    _edgesQueued: boolean;
    requestRender: () => void;
    requestEdgeUpdate: () => void;
    contextMenuPointerDownHandler?: (ev: Event) => void;
    /** Off-screen culling is transform-aware (driven by updateCulling), not the
     *  browser's content-visibility heuristic — see updateCulling for why. */
    cullEnabled = false;
    _cullQueued = false;
    _cullForce = false;
    /** Window (canvas-space) of the last cull pass — a camera still safely
     *  inside it (pan OR zoom) reuses the pass. W/H are the viewport extent at
     *  cull time; the margin test is in those units. */
    _lastCull: { minX: number; minY: number; maxX: number; maxY: number; W: number; H: number } | null = null;
    /** Camera DOM writes are rAF-coalesced (see updateCanvasTransform). */
    _xformQueued = false;
    _lastZoomVar: number | null = null;
    _zoomVarTimer: ReturnType<typeof setTimeout> | undefined;
    /** Canvas offset, cached — reading offsetLeft per pinch-move forces layout. */
    _canvasOffset: { left: number; top: number } | null = null;
    /** Last dispatched selection signature — pans must not re-announce it. */
    _lastSelSig: string | null = null;

    constructor(canvasState: CanvasState) {
        updateCanvasController(this)
        this.canvasState = canvasState;
        // The CrdtAdapter is the substrate write seam (updateElement/updateEdge
        // funnel into the debounced fact writer) — the Yjs-era update/presence
        // surface is gone; remote merge is the change-feed poller (startLiveSync).
        this.crdt = new CrdtAdapter(canvasState.canvasId);

        if (!this.canvasState.edges) {
            this.canvasState.edges = [];
        }

        this.selectedElementIds = new Set();   // multiselect aware
        this.selectedEdgeIds = new Set();      // unified selection: edges too (ADR-0016)
        Object.defineProperty(this, 'selectedElementId', {  // legacy shim
            get: () => (this.selectedElementIds.size === 1 ? [...this.selectedElementIds][0] : null),
            set: (v) => { this.selectedElementIds.clear(); if (v) this.selectedElementIds.add(v); }
        });

        this.selectionBox = null;              // DOM element for the rubber‑band rectangle
        this.activeEditTab = "content"; // "content" or "src"

        this.viewState = {
            scale: 1,
            translateX: 0,
            translateY: 0
        };

        this.elementRegistry = elementRegistry;
        this.elementNodesMap = {};
        this.edgeNodesMap = {};

        this.canvas = document.getElementById("canvas");
        this.container = document.getElementById("canvas-container");
        this.staticContainer = document.getElementById("static-container");
        this.contextMenu = document.getElementById("context-menu");
        this.modeBtn = document.getElementById("mode");
        this.drillUpBtn = document.getElementById("drillUp");
        this.edgesLayer = document.getElementById("edges-layer") as any as SVGSVGElement;
        this.groupBox = document.createElement('div');
        this.groupBox.id = 'group-box';
        this.groupBox.innerHTML = `
  <div class="box"></div>
  <div class="element-handle resize-handle"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></div>
  <div class="element-handle rotate-handle"><i class="fa-solid fa-rotate"></i></div>
  <div class="element-handle scale-handle"><i class="fa-solid fa-up-down-left-right"></i></div>`;
        this.container.appendChild(this.groupBox);
        this.groupBox.style.display = 'none';

        this.MAX_SCALE = 10;
        this.MIN_SCALE = 0.1;

        this.codeMirrorContent = null;
        this.codeMirrorSrc = null;

        this.tokenKey = "PARC.LAND/BKPK_TOKEN";

        this.modes = ['direct', 'navigate'];
        this.mode = 'direct';
        this.switchMode('navigate');

        /* ── UNDO / REDO stacks ─────────────────────────────────── */
        this._undo = [];          // stack of past states
        this._redo = [];          // stack of undone states
        this._maxHistory = 100;   // ring-buffer size

        // First entry = pristine state so the user can always go “Back to start”
        this._pushHistorySnapshot('Init');

        this.loadLocalViewState();
        const helperActions = createGestureHelpers(this);
        let safeActions: any = {};
        Object.entries(helperActions).forEach(([key, fn]: [string, any]) => {
            safeActions[key] = (ctx: any, ev: any, meta?: any) => {
                // apply* actions fire per pointermove — logging them floods the
                // sticky on-device console (eruda) into an iOS memory problem.
                if (!key.startsWith('apply')) console.log(`[Gesture Action: ${key}]`);
                try {
                    // run the real helper
                    return (fn as any)(ctx, ev, meta);
                } catch (err) {
                    console.error(`[Gesture Action Error: ${key}]`, err);
                    // emit an in‐machine event—this will bubble to your state machine
                    this.fsmService.send({ type: 'ERROR', action: key, error: err });
                    // swallow, so the machine's transition still completes
                }
            };
        });
        this.fsmService = interpret(
            gestureMachine.withContext({
                ...gestureMachine.context,
                controller: this,
            }).withConfig({
                actions: { ...safeActions },
            })
        ).start();
        this.uninstallAdapter = installPointerAdapter(
            this.canvas,
            this.fsmService,
            () => ({ ...this.viewState }),
            () => this.selectedElementIds
        );
        this.setupEventListeners();


        if (this.canvasState.parentCanvas) {
            this.drillUpBtn.style.display = 'block';
        } else {
            this.drillUpBtn.style.display = 'none';
        }

        (this.canvas as any).controller = this;

        // `body.cull` is the feature flag (set from the URL param in main()); the
        // culling itself is transform-aware JS now (updateCulling), not CSS.
        this.cullEnabled = typeof document !== 'undefined' && document.body.classList.contains('cull');

        this.updateCanvasTransform();
        this._renderQueued = false;
        this._edgesQueued = false;

        this.requestRender = () => {
            if (this._renderQueued) return;
            this._renderQueued = true;
            requestAnimationFrame(() => {
                this._renderQueued = false;
                this.renderElementsImmediately();
            });
        };
        this.requestEdgeUpdate = () => {
            if (this._edgesQueued) return;
            this._edgesQueued = true;
            requestAnimationFrame(() => {
                this._edgesQueued = false;
                this.renderEdgesImmediately();
            });
        };

        this.requestRender();
        this.uninstallCommandPalette =
            new URLSearchParams(location.search).get('embed') === '1'
                ? () => undefined // an embed is a picture: no chrome
                : installCommandPalette(this);
    }

    detach() {
        // Tear down BEHAVIOR, not just DOM: without these, every drill left the
        // old pointer adapter + FSM alive (two machines per event, the detached
        // one still mutating state and writing under the wrong board) and
        // stacked a second command palette + shortcut listeners.
        try { this.uninstallAdapter?.(); } catch { /* already gone */ }
        try { this.uninstallCommandPalette?.(); } catch { /* already gone */ }
        try { this.fsmService?.stop?.(); } catch { /* already stopped */ }
        clearTimeout(this._zoomVarTimer);

        // Remove context menu event listener
        if (this.contextMenuPointerDownHandler) {
            this.contextMenu.removeEventListener("pointerdown", this.contextMenuPointerDownHandler);
        }

        // Clean up DOM nodes
        Object.values(this.elementNodesMap).forEach(node => node.remove());
        this.elementNodesMap = {};
        Object.values(this.edgeNodesMap).forEach(line => line.remove());
        this.edgeNodesMap = {};
        if (this.edgeLabelNodesMap) {
            Object.values(this.edgeLabelNodesMap).forEach(label => label.remove());
            this.edgeLabelNodesMap = {};
        }
        this.container.innerHTML = '';
        this.staticContainer.innerHTML = '';
        this.edgesLayer.innerHTML = '';

        // Remove button click handlers
        this.modeBtn.onclick = null;
        this.drillUpBtn.onclick = null;

        this.hideContextMenu();

        if (window.CC === this) {
            window.CC = null as any;
            activeCanvasController = null;
        }
    }

    setupEventListeners() {

        this.contextMenuPointerDownHandler = (ev) => {
            console.log("contextMenu");
            ev.stopPropagation();
        };

        // Add context menu event listener
        this.contextMenu.addEventListener("pointerdown", this.contextMenuPointerDownHandler);

        // Add mode button click handler
        this.modeBtn.onclick = (ev) => {
            ev.stopPropagation();
            const newMode = (this.mode === 'direct') ? 'navigate' : 'direct';
            this.switchMode(newMode);
        };

        // Add drill up button click handler
        this.drillUpBtn.onclick = this.handleDrillUp.bind(this);

        // The cached canvas offset (screenToCanvas) survives until the viewport
        // itself moves under us.
        window.addEventListener('resize', () => { this._canvasOffset = null; });
    }

    undo() { this._stepHistory(this._undo, this._redo, 'undo'); }
    redo() { this._stepHistory(this._redo, this._undo, 'redo'); }

    _snapshot(label = '') {
        return {
            label,
            data: structuredClone({
                canvasState: this.canvasState,
                viewState: this.viewState
            })
        };
    }

    _pushHistorySnapshot(label) {
        const snap = this._snapshot(label);
        // Byte-budget the history as well as counting entries: 100 clones of a
        // big board is hundreds of MB — on iOS that heap alone kills the tab.
        try { (snap as any).bytes = JSON.stringify(snap.data).length; } catch { (snap as any).bytes = 0; }
        this._undo.push(snap);
        if (this._undo.length > this._maxHistory) this._undo.shift();
        const budget = 24 * 1024 * 1024; // ~24MB of snapshot JSON, all entries
        let total = this._undo.reduce((a, s) => a + ((s as any).bytes || 0), 0);
        while (total > budget && this._undo.length > 3) {
            total -= (this._undo.shift() as any).bytes || 0;
        }
        this._redo.length = 0;            // clear redo chain
    }

    _stepHistory(fromStack, toStack, direction) {
        if (fromStack.length === 0) return;
        const cur = this._snapshot();     // current → opposite stack
        // Snapshots are pushed AFTER each mutation, so the stack top usually
        // EQUALS the current state — restoring it made the first undo a
        // visible no-op ("undo needs two presses"). Skip past the echo.
        let top = fromStack.pop();
        try {
            if (fromStack.length &&
                JSON.stringify(top.data.canvasState) === JSON.stringify(cur.data.canvasState)) {
                top = fromStack.pop();
            }
        } catch { /* compare is best-effort */ }
        toStack.push(cur);
        this._restoreSnapshot(top.data);
    }

    _restoreSnapshot({ canvasState, viewState }) {

        this.canvasState = structuredClone(canvasState);
        //this.viewState   = structuredClone(viewState);

        // clear selection, keep mode
        this.selectedElementIds.clear();
        this.updateGroupBox();
        this.requestRender();
        this.requestEdgeUpdate(); // the undone change may have moved endpoints
        // Undo IS an edit: without persisting, a reload resurrected the undone
        // change (the substrate still held the newer state).
        saveCanvas(this.canvasState);
    }


    createSelectionBox(startX, startY) {
        this.selectionBox = document.createElement('div');
        this.selectionBox.id = 'lasso-box';
        Object.assign(this.selectionBox.style, {
            position: 'absolute',
            border: '1px dashed #00aaff',
            background: 'rgba(0,170,255,0.05)',
            left: `${startX}px`,
            top: `${startY}px`,
            width: '0px',
            height: '0px',
            zIndex: 10000,
            pointerEvents: 'none'
        });
        this.canvas.appendChild(this.selectionBox);
    }

    updateSelectionBox(startX, startY, curX, curY) {
        if (!this.selectionBox) this.createSelectionBox(startX, startY)
        const x = Math.min(startX, curX);
        const y = Math.min(startY, curY);
        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);
        Object.assign(this.selectionBox.style, {
            left: `${x}px`, top: `${y}px`,
            width: `${w}px`, height: `${h}px`
        });
    }

    removeSelectionBox() {
        if (this.selectionBox) { this.selectionBox.remove(); this.selectionBox = null; }
    }


    selectElement(id: string, additive = false) {
        if (!additive) this.selectedElementIds.clear();
        console.log("[Controller] selectElement", id, { additive })
        const el = this.findElementById(id);
        if (el?.group) {
            // pull in every element with the same group ID
            const gid = el.group;
            this.canvasState.elements
                .filter(e => e.group === gid)
                .forEach(e => this.selectedElementIds.add(e.id));
        } else {
            // fall back to single‐element toggle
            if (this.selectedElementIds.has(id) && additive) {
                this.selectedElementIds.delete(id);
            } else {
                this.selectedElementIds.add(id);
            }
        }
        this.crdt.updateSelection(this.selectedElementIds);
        this.updateGroupBox()
        this.requestRender();
    }

    clearSelection() {
        if (this.selectedElementIds.size) {
            this.selectedElementIds.clear();
            this.crdt.updateSelection(this.selectedElementIds);
            this.updateGroupBox()
            this.requestRender();
        }
    }

    isElementSelected(id: string) {
        return this.selectedElementIds.has(id);
    }

    getGroupBBox(): { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number } | null {
        if (this.selectedElementIds.size === 0) return null;
        const els = [...this.selectedElementIds].map(id => this.findElementById(id));
        
        // Calculate corners for each element considering rotation
        const allCorners = [];
        
        els.forEach(el => {
            const scaleFactor = el.scale || 1;
            const halfW = (el.width * scaleFactor) / 2;
            const halfH = (el.height * scaleFactor) / 2;
            const cx = el.x;
            const cy = el.y;
            const theta = ((el.rotation || 0) * Math.PI) / 180;
            const cosθ = Math.cos(theta);
            const sinθ = Math.sin(theta);
            
            // Calculate the four corners of the rotated rectangle
            const corners = [
                { x: -halfW, y: -halfH }, // top-left
                { x: halfW, y: -halfH },  // top-right
                { x: halfW, y: halfH },   // bottom-right
                { x: -halfW, y: halfH }   // bottom-left
            ].map(pt => {
                // Rotate point
                const rx = pt.x * cosθ - pt.y * sinθ;
                const ry = pt.x * sinθ + pt.y * cosθ;
                // Translate to element position
                return { x: cx + rx, y: cy + ry };
            });
            
            allCorners.push(...corners);
        });
        
        // Find min/max coordinates from all corners
        const xs = allCorners.map(pt => pt.x);
        const ys = allCorners.map(pt => pt.y);
        
        return {
            x1: Math.min(...xs), y1: Math.min(...ys),
            x2: Math.max(...xs), y2: Math.max(...ys),
            cx: (Math.min(...xs) + Math.max(...xs)) / 2,
            cy: (Math.min(...ys) + Math.max(...ys)) / 2
        };
    }

    updateGroupBox() {
        // Surface element/group selection to the consolidated cmd-context strip
        // (ADR-0016). This is the one chokepoint every selection path funnels
        // through. Dedupe HERE by id-set — this runs on every camera frame
        // during a pan, and dispatching into the inspector's listener chain per
        // frame was measurable main-thread cost on mobile.
        try {
            const ids = [...this.selectedElementIds];
            const sig = ids.join(',');
            if (sig !== this._lastSelSig) {
                this._lastSelSig = sig;
                window.dispatchEvent(new CustomEvent('parc:selection-changed', { detail: { ids } }));
            }
        } catch { /* non-DOM env */ }

        if (this.selectedElementIds.size < 2) {
            this.groupBox.style.display = 'none';
            this.canvas.classList.remove('group-selected')
            return;
        }

        const bb = this.getGroupBBox();
        if (!bb) {
            this.groupBox.style.display = 'none';
            this.canvas.classList.remove('group-selected')
            return;
        }

        this.canvas.classList.add('group-selected')

        this.groupBox.style.display = 'block';
        this.groupBox.style.left = bb.x1 + 'px';           // canvas-space
        this.groupBox.style.top = bb.y1 + 'px';
        this.groupBox.style.width = (bb.x2 - bb.x1) + 'px';
        this.groupBox.style.height = (bb.y2 - bb.y1) + 'px';
    }

    switchMode(m?: string) {
        if (m && this.mode === m) return;
        this.mode = m!;
        this.updateModeUI();
        this.fsmService?.send('TOGGLE_MODE');
    }

    updateModeUI() {
        this.canvas.setAttribute("mode", this.mode);
        this.modeBtn.innerHTML = `<i class="fa-solid fa-${this.mode === 'direct' ? 'arrow-pointer' : 'hand'}"></i> ${this.mode === 'direct' ? 'Editing' : 'Viewing'}`;
    }

    loadLocalViewState() {
        try {
            const key = "canvasViewState_" + (this.canvasState.canvasId || "default");
            const saved = localStorage.getItem(key);
            if (saved) {
                const vs = JSON.parse(saved);
                // Clamp the restored camera: a corrupt/out-of-range saved view
                // (e.g. persisted mid-runaway) must not re-poison this session.
                const s = isFiniteNum(vs.scale) ? vs.scale : 1;
                this.viewState.scale = Math.min(Math.max(s || 1, this.MIN_SCALE), this.MAX_SCALE);
                this.viewState.translateX = isFiniteNum(vs.translateX) ? Math.min(Math.max(vs.translateX, -1e7), 1e7) : 0;
                this.viewState.translateY = isFiniteNum(vs.translateY) ? Math.min(Math.max(vs.translateY, -1e7), 1e7) : 0;
            }
        } catch (e) {
            console.warn("No local viewState found", e);
        }
    }

    saveLocalViewState() {
        try {
            const key = "canvasViewState_" + (this.canvasState.canvasId || "default");
            localStorage.setItem(key, JSON.stringify(this.viewState));
        } catch (e) {
            console.warn("Could not store local viewState", e);
        }
    }

    /**
     * Camera → DOM, coalesced to one write per frame. During a pan iOS fires
     * pointermove at up to 120Hz and this used to run its DOM writes + a forced
     * layout SYNCHRONOUSLY per move — measured on the live parcland board at
     * ~4 forced layouts and ~17 style recalcs PER MOVE (~33ms of main-thread
     * work each). That saturation, sustained for a whole pan with animated
     * elements re-rastering behind it, is the navigate-mode iOS tab-kill.
     * viewState is the source of truth and is updated synchronously by the
     * gesture math; only the DOM writes wait for the frame.
     */
    updateCanvasTransform() {
        if ((this.canvas as any).controller !== this) return;

        // Circuit breaker: a non-finite camera (NaN/Infinity from any upstream
        // math fault) would put `scale(NaN)` on the compositor and every later
        // screenToCanvas call on garbage. Reset to identity instead. Runs
        // per-call (not per-frame) so garbage never lives in viewState.
        const { scale, translateX, translateY } = this.viewState;
        if (!isFiniteNum(scale) || scale <= 0 || !isFiniteNum(translateX) || !isFiniteNum(translateY)) {
            console.warn('[canvas] non-finite viewState — resetting camera', { scale, translateX, translateY });
            this.viewState.scale = 1;
            this.viewState.translateX = 0;
            this.viewState.translateY = 0;
        }

        this.crdt.updateView(this.viewState);

        if (this._xformQueued) return;
        this._xformQueued = true;
        requestAnimationFrame(() => {
            this._xformQueued = false;
            this.applyCanvasTransformNow();
        });
    }

    /** The actual DOM writes for the camera — one batch per frame. */
    applyCanvasTransformNow() {
        if ((this.canvas as any).controller !== this) return;

        this.container.style.transform = `translate(${this.viewState.translateX}px, ${this.viewState.translateY}px) scale(${this.viewState.scale})`;
        // --zoom is consumed by per-element CSS (padding/border calc), so
        // writing it recalcs style AND re-lays-out the whole subtree. A pan
        // doesn't change it — only write when the scale actually moved.
        // (--translateX/-Y were written here too but NOTHING consumes them:
        // pure per-move subtree invalidation, now gone.)
        // During a CONTINUOUS zoom every frame moves the scale, which made this
        // a full-board layout per frame — the zoom-path analogue of the pan
        // tab-kill. Quantize mid-zoom writes to ~5% steps (a 0.4px padding
        // drift, invisible) and settle to the exact value once the zoom rests.
        if (this._lastZoomVar !== this.viewState.scale) {
            const s = this.viewState.scale;
            const prev = this._lastZoomVar;
            if (prev !== null && Math.abs(s - prev) / prev < 0.05) {
                clearTimeout(this._zoomVarTimer);
                this._zoomVarTimer = setTimeout(() => {
                    if ((this.canvas as any).controller !== this) return;
                    if (this._lastZoomVar !== this.viewState.scale) {
                        this._lastZoomVar = this.viewState.scale;
                        this.container.style.setProperty('--zoom', String(this.viewState.scale));
                    }
                }, 120);
            } else {
                this._lastZoomVar = s;
                this.container.style.setProperty('--zoom', String(s));
            }
        }

        // The canvas is viewport-sized; clientWidth avoids getBoundingClientRect's
        // fractional rect (and reads once per frame, not per pointermove).
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;

        // Compute the visible region in canvas coordinates:
        const visibleX = -this.viewState.translateX / this.viewState.scale;
        const visibleY = -this.viewState.translateY / this.viewState.scale;
        const visibleWidth = W / this.viewState.scale;
        const visibleHeight = H / this.viewState.scale;

        // Set the viewBox attribute on the SVG layer so that its coordinate system
        // matches the visible region.
        const viewBox = `${String(visibleX)} ${String(visibleY)} ${String(visibleWidth)} ${String(visibleHeight)}`;
        this.edgesLayer.setAttribute("viewBox", viewBox);
        // The frames overlay (ADR-0015) tracks the board by the SAME transform as
        // the element container (not a viewBox), so it lines up at any viewport —
        // the model the SSR-painted layer also uses. Guarded — it may not exist.
        const framesLayer = document.getElementById('frames-layer');
        if (framesLayer) framesLayer.style.transform = this.container.style.transform;

        this.updateGroupBox()
        this.scheduleCulling();
    }

    /** Coalesce culling to one pass per frame — updateCanvasTransform can fire
     *  many times per pan gesture, but the visible set only needs recomputing once
     *  the transform settles for the frame. `force` skips the moved-far-enough
     *  early-exit (needed when the ELEMENTS changed rather than the camera). */
    scheduleCulling(force = false) {
        if (!this.cullEnabled) return;
        this._cullForce = this._cullForce || force;
        if (this._cullQueued) return;
        this._cullQueued = true;
        requestAnimationFrame(() => {
            this._cullQueued = false;
            const f = this._cullForce;
            this._cullForce = false;
            this.updateCulling(f);
        });
    }

    /** Transform-aware off-screen culling. The blanket `content-visibility:auto`
     *  this replaces had two faults on a CSS-transformed board: (1) its viewport
     *  relevance heuristic doesn't reliably re-evaluate after a programmatic camera
     *  jump (goToFrame), so elements panned into view stayed skipped — a blank
     *  frame; (2) `auto` implies paint containment, which clips the salience badge
     *  and edit handles that render outside the element box. Here WE decide what's
     *  on-screen from the canvas-space rect: visible elements get NO containment
     *  (handles/badges paint freely, always rendered), off-screen ones get
     *  `content-visibility:hidden` (skipped, keeping the iOS compositing relief —
     *  and unlike display:none it preserves iframe/editor state). */
    updateCulling(force = false) {
        if (!this.cullEnabled) return;
        const s = this.viewState.scale || 1;
        const W = this.canvas.clientWidth / s;
        const H = this.canvas.clientHeight / s;
        const vx = -this.viewState.translateX / s;
        const vy = -this.viewState.translateY / s;
        // The slack below is a full screen per side, so the visible set only
        // changes once the camera nears the edge of the last pass's window —
        // skip the whole O(elements+edges) pass until then. The test is
        // CONTAINMENT (visible rect safely inside the window), not camera
        // deltas, so it also holds during a ZOOM: the old `W === last.W`
        // equality never matched while the scale moved, which ran the full
        // pass — hundreds of style writes — on every frame of a pinch/wheel
        // zoom. Zooming IN shrinks the rect (always contained); zooming OUT
        // grows it and reculls exactly when the window no longer covers it.
        const last = this._lastCull;
        if (!force && last
            && vx - last.minX >= last.W / 2 && last.maxX - (vx + W) >= last.W / 2
            && vy - last.minY >= last.H / 2 && last.maxY - (vy + H) >= last.H / 2) return;
        // One screen of slack on every side, so small pans don't thrash elements
        // on/off at the edge (and it absorbs rotation's bbox growth).
        const minX = vx - W, minY = vy - H, maxX = vx + 2 * W, maxY = vy + 2 * H;
        this._lastCull = { minX, minY, maxX, maxY, W, H };
        const visibleEl = new Set<string>();
        // Style writes are guarded — re-setting the same contentVisibility on
        // ~all elements each pass is not free on a big board.
        const setCV = (node: HTMLElement, v: string): void => {
            if (node.style.contentVisibility !== v) node.style.contentVisibility = v;
        };
        for (const el of this.canvasState.elements) {
            const node = this.elementNodesMap[el.id];
            if (!node) continue;
            if (el.static) { setCV(node, 'visible'); visibleEl.add(el.id); continue; } // screen-pinned: always on
            const sc = el.scale || 1;
            const hw = ((el.width || 240) * sc) / 2, hh = ((el.height || 120) * sc) / 2;
            const off = (el.x + hw < minX) || (el.x - hw > maxX) || (el.y + hh < minY) || (el.y - hh > maxY);
            if (off) {
                // contain-intrinsic-size lets the skipped box keep its footprint
                // (left/top still anchor it) instead of collapsing to zero.
                if (node.style.contentVisibility !== 'hidden') {
                    node.style.containIntrinsicSize = `${Math.round((el.width || 240) * sc)}px ${Math.round((el.height || 120) * sc)}px`;
                    node.style.contentVisibility = 'hidden';
                }
            } else {
                setCV(node, 'visible');
                visibleEl.add(el.id);
            }
        }
        // Cull the edge layer by the same window: on a link-heavy board (the
        // live one carries 346 edges → ~1000 SVG line/text nodes) the SVG was
        // fully re-laid-out on every viewBox change even when almost none of
        // it was on screen. An edge stays when EITHER endpoint is on screen
        // (an edge-to-an-edge endpoint counts as visible — cheap and safe).
        for (const edge of this.canvasState.edges) {
            const line = this.edgeNodesMap[edge.id];
            if (!line) continue;
            const srcVis = visibleEl.has(edge.source) || !this.elementNodesMap[edge.source];
            const tgtVis = visibleEl.has(edge.target) || !this.elementNodesMap[edge.target];
            const disp = (srcVis || tgtVis) ? '' : 'none';
            if (line.style.display !== disp) {
                line.style.display = disp;
                const hit = this.edgeHitNodesMap?.[edge.id];
                if (hit) hit.style.display = disp;
                const label = this.edgeLabelNodesMap?.[edge.id];
                if (label) label.style.display = disp;
            }
        }
    }

    recenterOnElement(elId: string) {
        const el = this.findElementById(elId);
        if (!el) {
            console.warn(`Element with ID "${elId}" not found.`);
            return;
        }

        // Compute the center of the element in canvas coordinates
        const scale = this.viewState.scale || 1;
        const elCenterX = el.x;
        const elCenterY = el.y;

        // Get canvas size in pixels
        const canvasRect = this.canvas.getBoundingClientRect();
        const canvasCenterX = canvasRect.width / 2;
        const canvasCenterY = canvasRect.height / 2;

        // Compute new translation to center the element
        this.viewState.translateX = canvasCenterX - (elCenterX * scale);
        this.viewState.translateY = canvasCenterY - (elCenterY * scale);

        this.updateCanvasTransform();
        this.saveLocalViewState();
    }

    renderElementsImmediately() {
        if ((this.canvas as any).controller !== this) return;
        const existingIds = new Set(Object.keys(this.elementNodesMap));
        const usedIds = new Set();

        this.canvasState.elements.forEach(el => {
            usedIds.add(el.id);
            let node = this.elementNodesMap[el.id];
            if (!node) {
                node = this._ensureDomFor(el);
                (el.static ? this.staticContainer : this.container).appendChild(node);
                this.elementNodesMap[el.id] = node;
            }
            const isSel = this.selectedElementIds.has(el.id);
            this.updateElementNode(node, el, isSel);
        });

        existingIds.forEach(id => {
            if (!usedIds.has(id)) {
                const node = this.elementNodesMap[id];
                const view = elementRegistry.viewFor(node?.dataset.type);
                view?.unmount?.(node.firstChild as HTMLElement);
                node.remove();

                delete this.elementNodesMap[id];
            }
        });
        this.updateGroupBox()
        this.requestEdgeUpdate();
        this.scheduleCulling(true); // element set/geometry changed — full re-cull
    }

    renderEdgesImmediately() {
        // console.log("requestEdgeUpdate()");

        // Ensure an SVG marker for arrowheads exists.
        let defs = this.edgesLayer.querySelector("defs");
        if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            this.edgesLayer.prepend(defs);
        }
        // Arrowheads inherit the edge's colour. SVG2 `context-stroke` is unreliable
        // on older iOS Safari, so mint one marker per distinct colour on demand.
        const arrowMarker = (color: string): string => {
            const c = color || "#ccc";
            const id = "arrowhead-" + c.replace(/[^a-zA-Z0-9]/g, "") || "arrowhead-def";
            if (!defs!.querySelector("#" + id)) {
                const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
                marker.setAttribute("id", id);
                marker.setAttribute("markerWidth", "10");
                marker.setAttribute("markerHeight", "7");
                marker.setAttribute("refX", "10");
                marker.setAttribute("refY", "3.5");
                marker.setAttribute("orient", "auto");
                const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                arrowPath.setAttribute("d", "M0,0 L0,7 L10,3.5 Z");
                arrowPath.setAttribute("fill", c);
                marker.appendChild(arrowPath);
                defs!.appendChild(marker);
            }
            return id;
        };
        // Inferred similarity links are BACKGROUND, not foreground (mirrors the
        // SSR thumbnail): the live board carries hundreds of `similarTo` edges,
        // and drawn at full strength they swamp the authored structure. An edge
        // the user has decorated (explicit colour) has been claimed — it renders
        // at full strength whatever its rel.
        const isFaint = (edge: Edge): boolean =>
            (typeof edge.rel === 'string' ? edge.rel.trim() : typeof edge.label === 'string' ? edge.label.trim() : '') === 'similarTo'
            && !edge.style?.color;
        const edgeColor = (edge: Edge): string =>
            this.selectedEdgeIds?.has(edge.id) ? "#2f6f4f"
            : isFaint(edge) ? "rgba(150,140,120,.28)"
            : (edge.style?.color || "#ccc");

        // Endpoint lookups go through a per-PASS map — two linear
        // findElementById scans per edge was O(E·V) per pass (346×127 on the
        // live board, every drag frame). Pass-scoped so it can't go stale
        // under the gesture paths, which keep the linear lookup.
        const elementsById = new Map(this.canvasState.elements.map(el => [el.id, el]));
        this.edgeHitNodesMap = this.edgeHitNodesMap || {};
        let createdEdgeNodes = false;
        this.canvasState.edges.forEach(edge => {
            let line = this.edgeNodesMap[edge.id];
            if (!line) {
                createdEdgeNodes = true;
                // A wide TRANSPARENT hit line under the visible one, so edges are
                // tappable (ADR-0016) — a 2px stroke is unhittable on touch. Both
                // carry data-id; the inspector reads it. The hit line goes first
                // (below), the visible line on top. Faint constellation edges get
                // a narrower band so they don't blanket the space between nodes.
                const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
                hit.setAttribute("stroke", "transparent");
                hit.setAttribute("stroke-width", isFaint(edge) ? "10" : "16");
                hit.setAttribute("data-id", edge.id);
                hit.setAttribute("class", "edge-hit");
                // #edges-layer is pointer-events:none (only its <text> opts back in),
                // so the lines must re-enable hit-testing themselves or edges are
                // untappable. `stroke` = hittable along the (transparent) stroke band.
                hit.setAttribute("pointer-events", "stroke");
                (hit as unknown as SVGElement & { style: CSSStyleDeclaration }).style.cursor = "pointer";
                this.edgeHitNodesMap[edge.id] = hit;
                this.edgesLayer.appendChild(hit);

                line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("data-id", edge.id);
                line.setAttribute("class", "edge-line");
                line.setAttribute("pointer-events", "none"); // the wide hit line below is the target
                this.edgeNodesMap[edge.id] = line;
                this.edgesLayer.appendChild(line);
            }
            {
                // Style every pass (creation falls through here too) so live
                // edits and selection reflect immediately.
                const selected = this.selectedEdgeIds?.has(edge.id);
                const faint = isFaint(edge);
                const color = edgeColor(edge);
                line.setAttribute("stroke", color);
                line.setAttribute("stroke-width", selected ? "3.5" : faint ? "1" : (edge.style?.thickness || "2"));
                // No arrowhead on the constellation: hundreds of markers are pure
                // paint cost and read as foreground clutter.
                if (faint && !selected) line.removeAttribute("marker-end");
                else line.setAttribute("marker-end", `url(#${arrowMarker(color)})`);
                if (edge.style?.dash) line.setAttribute("stroke-dasharray", String(edge.style.dash)); else line.removeAttribute("stroke-dasharray");
            }

            this.updateEdgePosition(edge, line, elementsById)
        });

        // Remove any orphaned SVG lines/labels (live-id Set: the find-per-id
        // sweep was O(edges²)).
        const liveEdgeIds = new Set(this.canvasState.edges.map(e => e.id));
        Object.keys(this.edgeNodesMap).forEach(edgeId => {
            if (!liveEdgeIds.has(edgeId)) {
                this.edgeNodesMap[edgeId].remove();
                delete this.edgeNodesMap[edgeId];
                this.edgeHitNodesMap?.[edgeId]?.remove();
                if (this.edgeHitNodesMap) delete this.edgeHitNodesMap[edgeId];
            }
        });
        if (this.edgeLabelNodesMap) {
            Object.keys(this.edgeLabelNodesMap).forEach(edgeId => {
                if (!liveEdgeIds.has(edgeId)) {
                    this.edgeLabelNodesMap[edgeId].remove();
                    delete this.edgeLabelNodesMap[edgeId];
                }
            });
        }
        if (createdEdgeNodes) this.scheduleCulling(true); // new lines need their on/off-screen state
    }

    updateEdgePosition(edge: Edge, line: SVGLineElement, elementsById?: Map<string, CanvasElement>) {
        if (!line) return;
        const lookup = (id: string): CanvasElement | undefined =>
            elementsById ? elementsById.get(id) : this.findElementById(id);
        const sourceEl = lookup(edge.source);
        const targetEl = lookup(edge.target);
        const sourceEdge = sourceEl ? null : this.findEdgeElementById(edge.source);
        const targetEdge = targetEl ? null : this.findEdgeElementById(edge.target);

        // An edge-to-edge endpoint anchors at the other edge's LABEL node; label
        // nodes are now created lazily (caption-less edges have none), so the
        // lookup must be null-safe. A not-yet-rendered anchor SKIPS this pass
        // (the next edge render resolves it) — it must not delete the edge.
        const anchorOf = (id: string): { x: number; y: number } | null => {
            const t = this.edgeLabelNodesMap?.[id];
            return t ? { x: parseFloat(t.getAttribute("x") || "0"), y: parseFloat(t.getAttribute("y") || "0") } : null;
        };
        let sourcePoint, targetPoint;
        if ((sourceEl || sourceEdge) && (targetEl || targetEdge)) {
            const sAnchor = sourceEl || anchorOf(edge.source);
            const tAnchor = targetEl || anchorOf(edge.target);
            if (!sAnchor || !tAnchor) return; // anchor label not rendered yet — try next pass
            sourcePoint = this.computeIntersection(sAnchor, tAnchor);
            targetPoint = this.computeIntersection(tAnchor, sAnchor);
        }

        if (sourcePoint && targetPoint) {
            line.setAttribute("x1", String(sourcePoint.x));
            line.setAttribute("y1", String(sourcePoint.y));
            line.setAttribute("x2", String(targetPoint.x));
            line.setAttribute("y2", String(targetPoint.y));
            line.setAttribute("stroke-dasharray", edge.data?.meta ? "5,5" : edge.style?.dash || "");
            // Keep the invisible hit line aligned with the visible one.
            const hit = this.edgeHitNodesMap?.[edge.id];
            if (hit) {
                hit.setAttribute("x1", String(sourcePoint.x));
                hit.setAttribute("y1", String(sourcePoint.y));
                hit.setAttribute("x2", String(targetPoint.x));
                hit.setAttribute("y2", String(targetPoint.y));
            }

            // Edge caption (ADR-0016): show the display label if set, else fall
            // back to the semantic relation — but never the generic 'relates',
            // nor the inferred 'similarTo' (SSR draws those as a faint
            // constellation, not captions; the live board carries hundreds and
            // each caption is an SVG text the layer re-lays-out on every
            // viewBox change). No caption → NO text node at all: empty <text>
            // elements still cost layout, and a link-heavy board had one per edge.
            const lbl = typeof edge.label === 'string' ? edge.label.trim() : '';
            const rel = typeof edge.rel === 'string' ? edge.rel.trim() : '';
            const pick = lbl || rel;
            const labelText = pick && pick !== 'relates' && pick !== 'similarTo' ? pick : '';
            if (!this.edgeLabelNodesMap) this.edgeLabelNodesMap = {};
            let textEl = this.edgeLabelNodesMap[edge.id];
            if (!labelText) {
                if (textEl) { textEl.remove(); delete this.edgeLabelNodesMap[edge.id]; }
            } else {
                if (!textEl) {
                    textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    textEl.setAttribute("text-anchor", "middle");
                    textEl.setAttribute("data-id", edge.id);
                    textEl.setAttribute("alignment-baseline", "middle");
                    textEl.setAttribute("fill", "#000");
                    textEl.style.fontSize = "12px";
                    if (this.selectedElementId === edge.id) textEl.style.fill = "red";
                    this.edgeLabelNodesMap[edge.id] = textEl;
                    this.edgesLayer.appendChild(textEl);
                }
                // Calculate midpoint of the line.
                const midX = (sourcePoint.x + targetPoint.x) / 2;
                const midY = (sourcePoint.y + targetPoint.y) / 2;
                textEl.setAttribute("x", String(midX));
                textEl.setAttribute("y", String(midY));
                textEl.textContent = labelText;
            }

        } else {
            // An endpoint is (possibly transiently) missing — element still
            // mounting, or a remote merge in flight. HIDE the edge, never
            // delete it from state: a draw pass mutating the model turned
            // every transient miss into a permanently dropped edge. Load/sync
            // hygiene owns real removals; the next pass re-shows it.
            line.setAttribute('visibility', 'hidden');
            const hit = this.edgeHitNodesMap?.[edge.id];
            if (hit) hit.setAttribute('visibility', 'hidden');
            const label = this.edgeLabelNodesMap?.[edge.id];
            if (label) label.setAttribute('visibility', 'hidden');
            return;
        }
        // Endpoints resolved — clear any transient-miss hiding.
        if (line.getAttribute('visibility') === 'hidden') {
            line.removeAttribute('visibility');
            this.edgeHitNodesMap?.[edge.id]?.removeAttribute('visibility');
            this.edgeLabelNodesMap?.[edge.id]?.removeAttribute('visibility');
        }
    }

    createElementNode(el: CanvasElement) {
        const node = document.createElement("div");
        node.classList.add("canvas-element");
        node.dataset.elId = el.id;
        return node;
    }

    updateElementNode(node: HTMLElement, el: CanvasElement, isSelected: boolean, skipHandles?: boolean) {
        this.crdt.updateElement(el.id, el)
        const view = this.elementRegistry.viewFor(el.type);
        if (view && typeof view.update === 'function') {
            view.update(el, node.firstChild, this);   // firstChild is view root
        } else {
            this.setElementContent(node, el);         // legacy fallback
        }

        this.applyPositionStyles(node, el);
        node.setAttribute("type", el.type);
        node.classList.remove("selected");
        if (isSelected) {
            node.classList.add("selected");
        }
        // (The Yjs peer-selection styling and its dangling `if` — which was
        // accidentally the handles' guard — are gone with the CRDT shim.)
        if (!skipHandles) {
            // Remove old handles (if any)
            const oldHandles = Array.from(node.querySelectorAll('.element-handle'));
            oldHandles.forEach(h => h.remove());
            if (isSelected) {
                this.buildHandles(node, el);
            }
        }
    }

    /**
     * Visually flag a problem on a canvas element.
     * Re-invocations replace the message so only one badge is shown.
     */
    _showElementError(node, msg = 'Error') {
        if (!node) return;

        let badge = node.querySelector('.el-err');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'el-err';
            Object.assign(badge.style, {
                position: 'absolute',
                top: 0,
                left: 0,
                maxWidth: '160px',
                padding: '.2em .4em',
                fontSize: 'calc(.6rem / var(--scale))',
                background: 'crimson',
                color: '#fff',
                fontFamily: 'monospace',
                zIndex: 9999,
                pointerEvents: 'none',
                whiteSpace: 'pre-wrap'
            });
            node.appendChild(badge);
        }
        badge.innerHTML = `<i class="fa fa-exclamation-triangle"/><span class="msg">${msg}</span>`;
    }

    async executeScriptElements(el, node) {

        // defer execution
        await new Promise(r => requestAnimationFrame(r));
        const scriptElements = Array.from(node.querySelectorAll('script')) as HTMLScriptElement[];
        if (!scriptElements.length) return;
        // Which fact's content is running, so a script error names its element
        // (these are user content — often legacy scripts referencing a global
        // `controller` that no longer exists; expected + non-fatal). A module/src
        // script executes globally and its error escapes to window.onerror, where
        // the shell reads this to attribute it.
        const elKey = (el && (el._factKey || el.id)) || '(unknown element)';
        (window as any).__canvasScriptEl = elKey;

        const loadScript = (script: HTMLScriptElement) => {
            return new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => {
                    this._showElementError(node.closest('.canvas-element') as HTMLElement,
                        `Failed to load
${script.getAttribute('src')}`);
                    reject(new Error(`Failed to load script: ${script.getAttribute('src')}`));
                };
                document.head.appendChild(script);
            });
        };

        for (const scriptElement of scriptElements) {
            if (scriptElement.type !== 'module' &&
                !scriptElement.getAttribute('src') &&
                scriptElement.textContent.trim()) {

                try {
                    // Scope the element's schedulers to its lifetime. A legacy
                    // widget (e.g. the custom minimap) runs an UNGUARDED
                    // `requestAnimationFrame(draw)` loop with no isConnected check,
                    // so every re-mount leaks another immortal 60fps board-redraw
                    // on a detached node. Shadow rAF/timers with guarded versions
                    // that stop the moment the element is removed or re-rendered.
                    //
                    // The guards also THROTTLE and GATE (measured on the live
                    // board): one such minimap loop alone held the idle board at
                    // 60 forced layouts/sec — a permanent ~20% main-thread duty
                    // cycle that, stacked under a pan's tile re-rasterisation,
                    // is the navigate-mode iOS tab-kill profile. Element-script
                    // animation loops are capped at ~30fps, and parked entirely
                    // while their element is culled off-screen or a pan/pinch is
                    // in progress (body.gesturing) — they resume by themselves.
                    const alive = (): boolean => (node as HTMLElement).isConnected;
                    const hostNode = (node as HTMLElement).closest?.('.canvas-element') as HTMLElement | null;
                    const suspended = (): boolean =>
                        (hostNode ? hostNode.style.contentVisibility === 'hidden' : false)
                        || document.body.classList.contains('gesturing');
                    const MIN_FRAME_MS = 33; // ~30fps cap for element-script loops
                    const gRaf = (cb: FrameRequestCallback): number => {
                        const tick = (t: number): void => {
                            if (!alive()) return; // element gone — the loop ends here
                            if (suspended()) { requestAnimationFrame(tick); return; } // parked, resumes later
                            const last = (node as any)._rafLast ?? 0;
                            if (t - last < MIN_FRAME_MS) { requestAnimationFrame(tick); return; }
                            (node as any)._rafLast = t;
                            cb(t);
                        };
                        return requestAnimationFrame(tick);
                    };
                    const gTimeout = (cb: () => void, ms?: number): number =>
                        window.setTimeout(() => { if (alive()) cb(); }, ms);
                    const gInterval = (cb: () => void, ms?: number): number => {
                        const id = window.setInterval(() => {
                            if (!alive()) { clearInterval(id); return; }
                            if (!suspended()) cb(); // skip the beat mid-gesture / while culled
                        }, ms);
                        return id as unknown as number;
                    };
                    const fn = new Function('element', 'controller', 'node', 'requestAnimationFrame', 'setTimeout', 'setInterval',
                        scriptElement.textContent || '');
                    fn(el, this, node, gRaf, gTimeout, gInterval);
                } catch (err: any) {
                    // Non-fatal: badge the element + log WHICH element, no global banner.
                    console.warn('[canvas] element script error', { element: elKey, error: err.message });
                    this._showElementError(node.closest('.canvas-element') as HTMLElement, `script: ${err.message}`);
                }

            } else {
                try {
                    await loadScript(scriptElement);
                } catch (err: any) {
                    console.warn('[canvas] element script load failed', { element: elKey, error: err && err.message });
                }
            }
        }
    }

    findElementOrEdgeById(id: string): CanvasElement | Edge | undefined {
        console.log(`[DEBUG] findElementOrEdgeById("${id}")`);
        return this.findElementById(id) || this.findEdgeElementById(id);
    }

    findElementById(id: string): CanvasElement | undefined {
        return this.canvasState.elements.find(e => e.id === id);
    }

    findEdgesByElementId(id: string): Edge[] {
        return this.canvasState.edges.filter(e => e.source === id || e.target === id);
    }

    findEdgeElementById(id: string): Edge | undefined {
        return this.canvasState.edges.find(e => e.id === id);
    }

    createNewElement(x: number, y: number, type = 'markdown', content = '', isCanvasContainer = false, data: any = {}) {
        const newId = uid("el");
        const defaultMap = {
            text: "New text element",
            img: "Realistic tree on white background",
            html: "<div>Hello World</div>",
            markdown: "# New Markdown\nSome **content** here..."
        };
        let finalType = isCanvasContainer ? 'canvas-container' : type;
        let finalContent = content || defaultMap[finalType] || "Untitled";
        const scaleFactor = this.viewState.scale || 1;
        const elObj = {
            ...data,
            id: newId,
            x, y,
            width: 120 / scaleFactor,
            height: 40 / scaleFactor,
            rotation: 0,
            type: finalType,
            content: finalContent,
            versions: [],
            static: false,
        };
        this.canvasState.elements.push(elObj);
        this.selectElement(newId);
        this.requestRender();
        saveCanvas(this.canvasState);
        this._pushHistorySnapshot('New element');
        return newId;
    }

    createNewEdge(sourceId: string, targetId: string, label: string, data: any = {}, style: any = {}) {
        // Create a new edge object.
        const newEdge: Edge = {
            id: uid("edge"),
            source: sourceId,
            target: targetId,
            label: label,
            style: {
                ...style,
            },
            data: {
                ...data,
            }
        };
        this.canvasState.edges.push(newEdge);
        this._pushHistorySnapshot('new edge');

    }

    createEditElement(ev: MouseEvent, el: CanvasElement, prop: string) {
        const canvasPt = this.screenToCanvas(ev.clientX, ev.clientY);
        const elId = this.createNewElement(canvasPt.x, canvasPt.y, "edit-prompt", el[prop], false, {
            target: el.id,
            property: prop,
        });
        this.switchMode('direct');
        this.createNewEdge(elId, el.id, "Editing...", { meta: true });
    }

    clickCapture(btn: HTMLElement, handler: (event: Event) => void) {
        btn.addEventListener("pointerdown", (ev: PointerEvent) => {
            ev.stopPropagation();
            btn.setPointerCapture(ev.pointerId);
        });
        btn.onclick = handler;
    }

    toggleStatic(el: CanvasElement) {
        const node = this.elementNodesMap[el.id];
        if (!node) return;
        if (!el.static) {
            const rect = node.getBoundingClientRect();
            const topPct = (rect.top / window.innerHeight) * 100;
            const leftPct = (rect.left / window.innerWidth) * 100;
            el.fixedTop = topPct;
            el.fixedLeft = leftPct;
            el.static = true;
        } else {
            const rect = node.getBoundingClientRect();
            const centerCanvas = this.screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
            el.x = centerCanvas.x - (el.width * (el.scale || 1)) / 2;
            el.y = centerCanvas.y - (el.height * (el.scale || 1)) / 2;
            el.static = false;
            delete el.fixedTop;   // stale fixed coords persisted forever and
            delete el.fixedLeft;  // confused every later read of the fact
            this.container.appendChild(node);
        }
    }

    screenToCanvas(px: number, py: number): { x: number; y: number } {
        // offsetLeft/offsetTop force a layout when read with pending style
        // writes — and applyCanvasPinch calls this per pointermove (120Hz on
        // iOS). The canvas is viewport-anchored, so cache the offset; a resize
        // invalidates it (see setupEventListeners).
        const off = this._canvasOffset ?? (this._canvasOffset = { left: this.canvas.offsetLeft, top: this.canvas.offsetTop });
        const dx = px - off.left;
        const dy = py - off.top;
        return {
            x: (dx - this.viewState.translateX) / this.viewState.scale,
            y: (dy - this.viewState.translateY) / this.viewState.scale
        };
    }

    setElementContent(node: HTMLElement, el: CanvasElement) {
        const currentType = node.dataset.type || "";
        const currentContent = node.dataset.content || "";
        const currentSrc = node.dataset.src || "";
        const desiredSrc = el.src || "";
        if (
            currentType === el.type &&
            currentContent === el.content &&
            currentSrc === desiredSrc
        ) {
            return;
        }
        // console.log("Setting element content", el.id, el.type)
        node.dataset.type = el.type;
        node.dataset.content = el.content;
        node.dataset.src = desiredSrc;
        node.innerHTML = "";
        // Render based on type:
        if (el.type === "text") {
            const t = document.createElement('p');
            t.classList.add('content');
            t.textContent = el.content;
            t.style.color = el.color || "#000000";
            node.appendChild(t);
        } else if (el.type === "html") {
            const t = document.createElement('div');
            t.classList.add('content');
            t.innerHTML = el.content;
            node.appendChild(t);
            this.executeScriptElements(el, t);
        } else if (el.type === "markdown") {
            const t = document.createElement('div');
            t.classList.add('content');
            t.innerHTML = (window as any).marked.parse(el.content);
            t.style.color = el.color || "#000000";
            node.appendChild(t);
        } else if (el.type === "img") {
            const i = document.createElement("img");
            i.classList.add("content");
            i.dataset.image_id = el.imgId || "";
            i.title = el.content;
            i.onerror = (err) => {
                console.warn("Image failed to load", err);
            };

            // Auto-generate a src-less img ONCE per element per session — a
            // render loop retrying a failing generation was an unbounded
            // stream of model jobs nobody asked for.
            const attempted: Set<string> = ((window as any).__imgGenAttempted ??= new Set());
            if (!el.src && !i.src && !attempted.has(el.id)) {
                attempted.add(el.id);
                regenerateImage(el).then(() => {
                    saveCanvasLocalOnly(this.canvasState);
                    this.requestRender();
                });
            }
            i.src = el.src || `https://placehold.co/${Math.round(el.width)}x${Math.round(el.height)}?text=${encodeURIComponent(el.content)}&font=lora`;

            node.appendChild(i);
        } else if (el.type === "edit-prompt") {
            // Render a prompt element for editing using a mini CodeMirror editor.
            const container = document.createElement('div');
            container.classList.add('content');
            node.appendChild(container);
            if (!(node as any).editor) {
                (node as any).editor = (window as any).CodeMirror(container, {
                    value: el.content || "",
                    lineNumbers: false,
                    mode: "text",
                    theme: "default",
                    lineWrapping: true,
                    viewportMargin: Infinity
                });
            }
            // Add Save and Cancel buttons beneath the editor.
            const btnContainer = document.createElement('div');
            btnContainer.classList.add('actions');
            node.appendChild(btnContainer);
            const saveBtn = document.createElement('button');
            saveBtn.textContent = "Save";
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = "Delete";
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = "Cancel";
            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(saveBtn);
            btnContainer.appendChild(deleteBtn);

            deleteBtn.onclick = () => {
                console.log("edit-prompt delete target");
                const target = this.findElementOrEdgeById(el.target);
                this.canvasState.elements = this.canvasState.elements.filter(e => e.id !== target?.id && e.id !== el.id);
                this.canvasState.edges = this.canvasState.edges.filter(e => e.id !== target?.id);
                this.requestRender();
                saveCanvas(this.canvasState);
            };

            saveBtn.onclick = () => {
                const val = (node as any).editor.getValue();
                const target = this.findElementOrEdgeById(el.target);
                if (target) {
                    console.log(`[DEBUG] Saving edit prompt content to [${target.id}] as property [${el.property}]. with value: "${val}"`, target, el);
                    target[el.property] = val;
                    this.requestEdgeUpdate();
                    saveCanvas(this.canvasState);
                }
                // Remove the edit-prompt element after saving
                this.canvasState.elements = this.canvasState.elements.filter(e => e.id !== el.id);
                // Remove the meta edge connecting edit-prompt to the target
                this.canvasState.edges = this.canvasState.edges.filter(e => e.source !== el.id && e.target !== el.id);
                this.requestRender();
            };
            cancelBtn.onclick = () => {
                // Remove the edit-prompt element
                this.canvasState.elements = this.canvasState.elements.filter(e => e.id !== el.id);
                // Remove the meta edge connecting edit-prompt to the target
                this.canvasState.edges = this.canvasState.edges.filter(e => e.source !== el.id && e.target !== el.id);
                this.requestRender();
                saveCanvas(this.canvasState);
            };
        } else {
            // Once per type per session — this fired per element PER FRAME
            // (an eruda memory bomb on iOS when debug is sticky).
            const w = ((window as any).__warnedTypes ??= new Set());
            if (!w.has(el.type)) {
                w.add(el.type);
                console.warn("Unknown element type", el.type, el);
            }
        }

        const c = node.querySelector('.content');
        if (c) {
            if (c.clientHeight < c.scrollHeight) {
                c.classList.add('scroller');
            } else {
                c.classList.remove('scroller');
            }
        }
        // only if someone has previously “converted” it
        if (el.refCanvasId) {
            const drillInBtn = document.createElement('button');
            drillInBtn.textContent = "Drill In";
            drillInBtn.style.marginTop = '0.5em';
            drillInBtn.onclick = async (ev) => {
                ev.stopPropagation();
                this.handleDrillIn(el);
            };
            c.appendChild(drillInBtn);
        }
    }

    deleteElementById(id: string) {
        this.canvasState.elements = this.canvasState.elements.filter(e => e.id !== id);
        if (this.elementNodesMap[id]) {
            this.elementNodesMap[id].remove();
            delete this.elementNodesMap[id];
        }
        this._pushHistorySnapshot('delete element');

    }

    async handleDrillIn(el: CanvasElement) {
        console.log("handleDrillIn()", el)
        if (!el.refCanvasId) return alert("No canvas reference found.");
        const canvasState = await loadInitialCanvas({
            canvasId: el.refCanvasId,
            elements: [],
            edges: [],
            versionHistory: [],
            parentCanvas: this.canvasState.canvasId,
        }, undefined);
        this.detach()
        const childController = new CanvasController(canvasState);
        updateCanvasController(childController);
        childController.recenterOnElement(el.id);
        window.history.pushState({}, "", canvasPath(el.refCanvasId));
    }

    async handleDrillUp(ev: Event) {
        ev.stopPropagation();
        const canvasId = this.canvasState.parentCanvas;
        if (!canvasId) return;
        const canvasState = await loadInitialCanvas({
            canvasId: canvasId,
            elements: [],
            edges: [],
            versionHistory: [],
        } as CanvasState, undefined);
        this.detach();
        const controller = new CanvasController(canvasState);
        updateCanvasController(controller);
        if (this.canvasState.parentElement) {
            controller.recenterOnElement(this.canvasState.parentElement)
        }
        window.history.pushState({}, "", canvasPath(canvasId));
    };

    buildHandles(node: HTMLElement, _el: CanvasElement) {
        const h = (className: string, icon: string, click?: (event: Event) => void) => {
            const wrap = document.createElement('div');
            wrap.className = className + ' element-handle';
            const i = document.createElement('i');
            i.className = icon;
            wrap.appendChild(i);
            if (click) wrap.addEventListener('click', click);
            node.appendChild(wrap);
        };

        /* top-left – TYPE switcher */
        h('type-handle', 'fa-solid fa-font');

        /* top-right – SCALE */
        h('scale-handle', 'fa-solid fa-up-down-left-right');

        /* bottom-left – REORDER (z-index) */
        h('reorder-handle', 'fa-solid fa-layer-group');

        /* bottom-right – RESIZE width/height */
        h('resize-handle', 'fa-solid fa-up-right-and-down-left-from-center');

        /* rotation handle, centred above */
        h('rotate-handle rotate-handle-position',
            'fa-solid fa-rotate');

        /* edge creation handle */
        h('edge-handle', 'fa-solid fa-link');

        /* “create node” handle */
        h('create-handle', 'fa-solid fa-plus');
    }

    applyPositionStyles(node: HTMLElement, el: CanvasElement) {
        const scale = el.scale || 1;
        const rotation = el.rotation || 0;
        const zIndex = Math.floor(el.zIndex) || 1;
        const blendMode = el.blendMode || 'normal';
        node.style.setProperty('--blend-mode', blendMode);
        if (el.static) {
            node.style.position = 'fixed';
            node.style.left = (el.fixedLeft || 0) + '%';
            node.style.top = (el.fixedTop || 0) + '%';
            // node.style.width = (el.width * scale) + "px";
            // node.style.height = (el.height * scale) + "px";
            node.style.setProperty('--translateX', String(this.viewState.translateX));
            node.style.setProperty('--translateY', String(this.viewState.translateY));
            node.style.setProperty('--zoom', String(this.viewState.scale));

            node.style.setProperty('--width', (el.width * scale) + 'px');
            node.style.setProperty('--height', (el.height * scale) + 'px');
            node.style.setProperty('--scale', String(scale));   // used by CSS for .content
            node.style.zIndex = String(zIndex);                  // plain style, not a CSS var
            node.style.transform = `rotate(${rotation}deg) translate(calc(0px - var(--padding)), calc(0px - var(--padding)))`;
        } else {
            node.style.position = 'absolute';
            node.style.left = (el.x - (el.width * scale) / 2) + "px";
            node.style.top = (el.y - (el.height * scale) / 2) + "px";
            // node.style.width = (el.width * scale) + "px";
            // node.style.height = (el.height * scale) + "px";
            node.style.setProperty('--width', (el.width * scale) + 'px');
            node.style.setProperty('--height', (el.height * scale) + 'px');
            node.style.setProperty('--scale', String(scale));   // used by CSS for .content
            node.style.zIndex = String(zIndex);
            node.style.transform = `rotate(${rotation}deg) translate(calc(0px - var(--padding)), calc(0px - var(--padding)))`;
        }
        this.requestEdgeUpdate();
    }
    // ------------------------------------------------------------------
    //  Registry helpers (new)
    // ------------------------------------------------------------------
    /** Ensure a DOM node exists for el, mounted through its ElementView. */
    _ensureDomFor(el: CanvasElement) {
        let node = this.elementNodesMap[el.id];
        if (node) return node;

        const view = this.elementRegistry.viewFor(el.type);
        node = document.createElement('div');
        node.classList.add('canvas-element');
        node.dataset.elId = el.id;
        node.dataset.type = el.type;

        /* Let the view create its inside DOM */
        if (view) {
            const inner = view.mount(el, this);
            inner && node.appendChild(inner);
        } else {
            /* fallback – keep old hard-wired rendering for legacy types */
            this.setElementContent(node, el);
        }
        this.elementNodesMap[el.id] = node;
        return node;
    }

    computeIntersection(el: CanvasElement | { x: number; y: number }, otherEl: CanvasElement | { x: number; y: number }): { x: number; y: number } {
        // 1) Center and scale as before
        const cx = el.x;
        const cy = el.y;
        const scaleFactor = ('scale' in el) ? (el.scale || 1) : 1;
        const w = (('width' in el) ? (el.width || 10) : 10) * scaleFactor;
        const h = (('height' in el) ? (el.height || 10) : 10) * scaleFactor;
        const halfW = w / 2;
        const halfH = h / 2;

        // 2) Vector from el center to otherEl
        let dx = otherEl.x - cx;
        let dy = otherEl.y - cy;

        // If same point, return center
        if (dx === 0 && dy === 0) {
            return { x: cx, y: cy };
        }

        // 3) Un-rotate the direction vector into the rectangle's local axes
        const theta = ((('rotation' in el) ? (el.rotation || 0) : 0) * Math.PI) / 180;
        const cosθ = Math.cos(-theta);
        const sinθ = Math.sin(-theta);
        const localDX = dx * cosθ - dy * sinθ;
        const localDY = dx * sinθ + dy * cosθ;

        // 4) Compute intersection on an axis-aligned box in local space
        const scaleX = localDX !== 0 ? halfW / Math.abs(localDX) : Infinity;
        const scaleY = localDY !== 0 ? halfH / Math.abs(localDY) : Infinity;
        const scale = Math.min(scaleX, scaleY);

        const localIX = localDX * scale;
        const localIY = localDY * scale;

        // 5) Rotate the intersection point back into world axes
        const cosθf = Math.cos(theta);
        const sinθf = Math.sin(theta);
        const worldIX = localIX * cosθf - localIY * sinθf;
        const worldIY = localIX * sinθf + localIY * cosθf;

        // 6) Translate back to world coordinates
        return {
            x: cx + worldIX,
            y: cy + worldIY
        };
    }


    buildContextMenu(elId?: string) {
        const el = elId ? (this.findElementById(elId) || this.findEdgeElementById(elId)) : undefined;
        buildContextMenu(el as any, this);
    }

    hideContextMenu() {
        this.contextMenu.style.display = "none";
    }

    showContextMenu(x: number, y: number) {
        this.contextMenu.style.left = x + "px";
        this.contextMenu.style.top = y + "px";
        this.contextMenu.style.display = "flex";
    }


    async openEditModal(el?: CanvasElement) {
        console.log("[openEditModa] init", el);
        // If caller didn't pass one, use the single selected element (legacy path)
        if (!el && this.selectedElementId) el = this.findElementById(this.selectedElementId);
        if (!el) return;                              // nothing to edit

        // The editor is the full detent of the unified sheet (Phase 2): host it in
        // cmd-context rather than a centered overlay, then restore on close.
        const host = enterFull();
        // A guaranteed-working close in the sheet header (independent of the
        // modal's own buttons, which can be off-screen on small viewports).
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
        hdr.innerHTML = '<strong style="font-family:Georgia,serif;flex:1">Edit</strong>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ Close';
        closeBtn.style.cssText = 'border:0;background:transparent;color:#8a8a82;font:inherit;cursor:pointer;padding:4px 6px';
        closeBtn.addEventListener('click', () => closeModal());
        hdr.appendChild(closeBtn);
        host.appendChild(hdr);
        try {
            console.log("[openEditModa] launch", el);
            const { status, el: updated } = await showModal(el, {
                host,
                /* Callback the modal can use for the “Generate” button */
                generateContent: (seed) => generateContent(seed, el, this)
            });

            // Persist changes if the user hit “Save”
            if (status === 'saved' && updated) {
                Object.assign(el, updated);               // merge returned changes
                this.updateElementNode(this.elementNodesMap[el.id], el, true);
                this.requestEdgeUpdate();                       // edge labels may have changed
                saveCanvas(this.canvasState);
                this._pushHistorySnapshot('edit element');

            }
        } catch (err) {
            console.error('[openEditModal] modal error:', err);
        } finally {
            exitFull();
            // Re-render the selection strip behind the closed editor.
            try { window.dispatchEvent(new CustomEvent('parc:editor-closed')); } catch { /* non-DOM */ }
        }
    }
}

let activeCanvasController: CanvasController | null = null;
function updateCanvasController(controller: CanvasController) {
    activeCanvasController = window.CC = controller
}

/** Clear the server-rendered board so the interactive controller (which appends
 *  without clearing — see renderElementsImmediately) doesn't paint a duplicate.
 *  Done only once the live state is in hand, so the SSR paint persists right up
 *  to the swap (no blank flash) and a failed load leaves the SSR board visible. */
function clearSsrPaint() {
    const ssrC = document.getElementById('canvas-container');
    if (ssrC && ssrC.dataset.ssr) {
        ssrC.innerHTML = '';
        const ssrS = document.getElementById('static-container');
        if (ssrS) ssrS.innerHTML = '';
        delete ssrC.dataset.ssr;
    }
}

/** Construct the live board from the SSR-embedded state (`#canvas-hydrate`) so it's
 *  interactive immediately, then run the full load in the background and reconcile.
 *  Returns true if it hydrated (caller should stop), false to fall back to the
 *  normal load path. Built-in element types render at once; custom renderers,
 *  edges, unplaced elements and any changes since SSR arrive with the refresh. */
async function tryHydrate(canvasId: string, token: string | null, t0: number): Promise<boolean> {
    try {
        const node = document.getElementById('canvas-hydrate');
        if (!node?.textContent) return false;
        const h = JSON.parse(node.textContent) as { canvasId?: string; cam?: { scale: number; translateX: number; translateY: number }; frame?: BBox; elements?: any[] };
        if (h.canvasId !== canvasId || !Array.isArray(h.elements) || !h.elements.length) return false;
        // Heal any out-of-bounds geometry a past runaway gesture persisted —
        // rendering a poisoned fact at face value is the iOS tab-kill.
        h.elements.forEach((el) => sanitizeElementGeometry(el));

        registerSubstrateTypes(); // built-in element renderers (text/markdown/html/img/…)
        clearSsrPaint();
        // The controller's first render funnels every element through the write
        // queue; with the dedup maps still unseeded that used to persist a full
        // board rewrite on EVERY hydrated open. Gate writes until the background
        // load below seeds the maps and lifts it.
        beginBoardPriming();
        const cc = new CanvasController({ canvasId, elements: h.elements, edges: [], versionHistory: [] } as any);
        // Prefer the framed REGION over the server's pre-baked camera: the SSR cam
        // was fit to a fixed 1200×800, so re-fitting the bbox to the real device
        // viewport here (instant, no network) is what makes the first interactive
        // paint land exactly on the frame instead of jumping after the full load.
        if (h.frame && typeof h.frame.minX === 'number') {
            const cam = fitRegion(h.frame, window.innerWidth, window.innerHeight);
            cc.viewState.scale = cam.scale;
            cc.viewState.translateX = cam.tx;
            cc.viewState.translateY = cam.ty;
            cc.updateCanvasTransform();
        } else if (h.cam && typeof h.cam.scale === 'number') {
            cc.viewState.scale = h.cam.scale;
            cc.viewState.translateX = h.cam.translateX;
            cc.viewState.translateY = h.cam.translateY;
            cc.updateCanvasTransform();
        }
        updateCanvasController(cc);
        installFrameNav();
        installFrameOverlay();
        installEdgeInspector();
        installSelectionInspector();
        markBooted();
        const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
        console.info('[canvas] hydrated from SSR', { elements: h.elements.length, ms });

        // Background refresh: the authoritative full load (auth, renderer facts,
        // links/edges, unplaced elements, salience, live-sync), then reconcile the
        // controller's state in place. The render reconciler (elementNodesMap)
        // adds/updates/removes diffs without a flash.
        void loadInitialCanvas({ canvasId, elements: [], edges: [], versionHistory: [] }, token)
            .then((full) => {
                cc.canvasState.elements = full.elements ?? cc.canvasState.elements;
                cc.canvasState.edges = full.edges ?? [];
                cc.requestRender();
                cc.requestEdgeUpdate();
                console.info('[canvas] background refresh reconciled', { elements: cc.canvasState.elements.length, edges: cc.canvasState.edges.length });
            })
            .catch((e) => console.warn('[canvas] background refresh failed (hydrated board stays live)', e));
        return true;
    } catch (e) {
        console.warn('[canvas] hydration failed — falling back to normal load', e);
        return false;
    }
}

/** Reveal the board: fade out the boot splash and remove it. Idempotent — called
 *  from every terminal boot path (hydrate, full load, and the failure path, so a
 *  boot error surfaces the banner instead of an eternal spinner). */
function markBooted(): void {
    try {
        document.body.classList.add('booted');
        setTimeout(() => document.getElementById('boot-splash')?.remove(), 320);
    } catch { /* pre-DOM */ }
}

(async function main() {
    const params = new URLSearchParams(window.location.search);
    // The board lives in the PATH now (/@c15r/canvas/<board>); ?canvas= is a
    // legacy fallback the server 301s to the path form. Path-based means it
    // survives the sign-in redirect (kernel redirect_uri = origin + pathname).
    const canvasId = boardFromPath() || params.get("canvas") || "canvas-002";
    const token = params.get("token");
    // Off-screen culling is ON by default — it measurably cut the iOS compositing
    // crash on big boards. The flag lives on `body.cull`; the culling is now
    // transform-aware JS (CanvasController.updateCulling), not blanket CSS
    // content-visibility. Escape with ?cull=0 / ?nocull=1.
    if (params.get('cull') !== '0' && params.get('nocull') !== '1') document.body.classList.add('cull');
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Boot narration (visible under ?debug=1). The previous boot logged nothing,
    // so a board that loaded then vanished gave no clue where it went.
    console.info('[canvas] boot', { canvasId, ssr: !!document.getElementById('canvas-container')?.dataset.ssr });

    // SSR hydration fast-path (default ON; escape with ?hydrate=0): the server
    // already read + painted this board, so consume its embedded JSON to go
    // INTERACTIVE in ~50ms instead of the multi-second API re-fetch, then refresh
    // from the substrate in the background (edges, unplaced elements, custom
    // renderers, freshness) and reconcile. tryHydrate no-ops when there's no
    // payload (a non-SSR load), so this is safe to attempt unconditionally; any
    // failure falls through to the normal load — no regression.
    if (params.get('hydrate') !== '0' && await tryHydrate(canvasId, token, t0)) return;

    let rootCanvasState: { canvasId: string; elements: any[]; edges: any[]; versionHistory: any[] } = {
        canvasId: canvasId,
        elements: [],
        edges: [],
        versionHistory: []
    };
    try {
        // Load FIRST (the SSR board stays painted meanwhile), THEN swap to the
        // live board in a single tick. Reversing the old order — which cleared
        // the SSR DOM *before* a multi-second load — removes the blank window and
        // means a load failure no longer wipes the canvas to nothing.
        rootCanvasState = await loadInitialCanvas(rootCanvasState, token);
        const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
        console.info('[canvas] loaded', { canvasId, elements: rootCanvasState.elements.length, edges: rootCanvasState.edges.length, ms });
        clearSsrPaint();
        updateCanvasController(new CanvasController(rootCanvasState));
        installFrameNav();
        installFrameOverlay();
        installEdgeInspector();
        installSelectionInspector();
        markBooted();
        if (!rootCanvasState.elements.length) {
            // A genuinely empty board and a load that fell back to empty look
            // identical on screen — say which, so the next debugger knows.
            console.warn(`[canvas] board "${canvasId}" rendered with 0 elements (empty board, or a load fallback — check for a prior [canvas] load-failed line)`);
        }
    } catch (err) {
        // A boot failure must be VISIBLE, not a silent blank. Keep the SSR paint
        // (don't clear) and surface the reason on the err-banner.
        console.error('[canvas] boot failed', err);
        const report = (window as unknown as { __canvasReport?: (m: string) => void }).__canvasReport;
        if (typeof report === 'function') report('canvas failed to boot: ' + ((err as Error)?.message ?? err));
        markBooted(); // drop the spinner so the error banner is visible, not hidden behind it
    }
})();
