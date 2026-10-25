import crypto from 'node:crypto';
import { canon, sha } from './canonical.js';
import { createProvenance, validateProvenance, validateCapturedProvenance } from './provenance.js';
export { canon, sha };
const ago=d=>new Date(Date.now()-d*864e5).toISOString();
const age=i=>(Date.now()-Date.parse(i))/864e5;
const lab=(...a)=>[...new Set(a.flat())];
export const FIX={
 events:[{id:'ev1',title:'Northstar quarterly review',client:'Northstar',start:ago(-1),attendees:['Ada Obi (CFO)','Tunde Bello (Ops)']},
  {id:'ev2',title:'Acme intro call',client:'Acme',start:ago(-1),attendees:['Kemi A.']},
  {id:'ev3',title:'Acme pricing session',client:'Acme',start:ago(-2),attendees:['Kemi A.']},
  {id:'ev4',title:'Globex check-in',client:'Globex',start:ago(-1),attendees:['J. Park']},
  {id:'ev5',title:'Horizon Global renewal review',client:'Horizon',start:ago(-1),attendees:['M. Reyes (VP Procurement)']}],
 crm:{Northstar:{id:'acc_88',name:'Northstar Ltd',stage:'Negotiation',opps:['Platform renewal ($240k)'],arr:240000,updated:ago(.25),internal_margin:'31%'},
  Globex:{id:'acc_91',name:'Globex',stage:'Qualified',opps:['Pilot ($60k)'],arr:60000,updated:ago(5),internal_margin:'22%'},
  Horizon:{id:'acc_77',name:'Horizon Global',stage:'Renewal',opps:['Annual renewal ($1.2M)'],arr:1200000,updated:ago(.1),internal_margin:'27%'}},
 mail:[{id:'m1',client:'Northstar',date:ago(17),subject:'Renewal terms',snippet:'Asked for a 12-month term and a revised SLA.'},
  {id:'m5',client:'Horizon',date:ago(3),subject:'Budget update',snippet:'Buyer revised budget ceiling down to $850,000.',budget:850000},
  {id:'m2',client:'Northstar',date:ago(240),subject:'Old onboarding note',snippet:'Onboarding completed.'}],
 docs:[{id:'d1',client:'Northstar',title:'Renewal proposal v2',modified:ago(21)}]};
export const RESTRICTED=['confidential','gov_id'];
const EFF=['read','compute','draft','reversible_write','irreversible_write'];
const day=s=>s.slice(0,10);
function compose(v){const C=[],f=(text,cites)=>C.push({kind:'fact',text,cites});
 f(`Meeting: ${v.Meeting.title}, ${v.Meeting.start.slice(0,16).replace('T',' ')} UTC.`,v.Meeting._src);
 f(`Attendees: ${v.Meeting.attendees.join(', ')}.`,v.Meeting._src);
 f(`${v.Account.name} is at stage "${v.Account.stage}". Open: ${v.Account.opps.join('; ')}.`,v.Account._src);
 v.Mail.items.filter(m=>m.budget!=null&&m.budget!==v.Account.arr).forEach(m=>f(`Conflict: CRM lists ARR $${v.Account.arr.toLocaleString('en-US')}, but email ${day(m.date)} states a budget ceiling of $${m.budget.toLocaleString('en-US')}. Both are shown; nothing was averaged or chosen.`,[v.Account._src[0],'mail:'+m.id]));
 if(v.Mail.items.length)v.Mail.items.forEach(m=>f(`Email ${day(m.date)} "${m.subject}": ${m.snippet}`,['mail:'+m.id]));else f('No related email in the last 180 days (query completed).',[v.Mail._src[0]]);
 if(v.Docs.items.length)v.Docs.items.forEach(d=>f(`Document "${d.title}", modified ${day(d.modified)}.`,['doc:'+d.id]));else f('No related documents found (query completed).',[v.Docs._src[0]]);
 C.push({kind:'suggestion',text:'Suggested: confirm next steps on the open opportunity.',cites:[]});
 const gaps=[];if(v.Mail.staleExcluded)gaps.push(`${v.Mail.staleExcluded} email(s) older than 180 days excluded.`);
 return{ok:true,value:{claims:C,gaps},src:[]}}
