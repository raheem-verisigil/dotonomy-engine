import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {buildPlan,preflight,execute,evaluate,makeReceipt,verifyReceipt,verifyReceiptChain,sha,canon,DOTS} from '../engine.js';
const G=['calendar.read','crm.read','mail.read','docs.read'];
const run=(hint,o={},g=G)=>{const plan=buildPlan(o),pre=preflight(plan,g);if(!pre.ok)return{plan,pre};const res=execute(plan,hint);return{plan,pre,res,ev:evaluate(res)}};
test('Northstar is SATISFIED, fully cited, zero writes',()=>{const x=run('Northstar');assert.equal(x.ev.status,'SATISFIED');assert.deepEqual(x.res.D.s6.value.unsupported,[]);assert.ok(x.res.inv.every(i=>['read','compute','draft'].includes(i.effect)))});
test('compose never receives internal_margin',()=>{const x=run('Northstar');const c=x.res.inv.find(i=>i.dot==='brief.compose');assert.ok(!JSON.stringify(c.received).includes('internal_margin'))});
test('Acme is ambiguous and BLOCKED',()=>{const x=run('Acme');assert.equal(x.res.halted.code,'AMBIGUOUS_MATCH');assert.equal(x.ev.status,'BLOCKED')});
test('Globex has stale CRM: CONDITIONAL, absence recorded',()=>{const x=run('Globex');assert.equal(x.ev.status,'CONDITIONAL');assert.match(x.ev.reqs[2].note,/absence/)});
test('preflight blocks bad plans',()=>{assert.equal(run('Northstar',{},G.filter(g=>g!=='mail.read')).pre.checks.find(c=>c.id==='P2').result,'fail');
 assert.equal(run('Northstar',{injectSend:true}).pre.checks.find(c=>c.id==='P8').result,'fail');
 assert.equal(run('Northstar',{externalModel:true}).pre.checks.find(c=>c.id==='P4').result,'fail')});
