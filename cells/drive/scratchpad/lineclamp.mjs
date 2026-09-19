// The kernel's `across`, replayed on a segment from (0,0) to (100,0), hw 7.
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const ax=0,az=0,bx=100,bz=0,hw=7;
const dx=bx-ax, dz=bz-az, L=Math.hypot(dx,dz);
const row=(x,z)=>{
  const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);
  const px=ax+dx*t, pz=az+dz*t;
  const kernelAcross=Math.abs((dx*(z-pz)-dz*(x-px))/L);   // the shipped rule
  const trueAcross=Math.hypot(x-px,z-pz);                  // distance to the SEGMENT
  return {at:`(${x},${z})`,t:+t.toFixed(2),kernelAcross:+kernelAcross.toFixed(2),
    trueAcross:+trueAcross.toFixed(2),
    kernelConsiders:kernelAcross-hw<=3, trueConsiders:trueAcross-hw<=3};
};
console.table([row(50,2),row(100,2),row(120,2),row(160,2),row(300,2),row(160,30)]);