const captureEvidence = (sourceId, payload, origin='fixture', recordTime=null) => {
 const record = createProvenance({
  sourceId,
  origin,
  retrievedAt:new Date().toISOString(),
  recordTime,
  authorizationRef:null,
  payload,
  limitations:[
   origin==='fixture'
    ? 'Fixture-backed data; not independently authenticated.'
    : 'Source authenticity has not been independently established.',
   'Payload hash does not establish authenticity, authorization or freshness.'
  ]
 });
 const checked = validateProvenance(record, payload);
 if (!checked.valid) {
  const error = new Error('Source provenance validation failed: ' + checked.reason);
  error.code = 'E_PROVENANCE_INVALID';
  throw error;
 }
 return record;
};

export const DOTS={
 'calendar.find_meeting':{version:'1.0.0',effect:'read',perms:['calendar.read'],ins:[],out:'Meeting',accepts:{},forbid:[],labels:['business_contact'],
  run:(v,p)=>{const h=String(p.hint??'').toLowerCase(),L=p.ctx?.events||FIX.events;const m=L.filter(e=>e.id===p.hint||(h&&((typeof e.client==='string'&&e.client.toLowerCase().includes(h))||(typeof e.title==='string'&&e.title.toLowerCase().includes(h)))));
   if(m.length!==1)return{ok:false,code:m.length?'AMBIGUOUS_MATCH':'NO_MATCH',candidates:m.map(e=>e.title)};
   return{ok:true,value:m[0],src:[{
    id:'cal:'+m[0].id,
    provenance:captureEvidence(
     'cal:'+m[0].id,
     m[0],
     p.ctx?.events?'calendar-ics':'fixture',
     m[0].start
    )
   }]}}},
 'crm.get_account':{version:'1.0.0',effect:'read',perms:['crm.read'],ins:['Meeting'],out:'Account',extra:['internal_margin'],accepts:{Meeting:['client']},forbid:[],labels:['business_contact','confidential'],
  run:(v,p)=>{if(p.ctx?.events)return{ok:false,code:'NO_ACCOUNT',candidates:[]};const a=FIX.crm[v.Meeting.client];return a?{ok:true,value:a,src:[{
   id:'crm:'+a.id,
   provenance:captureEvidence('crm:'+a.id,a,'fixture',a.updated)
  }]}:{ok:false,code:'NO_ACCOUNT',candidates:[]}}},
 'mail.search_related':{version:'1.0.0',effect:'read',perms:['mail.read'],ins:['Meeting','Account'],out:'Mail',accepts:{Meeting:['client'],Account:['id']},forbid:[],labels:['confidential'],
  run:v=>{const all=FIX.mail.filter(m=>m.client===v.Meeting.client),items=all.filter(m=>age(m.date)<=180);
   return{ok:true,value:{items,staleExcluded:all.length-items.length},src:[
    {
     id:'qry:mail:'+v.Account.id,
     provenance:captureEvidence(
      'qry:mail:'+v.Account.id,
      {matched:all,returned:items,staleExcluded:all.length-items.length}
     )
    },
    ...items.map(m=>({
     id:'mail:'+m.id,
     provenance:captureEvidence('mail:'+m.id,m,'fixture',m.date)
    }))
   ]}}},
 'docs.search_related':{version:'1.0.0',effect:'read',perms:['docs.read'],ins:['Account'],out:'Docs',accepts:{Account:['id','name']},forbid:[],labels:['business_contact'],
  run:v=>{const items=FIX.docs.filter(d=>v.Account.name.startsWith(d.client));
   return{ok:true,value:{items},src:[
    {
     id:'qry:docs:'+v.Account.id,
     provenance:captureEvidence('qry:docs:'+v.Account.id,{matched:items})
    },
    ...items.map(d=>({
     id:'doc:'+d.id,
     provenance:captureEvidence('doc:'+d.id,d,'fixture',d.modified)
    }))
   ]}}},
 'brief.compose':{version:'1.0.0',effect:'draft',perms:[],ins:['Meeting','Account','Mail','Docs'],out:'Brief',
  accepts:{Meeting:['title','start','attendees'],Account:['name','stage','opps','arr'],Mail:['items','staleExcluded'],Docs:['items']},forbid:['gov_id'],labels:[],run:compose},
 'brief.validate':{version:'1.0.0',effect:'compute',perms:[],ins:['Brief'],out:'Validation',accepts:{Brief:['claims']},forbid:[],labels:[],
  run:(v,p)=>({ok:true,value:{unsupported:v.Brief.claims.filter(c=>c.kind==='fact'&&(!c.cites.length||c.cites.some(x=>!p.known.includes(x)))).map(c=>c.text)},src:[]})}};