test('signed receipt verifies and tampering is detected',()=>{const{privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');const x=run('Northstar');const expectedKeyId=sha(publicKey.export({type:'spki',format:'pem'})).slice(0,19);
 const r=makeReceipt({runId:'t1',plan:x.plan,pre:x.pre,res:x.res,ev:x.ev,result:x.res.D.s5.value,prev:null,priv:privateKey,keyId:expectedKeyId});
 assert.equal(verifyReceipt(r,publicKey).valid,true);
 assert.equal(verifyReceipt(r,publicKey).signature_valid,true);
 assert.ok(Array.isArray(r.datums));
 assert.ok(r.datums.length > 0);
 for (const datum of r.datums) {
  assert.ok(Array.isArray(datum.source_refs));
  assert.equal(datum.source_refs.join(','), [...datum.source_refs].sort().join(','));
  assert.equal(datum.source_reference_hash, sha(canon(datum.source_refs)));
  assert.ok(['CAPTURED_UNVERIFIED','PARTIAL_UNVERIFIED','REFERENCE_ONLY','NO_SOURCE_REFERENCES'].includes(datum.provenance_status));
  assert.ok(Array.isArray(datum.provenance_records));
  assert.deepEqual(datum.provenance_records.map(p=>p.source_id), datum.source_refs);
  for (const provenance of datum.provenance_records) {
   assert.ok(['record_reference','query_reference'].includes(provenance.evidence_kind));
   assert.equal(provenance.verification_status, 'unverified');
   assert.equal(Object.hasOwn(provenance, 'payload'), false);
   if (provenance.captured_provenance) {
    assert.equal(provenance.captured_provenance.source_id, provenance.source_id);
    assert.match(provenance.captured_provenance.integrity_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(provenance.integrity_hash, provenance.captured_provenance.integrity_hash);
    assert.equal(provenance.captured_provenance.verification_status, 'unverified');
    assert.equal(Object.hasOwn(provenance.captured_provenance, 'payload'), false);
   } else {
    assert.equal(provenance.integrity_hash, null);
   }
  }
 }
 const alteredSources=structuredClone(r);
 alteredSources.datums[0].source_refs.push('fabricated:source');
 assert.equal(verifyReceipt(alteredSources,publicKey).valid,false);
 const alteredSourceHash=structuredClone(r);
 alteredSourceHash.datums[0].source_reference_hash='sha256:forged';
 assert.equal(verifyReceipt(alteredSourceHash,publicKey).valid,false);

 const alteredProvenanceStatus=structuredClone(r);
 alteredProvenanceStatus.datums[0].provenance_status='VERIFIED';
 assert.equal(verifyReceipt(alteredProvenanceStatus,publicKey).valid,false);
 const capturedDatum=r.datums.find(d=>d.provenance_records.some(p=>p.captured_provenance));
 if(capturedDatum){
  const alteredCapturedProvenance=structuredClone(r);
  const entry=alteredCapturedProvenance.datums.find(d=>d.step===capturedDatum.step)
   .provenance_records.find(p=>p.captured_provenance);
  entry.captured_provenance.origin='unknown';
  assert.equal(verifyReceipt(alteredCapturedProvenance,publicKey).valid,false);
 }


 const otherPair=crypto.generateKeyPairSync('ed25519');
 assert.equal(verifyReceipt(r,otherPair.publicKey).reason,'KEY_ID_MISMATCH');

 const wrongKeyId=structuredClone(r);wrongKeyId.key_id='wrong-key';assert.equal(verifyReceipt(wrongKeyId,publicKey).reason,'KEY_ID_MISMATCH');
 assert.equal(verifyReceipt(r,publicKey).source_authenticity,'NOT_ESTABLISHED');
 assert.equal(verifyReceipt(r,publicKey).signer_trust,'NOT_ESTABLISHED');
 assert.equal(verifyReceipt(null,publicKey).reason,'MALFORMED_RECEIPT');
 const missingKeyId=structuredClone(r);delete missingKeyId.key_id;
 assert.equal(verifyReceipt(missingKeyId,publicKey).reason,'MISSING_KEY_ID');
 const malformedSignature=structuredClone(r);malformedSignature.signature='not-a-signature';
 assert.equal(verifyReceipt(malformedSignature,publicKey).reason,'MALFORMED_SIGNATURE');
 const t=structuredClone(r);t.requirements[0].state='FAILED';assert.equal(verifyReceipt(t,publicKey).valid,false);
 const u=makeReceipt({runId:'t2',plan:x.plan,pre:x.pre,res:x.res,ev:x.ev,result:{},prev:null,priv:null,keyId:expectedKeyId});assert.equal(verifyReceipt(u,publicKey).reason,'UNSIGNED_PREVIEW')});


test('receipt-chain verifier checks signatures, links, and checkpoints', () => {
 const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
 const x = run('Northstar');
 const keyId = sha(publicKey.export({type:'spki',format:'pem'})).slice(0,19);
 const make = (id, prev) => makeReceipt({
  runId:id, plan:x.plan, pre:x.pre, res:x.res, ev:x.ev,
  result:x.res.D.s5.value, prev, priv:privateKey, keyId
 });
 const first = make('chain-1', null);
 const firstHash = sha(canon(first));
 const second = make('chain-2', firstHash);
 const secondHash = sha(canon(second));
 const third = make('chain-3', secondHash);
 const headHash = sha(canon(third));

 const good = verifyReceiptChain([first, second, third], publicKey, {
  expectedFirstPrevHash: null,
  expectedHeadHash: headHash
 });
 assert.equal(good.valid, true);
 assert.equal(good.chain_consistent, true);
 assert.equal(good.complete, true);
 assert.equal(good.anchored, true);
 assert.equal(good.head_hash, headHash);

 const broken = make('chain-broken-link', firstHash);
 const brokenCheck = verifyReceiptChain([first, second, broken], publicKey);
 assert.equal(brokenCheck.valid, false);
 assert.equal(brokenCheck.reason, 'BROKEN_PREDECESSOR_LINK');

 const missing = verifyReceiptChain([first, third], publicKey);
 assert.equal(missing.valid, false);
 assert.equal(missing.reason, 'BROKEN_PREDECESSOR_LINK');

 const segment = verifyReceiptChain([second, third], publicKey);
 assert.equal(segment.valid, true);
 assert.equal(segment.chain_consistent, true);
 assert.equal(segment.complete, false);
 assert.equal(segment.anchored, false);

 const anchored = verifyReceiptChain([second, third], publicKey, {
  expectedFirstPrevHash: firstHash,
  expectedHeadHash: headHash
 });
 assert.equal(anchored.valid, true);
 assert.equal(anchored.complete, true);
 assert.equal(anchored.anchored, true);

 const wrongHead = verifyReceiptChain([first, second, third], publicKey, {
  expectedHeadHash: 'sha256:' + '0'.repeat(64)
 });
 assert.equal(wrongHead.valid, false);
 assert.equal(wrongHead.chain_consistent, true);
 assert.equal(wrongHead.reason, 'EXPECTED_HEAD_MISMATCH');
});

test('execution rejects missing provenance', () => {
 const original=DOTS['calendar.find_meeting'];
 const REG={
  ...DOTS,
  'calendar.find_meeting':{
   ...original,
   run:(...args)=>{
    const result=original.run(...args);
    if(result.ok)result.src=result.src.map(({id})=>({id}));
    return result;
   }
  }
 };
 const result=execute(buildPlan(),'Northstar',REG);
 assert.equal(result.halted.code,'E_PROVENANCE_INVALID');
 assert.deepEqual(result.D,{});
});

test('execution rejects a mismatched source identifier', () => {
 const original=DOTS['calendar.find_meeting'];
 const REG={
  ...DOTS,
  'calendar.find_meeting':{
   ...original,
   run:(...args)=>{
    const result=original.run(...args);
    if(result.ok)result.src=result.src.map(source=>({
     ...source,
     id:'fabricated:'+source.id
    }));
    return result;
   }
  }
 };
 const result=execute(buildPlan(),'Northstar',REG);
 assert.equal(result.halted.code,'E_PROVENANCE_INVALID');
 assert.deepEqual(result.D,{});
});

test('execution rejects copied or fabricated provenance records', () => {
 const original=DOTS['calendar.find_meeting'];
 const REG={
  ...DOTS,
  'calendar.find_meeting':{
   ...original,
   run:(...args)=>{
    const result=original.run(...args);
    if(result.ok)result.src=result.src.map(source=>({
     ...source,
     provenance:{...source.provenance}
    }));
    return result;
   }
  }
 };
 const result=execute(buildPlan(),'Northstar',REG);
 assert.equal(result.halted.code,'E_PROVENANCE_INVALID');
 assert.deepEqual(result.D,{});
});

// DOTONOMY_DIRECT_SOURCE_PAYLOAD_BINDING_TESTS
test('execution rejects a mutated calendar value with genuine provenance', () => {
 const original = DOTS['calendar.find_meeting'];
 const REG = {
  ...DOTS,
  'calendar.find_meeting': {
   ...original,
   run: (...args) => {
    const result = original.run(...args);
    if (result.ok) {
     result.value = {
      ...result.value,
      title: 'FABRICATED: board approved the acquisition'
     };
    }
    return result;
   }
  }
 };

 const result = execute(buildPlan(), 'Northstar', REG);
 assert.equal(result.halted?.code, 'E_PROVENANCE_INVALID');
 assert.ok(result.halted?.candidates.includes('OUTPUT_PAYLOAD_MISMATCH'));
 assert.equal(result.D.s1, undefined);
});

test('execution rejects a mutated CRM value with genuine provenance', () => {
 const original = DOTS['crm.get_account'];
 const REG = {
  ...DOTS,
  'crm.get_account': {
   ...original,
   run: (...args) => {
    const result = original.run(...args);
    if (result.ok) {
     result.value = {
      ...result.value,
      arr: 999999999
     };
    }
    return result;
   }
  }
 };

 const result = execute(buildPlan(), 'Northstar', REG);
 assert.equal(result.halted?.step, 's2');
 assert.equal(result.halted?.code, 'E_PROVENANCE_INVALID');
 assert.ok(result.halted?.candidates.includes('OUTPUT_PAYLOAD_MISMATCH'));
 assert.ok(result.D.s1);
 assert.equal(result.D.s2, undefined);
});

test('live calendar events cannot resolve fixture CRM accounts', () => {
 const original = DOTS['calendar.find_meeting'];
 const liveEvent = client => ({
  id: 'live-event-1',
  title: 'Northstar quarterly review',
  client,
  start: new Date().toISOString(),
  attendees: ['Meeting attendee']
 });

 for (const client of [null, 'Northstar']) {
  const result = execute(
   buildPlan(),
   'Northstar',
   DOTS,
   {events: [liveEvent(client)]}
  );

  assert.ok(
   ['s1', 's2'].includes(result.halted?.step),
   `unexpected halt step for client ${String(client)}`
  );
  if (client === null) {
   assert.equal(result.halted?.step, 's1');
   assert.equal(result.halted?.code, 'E_OUTPUT_INVALID');
  } else {
   assert.equal(result.halted?.step, 's2');
   assert.equal(result.halted?.code, 'NO_ACCOUNT');
  }
  assert.equal(result.D.s2, undefined);
 }
});
