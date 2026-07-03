// Type definitions for parcland
// Using 'any' types where complex inference would be needed to avoid breaking existing behavior

export interface CanvasElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  type: string;
  content: string;
  scale?: number;
  versions?: any[];
  static?: boolean;
  group?: string;
  zIndex?: number;
  blendMode?: string;
  color?: string;
  src?: string;
  imgId?: string;
  refCanvasId?: string;
  fixedTop?: number;
  fixedLeft?: number;
  target?: string;
  property?: string;
  [key: string]: any; // Allow additional properties
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  /** The substrate relation — the edge's semantic TYPE (supports/navNext/relates…).
   *  Drives the link written to the substrate. Distinct from `label` (ADR-0016). */
  rel?: string;
  /** The display annotation — free text shown on the edge. Editing it never
   *  changes `rel`. Decoration-only; absent on a bare reference. */
  label?: string;
  style?: {
    color?: string;
    thickness?: string;
    dash?: string;
    [key: string]: any;
  };
  data?: {
    meta?: boolean;
    [key: string]: any;
  };
}

export interface CanvasState {
  canvasId: string;
  elements: CanvasElement[];
  edges: Edge[];
  versionHistory: any[];
  parentCanvas?: string;
  parentElement?: string;
}

export interface ViewState {
  scale: number;
  translateX: number;
  translateY: number;
}

// Element registry types
export interface ElementRegistry {
  listTypes(): string[];
  register(type: string, renderer: ElementRenderer): void;
  getRenderer(type: string): ElementRenderer | undefined;
}

export interface ElementRenderer {
  render(element: CanvasElement, container: HTMLElement): void;
  update?(element: CanvasElement, container: HTMLElement): void;
}

// Command palette types
export interface CommandItem {
  kind: 'command';
  path: string[];
  action?: (controller: CanvasController, input?: string) => void | Promise<void>;
  needsInput?: string;
  shortcut?: string | null;
  category?: string | null;
  icon?: string | null;
  searchText: string;
}

export interface ElementSuggestion {
  kind: 'element';
  id: string;
  label: string;
  icon: string;
  type: string;
  searchText: string;
}

/** A substrate fact NOT yet on this board — selecting it adds the fact to the
 *  canvas (membership tag + placement). Distinct from ElementSuggestion, which
 *  jumps to an item already present. */
export interface FactSuggestion {
  kind: 'fact';
  key: string;
  label: string;
  icon: string;
  type: string;
  searchText: string;
}

export type SuggestionItem = CommandItem | ElementSuggestion | FactSuggestion;

export interface MenuItem {
  label: string | ((controller: CanvasController, config?: any) => string);
  icon?: string;
  category?: string;
  shortcut?: string;
  /** Space-separated synonyms folded into palette search ("remove erase"). */
  aliases?: string;
  children?: MenuItem[];
  action?: (controller: any, input?: any) => void | Promise<void> | any;
  needsInput?: string;
  visible?: (controller: CanvasController) => boolean;
  enabled?: (controller: CanvasController) => boolean;
}

// The substrate write seam (kept under its historical CRDT name).
export interface CrdtAdapter {
  updateElement(id: string, data: any): void;
  updateEdge(id: string, data: any): void;
  updateView(data: any): void;
  updateSelection(data: Set<string>): void;
}

// Controller interface (partial - covers what's used in the files we're migrating)
export interface CanvasController {
  canvasState: CanvasState;
  viewState: ViewState;
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  elementNodesMap: Record<string, HTMLElement>;
  edgeNodesMap: Record<string, SVGLineElement>;
  canvas: HTMLElement;
  container: HTMLElement;
  staticContainer: HTMLElement;
  contextMenu: HTMLElement;
  modeBtn: HTMLElement;
  drillUpBtn: HTMLElement;
  edgesLayer: SVGSVGElement;
  groupBox: HTMLElement;
  elementRegistry?: ElementRegistry;
  crdt: CrdtAdapter;
  MAX_SCALE: number;
  MIN_SCALE: number;

  // Methods
  clickCapture(element: HTMLElement, callback: (event: Event) => void): void;
  updateElementNode(node: HTMLElement, element: CanvasElement, isSelected: boolean, skipHandles?: boolean): void;
  hideContextMenu(): void;
  requestRender(): void;
  requestEdgeUpdate(): void;
  regenerateImage?(element: CanvasElement): void;
  toggleStatic(element: CanvasElement): void;
  openEditModal(element: CanvasElement): void;
  createEditElement(event: Event, element: CanvasElement, property: string): void;
  selectElement(id: string, additive?: boolean): void;
  clearSelection(): void;
  handleDrillIn(element: CanvasElement): void;
  findElementById(id: string): CanvasElement | undefined;
  findEdgeElementById?(id: string): Edge | undefined;
  createNewElement(x: number, y: number, type: string, content: string, isCanvasContainer?: boolean, data?: any): string;
  createNewEdge?(sourceId: string, targetId: string, label: string, data?: any, style?: any): void;
  screenToCanvas(x: number, y: number): { x: number; y: number };
  updateCanvasTransform(): void;
  saveLocalViewState?(): void;
  recenterOnElement(id: string): void;
  switchMode?(mode?: string): void;
  undo(): void;
  redo(): void;
  _pushHistorySnapshot(label: string): void;
  updateSelectionBox(startX: number, startY: number, curX: number, curY: number): void;
  removeSelectionBox(): void;
  isElementSelected(id: string): boolean;
  getGroupBBox(): { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number } | null;
  buildContextMenu?(elementId?: string): void;
  showContextMenu?(x: number, y: number): void;

  // Legacy properties (used by some files)
  [key: string]: any;
}

// Auto-layout types
export interface AutoLayoutOptions {
  scope?: 'selection' | 'all';
  edgeAwareSpacing?: number;
  nodePadding?: number;
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  algorithm?: string;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
}

// Global type augmentations
declare global {
  interface Window {
    CC: any;
    marked: any;
    CodeMirror: any;
    eruda: any;
  }
}

export {};