export const CONTRACT={id:'client.meeting_readiness',version:'0.1.0',purpose:'meeting_preparation',maxEffect:'draft',
 requirements:[{id:'R1',text:'Correct meeting identified',dot:'calendar.find_meeting'},{id:'R2',text:'Account identified',dot:'crm.get_account'},
 {id:'R3',text:'Interactions checked (absence is recorded)',dot:'mail.search_related'},{id:'R4',text:'Sources fresh (CRM within 24h)',dot:'crm.get_account'},
 {id:'R5',text:'Every factual claim has a source',dot:'brief.validate'},{id:'R6',text:'Zero write actions'},{id:'R7',text:'Sources do not contradict each other',dot:'mail.search_related'}]};
const T={Meeting:{id:'string',title:'string',client:'string|null',start:'string',attendees:'array'},Account:{id:'string',name:'string',stage:'string',opps:'array',arr:'number',updated:'string'},Mail:{items:'array',staleExcluded:'number'},Docs:{items:'array'},Brief:{claims:'array',gaps:'array'},Validation:{unsupported:'array'}};
const ty=v=>Array.isArray(v)?'array':typeof v;
export function checkOutput(dot,r){const sch=T[dot.out];if(!r||typeof r.value!=='object'||r.value===null)return'output is not an object';
 for(const[k,t]of Object.entries(sch)){const actual=ty(r.value[k]);if(t.split('|').includes(actual))continue;return`field ${k} must be ${t}`;}
 const extra=Object.keys(r.value).filter(k=>!(k in sch)&&!(dot.extra||[]).includes(k));if(extra.length)return`undeclared field(s): ${extra.join(', ')}`;
 if(!Array.isArray(r.src)||r.src.some(x=>!x||typeof x.id!=='string'||!x.id))return'malformed evidence references';return null}
export function validateManifest(id,d){const e=[];['version','effect','perms','ins','out','accepts','forbid','labels','run'].forEach(k=>{if(d[k]===undefined)e.push('missing '+k)});
 if(d.effect&&!EFF.includes(d.effect))e.push('unknown effect '+d.effect);if(d.effect&&EFF.indexOf(d.effect)>2&&!d.compensation)e.push('write Dot needs a compensation entry');
 if(d.out&&!T[d.out])e.push('unknown output type '+d.out);if(d.labels&&d.labels.some(l=>!['public','business_contact','confidential','gov_id'].includes(l)))e.push('unknown label');return e}
export function registerDot(reg,id,d){const e=validateManifest(id,d);if(e.length)throw new Error(`Rejected ${id}: ${e.join('; ')}`);reg[id]=d;return reg}
Object.entries(DOTS).forEach(([id,d])=>{const e=validateManifest(id,d);if(e.length)throw new Error(`Core Dot ${id} invalid: ${e.join('; ')}`)});
const TEMPLATE=[['s1','calendar.find_meeting',[]],['s2','crm.get_account',['s1']],['s3','mail.search_related',['s1','s2']],['s4','docs.search_related',['s2']],['s5','brief.compose',['s1','s2','s3','s4']],['s6','brief.validate',['s5']]];
export function buildPlan(o={}){const p=TEMPLATE.map(([id,dot,deps])=>({id,dot,deps,ext:dot==='brief.compose'&&!!o.externalModel}));if(o.injectSend)p.push({id:'s7',dot:'mail.send',deps:['s5'],ext:false});return p}
export function validatePlan(plan, REG=DOTS) {
 const errors=[];
 if(!Array.isArray(plan)) return {ok:false,errors:['plan must be an array']};
 if(plan.length===0) return {ok:false,errors:['plan must contain at least one step']};
 const positions=new Map();
 for(let i=0;i<plan.length;i++){
  const step=plan[i];
  if(!step||typeof step!=='object'||Array.isArray(step)){
   errors.push(`step at index ${i} must be an object`);continue;
  }
  if(typeof step.id!=='string'||!step.id.trim()){
   errors.push(`step at index ${i} needs a non-empty id`);continue;
  }
  if(positions.has(step.id)){
   errors.push(`duplicate step id: ${step.id}`);
  }else positions.set(step.id,i);
  if(typeof step.dot!=='string'||!step.dot.trim()){
   errors.push(`step ${step.id} needs a Dot id`);
  }else if(!REG[step.dot]){
   errors.push(`unregistered Dot: ${step.dot}`);
  }
  if(!Array.isArray(step.deps)){
   errors.push(`dependencies for ${step.id} must be an array`);
  }
 }
 for(let i=0;i<plan.length;i++){
  const step=plan[i];
  if(!step||typeof step!=='object'||typeof step.id!=='string'||!Array.isArray(step.deps))continue;
  for(const dep of step.deps){
   if(typeof dep!=='string'||!positions.has(dep)){
    errors.push(`missing dependency ${String(dep)} for ${step.id}`);
   }else if(positions.get(dep)>=i){
    errors.push(`dependency ${dep} must precede step ${step.id}`);
   }
  }
 }
 const color=new Map(),stack=[];
 function visit(id){
  color.set(id,1);stack.push(id);
  const step=plan[positions.get(id)];
  for(const dep of Array.isArray(step?.deps)?step.deps:[]){
   if(!positions.has(dep))continue;
   if(color.get(dep)===1){
    const start=stack.indexOf(dep);
    errors.push(`dependency cycle: ${[...stack.slice(start),dep].join(' -> ')}`);
   }else if(!color.has(dep))visit(dep);
  }
  stack.pop();color.set(id,2);
 }
 for(const id of positions.keys())if(!color.has(id))visit(id);
 return {ok:errors.length===0,errors:[...new Set(errors)]};
}

