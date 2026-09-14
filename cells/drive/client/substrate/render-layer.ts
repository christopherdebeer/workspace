export interface ProductionRenderLayerAppend<T> {
  expectedCount: number;
  packets: readonly T[];
  directPacketCount?: number;
}

export interface ProductionRenderLayerSnapshot<T> {
  generation: number;
  expectedCount: number;
  directPacketCount: number;
  packets: readonly T[];
  boundSourceRevision: number;
  complete: boolean;
}

interface MutableProductionRenderLayer<T> {
  generation: number;
  expectedCount: number;
  directPacketCount: number;
  packets: T[];
  boundSourceRevision: number;
  complete: boolean;
}

/**
 * Renderer-free lifecycle for one packet layer keyed by substrate tile.
 *
 * Authoring may arrive in several batches, but a source revision can bind only
 * after every expected packet exists. Invalidation preserves authored arrays
 * while removing their source-revision authority, allowing a later terrain
 * redrape to bind the same arrays without reconstructing renderer objects.
 */
export class ProductionRenderLayerStore<T> {
  private readonly layers = new Map<string, MutableProductionRenderLayer<T>>();

  append(key: string, input: ProductionRenderLayerAppend<T>): ProductionRenderLayerSnapshot<T> {
    if (!Number.isInteger(input.expectedCount) || input.expectedCount < 0) {
      throw new Error('render layer expected count must be a non-negative integer');
    }
    const directPacketCount = input.directPacketCount ?? input.packets.length;
    if (!Number.isInteger(directPacketCount)
      || directPacketCount < 0
      || directPacketCount > input.expectedCount) {
      throw new Error('render layer direct packet count is invalid');
    }
    let layer = this.layers.get(key);
    if (!layer) {
      layer = {
        generation: 0,
        expectedCount: 0,
        directPacketCount: 0,
        packets: [],
        boundSourceRevision: -1,
        complete: true,
      };
      this.layers.set(key, layer);
    }
    layer.generation++;
    layer.expectedCount += input.expectedCount;
    layer.directPacketCount += directPacketCount;
    layer.boundSourceRevision = -1;
    const batchComplete = input.packets.length === input.expectedCount;
    layer.complete = layer.complete && batchComplete;
    layer.packets = layer.complete
      ? [...layer.packets, ...input.packets]
      : [];
    return this.snapshotOf(layer);
  }

  bind(key: string, sourceRevision: number): boolean {
    const layer = this.layers.get(key);
    if (!layer) return true;
    const complete = layer.complete && layer.packets.length === layer.expectedCount;
    layer.boundSourceRevision = sourceRevision;
    if (!complete) {
      layer.packets = [];
      layer.complete = false;
    }
    return complete;
  }

  packetsFor(key: string, sourceRevision: number): readonly T[] {
    const layer = this.layers.get(key);
    return layer?.complete && layer.boundSourceRevision === sourceRevision
      ? layer.packets
      : [];
  }

  snapshot(key: string): ProductionRenderLayerSnapshot<T> | undefined {
    const layer = this.layers.get(key);
    return layer ? this.snapshotOf(layer) : undefined;
  }

  *entries(): IterableIterator<[string, ProductionRenderLayerSnapshot<T>]> {
    for (const [key, layer] of this.layers) yield [key, this.snapshotOf(layer)];
  }

  keys(): IterableIterator<string> {
    return this.layers.keys();
  }

  get size(): number {
    return this.layers.size;
  }

  delete(key: string): boolean {
    return this.layers.delete(key);
  }

  clear(): void {
    this.layers.clear();
  }

  private snapshotOf(layer: MutableProductionRenderLayer<T>): ProductionRenderLayerSnapshot<T> {
    return {
      generation: layer.generation,
      expectedCount: layer.expectedCount,
      directPacketCount: layer.directPacketCount,
      packets: layer.packets,
      boundSourceRevision: layer.boundSourceRevision,
      complete: layer.complete,
    };
  }
}
