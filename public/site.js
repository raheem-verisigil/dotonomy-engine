const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const HINT={normal:'Northstar',conflict:'Horizon',stale:'Globex',ambig:'Acme'},ON='px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold text-xs shadow-sm transition-all',OFF='px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface hover:text-white border border-outline-variant/60 text-xs transition-all';
let scen='normal',last=null;
const col=s=>s==='SATISFIED'||s==='pass'?'text-primary':s==='CONDITIONAL'||s==='STALE'||s==='CONFLICTED'?'text-tertiary':s==='UNKNOWN'?'text-slate-500':'text-error';
document.querySelectorAll('[data-scen]').forEach(b=>b.onclick=()=>{scen=b.dataset.scen;document.querySelectorAll('[data-scen]').forEach(x=>x.className=x===b?ON:OFF)});
$('#liveRun').onclick=async()=>{const out=$('#liveOut');out.innerHTML='<p class="text-on-surface-variant">Running the real engine…</p>';
 const G=['calendar.read','crm.read','docs.read'].concat($('#optNoMail').checked?[]:['mail.read']);
 try{const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hint:HINT[scen],grants:G,externalModel:$('#optExt').checked,sample:true})});
  if(!r.ok){out.innerHTML=`<p class="text-error">${r.status===429?'Too many demo runs. Please wait a few minutes.':'The demo is unavailable right now.'}</p>`;return}
  const d=await r.json();last=d.receipt;const tier1=!d.preflight.ok?'NOT STARTED (plan rejected)':d.halted?'HALTED':'COMPLETED';
  let h=`<div class="grid sm:grid-cols-2 gap-3 mb-4"><div class="p-3 rounded-lg bg-surface-container border border-outline-variant/60"><div class="text-slate-500">TIER 1 · RUN STATE</div><div class="text-lg font-bold ${tier1==='COMPLETED'?'text-primary':'text-tertiary'}">${tier1}</div></div><div class="p-3 rounded-lg bg-surface-container border border-outline-variant/60"><div class="text-slate-500">TIER 2 · OUTCOME</div><div class="text-lg font-bold ${col(d.status)}">${d.status}</div></div></div>`;
  h+=`<div class="text-slate-500 mb-1">PREFLIGHT</div>`+d.preflight.checks.map(c=>`<div class="flex gap-3"><span class="${col(c.result)} w-10">${c.result.toUpperCase()}</span><span class="text-white w-8">${c.id}</span><span class="text-on-surface-variant">${esc(c.name)}${c.result==='fail'?' — '+esc(c.detail):''}</span></div>`).join('');
  if(d.halted)h+=`<p class="mt-3 text-tertiary">Stopped: ${esc(d.halted.code)}. ${(d.halted.candidates||[]).map(esc).join(' | ')}. Nothing was guessed.</p>`;
  if(d.brief?.claims)h+=`<div class="text-slate-500 mt-4 mb-1">BRIEF</div>`+d.brief.claims.map(c=>c.kind==='fact'?`<p class="${/^Conflict/.test(c.text)?'text-tertiary':'text-on-surface'}">${esc(c.text)} ${c.cites.map(x=>`<span class="text-secondary">[${esc(x)}]</span>`).join(' ')}</p>`:`<p class="italic text-slate-500">${esc(c.text)}</p>`).join('');
  h+=`<div class="text-slate-500 mt-4 mb-1">REQUIREMENTS</div>`+d.requirements.map(q=>`<div class="flex gap-3"><span class="w-24 ${col(q.state)}">${q.state}</span><span class="text-on-surface-variant">${esc(q.text)}${q.note?' — '+esc(q.note):''}</span></div>`).join('');
  h+=`<p class="mt-4 text-on-surface-variant">Signed receipt <span class="text-white">${esc(d.receipt.receipt_id)}</span> issued. <a href="#receipt-verifier" class="text-primary underline" id="toVerify">Check it in the verifier</a>.</p>`;
  out.innerHTML=h;$('#toVerify').onclick=()=>{$('#receiptInputArea').value=JSON.stringify(last,null,2)}}catch{out.innerHTML='<p class="text-error">Could not reach the engine.</p>'}};
const ta=$('#receiptInputArea'),setBadge=(ok,msg)=>{$('#badgeDot').className='w-2 h-2 rounded-full '+(ok?'bg-primary':'bg-error');$('#badgeText').className='font-mono text-xs '+(ok?'text-primary':'text-error');$('#badgeText').textContent=msg};
ta.value='';ta.placeholder='Run the live demo above, then choose "Load Last Receipt". You can also paste any receipt JSON.';
$('#btnLoadValidReceipt').onclick=()=>{if(!last){setBadge(false,'RUN THE LIVE DEMO FIRST');return}ta.value=JSON.stringify(last,null,2);setBadge(true,'READY FOR VERIFICATION')};
$('#btnLoadTamperedReceipt').onclick=()=>{try{const o=JSON.parse(ta.value);o.outcome_status='SATISFIED';o.warnings=[];o.run_id=o.run_id+'x';ta.value=JSON.stringify(o,null,2);setBadge(true,'ALTERED. NOW VERIFY IT')}catch{setBadge(false,'LOAD A RECEIPT FIRST')}};
$('#btnVerifySignature').onclick=async()=>{let o;try{o=JSON.parse(ta.value)}catch{setBadge(false,'NOT VALID JSON');return}
 const d=await fetch('/api/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receipt:o})}).then(r=>r.json());
 setBadge(d.valid,d.valid?'SIGNATURE VALID':d.reason==='UNSIGNED_PREVIEW'?'UNSIGNED PREVIEW':'INVALID · '+d.reason)};
fetch('/api/state').then(r=>r.json()).then(d=>{const k=$('#pubKeyId');if(k)k.textContent=d.keyId}).catch(()=>{});
$('#pilotForm').addEventListener('submit',async e=>{e.preventDefault();const m=$('#trialConfirmation');m.classList.remove('hidden');m.textContent='Creating your account…';
 const r=await fetch('/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('#workEmail').value,password:$('#signupPw').value})});const d=await r.json();
 if(r.ok){m.textContent='Account created. Opening your workspace…';location.href='/app.html'}else m.textContent=d.error||'Could not create the account.'});
