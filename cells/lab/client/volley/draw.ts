/**
 * Volley's picture: fired and glazed sheets hanging in haze, in WebGL 2, with nothing else in it.
 *
 * A sheet is a slab of clay with tiles set in it. Each tile is drawn from its outline (its edges along a motif's rings
 * bent to the ring's arc): a face, tilted a little off the sheet's plane so no two catch the light alike, its rim
 * rounded over in a quarter-round (smooth normals: the light runs round it), its sides down into the grout; under it
 * its bed, the same outline uninset, meeting its neighbours' as the grout's floor, and running back as the slab, whose
 * crumbling walls show in the holes. Pieces in the air are sharp prisms: they're broken.
 *
 * What a face is made of is worked out where it's drawn: the body, sugary and porous, specked and pitted, its grains
 * catching the light; another clay; a soft glaze and a hard one, thick and glossy, orange-peeled so their highlights
 * break up, crazed, pooled deep on the face and thinning to the body over the rounded rim, the sky and the light in
 * them; the grout, dark; the bare clay of the slab's broken walls. A hard glaze struck once and not broken is cracked
 * from where it was struck. Each firing has its own clays, glazes and air (PALETTES).
 *
 * One light, low and warm, from behind your shoulder, and it casts (a shadow map). Each blow runs through the tiles
 * round it as a ripple; the ball squashes against what it meets. Haze thickens into the sky's gradient. It's drawn
 * antialiased to a texture, then through a lens focused on the nearest sheet still standing.
 *
 * The eye looks straight along the way from behind the pane, far enough back that the pane exactly fills the screen:
 * a point on the pane and a point on the screen are the same point. Beyond it the picture (never the game) bends.
 */
import { H, R, SHEET_T, HARD, SOFT, type Sheet } from './sim';
import { hash } from '../kit/rng';

/** floats per vertex of a solid: place, normal, tone, what it's made of (and which firing: + 10 each), where on the
 * tile (1 the face's middle, 0.12 the face's edge, 0 the rim's foot; -1 to -2 down a side), and where a blow landed */
export const STRIDE = 11;
/** floats per vertex of a sprite (the ball's wake, dust, flashes): place, a coordinate across it, colour and alpha */
export const SPRITE = 9;
/** how far behind the pane the eye is */
export const EYE_BACK = 7;
export const MAT = { plain: 0, fired: 1, hard: 2, crazed: 3, ball: 4, soft: 5, grout: 6 } as const;
/** how deep a tile stands proud of the grout's floor */
export const TILE_D = 0.32;
const NEAR = 1, FAR = 300, NOHIT = 1e4, HITS = 8;

type C = [number, number, number];
export interface Palette { name: string; body: C; fired: C; soft: C; hard: C; clay: C; ball: C; top: C; low: C; sun: C; ink: string; ring: string }
/** a firing's clays, glazes and air */
export const PALETTES: Palette[] = [
  { name: 'lapis', body: [0.9, 0.82, 0.71], fired: [0.72, 0.35, 0.22], soft: [0.86, 0.6, 0.24], hard: [0.07, 0.1, 0.42], clay: [0.86, 0.62, 0.5], ball: [0.1, 0.15, 0.55], top: [0.99, 0.84, 0.71], low: [0.9, 0.64, 0.53], sun: [1, 0.88, 0.72], ink: '#1b2a78', ring: '#1b2a78' },
  { name: 'celadon', body: [0.92, 0.9, 0.87], fired: [0.6, 0.53, 0.62], soft: [0.52, 0.66, 0.58], hard: [0.38, 0.04, 0.06], clay: [0.88, 0.55, 0.5], ball: [0.47, 0.05, 0.08], top: [0.93, 0.92, 0.95], low: [0.76, 0.74, 0.8], sun: [1, 0.97, 0.94], ink: '#7d1622', ring: '#7d1622' },
  { name: 'tenmoku', body: [0.88, 0.72, 0.56], fired: [0.66, 0.29, 0.14], soft: [0.82, 0.42, 0.08], hard: [0.07, 0.05, 0.05], clay: [0.82, 0.56, 0.38], ball: [0.93, 0.86, 0.75], top: [0.88, 0.6, 0.36], low: [0.48, 0.27, 0.15], sun: [1, 0.82, 0.58], ink: '#1b2a78', ring: '#fbefd9' },
];
/** which palette firing `f` of this seed's way is fired in */
export const paletteOf = (seed: number, f: number) => (((f + seed - 1) % PALETTES.length) + PALETTES.length) % PALETTES.length;

export interface Frame {
  z: number; W: number; shake: [number, number];
  bend: [number, number];
  /** the air now: the sky at the top and the bottom of the screen, and the light */
  skyTop: number[]; skyLow: number[]; sun: number[];
  ball: [number, number, number]; ballOn: boolean; ballPal: number;
  /** the ball squashed along (x, y, z) by w (0: round) */
  squash: number[];
  sheets: Sheet[];
  /** which palette sheet `i` is in; and which sheet is the nearest still standing (it and the next are drawn finely) */
  palOf: (i: number) => number; nearest: number;
  /** how far from the eye the lens is focused (the nearest standing sheet) */
  focus: number;
  /** the game's clock, and the latest blows: x, y, z, when (HITS of them), and how hard each runs through the tiles */
  now: number; hits: Float32Array; hitA: Float32Array;
  /** pieces in the air: solid vertices, as many as `fragVerts` */
  frags: Float32Array; fragVerts: number;
  sprites: Float32Array; spriteVerts: number;
}

