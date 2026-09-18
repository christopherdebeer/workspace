import * as THREE from 'three';
import {wildlifeMeshes,hip,LEG} from './wildlife-models';
import {tracePath,habitable,random,seedString,gaitFoot,type SampleSupport} from './wildlife-motion';

interface Environment {
  camera: THREE.Camera; scene: THREE.Scene;
  truck: () => {x:number;z:number;speed:number;heading:number};
  sample: SampleSupport;
  ground: (x:number,z:number) => number | null;
  clear: (ax:number,az:number,bx:number,bz:number,y:number) => boolean;
  rain: (x:number,z:number) => number;
  species: (air:boolean,x:number,z:number,r:number) => number;
  worldKey: () => string;
  shadow: (mesh:THREE.InstancedMesh) => void;
  pixelHeight: () => number;
}
interface Foot {x:number;y:number;z:number;stance:boolean;sampleAt:number}
export interface Critter {
  id:number;seed:number;sp:number;grp:number;sz:number;tint:THREE.Color;
  x:number;y:number;z:number;vx:number;vy:number;vz:number;ph:number;
  active:boolean;yaw:number;bank:number;seen:number;nextPlan:number;
  turn:number;safeSpeed:number;wet:number;nextSpawn:number;cycle:number;
  feet:Foot[];lastNear:boolean;nextSeat:number;stuckSince:number;
}
const ALT=[34,22,58], BOX=[560,820], N=[30,52], GROUPS=[3,4];
export const HERD_CLEAR=4.8;
/** A herd animal may be born INSIDE the frustum from this far: at PIX_H 320 a
 *  1 m animal at 300 m is two art pixels, a bison three — a dot on the far
 *  field, not a pop. Below the 364 m recycle radius so it is not reclaimed the
 *  frame it arrives. The clearance test reads the same number. */
export const HERD_DOT_M=300;
/** The first spawn after a hop is an ARRIVAL: the wedge is empty, nothing was
 *  on the glass, so the herd is placed in view beside the road ahead. */
const ARRIVAL_S=12;
/** An animal refused its sweep for this long while nobody is looking is
 *  standing where the ground changed under it — respawn it somewhere it can
 *  walk. A watched one stays (a vanish is a pop too). */
