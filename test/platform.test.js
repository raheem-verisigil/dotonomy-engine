import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {newDb} from 'pg-mem';import {hashPassword,verifyPassword,signToken,verifyToken} from '../auth.js';import {fileStore,pgStore} from '../store.js';import {build} from '../server.js';
test('passwords and session tokens',()=>{const h=hashPassword('correct horse battery');assert.ok(verifyPassword('correct horse battery',h));assert.ok(!verifyPassword('wrong',h));
 const t=signToken('u_1','s');assert.equal(verifyToken(t,'s'),'u_1');assert.equal(verifyToken(t,'other'),null);assert.equal(verifyToken(t.slice(0,-2)+'xx','s'),null);assert.equal(verifyToken(signToken('u_1','s',-1),'s'),null)});
const mk={file:()=>fileStore(fs.mkdtempSync(path.join(os.tmpdir(),'dn-'))),pg:()=>{const{Pool}=newDb().adapters.createPg();return pgStore(new Pool())}};
for(const[n,f]of Object.entries(mk))test(`${n} store: users, workspaces, receipts stay separate`,async()=>{const s=f();await s.init();
 await s.createUser({id:'u_1',email:'a@x.io',pass:'p'});await assert.rejects(()=>s.createUser({id:'u_2',email:'a@x.io',pass:'p'}),/EXISTS/);
 assert.equal((await s.userByEmail('a@x.io')).id,'u_1');const w=await s.workspace('u_1');assert.equal(w.runs,0);await s.saveWorkspace('u_1',{runs:2,paid:true,last:'h'});assert.deepEqual(await s.workspace('u_1'),{runs:2,paid:true,last:'h'});
 await s.addReceipt('u_1',{receipt_id:'r1'});await s.addReceipt('u_1',{receipt_id:'r2'});await s.addReceipt('u_9',{receipt_id:'r3'});
 assert.deepEqual((await s.receipts('u_1')).map(r=>r.receipt_id),['r2','r1']);assert.equal((await s.receipts('u_9')).length,1)});
test('HTTP: accounts are private, trial cap and unlock work',async()=>{
 const app=await build({store:mk.pg(),secret:'s',priv:crypto.generateKeyPairSync('ed25519').privateKey,cap:2}),srv=app.listen(0),base=`http://127.0.0.1:${srv.address().port}`;
 const client=()=>{let c='';return async(p,b)=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json',cookie:c},body:b?JSON.stringify(b):undefined});const sc=r.headers.getSetCookie().map(x=>x.split(';')[0]).pop();if(sc!==undefined)c=sc;return{s:r.status,d:await r.json()}}};
 try{const A=client(),B=client(),G=['calendar.read','crm.read','mail.read','docs.read'];
  assert.equal((await A('/api/auth/signup',{email:'a@x.io',password:'short'})).s,400);assert.equal((await A('/api/auth/signup',{email:'a@x.io',password:'long-enough-pw1'})).s,200);
  assert.equal((await B('/api/auth/signup',{email:'a@x.io',password:'long-enough-pw1'})).s,409);assert.equal((await B('/api/auth/login',{email:'a@x.io',password:'nope-nope-nope'})).s,401);
  assert.equal((await B('/api/auth/signup',{email:'b@x.io',password:'long-enough-pw1'})).s,200);
  const run=await A('/api/run',{hint:'Northstar',grants:G});assert.equal(run.d.status,'SATISFIED');assert.equal(run.d.watermark,true);
  assert.equal((await A('/api/receipts')).d.length,1);assert.equal((await B('/api/receipts')).d.length,0);
  await A('/api/run',{hint:'Northstar',grants:G});assert.equal((await A('/api/run',{hint:'Northstar',grants:G})).s,402);
  assert.equal((await A('/api/workspace/unlock',{})).d.paid,true);const signed=await A('/api/run',{hint:'Northstar',grants:G});assert.equal((await A('/api/verify',{receipt:signed.d.receipt})).d.valid,true);
  const anon=client();assert.equal((await anon('/api/workspace/unlock',{})).s,401)}finally{srv.close()}});

test('HTTP: caller-supplied grants cannot change server-side preflight',async()=>{
 const app=await build({
  store:mk.file(),
  secret:'grant-test-secret',
  priv:crypto.generateKeyPairSync('ed25519').privateKey,
  cap:9
 });
 const srv=app.listen(0);
 const base=`http://127.0.0.1:${srv.address().port}`;
 const call=async body=>{
  const r=await fetch(base+'/api/run',{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify(body)
  });
  return {status:r.status,data:await r.json()};
 };
 try{
  const without=await call({hint:'Northstar',grants:[]});
  const forged=await call({
   hint:'Northstar',
   grants:['calendar.read','crm.read','mail.read','docs.read','admin','mail.send']
  });

  assert.equal(without.status,200);
  assert.equal(forged.status,200);
  assert.equal(without.data.status,forged.data.status);
  assert.deepEqual(without.data.preflight,forged.data.preflight);
  assert.ok(without.data.preflight.checks.every(c=>c.result==='pass'));
 }finally{
  await new Promise(resolve=>srv.close(resolve));
 }
});
