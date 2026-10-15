/** Contact-driven Taohua arms. All inputs share the torso's local frame. */
export type V = [number, number, number];
export const add = (a: V, b: V): V => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub = (a: V, b: V): V => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale = (a: V, k: number): V => [a[0]*k,a[1]*k,a[2]*k];
export const dot = (a: V, b: V) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const length = (a: V) => Math.hypot(...a);
export const unit = (a: V): V => scale(a,1/(length(a)||1));
export const shoulder = (side: number): V => [side*.18,1.27,0];
export const ARM = .34;
/** Exact two-bone solve. Callers keep targets reachable; no stretching. */
export function elbow(s: V, hand: V, side: number): V {
  const d = sub(hand,s), n = unit(d), l = Math.min(ARM*2-.0001,length(d));
  const hint: V = [side*.12,-1,-.08];
  const bend = unit(sub(hint,scale(n,dot(hint,n))));
  return add(add(s,scale(n,l*.5)),scale(bend,Math.sqrt(Math.max(0,ARM*ARM-l*l*.25))));
}
export function clearance(a: V, b: V, centre: V): number {
  const ab=sub(b,a), t=Math.max(0,Math.min(1,dot(sub(centre,a),ab)/(dot(ab,ab)||1)));
  return length(sub(add(a,scale(ab,t)),centre));
}
export interface Shaft { tip: V; top: V; right: V; left: V; valid: boolean; clearance: number }
/** Search a small natural grip envelope, keeping the entire shaft outside the hat's swept sphere. */
export function shaft(tip: V, desired: V, size: number, twoHands: boolean, head: V): Shaft {
  let best: Shaft | null = null;
  for (let k=0;k<8;k++) {
    const grip: V=[desired[0]+k*.02,desired[1],desired[2]], axis=unit(sub(grip,tip));
    const top=add(tip,scale(axis,size));
    const right=twoHands?sub(grip,scale(axis,.28)):grip, left=grip;
    const gap=clearance(tip,top,head);
    const valid=gap>.49 && length(sub(right,shoulder(1)))<ARM*2-.015 && (!twoHands || length(sub(left,shoulder(-1)))<ARM*2-.015) && length(sub(grip,tip))<size-.15;
    const p={tip,top,right,left,valid,clearance:gap};
    if(valid) return p;
    if(!best || gap>best.clearance) best=p;
  }
  return best!;
}
