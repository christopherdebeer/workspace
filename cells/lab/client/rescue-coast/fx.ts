/** Rocky Coast wake model: scattered stern turbulence and short-lived spray rather
 * than the original pair of persistent parallel white trails. */
import { Marks as OriginalMarks } from '../rescue/fx';
import { FX } from './render';
export class Marks extends OriginalMarks {
  wake(x:number,z:number,h:number,v:number,dt:number,big=true) {
    const fast=Math.min(1,v/9); if(fast<.08)return;
    const rnd=Math.random,s=Math.sin(h),c=Math.cos(h);
    const n=(big?66:11)*dt*(.45+fast);
    for(let k=0;k<Math.floor(n)+(rnd()<n%1?1:0);k++){
      const side=rnd()<.5?-1:1,scatter=rnd();
      const back=big?-3.8-rnd()*5.2:-1.3-rnd();
      const lateral=(big?1.2:.6)*side+(rnd()-.5)*(big?2.8:.65);
      this.add({kind:FX.FOAM,x:x+s*back+c*lateral,z:z+c*back-s*lateral,
        vx:c*side*(.45+rnd()*2)*fast-s*(.18+rnd()*.6),
        vz:-s*side*(.45+rnd()*2)*fast-c*(.18+rnd()*.6),
        size:(big?.3:.17)+rnd()*(big?.67:.18),grow:big?.5:.22,
        life:(big?1.2:.45)+rnd()*(big?1.8:.45),alpha:(.26+scatter*.47)*fast,
        stretch:.65+rnd()*.6});
    }
    if(big&&fast>.45&&rnd()<dt*18){
      const side=rnd()<.5?-1:1;
      this.add({kind:FX.DROP,x:x+s*4.5+c*side*1.4,z:z+c*4.5-s*side*1.4,
        y:.45,vy:1.6+rnd()*1.8,vx:c*side*(1.5+rnd()),vz:-s*side*(1.5+rnd()),
        size:.055+rnd()*.08,life:.48+rnd()*.25,fall:8,alpha:.8});
    }
    if(big&&fast>.35&&rnd()<dt*23){
      const sd=rnd()<.5?-1:1;
      this.add({kind:FX.FOAM,x:x+s*4.9+c*sd*1.4,z:z+c*4.9-s*sd*1.4,
        vx:c*sd*(1+rnd()*1.7),vz:-s*sd*(1+rnd()*1.7),
        size:.25+rnd()*.4,grow:.6,life:.4+rnd()*.65,alpha:fast*.63});
    }
  }
}

