/** One analytic choppy surface for buoyancy and GLSL. The second harmonic narrows
 * crests and broadens troughs; derivatives are generated from the identical terms. */
export * from '../rescue/sea';
import {heightAt,type Sea} from '../rescue/sea';
export const COAST_WAVES=[
 [.8,.6,23,.43,0],[-.45,.893,13,.23,1.7],[.97,-.243,7.5,.10,4.1],
 [-.2,-.98,4.2,.045,2.3],[.64,.768,3.1,.023,.8]
];
export function waveAt(sea:Sea|null,x:number,z:number,t:number):[number,number,number]{
 const u=sea?Math.max(0,Math.min(1,(-heightAt(sea,x,z)-.4)/4.1)):1,calm=u*u*(3-2*u);
 let y=0,dx=0,dz=0;
 for(const [ax,az,wl,a,ph] of COAST_WAVES){
  const k=2*Math.PI/wl,q=k*(ax*x+az*z)-Math.sqrt(9.81*k)*t+ph;
  y+=a*calm*(Math.sin(q)-.22*Math.cos(2*q));
  const slope=a*calm*k*(Math.cos(q)+.44*Math.sin(2*q));dx+=slope*ax;dz+=slope*az;
 }
 return [y,dx,dz];
}
export function wavesGlsl(){
 const f=(n:number)=>n.toFixed(9);
 return `vec3 waves(vec2 p,float t,float calm){vec3 h=vec3(0.);float q;\n`+COAST_WAVES.map(([ax,az,wl,a,ph])=>{
  const k=2*Math.PI/wl;
  return `q=${f(k)}*dot(vec2(${f(ax)},${f(az)}),p)-${f(Math.sqrt(9.81*k))}*t+${f(ph)};
 h+=${f(a)}*calm*vec3(sin(q)-.22*cos(2.*q),${f(k*ax)}*(cos(q)+.44*sin(2.*q)),${f(k*az)}*(cos(q)+.44*sin(2.*q)));`;
 }).join('\n')+'\nreturn h;}';
}
