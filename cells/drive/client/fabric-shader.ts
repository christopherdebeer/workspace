/** Metric, band-limited surface relief; shared by production and the facade lab. */
export const FABRIC_GLSL = /* glsl */`
varying vec4 vFabric;
float fbHash(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float fbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(fbHash(i),fbHash(i+vec2(1,0)),f.x),mix(fbHash(i+vec2(0,1)),fbHash(i+vec2(1,1)),f.x),f.y);
}
float fbBand(float px, float size) { return 1.0-smoothstep(size*.28,size*.65,px); }
vec3 fbCondition() {
  float p = max(0.0, floor(vFabric.z + .5) - 1.0);
  return vFabric.z > .5 ? vec3(mod(p,256.0)/255.0,mod(floor(p/256.0),256.0)/255.0,floor(p/65536.0)) : vec3(0.0,.7,0.0);
}
// RGB tint and height in metres. No displacement and no silhouette change.
vec4 fbSurface(vec2 wall, float top, vec3 state, float seed) {
  float decay = state.y, kind = state.z;
  vec2 p = wall + vec2(mod(seed,251.0), floor(seed/251.0)) * .73;
  float px = max(length(fwidth(wall)), .0001);
  float broad = fbNoise(p*.37), weather = fbNoise(p*1.7);
  float fine = (fbNoise(p*32.0)-.5)*fbBand(px,.07);
  float damage = smoothstep(.66-decay*.35,.80-decay*.30,broad*.68+weather*.32);
  float stone = step(.5,kind)*(1.0-step(1.5,kind));
  float brick = step(1.5,kind)*(1.0-step(2.5,kind));
  float timber = step(2.5,kind)*(1.0-step(3.5,kind));
  float adobe = step(3.5,kind);
  vec2 size = mix(vec2(.32,.13),vec2(.65,.32),stone);
  size *= .88 + .24*fbHash(vec2(seed,4.7));
  vec2 cell = p/size;
  cell.x += mod(floor(cell.y),2.0)*.5;
  cell.x += stone*(fbHash(vec2(floor(cell.y),seed))-.5)*.55;
  vec2 unit = floor(cell), edge = min(fract(cell),1.0-fract(cell))*size;
  float joint = 1.0-smoothstep(.009,.022+px*.6,min(edge.x,edge.y));
  joint = mix(.15,joint,fbBand(px,size.y));
  float exposed = max(max(stone,brick), damage*(1.0-adobe)*(1.0-timber));
  float unitTone = (fbHash(unit+floor(seed))-.5)*fbBand(px,size.y);
  vec3 masonry = mix(vec3(.65,.43,.30),vec3(.63,.61,.52),stone);
  masonry *= 1.0 + unitTone*.32;
  masonry = mix(masonry,vec3(.32,.30,.25),joint*.72);
  vec3 tint = mix(vec3(1.0),masonry,exposed*.65);
  tint *= .90 + .17*fbHash(vec2(seed,8.3));
  float height = -exposed*joint*.015 - damage*(1.0-timber)*.009;
  // Long cracks, variable width: the same field drives pigment and relief.
  float fracture = abs(fbNoise(p*.75+vec2(weather*.35))-.5);
  float crack = (1.0-smoothstep(.009,.024+px*.03,fracture))*damage*decay*fbBand(px,.22);
  tint *= 1.0 - crack*.24;
  height -= crack*.010;
  // Weather follows gravity: damp at the foot, runoff below the coping.
  float runoff = smoothstep(.48,.78,fbNoise(vec2(p.x*2.7,p.y*.12)))
    * exp(-max(0.0,top-wall.y)*.16);
  float damp = exp(-max(0.0,wall.y)*.75)*(.35+.65*weather);
  tint *= 1.0 - decay*(runoff*.20+damp*.25+damage*.08);
  tint = mix(tint,tint*vec3(.64,.76,.52),decay*damp*.38);
  // Timber has recessed plank seams, weathered grain and sparse old nail rust.
  float plankEdge = min(fract(p.x/.19),1.0-fract(p.x/.19))*.19;
  float seam = (1.0-smoothstep(.003,.008+px*.4,plankEdge))*fbBand(px,.19);
  float grain = (fbNoise(vec2(p.x*60.0,p.y*2.0))-.5)*fbBand(px,.035);
  vec3 wood = vec3(.73,.67,.55)*(1.0-seam*.32+grain*.22-weather*decay*.15);
  tint = mix(tint,wood,timber);
  height = mix(height,-seam*.012+grain*.002,timber);
  height += fine*.002 + (weather-.5)*.003*fbBand(px,.6);
  tint *= 1.0+fine*.09;
  return vec4(tint,height);
}
`;

export const FABRIC_NORMAL = /* glsl */`
// Differential height in view-space, after Three's own normal maps and before lighting.
vec3 fbDx = dFdx(-vViewPosition), fbDy = dFdy(-vViewPosition);
vec3 fbRx = cross(fbDy, normal), fbRy = cross(normal, fbDx);
float fbDet = dot(fbDx, fbRx);
vec3 fbGradient = (fbRx*dFdx(facRelief)+fbRy*dFdy(facRelief))
  * (sign(fbDet)*faceDirection)/max(abs(fbDet),1e-8);
// Bound extreme screen-space derivatives at silhouette/degenerate fragments.
fbGradient *= min(1.0,.65/max(length(fbGradient),.0001));
normal = normalize(normal - fbGradient);
`;