const BEND = `float d=max(0.,w.z-u_z); w.xy+=u_bend*d*d;`;
// (a blow runs out through the tiles round it: each pushed back and sprung forward, less the further and later)
const RIPPLE = `uniform vec4 u_hits[${HITS}]; uniform float u_hitA[${HITS}]; uniform float u_now;
vec3 ripple(vec3 w){
  for(int i=0;i<${HITS};i++){ vec4 h=u_hits[i]; float age=u_now-h.w; if(age<0.||age>.9||abs(w.z-h.z)>1.)continue;
    float d=length(w.xy-h.xy); w.z+=u_hitA[i]*exp(-age*6.)*sin(age*42.-d*7.)*exp(-d*1.3); }
  return w;
}`;
const VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec3 a_fx; layout(location=3) in vec2 a_hit;
uniform mat4 u_vp, u_light; uniform vec2 u_bend; uniform float u_z; uniform vec4 u_model, u_squash;
out vec3 v_w, v_o, v_n, v_fx, v_p; out vec2 v_hit; out vec4 v_l;
${RIPPLE}
void main(){
  vec3 p=a_pos, nn=a_nrm;
  if(u_squash.w!=0.){ vec3 ax=u_squash.xyz; float k=u_squash.w, al=dot(p,ax); p+=-ax*al*k+(p-ax*al)*k*.5; }
  vec3 w=ripple(u_model.xyz+p*u_model.w); v_o=w; v_n=nn; v_fx=a_fx; v_p=a_pos; v_hit=a_hit;
  ${BEND}
  v_w=w; v_l=u_light*vec4(w+nn*.06,1.);
  gl_Position=u_vp*vec4(w,1.);
}`;
const DEPTH_VERT = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_light; uniform vec2 u_bend; uniform float u_z; uniform vec4 u_model;
${RIPPLE}
void main(){ vec3 w=ripple(u_model.xyz+a_pos*u_model.w); ${BEND} gl_Position=u_light*vec4(w,1.); }`;
const DEPTH_FRAG = `#version 300 es
precision mediump float; void main(){}`;

