import {finishReturn} from './auth';
// Finish the full-page OAuth fallback before reading the room/observer fragment.
async function boot(){
 try{await finishReturn()}catch(e){const s=document.getElementById('status');if(s)s.textContent='Sign-in could not complete: '+(e as Error).message}
 await import('./app');
}
void boot();