const STUCK_S=3;
export function createWildlife(env:Environment) {
  const birdMeshes=wildlifeMeshes(true,N[1]),herds=wildlifeMeshes(false,N[0]);
  for(const m of [...birdMeshes,...herds]) env.scene.add(m);
  for(const m of herds) env.shadow(m);
  const birds={get visible(){return birdMeshes[0].visible;},set visible(v:boolean){for(const m of birdMeshes)m.visible=v;}};
  const flock:Critter[]=[],graze:Critter[]=[];
  let time=0,initialized=false,closest=Infinity,climatePending=false,arrivalUntil=0;
  const frustum=new THREE.Frustum(),vp=new THREE.Matrix4(),sphere=new THREE.Sphere(),dummy=new THREE.Object3D();
  dummy.rotation.order='YXZ';
  const stats={steps:0,samples:0,blocked:0,recycles:0,spawnAttempts:0,footSamples:0,constrainedClearance:0,ms:0,
    // Why a spawn attempt was refused, so the seat can tell an empty plain from a herd that is there and unseen.
    refused:{noGround:0,unhabitable:0,trace:0,rain:0,seen:0,truck:0},spawned:0,
    // Where herd animals were born: in view on arrival, a dot ahead, a flank outside the wedge.
    born:{arrival:0,dot:0,flank:0,bird:0},reseated:0,stuckRecycled:0,
    // Which check of the per-frame sweep stopped an animal (a frozen herd is one of these, every frame).
    stoppedBy:{} as Record<string,number>};
  const sample:SampleSupport=(...args)=>{stats.samples++;return env.sample(...args);};
  const trace=(c:Critter,x:number,z:number)=>tracePath(sample,c,x,z,env.clear);
  const seen=(x:number,y:number,z:number,r=3)=>{
    sphere.center.set(x,y,z);sphere.radius=r;
    return sphere.center.distanceToSquared(env.camera.position)<45*45 || frustum.intersectsSphere(sphere);
  };
  const tint=(c:Critter,air:boolean)=>{
    const rng=random(Math.floor(c.seed*0xffffff)+73);
    if(air)c.tint.setHSL([.58,.62,.07][c.sp],[.07,.17,.38][c.sp],([.88,.16,.38][c.sp])*(.88+rng()*.22));
    else c.tint.setHSL(.08+rng()*.035,.13+rng()*.12,.44+rng()*.14).multiplyScalar(1.45);
  };
  function initialize(){
    const seed=seedString(env.worldKey()),truck=env.truck();
    for(const air of [false,true]){
      const k=+air,pop=air?flock:graze, species=Array.from({length:GROUPS[k]},(_,g)=>env.species(air,truck.x,truck.z,random(seed+g*713+k*5731)()));
      for(let i=0;i<N[k];i++){
        const rng=random(seed+i*1777+k*7981),s=rng();
        const c:Critter={id:i,seed:rng(),sp:species[i%GROUPS[k]],grp:i%GROUPS[k],sz:air?.78+s*.5:.72+s*s*.62,
          tint:new THREE.Color(),x:truck.x,y:0,z:truck.z,vx:(rng()-.5)*6,vy:0,vz:(rng()-.5)*6,ph:rng()*Math.PI*2,
          active:false,yaw:0,bank:0,seen:-100,nextPlan:rng()*.2,turn:0,safeSpeed:22,wet:0,nextSpawn:0,cycle:0,
          feet:[],lastNear:false,nextSeat:0,stuckSince:-1};
        // seed is a [0,1) shader attribute; retain its bits for deterministic choices.
        c.seed=Math.floor(c.seed*0xffffff)/0xffffff;tint(c,air);pop.push(c);
      }
    }
    initialized=true;arrivalUntil=time+ARRIVAL_S;
  }
  /** Half the horizontal field of view: the wedge the seat can see. */
  const halfH=()=>{const cam=env.camera as THREE.PerspectiveCamera;const fov=(cam.fov??55)*Math.PI/360;return Math.atan(Math.tan(fov)*(cam.aspect??.5));};
  function spawn(c:Critter,air:boolean,recycle:boolean):boolean{
    if(time<c.nextSpawn)return false;
    c.nextSpawn=time+.7+(c.id%5)*.09;
    const k=+air,rng=random(((c.seed*0xffffff)|0) ^ (++c.cycle)*11779),truck=env.truck();
    const centre=env.camera.position;
    const arrival=!air&&time<arrivalUntil;
    for(let attempt=0;attempt<12;attempt++){
      stats.spawnAttempts++;
      let x:number,z:number,kind:'arrival'|'dot'|'flank'|'bird';
      if(air){
        // Birds keep their world sectors: they cross the sky on their own.
        const groupAngle=c.grp*Math.PI*2/GROUPS[k]+.45;
        const radius=BOX[k]*(.18+rng()*.24),angle=groupAngle+(rng()-.5)*1.25;
        x=centre.x+Math.sin(angle)*radius;z=centre.z+Math.cos(angle)*radius;kind='bird';
      }else{
        // THE HERD IS BORN IN THE TRUCK'S FRAME, NOT THE WORLD'S. A point outside
        // the wedge never enters it under forward motion (its bearing only
        // grows), so a world-fixed sector is a herd you meet only on a bend.
        // Three sectors instead: ARRIVAL (the first seconds after a hop, in view
        // beside the road ahead — the wedge was empty, nothing pops), DOT (ahead
        // inside the wedge but beyond HERD_DOT_M, where it is two art pixels
        // and grows as you drive up), FLANK (just outside the wedge, ahead of
        // abeam, found by a turn of the wheel or of the head).
        const hx=Math.sin(truck.heading),hz=-Math.cos(truck.heading),wedge=halfH();
        // One sector per GROUP (cohesion must not drag a group across the
        // road), and the sectors rotate among the groups every 90 s so the
        // species ahead is not always the same one.
        const role=(c.grp+Math.floor(time/90))%3;
        // The sector is tight for the first attempts and opens out after: a
        // road along a cliff has no field 300 m ahead and no flank inland, and
        // a herd that cannot be born anywhere is a herd left a kilometre back.
        // The last attempts are the old wide ring, any bearing the gate allows.
        const wide=attempt>=4,ring=attempt>=8;
        let ahead:number,side:number;
        if(arrival){ahead=40+rng()*70;side=(c.grp-1)*22+(rng()-.5)*16;kind='arrival';}
        else if(ring){const dist=100+rng()*135,bearing=(rng()-.5)*Math.PI*1.6;ahead=Math.cos(bearing)*dist;side=Math.sin(bearing)*dist;kind='flank';}
        else if(role===0){ahead=HERD_DOT_M+rng()*40;side=(rng()<.5?-1:1)*(6+rng()*(wide?64:44));kind='dot';}
        else{const dist=wide?60+rng()*140:70+rng()*60,bearing=(role===1?-1:1)*(wedge+.14+rng()*(wide?1.0:.38));ahead=Math.cos(bearing)*dist;side=Math.sin(bearing)*dist;kind='flank';}
        x=truck.x+hx*ahead-hz*side;z=truck.z+hz*ahead+hx*side;
      }
      const ground=env.ground(x,z);if(ground===null){stats.refused.noGround++;continue;}
      let y=ground+ALT[c.sp];
      if(!air){
        const s=sample(x,z,undefined,[.31,.56,.38][c.sp]*c.sz);
        if(!habitable(s,c.sz,LEG[c.sp])){stats.refused.unhabitable++;continue;}
        const probe={...c,x,y:s.y,z};const check=trace(probe,x+.01,z);
        if(!check.complete){stats.refused.trace++;continue;}y=check.y;
      }else if(env.rain(x,z)>.72){stats.refused.rain++;continue;}
      // No pop: not on the glass, unless it is an arrival or a far dot.
      const exempt=kind==='arrival'||(kind==='dot'&&Math.hypot(x-centre.x,z-centre.z)>=HERD_DOT_M);
      if(!exempt&&seen(x,y+(air?0:1),z,air?3:3*c.sz)){stats.refused.seen++;continue;}
      if(Math.hypot(x-truck.x,z-truck.z)<HERD_CLEAR+8){stats.refused.truck++;continue;}
      c.x=x;c.y=y;c.z=z;c.active=true;c.feet=[];c.lastNear=false;c.vy=0;c.wet=0;
      c.nextPlan=0;c.safeSpeed=22;c.turn=0;c.seen=time-3;c.stuckSince=-1;c.nextSeat=time+.3;
      if(recycle)stats.recycles++;stats.spawned++;stats.born[kind]++;
      return true;
    }
    return false;
  }
  function feet(c:Critter,mesh:THREE.InstancedMesh,index:number,speed:number,rootY:number){
    const distance=Math.max(1,env.camera.position.distanceTo(new THREE.Vector3(c.x,c.y,c.z)));
    const near=env.pixelHeight()*2*c.sz/distance>9;
    const co=Math.cos(c.yaw),si=Math.sin(c.yaw);
    const arrays=[[],[],[]] as number[][];
    for(let l=0;l<4;l++){
      const h=hip(c.sp,l),pose=gaitFoot(c.ph,l,speed,c.sz),localZ=h[2]+pose.z;
      const wx=c.x+(h[0]*co+localZ*si)*c.sz,wz=c.z+(-h[0]*si+localZ*co)*c.sz;
      let f=c.feet[l];
      if(!f){f={x:wx,y:c.y,z:wz,stance:false,sampleAt:0};c.feet[l]=f;}
      if(near){
        if(!pose.stance||!f.stance||!c.lastNear){f.x=wx;f.z=wz;}
        if(time>=f.sampleAt||(!f.stance&&pose.stance)){
          const s=sample(f.x,f.z,c.y,.08);stats.footSamples++;
          f.y=habitable(s,c.sz,LEG[c.sp])&&Math.abs(s.y-c.y)<.45*c.sz?s.y:c.y;
          f.sampleAt=time+.10+(c.id%3)*.015;
        }
        const dx=(f.x-c.x)/c.sz,dz=(f.z-c.z)/c.sz;
        arrays[0].push(dx*co-dz*si);arrays[2].push(dx*si+dz*co);
        arrays[1].push((f.y-rootY)/c.sz+pose.lift);
      }else{arrays[0].push(h[0]);arrays[1].push((c.y-rootY)/c.sz+pose.lift);arrays[2].push(localZ);}
      f.stance=pose.stance;
    }
    c.lastNear=near;
    for(let a=0;a<3;a++)(mesh.geometry.attributes[['aFeetX','aFeetY','aFeetZ'][a]] as THREE.InstancedBufferAttribute).setXYZW(index,...arrays[a] as [number,number,number,number]);
  }
  function stepPop(pop:Critter[],meshes:THREE.InstancedMesh[],air:boolean,dt:number){
    const k=+air,box=BOX[k],base=air?11:2.4,truck=env.truck();
    const groups=Array.from({length:GROUPS[k]},()=>({n:0,x:0,z:0,vx:0,vz:0}));
    for(const c of pop)if(c.active){const g=groups[c.grp];g.n++;g.x+=c.x;g.z+=c.z;g.vx+=c.vx;g.vz+=c.vz;}
    for(const g of groups)if(g.n){g.x/=g.n;g.z/=g.n;g.vx/=g.n;g.vz/=g.n;}
    const counts=[0,0,0];
    for(const c of pop){
      if(!c.active&&!spawn(c,air,false))continue;
      if(seen(c.x,c.y+(air?0:1),c.z,3*c.sz))c.seen=time;
      const offscreen=time-c.seen>1.5;
      const rain=air?env.rain(c.x,c.z):0;c.wet=Math.max(0,c.wet+dt*(rain>.65?1:-2));
      if(offscreen&&(Math.hypot(c.x-env.camera.position.x,c.z-env.camera.position.z)>box*.65||(air&&c.wet>8)))spawn(c,air,true);
      const g=groups[c.grp];
      let ax=g.n?(g.x-c.x)*.06+(g.vx-c.vx)*.35:0,az=g.n?(g.z-c.z)*.06+(g.vz-c.vz)*.35:0;
      const sep=air?7:6;
      for(const d of pop)if(d!==c&&d.active){const dx=c.x-d.x,dz=c.z-d.z,q=dx*dx+dz*dz;
        if(q<sep*sep&&q>1e-4){const len=Math.sqrt(q),f=(sep-len)*.5;ax+=dx/len*f;az+=dz/len*f;}}
      const fx=c.x-truck.x,fz=c.z-truck.z,fd=Math.hypot(fx,fz)||.001,carV=Math.abs(truck.speed);
      const fear=(air?55:24)+carV*(air?.5:2.2),panic=fd<fear?1-fd/fear:0;
      if(panic>0){const hx=Math.sin(truck.heading),hz=-Math.cos(truck.heading),side=Math.sign(fx*-hz+fz*hx)||1,mix=.4+.6*panic;
        const ex=fx/fd*(1-mix)-hz*side*mix,ez=fz/fd*(1-mix)+hx*side*mix,el=Math.hypot(ex,ez)||1,p=panic*panic*base*30;
        ax+=ex/el*p;az+=ez/el*p;if(air)c.vy+=9*dt;}
      c.vx+=ax*dt*(air?1:1.6)*(1+panic*3);c.vz+=az*dt*(air?1:1.6)*(1+panic*3);
      const v=Math.hypot(c.vx,c.vz)||.001,flat=Math.min(Math.max(base*4.5,carV*1.2),air?30:22);
      const want=base+(flat-base)*panic,speed=v+(want-v)*Math.min(1,dt*(2+16*panic));
      c.vx=c.vx/v*speed;c.vz=c.vz/v*speed;
      const oldX=c.x,oldZ=c.z,oldYaw=c.yaw;
      if(!air){
        // RE-SEAT. The ground under a placed animal changes — tiles refine,
        // walls and plots arrive, the substrate contact comes live — and the
        // sweep below refuses a station that no longer matches c.y, forever,
        // because only a complete sweep writes c.y. So the station is read on
        // its own clock: a habitable one re-seats the animal; one that is no
        // longer habitable recycles it once nobody is looking.
        if(time>=c.nextSeat){
          c.nextSeat=time+(offscreen?.6:.25)+(c.id%4)*.03;
          const st=sample(c.x,c.z,c.y,[.31,.56,.38][c.sp]*c.sz);
          if(habitable(st,c.sz,LEG[c.sp])){if(Math.abs(st.y-c.y)>.02){c.y=st.y;c.feet=[];stats.reseated++;}}
          else if(offscreen){if(spawn(c,air,true)){stats.stuckRecycled++;continue;}}
        }
        if(time>=c.nextPlan){
          // An unseen animal plans a third as often: nobody is watching it think.
          c.nextPlan=time+(offscreen?.4:.13)+(c.id%4)*.015;
          const yaw=Math.atan2(c.vx,c.vz),distance=Math.min(16,1.3+speed*.3+speed*speed/24);
          let best=-Infinity,bestTurn=0,bestDistance=0;
          for(const turn of [0,.45,-.45,.95,-.95,1.65,-1.65,Math.PI]){
            const t=trace(c,c.x+Math.sin(yaw+turn)*distance,c.z+Math.cos(yaw+turn)*distance);
            const score=t.travelled-Math.abs(turn)*1.1;
            if(score>best){best=score;bestTurn=turn;bestDistance=t.travelled;}
            if(t.complete && Math.abs(turn)<=.95)break;
          }
          c.turn=bestTurn;c.safeSpeed=Math.sqrt(Math.max(0,bestDistance-.55)*24);
        }
        // Bound the speed by stopping distance, then sweep the actual frame.
        const yaw=Math.atan2(c.vx,c.vz)+c.turn*Math.min(1,dt*7),allowed=Math.min(speed,c.safeSpeed);
        c.vx=Math.sin(yaw)*allowed;c.vz=Math.cos(yaw)*allowed;
        // A standing animal is not swept (its station is read above); a moving
        // one is, and one refused for STUCK_S while unseen is reborn elsewhere.
        if(Math.hypot(c.vx,c.vz)*dt>1e-3){
          const t=trace(c,c.x+c.vx*dt,c.z+c.vz*dt);
          c.x=t.x;c.y=t.y;c.z=t.z;
          if(!t.complete){c.vx=0;c.vz=0;stats.blocked++;const w=t.why??'?';stats.stoppedBy[w]=(stats.stoppedBy[w]??0)+1;
            if(c.stuckSince<0)c.stuckSince=time;
            else if(offscreen&&time-c.stuckSince>STUCK_S&&spawn(c,air,true)){stats.stuckRecycled++;continue;}
          }else c.stuckSince=-1;
        }else if(c.safeSpeed<.05){
          // Planned to a standstill: every direction refused. Stuck by the plan.
          if(c.stuckSince<0)c.stuckSince=time;
          else if(offscreen&&time-c.stuckSince>STUCK_S&&spawn(c,air,true)){stats.stuckRecycled++;continue;}
        }else c.stuckSince=-1;
        let d=Math.hypot(c.x-truck.x,c.z-truck.z);
        if(d<HERD_CLEAR){
          let rescued=false;
          const hx=Math.sin(truck.heading),hz=-Math.cos(truck.heading),side=Math.sign((c.x-truck.x)*-hz+(c.z-truck.z)*hx)||1;
          for(const flank of [side,-side]){
            const tx=truck.x-hz*flank*(HERD_CLEAR+.05),tz=truck.z+hx*flank*(HERD_CLEAR+.05),escape=trace(c,tx,tz);
            if(escape.complete){c.x=escape.x;c.y=escape.y;c.z=escape.z;c.feet=[];rescued=true;break;}
          }
          if(!rescued)stats.constrainedClearance++;
          d=Math.hypot(c.x-truck.x,c.z-truck.z);
        }
        closest=Math.min(closest,d);
        const moved=Math.hypot(c.x-oldX,c.z-oldZ);
        c.ph+=moved/(c.sz*(1.0+Math.min(1,speed/8)*.5))*Math.PI*2;
      }else{
        const nx=c.x+c.vx*dt,nz=c.z+c.vz*dt;
        let floor=env.ground(nx,nz),ahead=env.ground(nx+c.vx*1.8,nz+c.vz*1.8);
        if(floor!==null){
          const target=Math.max(floor,ahead??floor)+ALT[c.sp]+Math.sin(c.ph*.12+c.seed*6)*4;
          c.vy+=(target-c.y)*.65*dt;c.vy*=Math.exp(-1.8*dt);c.vy=Math.max(-9,Math.min(18,c.vy));
          const ny=c.y+c.vy*dt;
          // Do not tunnel into a hillside/building while the climb catches up.
          if(ny>floor+4&&env.clear(c.x,c.z,nx,nz,ny)){c.x=nx;c.z=nz;c.y=ny;}
          else{c.vy=Math.max(5,c.vy);c.y+=c.vy*dt;c.vx=-c.vz;c.vz=Math.sin(oldYaw)*speed;}
        }else{c.vx*=Math.exp(-dt*3);c.vz*=Math.exp(-dt*3);}
        c.ph+=dt*[5.5,10,4.0][c.sp]*(1+panic*.35);
      }
      const actual=Math.hypot(c.x-oldX,c.z-oldZ)/Math.max(dt,.0001);
      if(actual>.04)c.yaw=Math.atan2(c.x-oldX,c.z-oldZ);
      const angle=Math.atan2(Math.sin(c.yaw-oldYaw),Math.cos(c.yaw-oldYaw));
      c.bank+=(Math.max(-.6,Math.min(.6,-angle/Math.max(dt,.001)*.22))-c.bank)*Math.min(1,dt*5);
      const gait=Math.min(1,actual/5),rootY=c.y+(air?0:(-.055+Math.sin(c.ph*2)*.025*gait)*c.sz);
      dummy.position.set(c.x,rootY,c.z);
      dummy.rotation.set(air?-Math.atan2(c.vy,Math.max(1,actual)):0,c.yaw,air?c.bank:0);dummy.scale.setScalar(c.sz);dummy.updateMatrix();
      const mesh=meshes[c.sp],idx=counts[c.sp]++;
      mesh.setMatrixAt(idx,dummy.matrix);mesh.instanceColor!.setXYZ(idx,c.tint.r,c.tint.g,c.tint.b);
      const glide=.5+.5*Math.sin(time*.38+c.seed*31),flap=air?(.12+(.65+(c.sp===1?.18:0))*THREE.MathUtils.smoothstep(glide,.38,.72))*(1+panic*.2):0;
      (mesh.geometry.attributes.aPose as THREE.InstancedBufferAttribute).setXYZW(idx,c.ph,gait,c.seed,flap);
      if(!air)feet(c,mesh,idx,actual,rootY);
    }
    for(let sp=0;sp<3;sp++){const mesh=meshes[sp];mesh.count=counts[sp];mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor!.needsUpdate=true;
      for(const name of air?['aPose']:['aPose','aFeetX','aFeetY','aFeetZ'])(mesh.geometry.attributes[name] as THREE.InstancedBufferAttribute).needsUpdate=true;}
  }
  return {birds,birdMeshes,herds,flock,graze,
    step(dt:number){
      if(!Number.isFinite(dt)||dt<=0)return;
      const start=performance.now();dt=Math.min(dt,.05);time+=dt;
      env.camera.updateMatrixWorld();vp.multiplyMatrices(env.camera.projectionMatrix,env.camera.matrixWorldInverse);frustum.setFromProjectionMatrix(vp);
      if(!initialized)initialize();
      if(climatePending){
        let deferred=false;
        for(const air of [false,true]){const pop=air?flock:graze;
          for(let g=0;g<GROUPS[+air];g++){const group=pop.filter(c=>c.grp===g);
            if(group.some(c=>c.active&&(seen(c.x,c.y+1,c.z,4)||time-c.seen<2))){deferred=true;continue;}
            const centre=group.find(c=>c.active)??env.truck(),sp=env.species(air,centre.x,centre.z,random(seedString(env.worldKey())+g*713+ +air*5731)());
            for(const c of group)if(c.sp!==sp){c.sp=sp;tint(c,air);c.feet=[];c.nextPlan=0;}
          }}climatePending=deferred;
      }
      stepPop(flock,birdMeshes,true,dt);stepPop(graze,herds,false,dt);stats.steps++;stats.ms=performance.now()-start;
    },
    refreshClimate(){climatePending=true;},
    reset(){flock.length=0;graze.length=0;initialized=false;climatePending=false;closest=Infinity;arrivalUntil=0;for(const m of [...birdMeshes,...herds])m.count=0;},
    consumeClosest(){const d=closest;closest=Infinity;return{closest:Number.isFinite(d)?+d.toFixed(2):null,clearance:HERD_CLEAR,constrained:stats.constrainedClearance};},
    diagnostics(){return{...stats,arrival:time<arrivalUntil,wedgeDeg:+(halfH()*180/Math.PI).toFixed(1),activeBirds:flock.filter(c=>c.active).length,activeHerd:graze.filter(c=>c.active).length,
      trianglesPerSpecies:[...herds,...birdMeshes].map(m=>m.geometry.attributes.position.count/3),climatePending,
      actors:[...graze,...flock].map(c=>({id:c.id,seed:c.seed,sp:c.sp,active:c.active,x:c.x,y:c.y,z:c.z,phase:c.ph,feet:c.feet,seenAgo:+(time-c.seen).toFixed(2),speed:+Math.hypot(c.vx,c.vz).toFixed(2)}))};},
  };
}