const N = PALETTES.length;
const FRAG = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 v_w, v_o, v_n, v_fx, v_p; in vec2 v_hit; in vec4 v_l; out vec4 o;
uniform vec3 u_eye, u_toLight, u_skyTop, u_skyLow, u_sun; uniform vec2 u_res; uniform float u_z, u_alpha, u_ballPal;
uniform vec3 u_body[${N}], u_fired[${N}], u_soft[${N}], u_hard[${N}], u_clay[${N}], u_ball[${N}];
uniform sampler2DShadow u_shadow;
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return .45*vn(p)+.28*vn(p*2.1+7.)+.17*vn(p*4.3+3.)+.1*vn(p*8.9+11.); }
// (crazing: the distance to the nearest of a scatter of points, against the next nearest: lines where they're equal)
float craze(vec2 p){
  vec2 i=floor(p),f=fract(p); float a=9.,b=9.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y),q=g+vec2(h2(i+g),h2(i+g+17.))-f; float d=dot(q,q); if(d<a){b=a;a=d;}else if(d<b)b=d; }
  return 1.-smoothstep(0.,.05,sqrt(b)-sqrt(a));
}
// (a blow's cracks: rays from where it landed, wandering, thinning as they go, and a ring round the crater)
float cracks(vec2 p, vec2 h){
  vec2 d=p-h; float r=length(d), a=atan(d.y,d.x), m=0.;
  for(int i=0;i<7;i++){
    float th=float(i)*.8976+h2(h+float(i))*.6, aa=a-th+.16*sin(r*13.+float(i)*2.7)+.05*sin(r*41.+float(i));
    aa=mod(aa+3.14159,6.28318)-3.14159;
    float len=.55+h2(h+float(i)+3.)*.7;
    if(abs(aa)<1.2){ float w=mix(.04,.008,clamp(r/len,0.,1.)), dist=r*abs(sin(aa)); m=max(m,(1.-smoothstep(w*.35,w,dist))*step(r,len)); }
  }
  m=max(m,1.-smoothstep(.008,.02,abs(r-.24-.04*sin(a*5.))));
  return m;
}
float lit(){
  vec3 p=v_l.xyz/v_l.w*.5+.5;
  if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.)return 1.;
  float s=0.,t=1./2048.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(u_shadow,vec3(p.xy+vec2(x,y)*t*1.4,p.z-.0009));
  return s/9.;
}
float lum(vec3 c){ return dot(c,vec3(.3,.59,.11)); }
// (a shoulder on the brightness alone, so the hues hold)
vec3 shoulder(vec3 c){ float L=max(lum(c),1e-4), T=L<.72?L:.72+.28*(1.-exp(-(L-.72)/.28)); return clamp(c*(T/L),0.,1.); }
void main(){
  vec3 n=normalize(v_n), view=normalize(u_eye-v_w), L=u_toLight;
  int pal=int(v_fx.y/10.+.01); float mat=mod(v_fx.y+.01,10.)-.01, tone=v_fx.x, edge=v_fx.z; bool side=edge<-.5;
  bool ball=mat>3.5&&mat<4.5, grout=mat>5.5&&mat<6.5, glaze=(mat>1.5&&mat<3.5)||(mat>4.5&&mat<5.5);
  if(ball) pal=int(u_ballPal+.5);
  vec2 uv=gl_FragCoord.xy/u_res;
  vec3 sky=mix(u_skyLow,u_skyTop,uv.y);
  // (the surface's own coordinates: across whichever way the face mostly looks, so a turned piece isn't streaked;
  // and how big a pixel is on it, so the finest grain fades rather than shimmers at a distance)
  vec3 an=abs(n); vec2 q=an.z>.6?v_o.xy:an.x>an.y?v_o.yz:v_o.xz;
  float px=length(fwidth(q)), fine=1.-smoothstep(.006,.03,px);
  float down=side?clamp(-edge-1.,0.,1.):0.;
  vec3 base; float gloss=0., ao=1., glint=0.;
  if(ball){
    vec3 g=u_ball[pal]; float c=craze(v_p.xy*3.+v_p.z*2.);
    base=mix(g,lum(g)<.3?g+.18:g*.72,c*.7); gloss=1.;
  } else if(grout){
    // the grout's floor, dark in the joints; the slab's broken walls, the bare clay crumbling
    vec3 cl=u_clay[pal];
    if(side){ base=cl*(.72+.3*fbm(q*7.))*(1.-.25*smoothstep(.55,.85,fbm(q*19.))); n=normalize(n+vec3(vn(q*24.)-.5,vn(q*24.+9.)-.5,vn(q*24.+3.)-.5)*.7); ao=.75-.35*down; }
    else { base=mix(cl*.5,u_body[pal]*.55,.4)*(.8+.3*vn(q*30.)); ao=.42; }
  } else if(side){
    // a tile's side, going down into the grout: its own body, darker the deeper
    vec3 b=mat>.5&&mat<1.5?u_fired[pal]:mix(u_body[pal],u_clay[pal],.35);
    base=b*(.9+.18*fbm(q*9.)); n=normalize(n+vec3(vn(q*30.)-.5,vn(q*30.+9.)-.5,0.)*.35*fine); ao=1.-.42*down*down;
  } else if(!glaze){
    // the body, or the other clay: sugary, specked, pitted, its grains catching the light
    vec3 b=mat<.5?u_body[pal]:u_fired[pal];
    base=mix(b*.8,b*1.08,fbm(q*1.2))*(1.-.2*smoothstep(.5,.85,fbm(q*12.)));
    float sp=h2(floor(q*85.)), sp2=h2(floor(q*37.)+11.);
    base*=1.-(.5*step(.955,sp)+.25*step(.93,sp2))*fine;
    base=mix(base,base*1.12+.03,step(.97,h2(floor(q*61.)+5.))*fine);
    n=normalize(n+vec3(vn(q*9.)-.5,vn(q*9.+5.)-.5,0.)*.26+vec3(h2(floor(q*70.))-.5,h2(floor(q*70.)+3.)-.5,0.)*.9*fine);
    glint=.22*fine;
  } else {
    // a glaze: thick and pooled on the face, thinning over the rim to the body, orange-peeled, crazed
    vec3 g=mat>4.5?u_soft[pal]:u_hard[pal];
    float thin=1.-smoothstep(.02,.13,edge), deep=smoothstep(.12,.7,edge);
    g*=mix(1.05,.8,deep)*(.95+.1*fbm(q*2.1));
    base=mix(g,mix(u_body[pal],g,.45)*1.05,thin*.7);
    vec3 line=lum(g)<.3?mix(g,vec3(.85,.86,.9),.55):g*.6;
    float cz=craze(q*(mat>2.5&&mat<3.5?3.2:5.4))*(mat>2.5&&mat<3.5?.45:.22);
    if(v_hit.x<1e3&&mat>2.5&&mat<3.5){
      // (where it was struck: a crater to the body, and cracks running from it)
      float ck=cracks(v_o.xy,v_hit), r=length(v_o.xy-v_hit), rim=.11+.03*vn(vec2(atan(v_o.y-v_hit.y,v_o.x-v_hit.x)*3.,0.));
      cz=max(cz*.6,ck);
      base*=1.-.25*(1.-smoothstep(.1,.45,r));
      base=mix(base,u_clay[pal]*(.75+.35*vn(q*40.)),1.-smoothstep(rim-.015,rim,r));
    }
    base=mix(base,line,cz);
    n=normalize(n+vec3(vn(q*11.)-.5,vn(q*11.+7.)-.5,0.)*.09+vec3(vn(q*37.)-.5,vn(q*37.+2.)-.5,0.)*.03);
    gloss=1.-cz*.5;
  }
  base*=tone;
  // (the grout line where a tile's rim meets its side)
  if(!side&&!grout&&!ball) ao*=.82+.18*smoothstep(0.,.03,edge);
  float ndl=max(dot(n,L),0.), sh=lit();
  vec3 amb=(mix(u_skyLow,u_skyTop,n.y*.5+.5)*.34+u_skyTop*.14*max(-n.z,0.)+u_skyLow*.12*max(-n.y,0.))*ao;
  vec3 c=base*(u_sun*1.3*ndl*sh*mix(1.,ao,.6)+amb);
  if(gloss>0.){
    // the sky and the light in it: a broad soft reflection of the light, a hard one, the sky's gradient at a slant
    vec3 Rf=reflect(-view,n); float rl=max(dot(Rf,L),0.);
    float F=.05+.95*pow(1.-max(dot(n,view),0.),5.);
    vec3 env=mix(u_skyLow,u_skyTop,clamp(Rf.y*.5+.5,0.,1.))*.6+u_sun*(1.1*pow(rl,9.)+7.*pow(rl,420.)*sh);
    c=c*(1.-F*.4)*.9+gloss*env*(.08+.92*F)*ao;
  }
  if(glint>0.){ vec3 Rg=reflect(-view,n); c+=u_sun*glint*pow(max(dot(Rg,L),0.),36.)*sh; }
  float far=max(0.,v_w.z-u_z-1.5), f=1.-exp(-far*.02);
  c=mix(c,sky,f);
  o=vec4(shoulder(c),u_alpha);
}`;

const SKY_VERT = `#version 300 es
out vec2 v_uv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.-1.,1.,1.); }`;
const SKY_FRAG = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform vec3 u_skyTop,u_skyLow,u_sun; uniform float u_aspect;
void main(){
  vec3 c=mix(u_skyLow,u_skyTop,v_uv.y);
  // (the light's own glow, up and to the left, where it comes from)
  vec2 d=(v_uv-vec2(.08,.92))*vec2(u_aspect,1.);
  c+=u_sun*(.3*exp(-dot(d,d)*7.)+.12*exp(-dot(d,d)*1.5));
  float L=max(dot(c,vec3(.3,.59,.11)),1e-4), T=L<.72?L:.72+.28*(1.-exp(-(L-.72)/.28)); o=vec4(clamp(c*(T/L),0.,1.),1.);
}`;
const SPRITE_VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec4 a_col;
uniform mat4 u_vp; uniform vec2 u_bend; uniform float u_z;
out vec2 v_uv; out vec4 v_col;
void main(){ vec3 w=a_pos; ${BEND} v_uv=a_uv; v_col=a_col; gl_Position=u_vp*vec4(w,1.); }`;
// (a sprite: a soft disc; a ribbon, across it (v > 1.5); or a ring (u > 4))
const SPRITE_FRAG = `#version 300 es
precision highp float; in vec2 v_uv; in vec4 v_col; out vec4 o;
void main(){
  float m;
  if(v_uv.x>4.){ float l=length(v_uv-vec2(10.,0.)); m=(1.-smoothstep(0.,.16,abs(l-.78)))*step(l,1.); }
  else m=v_uv.y>1.5?smoothstep(0.,.7,1.-abs(v_uv.x)):smoothstep(0.,.7,1.-length(v_uv));
  o=vec4(v_col.rgb,v_col.a*m);
}`;
// the lens: a gather of 24 taps in a disc, each counted only if its own blur reaches this far (so what's sharp in
// front never smears onto what's blurred behind); then the eye drawn in toward the middle, and a little grain
const LENS_FRAG = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D u_col, u_dep; uniform vec2 u_px; uniform float u_A, u_B, u_focus, u_span, u_maxR, u_seed;
float dist(vec2 uv){ return u_B/((texture(u_dep,uv).r*2.-1.)-u_A); }
float coc(vec2 uv){ float d=dist(uv); return clamp((d-u_focus)/u_span,0.,1.); }
void main(){
  vec2 uv=v_uv; float c0=coc(uv); vec3 acc=texture(u_col,uv).rgb; float w=1.;
  if(c0>.01){
    for(int i=0;i<24;i++){
      float a=float(i)*2.39996, r=sqrt((float(i)+.5)/24.);
      vec2 su=uv+vec2(cos(a),sin(a))*r*c0*u_maxR*u_px;
      float cs=coc(su), wt=clamp((cs-r*c0)*10.+1.,0.,1.);
      acc+=texture(u_col,su).rgb*wt; w+=wt;
    }
    acc/=w;
  }
  vec2 v=uv-.5; acc*=1.-.28*dot(v*vec2(.8,1.),v*vec2(.8,1.))*2.;
  acc+=(fract(sin(dot(gl_FragCoord.xy+u_seed,vec2(12.9898,78.233)))*43758.5453)-.5)*.018;
  o=vec4(acc,1.);
}`;

