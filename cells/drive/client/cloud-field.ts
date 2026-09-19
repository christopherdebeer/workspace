/**
 * ONE CLOUD FIELD, for the sky, the ground it shades and the water reflecting
 * it. The deck is anchored in world space: the sky intersects it along the
 * view ray, terrain walks to it along the sun ray, and hydro follows the
 * reflected view ray. Keeping this source shared prevents three cloud patterns
 * from merely drifting in roughly the same direction.
 */
export const CLOUD_DECK_Y = 900;
export const CLOUD_SCALE = 0.0016;

export const CLOUD_GLSL = /* glsl */`
  float clh21(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
  float clvn(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(clh21(i), clh21(i + vec2(1.0, 0.0)), f.x),
               mix(clh21(i + vec2(0.0, 1.0)), clh21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float clfbm(vec2 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * clvn(p); p *= 2.07; a *= 0.5; }
    return s;
  }
  // How much of the sky this bit of deck fills. One curve, so a patch that
  // reads as solid overhead is solid on the ground and in reflection too.
  float clCov(float n, float cover){
    return smoothstep(0.60 - cover * 0.40, 0.90 - cover * 0.28, n);
  }
  // THE LATTICE HAS AN EDGE. The weather field is 48 cells of 256m centred on
  // the truck. Fade to the scalar cover rather than clamping the last texel
  // forever beyond its 12.3km footprint.
  float clInLattice(vec2 uv){ vec2 e = abs(uv - 0.5) * 2.0; return 1.0 - smoothstep(0.92, 1.0, max(e.x, e.y)); }`;