export function preflight(plan,grants,REG=DOTS){const out=[],by=Object.fromEntries(plan.map(s=>[s.id,s])),reg=s=>REG[s.dot];
 const add=(id,name,bad)=>out.push({id,name,result:bad.length?'fail':'pass',detail:bad.join('; ')||'ok'});
 const graph=validatePlan(plan,REG);add('P0','Plan graph is valid',graph.errors);
 add('P8','Every Dot is registered and trusted',plan.filter(s=>!reg(s)).map(s=>`${s.dot} is not in the registry`));
 const ok=plan.filter(reg);
 add('P1','Types match along every edge',ok.flatMap(s=>s.deps.filter(d=>by[d]&&reg(by[d])&&!reg(s).ins.includes(reg(by[d]).out)).map(d=>`${by[d].dot} to ${s.dot}`)));
 add('P2','Permissions covered by the grant',[...new Set(ok.flatMap(s=>reg(s).perms))].filter(p=>!grants.includes(p)).map(p=>`missing ${p}`));
 const L={};ok.forEach(s=>{L[s.id]=lab(reg(s).labels,s.deps.flatMap(d=>L[d]||[]))});
 add('P3','No forbidden label reaches a Dot',ok.filter(s=>L[s.id].some(l=>reg(s).forbid.includes(l))).map(s=>s.dot));
 add('P4','Restricted data never reaches an external model',ok.filter(s=>s.ext&&L[s.id].some(l=>RESTRICTED.includes(l))).map(s=>`${s.dot} would receive ${L[s.id].filter(l=>RESTRICTED.includes(l)).join('+')}`));
 add('P5','Effect ceiling respected (draft)',ok.filter(s=>EFF.indexOf(reg(s).effect)>EFF.indexOf(CONTRACT.maxEffect)).map(s=>`${s.dot} is ${reg(s).effect}`));
 add('P7','Every hard requirement has an evidence path',CONTRACT.requirements.filter(r=>r.dot&&!plan.some(s=>s.dot===r.dot)).map(r=>r.id));
 return{ok:out.every(c=>c.result==='pass'),checks:out}}
