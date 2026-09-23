/** Constructed surface evidence. Land-use alone is never proof of sealing. */
export type MadeKind = 'asphalt' | 'concrete' | 'paving';
export function madeKind(tags: Record<string, string>): MadeKind | null {
  const s = tags.surface;
  if (s === 'asphalt' || s === 'chipseal') return 'asphalt';
  if (s === 'concrete' || s === 'concrete:plates') return 'concrete';
  if (s === 'paving_stones' || s === 'sett' || s === 'cobblestone' || s === 'bricks') return 'paving';
  // Explicit unsealed surfaces always defeat typological defaults.
  if (s && s !== 'paved') return null;
  if (tags.amenity === 'parking') return 'asphalt';
  if (tags.highway === 'pedestrian' && tags.area === 'yes') return 'paving';
  return s === 'paved' ? 'concrete' : null;
}

/** RGB are independent surface shares, not interpolated category numbers.
 * The coarse built fallback remains mostly natural ground: a mixed pixel is
 * neither an invented plaza nor permission to pave a rural road's shoulders. */
export function madeShares(cover: number | null, explicit: MadeKind | null,
  naturalArea = false): [number, number, number] {
  if (cover === 80 || naturalArea) return [0, 0, 0];
  if (explicit) return explicit === 'asphalt' ? [1,0,0] : explicit === 'concrete' ? [0,1,0] : [0,0,1];
  return cover === 50 ? [0.12,0.20,0] : [0,0,0];
}

export const MADE_GLSL = /* glsl */`
// Analytically filtered metre-scale joints; they converge to their mean.
float madeJoint(vec2 p, vec2 size, float px) {
  vec2 f = fract(p / size);
  vec2 edge = min(f, 1.0-f)*size;
  float line = 1.0-smoothstep(0.015,0.015+max(px,0.012),min(edge.x,edge.y));
  float band = 1.0-smoothstep(min(size.x,size.y)*0.18,min(size.x,size.y)*0.55,px);
  return mix(0.025,line,band);
}
vec3 madeColour(vec3 base, vec2 p, vec3 shares, float px) {
  float mass = clamp(shares.x+shares.y+shares.z,0.0,1.0);
  float lum = dot(base,vec3(0.2126,0.7152,0.0722));
  // Preserve the world's palette and brightness rather than placing a bright
  // grey map over it. Material identity comes from scale and contrast.
  vec3 asphalt = vec3(lum)*vec3(0.72,0.74,0.76);
  vec3 concrete = vec3(lum)*vec3(1.12,1.09,1.03);
  vec3 paving = vec3(lum)*vec3(1.10,1.02,0.90);
  concrete *= 1.0-0.20*madeJoint(p,vec2(3.0,4.5),px);
  vec2 bond = p; bond.x += mod(floor(p.y/0.45),2.0)*0.30;
  paving *= 1.0-0.24*madeJoint(bond,vec2(0.60,0.45),px);
  return base*(1.0-mass)+asphalt*shares.x+concrete*shares.y+paving*shares.z;
}
`;
