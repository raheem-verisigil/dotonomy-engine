import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {buildPlan,execute,evaluate} from '../engine.js';import {fileStore} from '../store.js';import {build} from '../server.js';
const run=h=>{const res=execute(buildPlan(),h);return{res,ev:evaluate(res)}};
test('CRM vs email budget conflict is detected, cited, and not resolved silently',()=>{const{res,ev}=run('Horizon');assert.equal(ev.status,'CONDITIONAL');
 assert.equal(ev.reqs.find(r=>r.id==='R7').state,'CONFLICTED');const c=res.D.s5.value.claims.find(x=>/Conflict/.test(x.text));assert.ok(c.cites.includes('crm:acc_77')&&c.cites.includes('mail:m5'));assert.deepEqual(res.D.s6.value.unsupported,[])});
test('clean client still SATISFIED with R7 satisfied',()=>{const{ev}=run('Northstar');assert.equal(ev.status,'SATISFIED');assert.equal(ev.reqs.find(r=>r.id==='R7').state,'SATISFIED')});
test('HTTP: sample runs are signed, verifiable, unmetered and not stored',async()=>{
 const app=await build({store:fileStore(fs.mkdtempSync(path.join(os.tmpdir(),'dn-'))),secret:'s',priv:crypto.generateKeyPairSync('ed25519').privateKey,cap:1}),srv=app.listen(0),base=`http://127.0.0.1:${srv.address().port}`;
 try{const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());const G=['calendar.read','crm.read','mail.read','docs.read'];
  for(let i=0;i<3;i++){const d=await post('/api/run',{hint:'Horizon',grants:G,sample:true});assert.equal(d.status,'CONDITIONAL');assert.equal(d.receipt.sample,true);assert.equal((await post('/api/verify',{receipt:d.receipt})).valid,true);
   const t=structuredClone(d.receipt);t.outcome_status='SATISFIED';assert.equal((await post('/api/verify',{receipt:t})).valid,false)}
  assert.equal((await fetch(base+'/api/public-key').then(r=>r.text())).includes('BEGIN PUBLIC KEY'),true)}finally{srv.close()}});

test('website: static HTML IDs are unique',()=>{
 const html=fs.readFileSync('public/app.html','utf8').split('<script>')[0];
 const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
 const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
 assert.deepEqual([...new Set(duplicates)],[]);
});

test('website: calendar has one connection container and handler',()=>{
 const html=fs.readFileSync('public/app.html','utf8');
 assert.equal((html.match(/id="connBox"/g)||[]).length,1);
 assert.equal((html.match(/async function conn\(/g)||[]).length,1);
 for(const id of ['cc','cd','curl']) {
  assert.equal(html.includes(`id="${id}"`),false,`obsolete calendar ID ${id}`);
 }
 assert.match(html,/id="cmsg"[^>]*aria-live="polite"/);
});

test('website: homepage does not claim seven preflight gates',()=>{
 const html=fs.readFileSync('public/index.html','utf8');
 assert.doesNotMatch(html,/7[- ]Gate|7 Gates|7 STATIC PREFLIGHT|Full 7-Gate/i);
});

test('engine and homepage: all eight preflight checks remain documented by the engine',()=>{
 const engine=fs.readFileSync('engine.js','utf8');
 const ids=[...engine.matchAll(/\badd\('(P\d+)'/g)].map(m=>m[1]);
 assert.deepEqual(ids,['P0','P8','P1','P2','P3','P4','P5','P7']);
 const homepage=fs.readFileSync('public/index.html','utf8');
 assert.match(homepage,/Preflight Verification Lifecycle/);
});
