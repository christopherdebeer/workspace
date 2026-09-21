/**
 * A transactional brush over the game's real raster tiles.
 *
 * The editor owns no copy of the raster. It changes the same typed arrays the
 * renderer, terrain worker and ecology samplers read, while retaining only the
 * bytes required to undo a stroke or restore the source for this session.
 */
export interface EditableRasterTile {
  key: string;
  xs: number;
  zs: number;
  w: number;
  h: number;
  columns: number;
  rows: number;
  data: Uint8Array;
}

export interface RasterEditResult {
  changed: number;
  tileKeys: string[];
  /** The cells this operation touched, as world footprints. The lab draws
   *  them while the rebuild they triggered is still queued — a painted texel
   *  is in the array immediately and on the screen a second or two later,
   *  and the gap is the whole reason the overlay exists. */
  cells?: CellRect[];
}

/** One raster cell on the ground: centre and footprint, in world metres. */
export interface CellRect { x: number; z: number; w: number; h: number }

interface CellEdit {
  tile: EditableRasterTile;
  index: number;
  before: number;
  after: number;
}

const cellKey = (tile: EditableRasterTile, index: number): string =>
  `${tile.key}:${index}`;

const cellRect = (tile: EditableRasterTile, index: number): CellRect => {
  const w = tile.w / tile.columns;
  const h = tile.h / tile.rows;
  const ix = index % tile.columns;
  const iz = (index - ix) / tile.columns;
  return { x: tile.xs + (ix + .5) * w, z: tile.zs + (iz + .5) * h, w, h };
};

export class RasterPaintSession {
  private originals = new Map<string, CellEdit>();
  private undoStack: CellEdit[][] = [];
  private redoStack: CellEdit[][] = [];
  private stroke: Map<string, CellEdit> | null = null;

  beginStroke(): void {
    if (this.stroke) this.endStroke();
    // A NEW STROKE FORKS THE HISTORY. Keeping a redo that was recorded before
    // an edit that has since happened would re-apply cells the new stroke has
    // already overwritten, at values nothing on the screen ever showed.
    this.redoStack.length = 0;
    this.stroke = new Map();
  }

