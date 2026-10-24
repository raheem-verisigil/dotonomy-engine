import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {parseIcs,toMeetings,blocked,fetchText} from '../connectors/ics.js';import {seal,unseal} from '../auth.js';import {funnel} from '../funnel.js';import {fileStore} from '../store.js';import {build} from '../server.js';
const d=n=>new Date(Date.now()+n*864e5).toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
const ICS=`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc123@x\r\nSUMMARY:Northstar plan\r\n ning sync\r\nDTSTART:${d(1)}\r\nATTENDEE;CN="Ada Obi":mailto:ada@northstar.io\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:old@x\r\nSUMMARY:Ancient\r\nDTSTART:20200101T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:far@x\r\nSUMMARY:Far future\r\nDTSTART:${d(90)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
test('ICS parsing unfolds lines, reads attendees, and keeps only the next 14 days',()=>{const m=toMeetings(parseIcs(ICS));assert.equal(m.length,1);assert.equal(m[0].title,'Northstar planning sync');assert.equal(m[0].client,'Northstar');assert.deepEqual(m[0].attendees,['Ada Obi'])});
test('private, loopback and metadata addresses are blocked; http is refused',async()=>{for(const a of['127.0.0.1','10.1.2.3','192.168.0.5','172.20.1.1','169.254.169.254','::1','fd00::1','::ffff:10.0.0.1'])assert.equal(blocked(a),true,a);assert.equal(blocked('93.184.216.34'),false);
 await assert.rejects(()=>fetchText('http://example.com/c.ics'),/https/);await assert.rejects(()=>fetchText('https://127.0.0.1/c.ics'),/not allowed|reach/)});
test('IPv6 special-purpose ranges are blocked while public IPv6 remains allowed', () => {
  for (const address of [
    '2001:0::1',
    '2001:1ff::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    '::ffff:10.0.0.1'
  ]) assert.equal(blocked(address), true, address);

  for (const address of [
    '2001:200::1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111'
  ]) assert.equal(blocked(address), false, address);
});

test('sealed connector links round-trip and fail with the wrong key',()=>{const u='https://calendar.example/secret.ics',s=seal(u,'k1');assert.ok(!s.includes('secret'));assert.equal(unseal(s,'k1'),u);assert.throws(()=>unseal(s,'k2'))});
test('funnel counts activation, repeat use and returns',()=>{const f=funnel([{ws:'u1',type:'signup',at:'2026-10-01T10:00:00Z'},{ws:'u1',type:'run',at:'2026-10-01T10:05:00Z'},{ws:'u1',type:'run',at:'2026-10-02T10:05:00Z'},{ws:'u1',type:'run',at:'2026-10-02T11:05:00Z'},{ws:'u2',type:'signup',at:'2026-10-01T10:00:00Z'},{ws:'a1',type:'demo_run',at:'2026-10-01T10:00:00Z'},{ws:'u1',type:'unlock',at:'2026-10-03T10:00:00Z'}]);
 assert.deepEqual([f.signups,f.activated_first_run,f.three_or_more_runs,f.returned_on_another_day,f.unlocked_demo_switch,f.demo_runs],[2,1,1,1,1,1])});
test('HTTP: login required, calendar connection is recorded, incomplete live assessments are blocked',async()=>{
 const cal=http.createServer((q,r)=>{r.setHeader('content-type','text/calendar');r.end(ICS)}).listen(0),url=`http://127.0.0.1:${cal.address().port}/c.ics`;
 const app=await build({store:fileStore(fs.mkdtempSync(path.join(os.tmpdir(),'dn-'))),secret:'s',priv:crypto.generateKeyPairSync('ed25519').privateKey,cap:9,allowPrivateIcs:true,adminToken:'tok-123'}),srv=app.listen(0),base=`http://127.0.0.1:${srv.address().port}`;
 try{
  let c='';
  const call=async(p,b,h={})=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json',cookie:c,...h},body:b?JSON.stringify(b):undefined});const sc=r.headers.getSetCookie().map(x=>x.split(';')[0]).pop();if(sc!==undefined)c=sc;return{s:r.status,d:await r.json()}};
  assert.equal((await call('/api/connectors/calendar',{url})).s,401);
  await call('/api/auth/signup',{email:'c@x.io',password:'long-enough-pw1'});
  assert.equal((await call('/api/connectors/calendar',{url:'https://127.0.0.1/x.ics'})).s,400);
  assert.equal((await call('/api/connectors/calendar',{url})).d.upcoming,1);
  assert.equal((await call('/api/connectors')).d.calendar.connected,true);

  const run=await call('/api/run',{hint:'Northstar',grants:['calendar.read','crm.read','mail.read','docs.read']});
  assert.equal(run.s,409);
  assert.equal(run.d.error,'LIVE_CONNECTORS_INCOMPLETE');
  assert.deepEqual(run.d.missing_live_sources,['crm','mail','docs']);
  assert.equal('receipt' in run.d,false);
  assert.equal((await call('/api/receipts')).d.length,0);

  assert.equal((await call('/api/connectors/calendar/remove',{})).d.connected,false);
  const afterRemoval=await call('/api/run',{hint:'Horizon',grants:['calendar.read','crm.read','mail.read','docs.read']});
  assert.equal(afterRemoval.s,409);
  assert.equal(afterRemoval.d.error,'LIVE_CONNECTORS_INCOMPLETE');

  assert.equal((await call('/api/admin/funnel')).s,404);
  const f=await call('/api/admin/funnel',null,{'x-admin-token':'tok-123'});
  assert.equal(f.s,200);
  assert.equal(f.d.signups,1);
  assert.equal(f.d.calendar_connected,1);
 }finally{srv.close();cal.close()}
});

test('calendar fetch rejects blocked IP literals before connecting', async () => {
  for (const url of [
    'https://127.0.0.1/calendar.ics',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/calendar.ics',
    'https://[::ffff:7f00:1]/calendar.ics'
  ]) {
    await assert.rejects(
      () => fetchText(url),
      /address not allowed/
    );
  }
});

test('calendar fetch refuses redirects instead of following them', async () => {
  let targetHit = false;
  const srv = http.createServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/target' });
      res.end();
    } else {
      targetHit = true;
      res.end('should not be fetched');
    }
  }).listen(0);

  try {
    const url = `http://127.0.0.1:${srv.address().port}/start`;
    await assert.rejects(
      () => fetchText(url, { allowPrivate: true }),
      /status 302/
    );
    assert.equal(targetHit, false);
  } finally {
    srv.closeAllConnections();
    await new Promise(resolve => srv.close(resolve));
  }
});

test('calendar fetch rejects responses exceeding the size limit', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end('x'.repeat(2_000_001));
  }).listen(0);

  try {
    const url = `http://127.0.0.1:${srv.address().port}/large.ics`;
    await assert.rejects(
      () => fetchText(url, { allowPrivate: true }),
      /too large/
    );
  } finally {
    srv.closeAllConnections();
    await new Promise(resolve => srv.close(resolve));
  }
});

test('calendar fetch enforces an overall deadline against slow-drip responses', async () => {
  let interval;
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.write('BEGIN:VCALENDAR\r\n');
    interval = setInterval(() => {
      res.write(' ');
    }, 20);
  }).listen(0);

  try {
    const url = `http://127.0.0.1:${srv.address().port}/slow.ics`;
    await assert.rejects(
      () => fetchText(url, { allowPrivate: true, timeoutMs: 100 }),
      /timed out/
    );
  } finally {
    if (interval) clearInterval(interval);
    srv.closeAllConnections();
    await new Promise(resolve => srv.close(resolve));
  }
});
