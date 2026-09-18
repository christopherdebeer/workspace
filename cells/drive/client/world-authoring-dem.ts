import type { RasterEditResult } from './world-authoring-raster';

export type DemBrush = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface EditableDemTile {
  key: string;
  xs: number;
  zs: number;
  w: number;
  h: number;
  columns: number;
  rows: number;
  data: Float32Array;
}

interface DemCellEdit {
  tile: EditableDemTile;
  index: number;
  before: number;
  after: number;
  influence: number;
}

const cellKey = (tile: EditableDemTile, index: number): string =>
  `${tile.key}:${index}`;

const smoothstep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/**
 * Transactional sculpting over the game's resident DEM arrays.
 *
 * A stroke records the source value of each touched cell and keeps the
 * strongest influence that reached it. Pointer event frequency therefore
 * cannot make a stationary raise brush climb indefinitely.
 */
export class DemPaintSession {
  private originals = new Map<string, DemCellEdit>();
  private undoStack: DemCellEdit[][] = [];
  private stroke: Map<string, DemCellEdit> | null = null;
  private brush: DemBrush = 'raise';
  private flattenTarget: number | null = null;

  beginStroke(brush: DemBrush): void {
    if (this.stroke) this.endStroke();
    this.stroke = new Map();
    this.brush = brush;
    this.flattenTarget = null;
  }

  paint(
    tiles: Iterable<EditableDemTile>,
    x: number,
    z: number,
    radiusM: number,
    strength: number,
  ): RasterEditResult {
    if (!this.stroke) this.beginStroke(this.brush);
    const available = [...tiles];
    if (this.brush === 'flatten' && this.flattenTarget === null) {
      const tile = available.find((candidate) =>
        x >= candidate.xs && x < candidate.xs + candidate.w
        && z >= candidate.zs && z < candidate.zs + candidate.h);
      if (tile) {
        const ix = Math.max(0, Math.min(tile.columns - 1,
          Math.floor((x - tile.xs) / tile.w * tile.columns)));
        const iz = Math.max(0, Math.min(tile.rows - 1,
          Math.floor((z - tile.zs) / tile.h * tile.rows)));
        this.flattenTarget = tile.data[iz * tile.columns + ix];
      }
    }

    const changedTiles = new Set<string>();
    let changed = 0;
    const radius = Math.max(0, radiusM);
    const amount = Math.max(0, strength);

    for (const tile of available) {
      if (x + radius < tile.xs || x - radius > tile.xs + tile.w
        || z + radius < tile.zs || z - radius > tile.zs + tile.h) continue;
      const pxW = tile.w / tile.columns;
      const pxH = tile.h / tile.rows;
      const halfCell = Math.hypot(pxW, pxH) * .5;
      const reach = radius + halfCell;
      const ix0 = Math.max(0, Math.floor((x - reach - tile.xs) / pxW));
      const ix1 = Math.min(tile.columns - 1, Math.floor((x + reach - tile.xs) / pxW));
      const iz0 = Math.max(0, Math.floor((z - reach - tile.zs) / pxH));
      const iz1 = Math.min(tile.rows - 1, Math.floor((z + reach - tile.zs) / pxH));

      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = tile.zs + (iz + .5) * pxH;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = tile.xs + (ix + .5) * pxW;
          const distance = Math.hypot(cx - x, cz - z);
          if (distance > reach) continue;
          const influence = radius <= 0
            ? 1
            : smoothstep(1 - Math.max(0, distance - halfCell) / Math.max(radius, 1e-6));
          if (influence <= 0) continue;
          const index = iz * tile.columns + ix;
          const key = cellKey(tile, index);
          let edit = this.stroke!.get(key);
          if (!edit) {
            const before = tile.data[index];
            edit = { tile, index, before, after: before, influence: 0 };
            this.stroke!.set(key, edit);
            if (!this.originals.has(key)) {
              this.originals.set(key, { ...edit });
            }
          }
          if (influence <= edit.influence) continue;
          edit.influence = influence;
          if (this.brush === 'raise' || this.brush === 'lower') {
            const sign = this.brush === 'raise' ? 1 : -1;
            edit.after = edit.before + sign * amount * influence;
          } else if (this.brush === 'flatten') {
            const target = this.flattenTarget ?? edit.before;
            const blend = 1 - Math.exp(-amount * influence);
            edit.after = edit.before + (target - edit.before) * blend;
          } else {
            let sum = 0, count = 0;
            for (let dz = -1; dz <= 1; dz++) {
              const nz = iz + dz;
              if (nz < 0 || nz >= tile.rows) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const nx = ix + dx;
                if (nx < 0 || nx >= tile.columns) continue;
                sum += tile.data[nz * tile.columns + nx];
                count++;
              }
            }
            const target = count ? sum / count : edit.before;
            const blend = 1 - Math.exp(-amount * influence);
            edit.after = edit.before + (target - edit.before) * blend;
          }
          if (Math.abs(tile.data[index] - edit.after) <= 1e-6) continue;
          tile.data[index] = edit.after;
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
    const edits = sampled.filter((edit) => Math.abs(edit.before - edit.after) > 1e-6);
    for (const edit of sampled) {
      const original = this.originals.get(cellKey(edit.tile, edit.index));
      if (original && Math.abs(edit.tile.data[edit.index] - original.before) <= 1e-6) {
        this.originals.delete(cellKey(edit.tile, edit.index));
      }
    }
    this.stroke = null;
    this.flattenTarget = null;
    if (edits.length) this.undoStack.push(edits);
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((edit) => edit.tile.key))],
    };
  }

  undo(): RasterEditResult {
    this.endStroke();
    const edits = this.undoStack.pop();
    if (!edits) return { changed: 0, tileKeys: [] };
    for (const edit of edits) {
      edit.tile.data[edit.index] = edit.before;
      const original = this.originals.get(cellKey(edit.tile, edit.index));
      if (original && Math.abs(edit.before - original.before) <= 1e-6) {
        this.originals.delete(cellKey(edit.tile, edit.index));
      }
    }
    return {
      changed: edits.length,
      tileKeys: [...new Set(edits.map((edit) => edit.tile.key))],
    };
  }

  reset(): RasterEditResult {
    this.endStroke();
    const changedTiles = new Set<string>();
    let changed = 0;
    for (const edit of this.originals.values()) {
      if (Math.abs(edit.tile.data[edit.index] - edit.before) <= 1e-6) continue;
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
