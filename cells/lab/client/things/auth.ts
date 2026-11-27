// Browser writes cross parc dispatch, which requires an authenticated caller.
// Use the platform kernel, with cell-only scope; never send a workspace grant.
type Kernel={accessToken:()=>string|null;loginSheet:(o:{identity:boolean})=>Promise<boolean>;login:(o:{identity:boolean})=>Promise<never>;ensureAuth:(o:{identity:boolean})=>Promise<void>};
const kernelURL='https://parc.land/@c15r/kernel/app.js';
let loading:Promise<Kernel>|undefined;
function kernel():Promise<Kernel>{return loading??=(import(/* @vite-ignore */ kernelURL) as Promise<Kernel>).catch(e=>{loading=undefined;throw e})}
export async function finishReturn(){if(new URLSearchParams(location.search).has('code'))await (await kernel()).ensureAuth({identity:true})}
export async function signInPage(){return (await kernel()).login({identity:true})}
let signing:Promise<boolean>|undefined;
async function signIn(k:Kernel){return signing??=(k.loginSheet({identity:true}).finally(()=>{signing=undefined}))}
export async function cellPost(path:string,body:unknown,interactive:boolean):Promise<Response>{
 if(!path.startsWith('/things/'))throw Error('Invalid cell path');
 const k=await kernel(),payload=JSON.stringify(body);
 const run=()=>{const headers=new Headers({'content-type':'application/json'});const token=k.accessToken();if(token)headers.set('authorization','Bearer '+token);return fetch(path,{method:'POST',headers,body:payload,credentials:'same-origin',cache:'no-store'})};
 let r=await run();
 if(r.status===401&&interactive){if(!await signIn(k))throw Error('Sign-in cancelled. Nothing was submitted.');r=await run()}
 if(r.status===401)throw Error('Sign in to parc.land before saving. Use Sign in, then try again.');
 if(r.status===403){const d=await r.clone().json().catch(()=>null);if(!d?.error||/forbidden|not granted|access denied/i.test(d.error))throw Error('This account is not authorised for the Lab cell.')}
 return r;
}
