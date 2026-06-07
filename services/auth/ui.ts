/**
 * Passkey UI — a single page that drives WebAuthn register/sign-in and then
 * either completes OAuth consent (when `client_id` is present) or approves a
 * device-code (when `user_code` is present). Ported/trimmed from
 * c15r/workspace's authorize page.
 */
import type { ServiceHttpRequest, ServiceHttpResponse } from '../../platform/runtime';

export function renderAuthPage(req: ServiceHttpRequest, serverName: string): ServiceHttpResponse {
  const u = new URL(req.url);
  const origin = `${u.protocol}//${u.host}`;
  const params = Object.fromEntries(u.searchParams);
  const deviceMode = !!params.user_code;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize — ${serverName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#161616;border:1px solid #222;border-radius:12px;padding:2rem;width:100%;max-width:400px}
h1{font-size:1.2rem;margin-bottom:.3rem}h1 .dim{color:#666;font-weight:400}
.sub{color:#888;font-size:.85rem;margin-bottom:1.5rem}
button{width:100%;padding:.7rem;border:none;border-radius:6px;font-size:.9rem;font-weight:600;cursor:pointer;margin-top:.5rem;font-family:inherit}
.bp{background:#238636;color:#fff}.bs{background:#222;color:#ccc}
.ig{margin-bottom:1rem}.ig label{display:block;font-size:.8rem;color:#888;margin-bottom:.3rem}
.ig input{width:100%;padding:.6rem;background:#0d0d0d;border:1px solid #333;border-radius:6px;color:#fff;font-size:.95rem}
.step{display:none}.step.active{display:block}
.st{text-align:center;padding:1rem 0}.st .icon{font-size:2.5rem;margin-bottom:.5rem}
.msg{color:#888;font-size:.85rem;margin-top:.5rem;text-align:center}
.code{font-family:ui-monospace,monospace;font-size:1.1rem;letter-spacing:.1em;color:#3fb950;text-align:center;margin:.5rem 0}
</style></head><body>
<div class="card">
<div class="step active" id="s-auth">
  <h1>${serverName}<span class="dim"> · auth</span></h1>
  <p class="sub">${deviceMode ? 'Approve device access.' : 'Sign in or register to authorize access.'}</p>
  ${deviceMode ? `<div class="code">${params.user_code}</div>` : ''}
  <div class="ig"><label>Username</label><input id="username" placeholder="your name" autocomplete="username webauthn"></div>
  <button class="bp" onclick="doAuth()">Sign in with passkey</button>
  <button class="bs" onclick="doRegister()">Register new passkey</button>
  <div class="msg" id="msg"></div>
</div>
<div class="step" id="s-wait"><div class="st"><div class="icon">🔐</div><p>Waiting for passkey…</p></div></div>
<div class="step" id="s-ok"><div class="st" style="color:#3fb950"><div class="icon">✓</div><h1>Authorized</h1><p class="msg" id="ok-msg"></p></div></div>
<div class="step" id="s-err"><div class="st" style="color:#f85149"><div class="icon">✗</div><h1>Failed</h1><p id="err-msg" class="msg"></p></div><button class="bs" onclick="show('s-auth')">Try again</button></div>
</div>
<script type="module">
import{startAuthentication,startRegistration}from"https://esm.sh/@simplewebauthn/browser@13";
const O=${JSON.stringify(origin)};
const P=${JSON.stringify(params)};
const DEVICE=${JSON.stringify(deviceMode)};
function show(id){document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active')}
function msg(t){document.getElementById('msg').textContent=t}
async function postJson(path,body){return(await fetch(O+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()}
window.show=show;
window.doAuth=async function(){
  show('s-wait');
  try{
    const opts=await postJson('/webauthn/authenticate/options',{});
    if(opts.error)throw new Error(opts.error);
    const resp=await startAuthentication({optionsJSON:opts.options});
    const v=await postJson('/webauthn/authenticate/verify',{challengeId:opts.challengeId,response:resp});
    if(!v.verified)throw new Error(v.error||'Verification failed');
    await complete(v.sessionId);
  }catch(e){document.getElementById('err-msg').textContent=e.message;show('s-err')}
};
window.doRegister=async function(){
  const username=document.getElementById('username').value.trim();
  if(!username){msg('Username required');return}
  show('s-wait');
  try{
    const opts=await postJson('/webauthn/register/options',{username});
    if(opts.error)throw new Error(opts.error);
    const resp=await startRegistration({optionsJSON:opts.options});
    const v=await postJson('/webauthn/register/verify',{challengeId:opts.challengeId,userId:opts.userId,username:opts.username,response:resp});
    if(!v.verified)throw new Error(v.error||'Registration failed');
    await complete(v.sessionId);
  }catch(e){document.getElementById('err-msg').textContent=e.message;show('s-err')}
};
async function complete(sessionId){
  if(DEVICE){
    const r=await postJson('/auth/device/approve',{sessionId,user_code:P.user_code});
    if(r.error){document.getElementById('err-msg').textContent=r.error;show('s-err');return}
    document.getElementById('ok-msg').textContent='Device approved. Return to your terminal.';
    show('s-ok');return;
  }
  if(!P.client_id||!P.redirect_uri){document.getElementById('err-msg').textContent='Missing OAuth params';show('s-err');return}
  const r=await postJson('/oauth/consent',{
    sessionId,clientId:P.client_id,redirectUri:P.redirect_uri,
    codeChallenge:P.code_challenge,codeChallengeMethod:P.code_challenge_method||'S256',
    scope:P.scope,state:P.state,resource:P.resource
  });
  if(r.error){document.getElementById('err-msg').textContent=r.error;show('s-err');return}
  document.getElementById('ok-msg').textContent='Redirecting…';
  show('s-ok');setTimeout(()=>{window.location.href=r.redirect},400);
}
</script></body></html>`;

  return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: html };
}
