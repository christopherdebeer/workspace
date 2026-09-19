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
}

interface CellEdit {
  tile: EditableRasterTile;
  index: number;
  before: number;
  after: number;
}

const cellKey = (tile: EditableRasterTile, index: number): string =>
  `${tile.key}:${index}`;

export class RasterPaintSession {
  private originals = new Map<string, CellEdit>();
  private undoStack: CellEdit[][] = [];
  private stroke: Map<string, CellEdit> | null = null;

  beginStroke(): void {
    if (this.stroke) this.endStroke();
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
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((e) => e.tile.key))],
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
    return { changed, tileKeys: [...changedTiles] };
  }

  report(): { editedCells: number; undoDepth: number; strokeCells: number } {
    return {
      editedCells: this.originals.size,
      undoDepth: this.undoStack.length,
      strokeCells: this.stroke?.size ?? 0,
    };
  }
}