export function execute(plan,hint,REG=DOTS,ctx=null){const graph=validatePlan(plan,REG);if(!graph.ok)return{halted:{step:null,dot:null,code:'E_INVALID_PLAN',candidates:graph.errors},inv:[],D:{}};const D={},inv=[],known=[];
 for(const s of plan){const dot=REG[s.dot],view={},recv={};
  for(const d of s.deps){const x=D[d],f=dot.accepts[x.type]||[];view[x.type]={_src:x.src.map(q=>q.id)};f.forEach(k=>view[x.type][k]=x.value[k]);recv[x.type]=f}
  let r;
  try {
   r=dot.run(view,{hint,known,ctx});
  } catch(error) {
   r={
    ok:false,
    code:error?.code==='E_PROVENANCE_INVALID'?'E_PROVENANCE_INVALID':'E_DOT_ERROR',
    candidates:[]
   };
  }
  if(r.ok){
   const bad=checkOutput(dot,r);
   if(bad)r={ok:false,code:'E_OUTPUT_INVALID',candidates:[bad]};
  }
  if(r.ok){
   const invalidSource=r.src.find(source =>
    !source ||
    typeof source.id!=='string' ||
    !source.provenance ||
    source.provenance.source_id!==source.id ||
    !validateCapturedProvenance(source.provenance).valid
   );
   if(invalidSource){
    r={
     ok:false,
     code:'E_PROVENANCE_INVALID',
     candidates:[typeof invalidSource?.id==='string'
      ? invalidSource.id
      : 'source reference has invalid provenance']
    };
   }
  }
  // DOTONOMY_DIRECT_SOURCE_PAYLOAD_BINDING_GUARD
  // Direct record outputs must match the payload committed by their provenance.
  // This establishes payload consistency, not source authenticity.
  if (r.ok) {
   const mismatchedDirectSource = r.src.find(source =>
    /^(cal|crm):/.test(source.id) &&
    !validateProvenance(source.provenance, r.value).valid
   );
   if (mismatchedDirectSource) {
    r = {
     ok: false,
     code: 'E_PROVENANCE_INVALID',
     candidates: [
      mismatchedDirectSource.id,
      'OUTPUT_PAYLOAD_MISMATCH'
     ]
    };
   }
  }
  inv.push({step:s.id,dot:s.dot,version:dot.version,effect:dot.effect,received:recv,ok:r.ok});
  if(!r.ok)return{halted:{step:s.id,dot:s.dot,code:r.code,candidates:r.candidates},inv,D};
  D[s.id]={type:dot.out,value:r.value,src:r.src,labels:lab(dot.labels,s.deps.flatMap(d=>D[d].labels)),by:{dot:s.dot,version:dot.version}};
  r.src.forEach(q=>known.push(q.id))}
 return{inv,D}}
export function evaluate(res){const R=[];const q=(i,state,note)=>R.push({id:i,text:CONTRACT.requirements[i-1].text,state,note:note||''});
 const rs=(id,s,n)=>R.push({id,text:CONTRACT.requirements.find(r=>r.id===id).text,state:s,note:n||''});
 if(res.halted){const h=res.halted,amb=h.code==='AMBIGUOUS_MATCH',soft=['AMBIGUOUS_MATCH','NO_MATCH','NO_ACCOUNT'].includes(h.code);
  CONTRACT.requirements.forEach(r=>rs(r.id,r.dot===h.dot?(amb?'CONFLICTED':'FAILED'):'UNKNOWN',r.dot===h.dot?`${h.code}: ${(h.candidates||[]).join(' | ')||'none'}`:''));
  return{reqs:R,status:soft?'BLOCKED':'FAILED',warnings:[`Stopped at ${h.dot}: ${h.code}.${soft?' Ask the user to choose.':' Output rejected by the runtime.'}`]}}
 const D=res.D,crm=D.s2.value,mail=D.s3.value,stale=age(crm.updated)>1;
 rs('R1','SATISFIED');rs('R2','SATISFIED');rs('R3','SATISFIED',mail.items.length?`${mail.items.length} email(s) found`:'supported absence: query completed, none found');
 rs('R4',stale?'STALE':'SATISFIED',stale?`CRM record is ${age(crm.updated).toFixed(1)} days old`:'');
 const bad=D.s6.value.unsupported;rs('R5',bad.length?'FAILED':'SATISFIED',bad.length?`${bad.length} unsupported`:'');
 rs('R6',res.inv.every(i=>EFF.indexOf(i.effect)<=2)?'SATISFIED':'FAILED');
 const cf=mail.items.filter(m=>m.budget!=null&&m.budget!==crm.arr);rs('R7',cf.length?'CONFLICTED':'SATISFIED',cf.length?`CRM ARR ${crm.arr} vs email budget ${cf[0].budget}`:'');
 const st=R.some(r=>r.state==='FAILED')?'FAILED':R.some(r=>r.state==='STALE'||r.state==='CONFLICTED')?'CONDITIONAL':'SATISFIED';
 return{reqs:R,status:st,warnings:[...(D.s5.value.gaps||[]),...(cf.length?['Sources disagree on budget. Verify before the meeting.']:[]),...(stale?['CRM data is stale; verify before the meeting.']:[])]}}