/** A sharp prism into `out` at float offset `o` (a piece in the air): a front face, sides, and a back if given. */
export function prism(out: Float32Array, o: number, front: number[], back: number[], cf: number[], nf: number[], cb: number[] | null, tone: number, mat: number): number {
  const n = front.length / 3;
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, edge: number) => { out.set([x, y, z, nx, ny, nz, tone, mat, edge, NOHIT, NOHIT], o); o += STRIDE; };
  for (let k = 0; k < n; k++) {
    const a = k * 3, b = ((k + 1) % n) * 3;
    put(cf[0], cf[1], cf[2], nf[0], nf[1], nf[2], 1); put(front[a], front[a + 1], front[a + 2], nf[0], nf[1], nf[2], 0.3); put(front[b], front[b + 1], front[b + 2], nf[0], nf[1], nf[2], 0.3);
    const ex = front[b] - front[a], ey = front[b + 1] - front[a + 1], ez = front[b + 2] - front[a + 2], dx = back[a] - front[a], dy = back[a + 1] - front[a + 1], dz = back[a + 2] - front[a + 2];
    let nx = ey * dz - ez * dy, ny = ez * dx - ex * dz, nz = ex * dy - ey * dx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * (front[a] + front[b] - 2 * cf[0]) + ny * (front[a + 1] + front[b + 1] - 2 * cf[1]) + nz * (front[a + 2] + front[b + 2] - 2 * cf[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    put(front[a], front[a + 1], front[a + 2], nx, ny, nz, -1); put(back[a], back[a + 1], back[a + 2], nx, ny, nz, -1.5); put(front[b], front[b + 1], front[b + 2], nx, ny, nz, -1);
    put(front[b], front[b + 1], front[b + 2], nx, ny, nz, -1); put(back[a], back[a + 1], back[a + 2], nx, ny, nz, -1.5); put(back[b], back[b + 1], back[b + 2], nx, ny, nz, -1.5);
    if (cb) { put(cb[0], cb[1], cb[2], -nf[0], -nf[1], -nf[2], 1); put(back[b], back[b + 1], back[b + 2], -nf[0], -nf[1], -nf[2], 1); put(back[a], back[a + 1], back[a + 2], -nf[0], -nf[1], -nf[2], 1); }
  }
  return o;
}
/** how a shard of a sheet sits: its face tilted a little, set a little proud or shy, a tone of its own */
export function seat(sheet: number, k: number) {
  const u = (j: number) => hash(sheet, k, j) / 4294967296;
  return { tx: (u(1) - 0.5) * 0.1, ty: (u(2) - 0.5) * 0.1, dz: (u(3) - 0.5) * 0.08, tone: 0.93 + u(4) * 0.14 };
}
/** a shard's material number: what it is (a hard glaze once struck is crazed), and the palette it's in */
export const matOf = (kind: number, hp: number, pal: number) => (kind === HARD ? (hp > 1 ? MAT.hard : MAT.crazed) : kind === SOFT ? MAT.soft : kind) + 10 * pal;
/** the quarter-round over a tile's rim: its steps (angles from the face round to the side), fine and plain */
const FINE = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2], PLAIN_ = [Math.PI / 2];

