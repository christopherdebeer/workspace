import type {
  HydroBedMaterial,
  HydroBankMaterial,
  HydroFeature,
  HydroKind,
  HydroPolygon,
  PackedXZ,
} from './types';

export interface OsmHydroPoint {
  lat: number;
  lon: number;
}

/** Compatibility shape for drive's current trimmed Overpass ways. */
export interface OsmHydroElement {
  id: string | number;
  tags?: Record<string, string>;
  geometry: readonly (OsmHydroPoint | readonly [number, number])[];
  /** Optional relation-aware geometry. Outer/holes are latitude/longitude. */
  polygons?: readonly {
    outer: readonly (OsmHydroPoint | readonly [number, number])[];
    holes?: readonly (readonly (OsmHydroPoint | readonly [number, number])[])[];
  }[];
}

export interface ExtractOsmHydroOptions {
  /** Latitude/longitude to projected world x/z metres. */
  project(lat: number, lon: number): readonly [number, number];
  defaultWidthsM?: Partial<Record<'river' | 'stream' | 'canal' | 'ditch' | 'drain', number>>;
}

const DEFAULT_WIDTHS = {
  river: 16,
  stream: 4,
  canal: 8,
  ditch: 2.5,
  drain: 2.5,
} as const;

function metricNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(',', '.');
  const match = normalized.match(/^-?[0-9]+(?:\.[0-9]+)?/);
  if (!match) return undefined;
  let n = Number(match[0]);
  if (!Number.isFinite(n)) return undefined;
  if (/\b(ft|feet|foot)\b|['′]/.test(normalized)) n *= 0.3048;
  return n;
}

function hydroKind(tags: Record<string, string>): HydroKind | undefined {
  const water = tags.water;
  if (water === 'pond') return 'pond';
  if (water === 'reservoir' || tags.landuse === 'reservoir') return 'reservoir';
  if (water === 'basin' || tags.landuse === 'basin') return 'basin';
  if (water === 'lagoon') return 'lagoon';
  if (water === 'river' || tags.waterway === 'riverbank') return 'river';
  if (water === 'canal') return 'canal';
  if (tags.natural === 'wetland') return 'wetland';
  if (tags.natural === 'water') return water === 'lake' ? 'lake' : 'lake';
  switch (tags.waterway) {
    case 'river': return 'river';
    case 'stream': return 'stream';
    case 'canal': return 'canal';
    case 'ditch':
    case 'drain': return 'stream';
    default: return undefined;
  }
}

function flowing(tags: Record<string, string>): boolean {
  return ['river', 'stream', 'canal', 'ditch', 'drain'].includes(tags.waterway ?? '');
}

function coordinates(
  points: readonly (OsmHydroPoint | readonly [number, number])[],
  project: ExtractOsmHydroOptions['project'],
): PackedXZ {
  const out = new Float64Array(points.length * 2);
  let n = 0;
  for (const point of points) {
    const lat = 'lat' in point ? point.lat : point[0];
    const lon = 'lon' in point ? point.lon : point[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const [x, z] = project(lat, lon);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    out[n++] = x;
    out[n++] = z;
  }
  return n === out.length ? out : out.slice(0, n);
}

function stripClosingPoint(points: PackedXZ): PackedXZ {
  if (points.length < 8) return points;
  const n = points.length;
  return Math.hypot(points[0] - points[n - 2], points[1] - points[n - 1]) < 0.01
    ? points.slice(0, n - 2)
    : points;
}

function isClosed(points: PackedXZ): boolean {
  const n = points.length;
  return n >= 8 && Math.hypot(points[0] - points[n - 2], points[1] - points[n - 1]) < 0.5;
}

function polygonFromWay(points: PackedXZ): HydroPolygon | undefined {
  const ring = stripClosingPoint(points);
  return ring.length >= 6 ? { outer: ring, holes: [] } : undefined;
}

function taggedElevation(tags: Record<string, string>): number | undefined {
  return metricNumber(tags.water_level) ?? metricNumber(tags.ele);
}

function taggedBedMaterial(
  tags: Record<string, string>,
  kind: HydroKind,
): HydroBedMaterial | undefined {
  const raw = [tags.bed, tags.surface, tags.material]
    .filter(Boolean).join(';').toLowerCase();
  if (/(mud|silt|clay|earth)/.test(raw)) return 'silt';
  if (/sand/.test(raw)) return 'sand';
  if (/(gravel|shingle)/.test(raw)) return 'gravel';
  if (/(pebble|cobble)/.test(raw)) return 'pebble';
  if (/(bedrock|rock|stone)/.test(raw)) return 'rock';
  if (kind === 'river') return 'gravel';
  if (kind === 'stream') return 'pebble';
  if (kind === 'canal' || kind === 'wetland') return 'silt';
  return undefined;
}

function taggedBankMaterial(tags: Record<string, string>): HydroBankMaterial | undefined {
  const raw = [tags['bank:material'], tags.bank]
    .filter(Boolean).join(';').toLowerCase();
  if (/(mud|clay)/.test(raw)) return 'mud';
  if (/(gravel|shingle|pebble|cobble)/.test(raw)) return 'gravel';
  if (/(bedrock|rock|stone)/.test(raw)) return 'rock';
  if (/(earth|soil|sand)/.test(raw)) return 'soil';
  return undefined;
}

/**
 * Normalize the water subset of OSM. Coastlines are intentionally ignored:
 * an unclosed coastline is not an ocean polygon; ocean coverage enters via
 * HydroTileInput.oceanCoverage.
 */
export function extractOsmHydro(
  elements: readonly OsmHydroElement[],
  options: ExtractOsmHydroOptions,
): HydroFeature[] {
  const widths = { ...DEFAULT_WIDTHS, ...(options.defaultWidthsM ?? {}) };
  const features: HydroFeature[] = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (tags.natural === 'coastline') continue;
    const kind = hydroKind(tags);
    if (!kind) continue;

    const common = {
      id: `osm:${element.id}`,
      source: 'osm' as const,
      kind,
      taggedLevelM: taggedElevation(tags),
      bedMaterial: taggedBedMaterial(tags, kind),
      bankMaterial: taggedBankMaterial(tags),
      intermittent: tags.intermittent === 'yes' || tags.seasonal === 'yes',
      tidal: tags.tidal === 'yes' || tags.water === 'tidal',
    };

    if (element.polygons?.length) {
      const polygons: HydroPolygon[] = [];
      for (const source of element.polygons) {
        const outer = stripClosingPoint(coordinates(source.outer, options.project));
        if (outer.length < 6) continue;
        const holes = (source.holes ?? [])
          .map((hole) => stripClosingPoint(coordinates(hole, options.project)))
          .filter((hole) => hole.length >= 6);
        polygons.push({ outer, holes });
      }
      if (polygons.length) features.push({ ...common, geometry: { type: 'area', polygons } });
      continue;
    }

    const points = coordinates(element.geometry, options.project);
    if (points.length < 4) continue;
    const area = !flowing(tags) && isClosed(points)
      || tags.natural === 'water'
      || tags.waterway === 'riverbank'
      || tags.landuse === 'reservoir'
      || tags.landuse === 'basin';

    if (area) {
      const polygon = polygonFromWay(points);
      if (polygon) features.push({ ...common, geometry: { type: 'area', polygons: [polygon] } });
      continue;
    }

    const sourceKind = tags.waterway as keyof typeof DEFAULT_WIDTHS;
    const widthM = metricNumber(tags.width)
      ?? (sourceKind === 'river' || sourceKind === 'stream' || sourceKind === 'canal'
        || sourceKind === 'ditch' || sourceKind === 'drain' ? widths[sourceKind] : 4);
    features.push({
      ...common,
      geometry: { type: 'line', points, widthM: Math.max(0.6, widthM) },
    });
  }

  return features;
}