export function makeReceipt({runId,plan,pre,res,ev,result,prev,priv,keyId,sample,live}){
 const body={receipt_id:'rcpt_'+runId,run_id:runId,contract:{id:CONTRACT.id,version:CONTRACT.version},created_at:new Date().toISOString(),plan_hash:sha(canon(plan)),
  policy_decisions:pre.checks.map(c=>({check:c.id,result:c.result})),dots:res.inv.map(i=>({id:i.dot,version:i.version,step:i.step,effect:i.effect})),
  datums:Object.entries(res.D||{}).map(([step,d])=>{
   const sources=Array.isArray(d.src)?d.src:[];
   const sourceById=new Map();
   for(const source of sources){
    if(typeof source?.id==='string'&&source.id.length>0&&!sourceById.has(source.id)){
     sourceById.set(source.id,source);
    }
   }
   const sourceRefs=[...sourceById.keys()].sort();
   const provenanceRecords=sourceRefs.map(sourceId=>{
    const source=sourceById.get(sourceId);
    const p=source?.provenance;
    const safeFields=['schema','version','source_id','origin','retrieved_at','record_time',
     'authorization_ref','integrity_hash','verification_status','limitations'];
    const captured=p&&p.source_id===sourceId&&
     typeof p.integrity_hash==='string'&&
     /^sha256:[a-f0-9]{64}$/.test(p.integrity_hash)&&
     p.verification_status==='unverified';
    const metadata=captured
     ?Object.fromEntries(safeFields.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]))
     :null;
    return {
     source_id:sourceId,
     evidence_kind:sourceId.startsWith('qry:')?'query_reference':'record_reference',
     verification_status:'unverified',
     integrity_hash:metadata?.integrity_hash??null,
     captured_provenance:metadata,
     limitations:metadata?.limitations??[
      'Reference identifier only; no captured source-provenance record was available for this reference.',
      'Source authenticity, authorization, and freshness are not established.'
     ]
    };
   });
   const capturedCount=provenanceRecords.filter(p=>p.captured_provenance!==null).length;
   const provenanceStatus=sourceRefs.length===0?'NO_SOURCE_REFERENCES':
    capturedCount===sourceRefs.length?'CAPTURED_UNVERIFIED':
    capturedCount>0?'PARTIAL_UNVERIFIED':'REFERENCE_ONLY';
   return {
    step,type:d.type,labels:d.labels,hash:sha(canon(d.value)),
    source_refs:sourceRefs,
    source_reference_hash:sha(canon(sourceRefs)),
    provenance_status:provenanceStatus,
    provenance_records:provenanceRecords
   };
  }),
  requirements:ev.reqs.map(({id,state})=>({id,state})),outcome_status:ev.status,warnings:ev.warnings,result_hash:sha(canon(result)),
  prev_receipt_hash:prev||null,signed:!!priv,sample:!!sample,live_sources:live||[],key_id:keyId,signature:null};
 if(priv){const {signature,...rest}=body;body.signature=crypto.sign(null,Buffer.from(canon(rest)),priv).toString('base64')}
 return body}