  paint(
    tiles: Iterable<EditableRasterTile>,
    x: number,
    z: number,
    radiusM: number,
    value: number,
  ): RasterEditResult {
    if (!this.stroke) this.beginStroke();
    const changedTiles = new Set<string>();
    let changed = 0;
    const radius = Math.max(0, radiusM);

    for (const tile of tiles) {
      if (x + radius < tile.xs || x - radius > tile.xs + tile.w
        || z + radius < tile.zs || z - radius > tile.zs + tile.h) continue;
      const pxW = tile.w / tile.columns;
      const pxH = tile.h / tile.rows;
      // A brush touches a texel when its disc touches the texel's footprint.
      // This also makes a zero-radius click select the texel under the cursor.
      const reach = radius + Math.hypot(pxW, pxH) * .5;
      const ix0 = Math.max(0, Math.floor((x - reach - tile.xs) / pxW));
      const ix1 = Math.min(tile.columns - 1, Math.floor((x + reach - tile.xs) / pxW));
      const iz0 = Math.max(0, Math.floor((z - reach - tile.zs) / pxH));
      const iz1 = Math.min(tile.rows - 1, Math.floor((z + reach - tile.zs) / pxH));

      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = tile.zs + (iz + .5) * pxH;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = tile.xs + (ix + .5) * pxW;
          if (Math.hypot(cx - x, cz - z) > reach) continue;
          const index = iz * tile.columns + ix;
          const before = tile.data[index];
          if (before === value) continue;
          const key = cellKey(tile, index);
          if (!this.originals.has(key)) {
            this.originals.set(key, { tile, index, before, after: value });
          }
          const inStroke = this.stroke!.get(key);
          if (inStroke) inStroke.after = value;
          else this.stroke!.set(key, { tile, index, before, after: value });
          tile.data[index] = value;
          changed++;
          changedTiles.add(tile.key);
        }
      }
    }
    return { changed, tileKeys: [...changedTiles] };
  }

  endStroke(): RasterEditResult {
    if (!this.stroke) return { changed: 0, tileKeys: [] };
    const sampled = [...this.stroke.values()];
    const edits = sampled.filter((e) => e.before !== e.after);
    // A pointer can cross a cell twice and finish on the value it started
    // with. Do not retain that as a session edit merely because it changed in
    // the middle of the stroke.
    for (const edit of sampled) {
      const original = this.originals.get(cellKey(edit.tile, edit.index));
      if (original && edit.tile.data[edit.index] === original.before) {
        this.originals.delete(cellKey(edit.tile, edit.index));
      }
    }
    this.stroke = null;
    if (edits.length) this.undoStack.push(edits);
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((e) => e.tile.key))],
      cells: edits.map((e) => cellRect(e.tile, e.index)),
    };
  }

  undo(): RasterEditResult {
    this.endStroke();
    const edits = this.undoStack.pop();
    if (!edits) return { changed: 0, tileKeys: [] };
    for (const edit of edits) {
      edit.tile.data[edit.index] = edit.before;
      const key = cellKey(edit.tile, edit.index);
      const original = this.originals.get(key);
      if (original && edit.before === original.before) this.originals.delete(key);
    }
    this.redoStack.push(edits);
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((e) => e.tile.key))],
      cells: edits.map((e) => cellRect(e.tile, e.index)),
    };
  }

  /** The inverse of undo, and it has to restore the SESSION record as well as
   *  the raster: `originals` is what the authored bank files, so a redone cell
   *  that is not back in it would be painted on the screen and absent from the
   *  entry. */
  redo(): RasterEditResult {
    this.endStroke();
    const edits = this.redoStack.pop();
    if (!edits) return { changed: 0, tileKeys: [] };
    for (const edit of edits) {
      edit.tile.data[edit.index] = edit.after;
      const key = cellKey(edit.tile, edit.index);
      if (!this.originals.has(key)) this.originals.set(key, edit);
    }
    this.undoStack.push(edits);
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((e) => e.tile.key))],
      cells: edits.map((e) => cellRect(e.tile, e.index)),
    };
  }

  reset(): RasterEditResult {
    this.endStroke();
    const changedTiles = new Set<string>();
    let changed = 0;
    for (const edit of this.originals.values()) {
      if (edit.tile.data[edit.index] === edit.before) continue;
      edit.tile.data[edit.index] = edit.before;
      changed++;
      changedTiles.add(edit.tile.key);
    }
    this.originals.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    return { changed, tileKeys: [...changedTiles] };
  }

  /** Every cell the session has left different from what the raster
   *  delivered, with its current value — the authored bank reads this. */
  edits(): Array<{ tile: EditableRasterTile; index: number; before: number; after: number }> {
    this.endStroke();
    const out: Array<{ tile: EditableRasterTile; index: number; before: number; after: number }> = [];
    for (const e of this.originals.values()) {
      const after = e.tile.data[e.index];
      if (after !== e.before) out.push({ tile: e.tile, index: e.index, before: e.before, after });
    }
    return out;
  }
  /** The stroke in flight, as world footprints — the lab's live feedback
   *  while a finger is still down and no rebuild has been asked for yet. */
  strokeCells(): CellRect[] {
    if (!this.stroke) return [];
    const out: CellRect[] = [];
    for (const edit of this.stroke.values()) {
      if (edit.before === edit.after) continue;
      out.push(cellRect(edit.tile, edit.index));
    }
    return out;
  }

  report(): { editedCells: number; undoDepth: number; redoDepth: number; strokeCells: number } {
    return {
      editedCells: this.originals.size,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      strokeCells: this.stroke?.size ?? 0,
    };
  }
}
