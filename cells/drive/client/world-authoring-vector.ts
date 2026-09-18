export type AuthoringPoint = [number, number];

export interface AuthoredPolyline {
  id: string;
  kind: 'road';
  value: string;
  widthM: number;
  points: AuthoringPoint[];
  createdAt: number;
}

export interface PolylineResult {
  changed: number;
  tileKeys: string[];
  feature?: AuthoredPolyline;
}

const distance = (a: AuthoringPoint, b: AuthoringPoint): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1]);

const segmentDistance = (p: AuthoringPoint, a: AuthoringPoint, b: AuthoringPoint): number => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const ll = dx * dx + dz * dz;
  if (ll <= 1e-9) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / ll));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
};

function simplify(points: AuthoringPoint[], tolerance: number): AuthoringPoint[] {
  if (points.length <= 2) return points.slice();
  let best = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > best) { best = d; at = i; }
  }
  if (best <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, at + 1), tolerance);
  const right = simplify(points.slice(at), tolerance);
  return [...left.slice(0, -1), ...right];
}

const cleanFeature = (value: unknown): AuthoredPolyline | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<AuthoredPolyline>;
  if (typeof v.id !== 'string' || v.kind !== 'road' || typeof v.value !== 'string'
    || !Number.isFinite(v.widthM) || !Array.isArray(v.points) || v.points.length < 2) return null;
  const points: AuthoringPoint[] = [];
  for (const point of v.points) {
    if (!Array.isArray(point) || point.length !== 2
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    points.push([Number(point[0]), Number(point[1])]);
  }
  return {
    id: v.id,
    kind: 'road',
    value: v.value,
    widthM: Math.max(1, Math.min(40, Number(v.widthM))),
    points,
    createdAt: Number.isFinite(v.createdAt) ? Number(v.createdAt) : 0,
  };
};

/**
 * Pointer-frequency-independent polyline capture. It owns source features,
 * while the runtime owns their derived meshes and rebuild status.
 */
export class PolylinePaintSession {
  private draft: AuthoredPolyline | null = null;
  private features: AuthoredPolyline[] = [];
  private sequence = 0;

  constructor(private readonly idFactory: () => string =
    () => `road-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`) {}

  begin(value: string, widthM: number, x: number, z: number): PolylineResult {
    this.draft = {
      id: this.idFactory(),
      kind: 'road',
      value,
      widthM: Math.max(1, Math.min(40, widthM)),
      points: [[x, z]],
      createdAt: Date.now(),
    };
    return { changed: 0, tileKeys: [] };
  }

  sample(x: number, z: number): PolylineResult {
    if (!this.draft) return { changed: 0, tileKeys: [] };
    const last = this.draft.points[this.draft.points.length - 1];
    const spacing = Math.max(1.5, this.draft.widthM * .3);
    if (distance(last, [x, z]) < spacing) return { changed: 0, tileKeys: [] };
    this.draft.points.push([x, z]);
    return { changed: 0, tileKeys: [] };
  }

  end(): PolylineResult {
    const draft = this.draft;
    this.draft = null;
    if (!draft) return { changed: 0, tileKeys: [] };
    const points = simplify(draft.points, Math.max(.6, draft.widthM * .12));
    let length = 0;
    for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
    if (points.length < 2 || length < Math.max(6, draft.widthM)) {
      return { changed: 0, tileKeys: [] };
    }
    const feature = { ...draft, points };
    this.features.push(feature);
    return { changed: points.length, tileKeys: [], feature };
  }

  cancel(): void {
    this.draft = null;
  }

  undo(): PolylineResult {
    const feature = this.features.pop();
    return { changed: feature ? feature.points.length : 0, tileKeys: [], feature };
  }

  reset(): PolylineResult {
    const changed = this.features.reduce((sum, feature) => sum + feature.points.length, 0);
    this.features = [];
    this.draft = null;
    return { changed, tileKeys: [] };
  }

  load(values: unknown): AuthoredPolyline[] {
    if (!Array.isArray(values)) return [];
    this.features = values.map(cleanFeature).filter((v): v is AuthoredPolyline => !!v);
    return this.snapshot();
  }

  snapshot(): AuthoredPolyline[] {
    return this.features.map((feature) => ({
      ...feature,
      points: feature.points.map(([x, z]) => [x, z]),
    }));
  }

  active(): AuthoredPolyline | null {
    if (!this.draft) return null;
    return { ...this.draft, points: this.draft.points.map(([x, z]) => [x, z]) };
  }

  report(): Record<string, number> {
    return {
      features: this.features.length,
      draftPoints: this.draft?.points.length ?? 0,
      vertices: this.features.reduce((sum, feature) => sum + feature.points.length, 0),
    };
  }
}
