// Explicitly opt-in interaction recorder. Separate bearer read link and writer secret.
// No names, typed content, room invitation, identity, raw pointer stream or external activity.
import {cellPost} from './auth';
export type Node={id:string;kind:string;form?:string;x:number;y:number;refs:string[]};
export type Frame={kind:string;ms:number;context:string;nodes:Node[];selected:string[];target?:string;duration?:number;factKind?:string};
type Keys={token:string;writer:string;expires:number};
type Capture=(kind:string,extra?:Partial<Frame>)=>Frame;
const uid=()=>crypto.randomUUID().replace(/-/g,'');
const endpoint=(token:string)=>'/things/observe/'+token;
function stored():Keys|null{try{return JSON.parse(localStorage.getItem('things.recording.v1')||'null')}catch{return null}}
function keep(k:Keys|null){try{if(k)localStorage.setItem('things.recording.v1',JSON.stringify(k));else localStorage.removeItem('things.recording.v1')}catch{}}
export class Recorder{
 keys=stored(); active=false;pending:Frame[]=[];startAt=0;count=0;busy=false;ending=false;error='';private timer=0;
 constructor(private capture:Capture,private changed:()=>void){}
 async send(action:string,events:Frame[]=[]){if(!this.keys)throw Error('No recording');const r=await cellPost(endpoint(this.keys.token),{writer:this.keys.writer,action,events},action!=='append');const d=await r.json();if(!r.ok)throw Error(d.error||'Recording unavailable');return d}
 async start(){if(this.busy||this.active||this.keys)return;this.busy=true;this.error='';this.keys={token:uid(),writer:uid(),expires:0};try{const d=await this.send('start');this.keys.expires=d.expires;keep(this.keys);this.count=0;this.startAt=performance.now();this.active=true;this.record('start');this.timer=window.setInterval(()=>void this.flush(),1200)}catch(e){this.error=(e as Error).message;this.keys=null}finally{this.busy=false;this.changed()}}
 record(kind:string,extra:Partial<Frame>={}){if(!this.active||this.ending)return;const f=this.capture(kind,extra);f.ms=Math.round(performance.now()-this.startAt);this.pending.push(f);if(this.pending.length>=4)void this.flush()}
 async flush(){if(this.busy||!this.keys||!this.pending.length||this.ending)return;this.busy=true;const batch=this.pending.slice(0,4);try{const d=await this.send('append',batch);this.pending.splice(0,batch.length);this.count=d.count;this.error=''}catch(e){this.error=(e as Error).message;this.active=false;clearInterval(this.timer);this.pending=[]}finally{this.busy=false;this.changed()}}
 async stop(){if(this.busy||!this.keys||this.ending)return;this.ending=true;clearInterval(this.timer);if(this.active)this.pending.push({...this.capture('stop'),ms:Math.round(performance.now()-this.startAt)});this.active=false;this.busy=true;try{while(this.pending.length>4){const d=await this.send('append',this.pending.slice(0,4));this.pending.splice(0,4);this.count=d.count}let d;try{d=await this.send('stop',this.pending)}catch{d=await this.send('stop',[]);this.error='Final unsaved events omitted.'}this.pending=[];this.count=d.count}catch(e){this.error=(e as Error).message;this.pending=[]}finally{this.busy=false;this.ending=false;this.changed()}}
 async remove(){if(!this.keys||this.busy)return;this.active=false;clearInterval(this.timer);this.pending=[];this.busy=true;try{await this.send('delete');this.keys=null;keep(null);this.count=0;this.error=''}catch(e){this.error=(e as Error).message}finally{this.busy=false;this.changed()}}
 link(){return this.keys?location.origin+'/things#observe='+this.keys.token:''}
}
export async function readRecording(token:string){const r=await fetch(endpoint(token),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Recording unavailable');return d as {events:Frame[];created:number;expires:number;closed:boolean}}
