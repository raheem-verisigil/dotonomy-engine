import express from 'express';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {buildPlan,preflight,execute,evaluate,makeReceipt,verifyReceipt,DOTS,CONTRACT,canon,sha} from './engine.js';
const here=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.DATA_DIR||path.join(here,'data');fs.mkdirSync(DATA,{recursive:true});
const kp=path.join(DATA,'key.pem');let priv;
if(process.env.SIGNING_KEY_PEM)priv=crypto.createPrivateKey(process.env.SIGNING_KEY_PEM.replace(/\\n/g,'\n'));
else if(fs.existsSync(kp))priv=crypto.createPrivateKey(fs.readFileSync(kp));
else{priv=crypto.generateKeyPairSync('ed25519').privateKey;fs.writeFileSync(kp,priv.export({type:'pkcs8',format:'pem'}))}
const pub=crypto.createPublicKey(priv),pubPem=pub.export({type:'spki',format:'pem'}),keyId=sha(pubPem).slice(0,19);
const sp=path.join(DATA,'store.json');const S=fs.existsSync(sp)?JSON.parse(fs.readFileSync(sp,'utf8')):{ws:{},receipts:[]};
const save=()=>fs.writeFileSync(sp,JSON.stringify(S));const CAP=Number(process.env.TRIAL_RUNS||5);
const wsOf=req=>{const id=(req.get('x-workspace')||'anon').replace(/[^\w-]/g,'').slice(0,40)||'anon';S.ws[id]??={runs:0,paid:false,last:null};return[id,S.ws[id]]};
const app=express();app.use(express.json({limit:'200kb'}));app.use(express.static(path.join(here,'public')));
app.get('/api/health',(q,r)=>r.json({ok:true,version:'0.1.0'}));
app.get('/api/state',(q,r)=>{const[,w]=wsOf(q);r.json({runs:w.runs,cap:CAP,paid:w.paid,publicKey:pubPem,keyId,contract:CONTRACT})});
app.get('/api/dots',(q,r)=>r.json(Object.entries(DOTS).map(([id,d])=>({id,version:d.version,effect:d.effect,permissions:d.perms,inputs:d.ins,output:d.out,accepts:d.accepts,labels:d.labels,forbidden:d.forbid}))));
app.post('/api/plan',(q,r)=>{const b=q.body||{};r.json({plan:buildPlan(b),...preflight(buildPlan(b),b.grants||[])})});
app.post('/api/run',(q,r)=>{const[id,w]=wsOf(q),b=q.body||{};if(!w.paid&&w.runs>=CAP)return r.status(402).json({error:'TRIAL_CAP_REACHED'});
 const plan=buildPlan(b),pre=preflight(plan,b.grants||[]),runId=crypto.randomUUID().slice(0,8);let res,ev,result;
 if(!pre.ok){res={inv:[],D:{}};ev={status:'BLOCKED',warnings:['Preflight failed: '+pre.checks.filter(c=>c.result==='fail').map(c=>c.id).join(', ')+'. Nothing was executed.'],reqs:CONTRACT.requirements.map(x=>({id:x.id,text:x.text,state:'UNKNOWN',note:''}))};result={}}
 else{res=execute(plan,String(b.hint||'').slice(0,80));ev=evaluate(res);result=res.D?.s5?.value||{}}
 const receipt=makeReceipt({runId,plan,pre,res,ev,result,prev:w.last,priv:w.paid?priv:null,keyId});w.runs++;w.last=sha(canon(receipt));
 S.receipts.push({ws:id,receipt});save();
 r.json({runId,status:ev.status,preflight:pre,halted:res.halted||null,brief:result,requirements:ev.reqs,warnings:ev.warnings,receipt,watermark:!w.paid})});
app.post('/api/verify',(q,r)=>r.json(verifyReceipt(q.body?.receipt,pub)));
app.post('/api/workspace/unlock',(q,r)=>{if(process.env.ALLOW_DEMO_UNLOCK==='false')return r.status(403).json({error:'PAYMENTS_NOT_CONFIGURED'});const[,w]=wsOf(q);w.paid=true;save();r.json({paid:true})});
app.get('/api/receipts',(q,r)=>{const[id]=wsOf(q);r.json(S.receipts.filter(x=>x.ws===id).map(x=>x.receipt).reverse())});
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Dotonomy listening',process.env.PORT||3000));
