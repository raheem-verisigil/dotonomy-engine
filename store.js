import fs from 'node:fs';import path from 'node:path';
const dup=()=>Object.assign(new Error('EXISTS'),{code:'EXISTS'});
export function fileStore(dir){fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,'store.json');
 const S=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{};S.users??={};S.ws??={};S.receipts??=[];S.conn??={};S.events??=[];const save=()=>fs.writeFileSync(f,JSON.stringify(S));
 return{kind:'file',async init(){},
  async createUser(u){if(Object.values(S.users).some(x=>x.email===u.email))throw dup();S.users[u.id]=u;save()},
  async userByEmail(e){return Object.values(S.users).find(x=>x.email===e)||null},async userById(i){return S.users[i]||null},
  async workspace(id){if(!S.ws[id]){S.ws[id]={runs:0,paid:false,last:null};save()}return{...S.ws[id]}},
  async saveWorkspace(id,w){S.ws[id]={runs:w.runs,paid:w.paid,last:w.last};save()},
  async getConnector(ws){return S.conn[ws]||null},async setConnector(ws,d){S.conn[ws]=d;save()},async delConnector(ws){delete S.conn[ws];save()},
  async addEvent(ws,type){S.events.push({ws,type,at:new Date().toISOString()});if(S.events.length>1e5)S.events.shift();save()},async events(){return S.events.slice()},
  async addReceipt(ws,r){S.receipts.push({ws,receipt:r});save()},
  async receipts(ws){return S.receipts.filter(x=>x.ws===ws).map(x=>x.receipt).reverse()}}}
export function pgStore(pool){const q=(s,a)=>pool.query(s,a);
 return{kind:'pg',async init(){
  await q('create table if not exists users(id text primary key,email text unique not null,pass text not null)');
  await q('create table if not exists workspaces(id text primary key,runs int not null default 0,paid boolean not null default false,last_hash text)');
  await q('create table if not exists receipts(id text primary key,ws text not null,receipt jsonb not null,seq bigserial)');
  await q('create index if not exists receipts_ws on receipts(ws)');
  await q('create table if not exists connectors(ws text primary key,data text not null)');
  await q('create table if not exists events(id bigserial primary key,ws text not null,type text not null,at timestamptz not null default now())')},
  async createUser(u){try{await q('insert into users(id,email,pass) values($1,$2,$3)',[u.id,u.email,u.pass])}catch(e){if(e.code==='23505')throw dup();throw e}},
  async userByEmail(e){return(await q('select id,email,pass from users where email=$1',[e])).rows[0]||null},
  async userById(i){return(await q('select id,email,pass from users where id=$1',[i])).rows[0]||null},
  async workspace(id){await q('insert into workspaces(id) values($1) on conflict do nothing',[id]);const r=(await q('select runs,paid,last_hash from workspaces where id=$1',[id])).rows[0];return{runs:r.runs,paid:r.paid,last:r.last_hash}},
  async saveWorkspace(id,w){await q('update workspaces set runs=$2,paid=$3,last_hash=$4 where id=$1',[id,w.runs,w.paid,w.last])},
  async getConnector(ws){return(await q('select data from connectors where ws=$1',[ws])).rows[0]?.data||null},
  async setConnector(ws,d){await q('delete from connectors where ws=$1',[ws]);await q('insert into connectors(ws,data) values($1,$2)',[ws,d])},async delConnector(ws){await q('delete from connectors where ws=$1',[ws])},
  async addEvent(ws,type){await q('insert into events(ws,type) values($1,$2)',[ws,type])},async events(){return(await q('select ws,type,at from events order by id desc limit 100000')).rows.map(x=>({ws:x.ws,type:x.type,at:new Date(x.at).toISOString()}))},
  async addReceipt(ws,r){await q('insert into receipts(id,ws,receipt) values($1,$2,$3)',[r.receipt_id,ws,JSON.stringify(r)])},
  async receipts(ws){return(await q('select receipt from receipts where ws=$1 order by seq desc limit 200',[ws])).rows.map(x=>typeof x.receipt==='string'?JSON.parse(x.receipt):x.receipt)}}}
