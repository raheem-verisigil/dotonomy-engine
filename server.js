import packageJson from './package.json' with { type: 'json' };
import express from 'express';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {buildPlan,preflight,execute,evaluate,makeReceipt,verifyReceipt,DOTS,CONTRACT,canon,sha} from './engine.js';
// Explicit server-owned capabilities for the current local fixture-backed Dots.
// These do not authorize future third-party connectors or write actions.
const SERVER_FIXTURE_GRANTS = Object.freeze(['calendar.read','crm.read','mail.read','docs.read']);
import {hashPassword,verifyPassword,signToken,verifyToken,parseCookies,seal,unseal} from './auth.js';import {fetchMeetings} from './connectors/ics.js';import {funnel} from './funnel.js';import {fileStore,pgStore} from './store.js';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function build({store,secret,priv,cap=5,demoUnlock=true,allowPrivateIcs=false,adminToken=process.env.ADMIN_TOKEN}){await store.init();
 const track=(ws,t)=>store.addEvent(ws,t).catch(()=>{}),cache=new Map();
 const pub=crypto.createPublicKey(priv),pubPem=pub.export({type:'spki',format:'pem'}),keyId=sha(pubPem).slice(0,19);
 const app=express();app.set('trust proxy',1);app.use(express.json({limit:'200kb'}));app.use(express.static(path.join(here,'public')));
 const h=f=>(q,r,n)=>f(q,r,n).catch(n);
 const setCookie=(q,r,v,age)=>r.append('Set-Cookie',`dn=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${q.secure?'; Secure':''}`);
 app.use(h(async(q,r,n)=>{const t=parseCookies(q.get('cookie')).dn,sub=t&&verifyToken(t,secret);q.user=null;
  if(sub&&sub.startsWith('u_')){q.user=await store.userById(sub);q.ws=sub}else if(sub&&sub.startsWith('a_'))q.ws=sub;
  else{q.ws='a_'+crypto.randomBytes(12).toString('hex');setCookie(q,r,signToken(q.ws,secret,30*864e5),30*864e5/1e3)}n()}));
 const hits=new Map(),mkLimit=(name,max)=>(q,r,n)=>{const k=name+q.ip,now=Date.now(),e=hits.get(k)?.reset>now?hits.get(k):{n:0,reset:now+6e5};e.n++;hits.set(k,e);e.n>max?r.status(429).json({error:'Too many attempts. Try again later.'}):n()},limit=mkLimit('auth',20),sampleLimit=mkLimit('sample',60);
 const login=(q,r,u)=>{setCookie(q,r,signToken(u.id,secret),7*864e2);r.json({email:u.email})};
 app.post('/api/auth/signup',limit,h(async(q,r)=>{const e=String(q.body?.email||'').trim().toLowerCase(),p=String(q.body?.password||'');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)||e.length>120)return r.status(400).json({error:'Enter a valid email.'});if(p.length<10||p.length>200)return r.status(400).json({error:'Password must be 10 to 200 characters.'});
  const u={id:'u_'+crypto.randomBytes(8).toString('hex'),email:e,pass:hashPassword(p)};
  try{await store.createUser(u)}catch(x){if(x.code==='EXISTS')return r.status(409).json({error:'That email already has an account.'});throw x}track(u.id,'signup');login(q,r,u)}));
 const DUMMY=hashPassword('dummy-password');
 app.post('/api/auth/login',limit,h(async(q,r)=>{const u=await store.userByEmail(String(q.body?.email||'').trim().toLowerCase()),ok=verifyPassword(String(q.body?.password||''),u?u.pass:DUMMY);
  if(!u||!ok)return r.status(401).json({error:'Wrong email or password.'});login(q,r,u)}));
 app.post('/api/auth/logout',(q,r)=>{setCookie(q,r,'',0);r.json({ok:true})});
 app.get('/api/public-key',(q,r)=>r.type('text/plain').send(pubPem));
 app.get('/api/health',(q,r)=>r.json({ok:true,version:packageJson.version,store:store.kind}));
 app.get('/api/state',h(async(q,r)=>{const w=await store.workspace(q.ws);r.json({runs:w.runs,cap,paid:w.paid,email:q.user?.email||null,publicKey:pubPem,keyId,contract:CONTRACT})}));
 app.get('/api/dots',(q,r)=>r.json(Object.entries(DOTS).map(([id,d])=>({id,version:d.version,effect:d.effect,permissions:d.perms,inputs:d.ins,output:d.out,accepts:d.accepts,labels:d.labels,forbidden:d.forbid}))));
 app.post('/api/plan',(q,r)=>{const b=q.body||{},p=buildPlan(b);r.json({plan:p,...preflight(p,SERVER_FIXTURE_GRANTS),grant_basis:'server_fixture_policy',authorization:'Planning result only; not authorization for external actions.'})});
 app.post('/api/run',(q,r,n)=>q.body?.sample===true?sampleLimit(q,r,n):n(),h(async(q,r)=>{const b=q.body||{},sample=b.sample===true;
  if(!sample)return r.status(409).json({
   error:'LIVE_CONNECTORS_INCOMPLETE',
   message:'Live assessment is unavailable until every required source is connected to a genuine live adapter. CRM, email and document steps still use fixture data. Use the explicitly labelled sample demo in the meantime.',
   available_live_adapters:['calendar-ics'],
   missing_live_sources:['crm','mail','docs']
  });

  const w=await store.workspace(q.ws);
  let ctx=null,live=[];
  if(!sample&&q.user){const c=await store.getConnector(q.ws);if(c){try{let m=cache.get(q.ws);if(!m||Date.now()-m.at>6e4){m={at:Date.now(),evs:await fetchMeetings(unseal(c,secret),{allowPrivate:allowPrivateIcs})};cache.set(q.ws,m)}ctx={events:m.evs};live=['calendar-ics']}catch{return r.status(502).json({error:'CALENDAR_UNREACHABLE',message:'Your connected calendar could not be read. Reconnect it, or disconnect to use sample data.'})}}}
  const plan=buildPlan(b),effectiveGrants=sample?(Array.isArray(b.grants)?b.grants:[]):SERVER_FIXTURE_GRANTS,pre=preflight(plan,effectiveGrants),runId=crypto.randomUUID().slice(0,8);let res,ev,result;
  if(!pre.ok){res={inv:[],D:{}};ev={status:'BLOCKED',warnings:['Preflight failed: '+pre.checks.filter(c=>c.result==='fail').map(c=>c.id).join(', ')+'. Nothing was executed.'],reqs:CONTRACT.requirements.map(x=>({id:x.id,text:x.text,state:'UNKNOWN',note:''}))};result={}}
  else{res=execute(plan,String(b.hint||'').slice(0,80),DOTS,ctx);ev=evaluate(res);result=res.D?.s5?.value||{}}
  const receipt=makeReceipt({runId,plan,pre,res,ev,result,prev:w.last,priv:(sample||w.paid)?priv:null,keyId,sample,live});track(q.ws,sample?'demo_run':'run');if(!sample){w.runs++;w.last=sha(canon(receipt));await store.saveWorkspace(q.ws,w);await store.addReceipt(q.ws,receipt)}
  r.json({runId,status:ev.status,preflight:pre,halted:res.halted||null,brief:result,requirements:ev.reqs,warnings:ev.warnings,receipt,watermark:!w.paid})}));
 app.post('/api/verify',(q,r)=>r.json(verifyReceipt(q.body?.receipt,pub)));
 app.post('/api/workspace/unlock',h(async(q,r)=>{if(!q.user)return r.status(401).json({error:'LOGIN_REQUIRED'});if(!demoUnlock)return r.status(403).json({error:'PAYMENTS_NOT_CONFIGURED'});
  const w=await store.workspace(q.ws);w.paid=true;await store.saveWorkspace(q.ws,w);track(q.ws,'unlock');r.json({paid:true})}));
 const need=(q,r)=>q.user?true:(r.status(401).json({error:'LOGIN_REQUIRED'}),false),connLimit=mkLimit('conn',10);
 app.get('/api/connectors',h(async(q,r)=>r.json({calendar:{connected:!!(q.user&&await store.getConnector(q.ws))}})));
 app.post('/api/connectors/calendar',connLimit,h(async(q,r)=>{if(!need(q,r))return;const url=String(q.body?.url||'').trim().slice(0,2000);let evs;
  try{evs=await fetchMeetings(url,{allowPrivate:allowPrivateIcs})}catch(e){return r.status(400).json({error:'Could not read that calendar link: '+e.message+'.'})}
  await store.setConnector(q.ws,seal(url,secret));cache.set(q.ws,{at:Date.now(),evs});track(q.ws,'connector_connected');r.json({connected:true,upcoming:evs.length})}));
 app.post('/api/connectors/calendar/remove',h(async(q,r)=>{if(!need(q,r))return;await store.delConnector(q.ws);cache.delete(q.ws);r.json({connected:false})}));
 app.get('/api/admin/funnel',h(async(q,r)=>{const g=String(q.get('x-admin-token')||'');if(!adminToken||g.length!==adminToken.length||!crypto.timingSafeEqual(Buffer.from(g),Buffer.from(adminToken)))return r.status(404).json({error:'Not found'});r.json(funnel(await store.events()))}));
 app.get('/api/receipts',h(async(q,r)=>r.json(await store.receipts(q.ws))));
 app.use((e,q,r,n)=>{console.error(e);r.status(500).json({error:'Server error'})});
 return app}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const DATA=process.env.DATA_DIR||path.join(here,'data');fs.mkdirSync(DATA,{recursive:true});
 const rd=(f,mk)=>{const p=path.join(DATA,f);if(fs.existsSync(p))return fs.readFileSync(p);const v=mk();fs.writeFileSync(p,v);return v};
 const priv=process.env.SIGNING_KEY_PEM?crypto.createPrivateKey(process.env.SIGNING_KEY_PEM.replace(/\\n/g,'\n')):crypto.createPrivateKey(rd('key.pem',()=>crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})));
 const secret=process.env.SESSION_SECRET||rd('session.secret',()=>crypto.randomBytes(32).toString('hex')).toString();
 if(!process.env.SESSION_SECRET||!process.env.SIGNING_KEY_PEM)console.warn('WARNING: set SESSION_SECRET and SIGNING_KEY_PEM in production; generated values may be lost on redeploy.');
 let store;if(process.env.DATABASE_URL){const pg=(await import('pg')).default;store=pgStore(new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:false}:undefined}))}else store=fileStore(DATA);
 const app=await build({store,secret,priv,cap:Number(process.env.TRIAL_RUNS||5),demoUnlock:process.env.ALLOW_DEMO_UNLOCK!=='false'});
 app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Dotonomy listening',process.env.PORT||3000,'store:',store.kind))}