/** A sheet as it stands: each tile (face, rounded rim, sides down to the grout) and its bed (the grout's floor, and
 * the slab's walls behind). `fine`: the rim rounded in steps, or (a sheet further off, out of focus) left square. */
function meshOf(sh: Sheet, pal: number, fine: boolean): Float32Array {
  const steps = fine ? FINE : PLAIN_, per = 3 + (steps.length - 1) * 6 + 6 + 3 + 6;
  let verts = 0;
  for (const d of sh.shards) if (d.hp) verts += (d.outline.length / 2) * per;
  const out = new Float32Array(verts * STRIDE);
  let o = 0;
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, tone: number, mat: number, edge: number, hx: number, hy: number) => {
    out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = nx; out[o + 4] = ny; out[o + 5] = nz; out[o + 6] = tone; out[o + 7] = mat; out[o + 8] = edge; out[o + 9] = hx; out[o + 10] = hy; o += STRIDE;
  };
  const front = sh.z - SHEET_T / 2, floor = front + TILE_D, back = sh.z + SHEET_T / 2, gm = MAT.grout + 10 * pal;
  sh.shards.forEach((d, k) => {
    if (!d.hp) return;
    const { tx, ty, dz, tone } = seat(sh.i, k), l = Math.hypot(tx, ty, 1), nf = [tx / l, ty / l, -1 / l], mat = matOf(d.kind, d.hp, pal);
    const hx = Number.isNaN(d.hx) ? NOHIT : d.hx, hy = Number.isNaN(d.hy) ? NOHIT : d.hy;
    const struck = hx !== NOHIT, kx = struck ? (hx - d.cx) * 0.05 : 0, ky = struck ? (hy - d.cy) * 0.05 : 0, sink = struck ? 0.05 : 0;
    const ol = d.outline, n = ol.length / 2, rb = fine ? Math.min(0.2, d.r * 0.25) : 0;
    const faceZ = (x: number, y: number) => front + dz + sink + (tx + kx) * (x - d.cx) + (ty + ky) * (y - d.cy);
    // each corner's way out (the halving of its two edges' outward normals), and how far along it a unit inset goes
    const ox: number[] = [], oy: number[] = [], ok: number[] = [];
    for (let j = 0; j < n; j++) {
      const p = (j + n - 1) % n, q = (j + 1) % n;
      let e0x = ol[j * 2] - ol[p * 2], e0y = ol[j * 2 + 1] - ol[p * 2 + 1], e1x = ol[q * 2] - ol[j * 2], e1y = ol[q * 2 + 1] - ol[j * 2 + 1];
      const l0 = Math.hypot(e0x, e0y) || 1, l1 = Math.hypot(e1x, e1y) || 1; e0x /= l0; e0y /= l0; e1x /= l1; e1y /= l1;
      let bx = e0y + e1y, by = -e0x - e1x;
      const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      const mx = ol[j * 2] - d.cx, my = ol[j * 2 + 1] - d.cy;
      if (bx * mx + by * my < 0) { const ml = Math.hypot(mx, my) || 1; bx = mx / ml; by = my / ml; }
      ox.push(bx); oy.push(by); ok.push(Math.min(2, 1 / Math.max(0.35, bx * e0y - by * e0x)));
    }
    // the rings round the rim, from the face's edge to the top of the side
    const rings = steps.map((th) => {
      const inset = rb * (1 - Math.sin(th)), deep = rb * (1 - Math.cos(th)), c = Math.cos(th), s = Math.sin(th), e = fine ? 0.12 * (1 - th / (Math.PI / 2)) : 0.12;
      return Array.from({ length: n }, (_, j) => {
        const x = ol[j * 2] - ox[j] * inset * ok[j], y = ol[j * 2 + 1] - oy[j] * inset * ok[j];
        const nx = nf[0] * c + ox[j] * s, ny = nf[1] * c + oy[j] * s, nz = nf[2] * c, nl = Math.hypot(nx, ny, nz);
        return { x, y, z: faceZ(x, y) + deep, nx: nx / nl, ny: ny / nl, nz: nz / nl, e };
      });
    });
    const face = rings[0], top = rings[rings.length - 1], cz = faceZ(d.cx, d.cy);
    for (let j = 0; j < n; j++) {
      const q = (j + 1) % n;
      // the face
      put(d.cx, d.cy, cz, nf[0], nf[1], nf[2], tone, mat, 1, hx, hy);
      put(face[j].x, face[j].y, face[j].z, nf[0], nf[1], nf[2], tone, mat, 0.12, hx, hy);
      put(face[q].x, face[q].y, face[q].z, nf[0], nf[1], nf[2], tone, mat, 0.12, hx, hy);
      // the rim, rounded over
      for (let r = 0; r + 1 < rings.length; r++) {
        const a = rings[r], b = rings[r + 1], v = (p: typeof a[0]) => put(p.x, p.y, p.z, p.nx, p.ny, p.nz, tone, mat, p.e, hx, hy);
        v(a[j]); v(b[j]); v(a[q]); v(a[q]); v(b[j]); v(b[q]);
      }
      // the side, down into the grout
      const s0 = top[j], s1 = top[q];
      put(s0.x, s0.y, s0.z, ox[j], oy[j], 0, tone, mat, -1, hx, hy); put(s0.x, s0.y, floor, ox[j], oy[j], 0, tone, mat, -2, hx, hy); put(s1.x, s1.y, s1.z, ox[q], oy[q], 0, tone, mat, -1, hx, hy);
      put(s1.x, s1.y, s1.z, ox[q], oy[q], 0, tone, mat, -1, hx, hy); put(s0.x, s0.y, floor, ox[j], oy[j], 0, tone, mat, -2, hx, hy); put(s1.x, s1.y, floor, ox[q], oy[q], 0, tone, mat, -2, hx, hy);
      // the bed: the grout's floor, and the slab's wall behind (shown where the next tile's gone)
      const bd = d.bed, ax = bd[j * 2], ay = bd[j * 2 + 1], bx = bd[q * 2], by = bd[q * 2 + 1];
      put(d.cx, d.cy, floor + 0.01, 0, 0, -1, 1, gm, 1, NOHIT, NOHIT); put(ax, ay, floor + 0.01, 0, 0, -1, 1, gm, 0, NOHIT, NOHIT); put(bx, by, floor + 0.01, 0, 0, -1, 1, gm, 0, NOHIT, NOHIT);
      let wx = by - ay, wy = -(bx - ax);
      const wl = Math.hypot(wx, wy) || 1; wx /= wl; wy /= wl;
      put(ax, ay, floor + 0.01, wx, wy, 0, 1, gm, -1, NOHIT, NOHIT); put(ax, ay, back, wx, wy, 0, 1, gm, -2, NOHIT, NOHIT); put(bx, by, floor + 0.01, wx, wy, 0, 1, gm, -1, NOHIT, NOHIT);
      put(bx, by, floor + 0.01, wx, wy, 0, 1, gm, -1, NOHIT, NOHIT); put(ax, ay, back, wx, wy, 0, 1, gm, -2, NOHIT, NOHIT); put(bx, by, back, wx, wy, 0, 1, gm, -2, NOHIT, NOHIT);
    }
  });
  return o === out.length ? out : out.subarray(0, o);
}
function sphere(seg = 22, rings = 14): Float32Array {
  // (faceted, like everything else: each face its own normal)
  const out: number[] = [];
  const p = (i: number, j: number) => { const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const q = [p(i, j), p(i + 1, j + 1), p(i + 1, j), p(i, j), p(i, j + 1), p(i + 1, j + 1)];
    const nm = [0, 1, 2].map((k) => (q[0][k] + q[1][k] + q[2][k]) / 3), l = Math.hypot(...nm);
    const nm2 = [0, 1, 2].map((k) => (q[3][k] + q[4][k] + q[5][k]) / 3), l2 = Math.hypot(...nm2);
    q.forEach((v, t) => out.push(...v, ...(t < 3 ? nm.map((x) => x / l) : nm2.map((x) => x / l2)), 1, MAT.ball, 1, NOHIT, NOHIT));
  }
  return new Float32Array(out);
}