export function verifyReceiptChain(receipts, pub, options = {}) {
  const fail = (reason, index = null, consistent = false) => ({
    valid: false,
    chain_consistent: consistent,
    complete: false,
    anchored: false,
    reason,
    failed_index: index,
    receipt_count: Array.isArray(receipts) ? receipts.length : 0,
    source_authenticity: 'NOT_ESTABLISHED',
    signer_trust: 'NOT_ESTABLISHED'
  });

  if (!Array.isArray(receipts) || receipts.length === 0 ||
      !options || typeof options !== 'object' || Array.isArray(options)) {
    return fail('EMPTY_OR_MALFORMED_CHAIN');
  }

  const hasExpectedHead = Object.hasOwn(options, 'expectedHeadHash');
  const hasExpectedFirst = Object.hasOwn(options, 'expectedFirstPrevHash');
  const expectedHeadHash = options.expectedHeadHash;
  const expectedFirstPrevHash = options.expectedFirstPrevHash;

  if (hasExpectedHead &&
      (typeof expectedHeadHash !== 'string' ||
       !/^sha256:[a-f0-9]{64}$/.test(expectedHeadHash))) {
    return fail('MALFORMED_EXPECTED_HEAD_HASH');
  }
  if (hasExpectedFirst && expectedFirstPrevHash !== null &&
      (typeof expectedFirstPrevHash !== 'string' ||
       !/^sha256:[a-f0-9]{64}$/.test(expectedFirstPrevHash))) {
    return fail('MALFORMED_FIRST_PREDECESSOR_CHECKPOINT');
  }

  let previousHash = null;

  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i];
    const checked = verifyReceipt(receipt, pub);
    if (!checked.valid) {
      return fail('RECEIPT_INVALID:' + checked.reason, i);
    }

    const predecessor = receipt.prev_receipt_hash ?? null;
    if (predecessor !== null &&
        (typeof predecessor !== 'string' ||
         !/^sha256:[a-f0-9]{64}$/.test(predecessor))) {
      return fail('MALFORMED_PREDECESSOR_HASH', i);
    }

    if (i === 0) {
      if (hasExpectedFirst && predecessor !== expectedFirstPrevHash) {
        return fail('FIRST_PREDECESSOR_CHECKPOINT_MISMATCH', i);
      }
    } else if (predecessor !== previousHash) {
      return fail('BROKEN_PREDECESSOR_LINK', i);
    }

    previousHash = sha(canon(receipt));
  }

  const firstPrev = receipts[0].prev_receipt_hash ?? null;
  const headHash = previousHash;
  const complete = hasExpectedFirst &&
    firstPrev === expectedFirstPrevHash;
  const anchored = hasExpectedHead &&
    headHash === expectedHeadHash;

  if (hasExpectedHead && !anchored) {
    return fail('EXPECTED_HEAD_MISMATCH', receipts.length - 1, true);
  }

  return {
    valid: true,
    chain_consistent: true,
    complete,
    anchored,
    reason: !complete ? 'CHAIN_CONSISTENT_BUT_INCOMPLETE' : !anchored ? 'CHAIN_CONSISTENT_BUT_UNANCHORED' : 'CHAIN_COMPLETE_AND_ANCHORED',
    receipt_count: receipts.length,
    first_predecessor_hash: firstPrev,
    head_hash: headHash,
    source_authenticity: 'NOT_ESTABLISHED',
    signer_trust: 'NOT_ESTABLISHED',
    limitations: [
      'Signature verification does not establish source authenticity.',
      'Signer trust must be established independently.',
      'A signed receipt does not independently prove an external action occurred.',
      'Completeness requires an explicitly supplied trusted starting checkpoint.',
      'Anchoring requires an explicitly supplied trusted expected head hash.'
    ]
  };
}
export function verifyReceipt(r, pub) {
  const result = (valid, reason, signatureValid = false) => ({
    valid,
    reason,
    signature_valid: signatureValid,
    source_authenticity: 'NOT_ESTABLISHED',
    signer_trust: 'NOT_ESTABLISHED',
    limitations: [
      'Signature verification does not establish source authenticity.',
      'The verifier must independently establish trust in the signing key.',
      'A signed receipt does not independently prove that an external action occurred.'
    ]
  });

  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return result(false, 'MALFORMED_RECEIPT');
  }

  if (typeof r.signature !== 'string' || !r.signature.trim()) {
    return result(false, 'UNSIGNED_PREVIEW');
  }

  if (typeof r.key_id !== 'string' || !r.key_id.trim()) {
    return result(false, 'MISSING_KEY_ID');
  }

  if (!pub) {
    return result(false, 'VERIFICATION_KEY_UNAVAILABLE');
  }

  try {
    const publicKey =
      pub && typeof pub === 'object' && pub.type === 'public'
        ? pub
        : crypto.createPublicKey(pub);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const expectedKeyId = sha(publicKeyPem).slice(0, 19);

    if (r.key_id !== expectedKeyId) {
      return result(false, 'KEY_ID_MISMATCH');
    }

    const signature = Buffer.from(r.signature, 'base64');

    if (
      signature.length !== 64 ||
      signature.toString('base64') !== r.signature
    ) {
      return result(false, 'MALFORMED_SIGNATURE');
    }

    const { signature: ignored, ...body } = r;
    const valid = crypto.verify(
      null,
      Buffer.from(canon(body)),
      publicKey,
      signature
    );

    return valid
      ? result(true, 'SIGNATURE_VALID', true)
      : result(false, 'TAMPERED: content does not match the signature');
  } catch {
    return result(false, 'MALFORMED');
  }
}