/** The eye's matrix: at (ex, ey, ez) looking down +z, the world's +x the screen's right, +y up; the pane, EYE_BACK
 * ahead, exactly filling the screen (W across, H up). */
function eyeMatrix(W: number, ex: number, ey: number, ez: number): Float32Array {
  const fx = EYE_BACK / (W / 2), fy = EYE_BACK / (H / 2), m = new Float32Array(16);
  const A = (FAR + NEAR) / (FAR - NEAR), B = (-2 * FAR * NEAR) / (FAR - NEAR);
  m[0] = fx; m[12] = -ex * fx; m[5] = fy; m[13] = -ey * fy; m[10] = A; m[14] = -ez * A + B; m[11] = 1; m[15] = -ez;
  return m;
}
/** The light's matrix: looking along the way the light goes, at a box round `c` (half-sizes `r` across, `deep` along). */
function lightMatrix(dir: number[], c: number[], r: number, deep: number): Float32Array {
  const f = dir, rl = Math.hypot(f[2], f[0]), right = [f[2] / rl, 0, -f[0] / rl];
  const up = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  const m = new Float32Array(16), row = (k: number, a: number[], s: number) => { m[k] = a[0] * s; m[4 + k] = a[1] * s; m[8 + k] = a[2] * s; m[12 + k] = -(a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) * s; };
  row(0, right, 1 / r); row(1, up, 1 / r); row(2, f, 1 / deep); m[15] = 1;
  return m;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const g0 = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!g0) return null;
  const g: WebGL2RenderingContext = g0;
  const program = (vs: string, fs: string, names: string[]) => {
    const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = g.createProgram()!;
    g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(p) ?? 'link');
    return { p, u: Object.fromEntries(names.map((k) => [k, g.getUniformLocation(p, k)])) };
  };
  const ripple = ['u_hits', 'u_hitA', 'u_now'];
  const main = program(VERT, FRAG, ['u_vp', 'u_light', 'u_bend', 'u_z', 'u_model', 'u_squash', 'u_eye', 'u_toLight', 'u_skyTop', 'u_skyLow', 'u_sun', 'u_res', 'u_alpha', 'u_shadow', 'u_ballPal', 'u_body', 'u_fired', 'u_soft', 'u_hard', 'u_clay', 'u_ball', ...ripple]);
  const depth = program(DEPTH_VERT, DEPTH_FRAG, ['u_light', 'u_bend', 'u_z', 'u_model', ...ripple]);
  const sky = program(SKY_VERT, SKY_FRAG, ['u_skyTop', 'u_skyLow', 'u_sun', 'u_aspect']);
  const sprite = program(SPRITE_VERT, SPRITE_FRAG, ['u_vp', 'u_bend', 'u_z']);
  const lens = program(SKY_VERT, LENS_FRAG, ['u_col', 'u_dep', 'u_px', 'u_A', 'u_B', 'u_focus', 'u_span', 'u_maxR', 'u_seed']);
  // (the palettes, once)
  g.useProgram(main.p);
  for (const key of ['body', 'fired', 'soft', 'hard', 'clay', 'ball'] as const) g.uniform3fv(main.u[`u_${key}`], PALETTES.flatMap((p) => p[key]));

  const solid = (usage: number) => {
    const vao = g.createVertexArray()!, buf = g.createBuffer()!;
    g.bindVertexArray(vao); g.bindBuffer(g.ARRAY_BUFFER, buf);
    [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 2, 36]].forEach(([loc, n, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, n, g.FLOAT, false, STRIDE * 4, off); });
    return { vao, buf, n: 0, ver: -1, pal: -1, fine: false, usage };
  };
  const fill = (m: ReturnType<typeof solid>, data: Float32Array, floats = data.length) => { g.bindBuffer(g.ARRAY_BUFFER, m.buf); g.bufferData(g.ARRAY_BUFFER, data.subarray(0, floats), m.usage); m.n = floats / STRIDE; };
  const ball = solid(g.STATIC_DRAW); fill(ball, sphere());
  const frags = solid(g.DYNAMIC_DRAW);
  const sheets = new Map<number, ReturnType<typeof solid>>();
  const spriteVao = g.createVertexArray()!, spriteBuf = g.createBuffer()!;
  g.bindVertexArray(spriteVao); g.bindBuffer(g.ARRAY_BUFFER, spriteBuf);
  [[0, 3, 0], [1, 2, 12], [2, 4, 20]].forEach(([loc, n, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, n, g.FLOAT, false, SPRITE * 4, off); });
  const skyVao = g.createVertexArray()!;

  const tex = (w: number, h: number, inner: number, format: number, type: number, filter: number) => {
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, inner, w, h, 0, format, type, null);
    for (const [k, v] of [[g.TEXTURE_MIN_FILTER, filter], [g.TEXTURE_MAG_FILTER, filter], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v);
    return t;
  };
  // the light's own view of things, for what it can't reach
  const SHADOW = 2048, shadowTex = tex(SHADOW, SHADOW, g.DEPTH_COMPONENT24, g.DEPTH_COMPONENT, g.UNSIGNED_INT, g.LINEAR), shadowFbo = g.createFramebuffer()!;
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_MODE, g.COMPARE_REF_TO_TEXTURE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_FUNC, g.LEQUAL);
  g.bindFramebuffer(g.FRAMEBUFFER, shadowFbo);
  g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, shadowTex, 0);
  g.drawBuffers([g.NONE]); g.readBuffer(g.NONE);

  // what you see, drawn first to these: antialiased if the device can, then resolved to textures for the lens
  const samples = Math.min(4, g.getParameter(g.MAX_SAMPLES) as number);
  let tw = 0, th = 0, msFbo: WebGLFramebuffer | null = null, rbs: WebGLRenderbuffer[] = [], colTex: WebGLTexture | null = null, depTex: WebGLTexture | null = null, resFbo: WebGLFramebuffer | null = null;
  function targets(w: number, h: number) {
    if (w === tw && h === th) return;
    tw = w; th = h;
    for (const r of rbs) g.deleteRenderbuffer(r);
    if (msFbo) g.deleteFramebuffer(msFbo);
    if (resFbo) g.deleteFramebuffer(resFbo);
    if (colTex) g.deleteTexture(colTex);
    if (depTex) g.deleteTexture(depTex);
    colTex = tex(w, h, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, g.LINEAR);
    depTex = tex(w, h, g.DEPTH_COMPONENT24, g.DEPTH_COMPONENT, g.UNSIGNED_INT, g.NEAREST);
    resFbo = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, resFbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, colTex, 0);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, depTex, 0);
    msFbo = null; rbs = [];
    if (samples > 1) {
      const c = g.createRenderbuffer()!, d = g.createRenderbuffer()!;
      g.bindRenderbuffer(g.RENDERBUFFER, c); g.renderbufferStorageMultisample(g.RENDERBUFFER, samples, g.RGBA8, w, h);
      g.bindRenderbuffer(g.RENDERBUFFER, d); g.renderbufferStorageMultisample(g.RENDERBUFFER, samples, g.DEPTH_COMPONENT24, w, h);
      msFbo = g.createFramebuffer()!; rbs = [c, d];
      g.bindFramebuffer(g.FRAMEBUFFER, msFbo);
      g.framebufferRenderbuffer(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.RENDERBUFFER, c);
      g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, d);
      if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) { g.deleteFramebuffer(msFbo); msFbo = null; }
    }
  }

  // (the light goes this way: from behind your left shoulder, and above)
  const dl = Math.hypot(0.4, -0.45, 1), going = [0.4 / dl, -0.45 / dl, 1 / dl], toLight = going.map((v) => -v);
  let frame = 0;
  const hitsU = (p: typeof main | typeof depth, f: Frame) => { g.uniform4fv(p.u.u_hits, f.hits); g.uniform1fv(p.u.u_hitA, f.hitA); g.uniform1f(p.u.u_now, f.now); };

  return {
    gl: g,
    samples,
    render(f: Frame) {
      const w = canvas.width, h = canvas.height;
      targets(w, h);
      // the sheets as they stand: a mesh each, made again when a tile of it changes (or it comes near), dropped behind
      const here = new Set<number>();
      for (const sh of f.sheets) {
        here.add(sh.i);
        let m = sheets.get(sh.i);
        if (!m) { m = solid(g.DYNAMIC_DRAW); sheets.set(sh.i, m); }
        const pal = f.palOf(sh.i), fine = sh.i <= f.nearest + 1;
        if (m.ver !== sh.ver || m.pal !== pal || m.fine !== fine) { fill(m, meshOf(sh, pal, fine)); m.ver = sh.ver; m.pal = pal; m.fine = fine; }
      }
      for (const [i, m] of sheets) if (!here.has(i)) { g.deleteBuffer(m.buf); g.deleteVertexArray(m.vao); sheets.delete(i); }
      fill(frags, f.frags, f.fragVerts * STRIDE);
      const eye = [f.shake[0], f.shake[1], f.z - EYE_BACK];
      const vp = eyeMatrix(f.W, eye[0], eye[1], eye[2]);
      const reach = Math.max(f.W, H) * 0.85 + 26, light = lightMatrix(going, [0, 0, f.z + 30], reach, 70);
      const solids = (p: typeof main | typeof depth) => {
        g.uniform4f(p.u.u_model, 0, 0, 0, 1);
        if (p === main) g.uniform4f(main.u.u_squash, 0, 0, 0, 0);
        for (const m of sheets.values()) if (m.n) { g.bindVertexArray(m.vao); g.drawArrays(g.TRIANGLES, 0, m.n); }
        if (frags.n) { g.bindVertexArray(frags.vao); g.drawArrays(g.TRIANGLES, 0, frags.n); }
        if (f.ballOn) {
          g.uniform4f(p.u.u_model, f.ball[0], f.ball[1], f.ball[2], R);
          if (p === main) g.uniform4fv(main.u.u_squash, f.squash);
          g.bindVertexArray(ball.vao); g.drawArrays(g.TRIANGLES, 0, ball.n);
        }
      };
      g.enable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.depthFunc(g.LESS); g.depthMask(true); g.disable(g.BLEND);
      // what the light sees
      g.bindFramebuffer(g.FRAMEBUFFER, shadowFbo); g.viewport(0, 0, SHADOW, SHADOW); g.clear(g.DEPTH_BUFFER_BIT);
      g.useProgram(depth.p);
      g.uniformMatrix4fv(depth.u.u_light, false, light); g.uniform2fv(depth.u.u_bend, f.bend); g.uniform1f(depth.u.u_z, f.z); hitsU(depth, f);
      g.enable(g.POLYGON_OFFSET_FILL); g.polygonOffset(2, 4);
      solids(depth);
      g.disable(g.POLYGON_OFFSET_FILL);
      // what you see: the sky, then the solids, then what's see-through
      g.bindFramebuffer(g.FRAMEBUFFER, msFbo ?? resFbo); g.viewport(0, 0, w, h); g.clear(g.DEPTH_BUFFER_BIT);
      g.useProgram(sky.p); g.depthMask(false); g.disable(g.DEPTH_TEST);
      g.uniform3fv(sky.u.u_skyTop, f.skyTop); g.uniform3fv(sky.u.u_skyLow, f.skyLow); g.uniform3fv(sky.u.u_sun, f.sun); g.uniform1f(sky.u.u_aspect, w / h);
      g.bindVertexArray(skyVao); g.drawArrays(g.TRIANGLES, 0, 3);
      g.enable(g.DEPTH_TEST); g.depthMask(true);
      g.useProgram(main.p);
      g.uniformMatrix4fv(main.u.u_vp, false, vp); g.uniformMatrix4fv(main.u.u_light, false, light);
      g.uniform2fv(main.u.u_bend, f.bend); g.uniform1f(main.u.u_z, f.z); g.uniform3fv(main.u.u_eye, eye); g.uniform3fv(main.u.u_toLight, toLight);
      g.uniform3fv(main.u.u_skyTop, f.skyTop); g.uniform3fv(main.u.u_skyLow, f.skyLow); g.uniform3fv(main.u.u_sun, f.sun);
      g.uniform2f(main.u.u_res, w, h); g.uniform1f(main.u.u_alpha, 1); g.uniform1f(main.u.u_ballPal, f.ballPal); hitsU(main, f);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, shadowTex); g.uniform1i(main.u.u_shadow, 0);
      solids(main);
      g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA); g.depthMask(false);
      if (f.ballOn) {
        // (the ball again where it's hidden, faint)
        g.depthFunc(g.GREATER); g.uniform1f(main.u.u_alpha, 0.38);
        g.uniform4f(main.u.u_model, f.ball[0], f.ball[1], f.ball[2], R); g.uniform4fv(main.u.u_squash, f.squash); g.bindVertexArray(ball.vao); g.drawArrays(g.TRIANGLES, 0, ball.n);
        g.depthFunc(g.LESS);
      }
      if (f.spriteVerts) {
        g.useProgram(sprite.p);
        g.uniformMatrix4fv(sprite.u.u_vp, false, vp); g.uniform2fv(sprite.u.u_bend, f.bend); g.uniform1f(sprite.u.u_z, f.z);
        g.bindVertexArray(spriteVao); g.bindBuffer(g.ARRAY_BUFFER, spriteBuf); g.bufferData(g.ARRAY_BUFFER, f.sprites.subarray(0, f.spriteVerts * SPRITE), g.DYNAMIC_DRAW);
        g.drawArrays(g.TRIANGLES, 0, f.spriteVerts);
      }
      g.depthMask(true); g.disable(g.BLEND);
      // resolved, and through the lens onto the screen
      if (msFbo) {
        g.bindFramebuffer(g.READ_FRAMEBUFFER, msFbo); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, resFbo);
        g.blitFramebuffer(0, 0, w, h, 0, 0, w, h, g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT, g.NEAREST);
      }
      g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, w, h); g.disable(g.DEPTH_TEST);
      g.useProgram(lens.p);
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, colTex); g.uniform1i(lens.u.u_col, 1);
      g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, depTex); g.uniform1i(lens.u.u_dep, 2);
      g.activeTexture(g.TEXTURE0);
      g.uniform2f(lens.u.u_px, 1 / w, 1 / h); g.uniform1f(lens.u.u_A, (FAR + NEAR) / (FAR - NEAR)); g.uniform1f(lens.u.u_B, (-2 * FAR * NEAR) / (FAR - NEAR));
      g.uniform1f(lens.u.u_focus, f.focus); g.uniform1f(lens.u.u_span, 26); g.uniform1f(lens.u.u_maxR, h * 0.011); g.uniform1f(lens.u.u_seed, (frame++ % 64) * 7.3);
      g.bindVertexArray(skyVao); g.drawArrays(g.TRIANGLES, 0, 3);
      g.enable(g.DEPTH_TEST);
    },
    stats: () => ({ sheets: sheets.size, verts: [...sheets.values()].reduce((n, m) => n + m.n, 0) + frags.n, samples: msFbo ? samples : 0 }),
  };
}
