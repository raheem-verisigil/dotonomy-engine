import https from 'node:https';import http from 'node:http';import dns from 'node:dns';import net from 'node:net';import {FIX} from '../engine.js';
const priv4=a=>{const[p,q]=a.split('.').map(Number);return p===10||p===127||p===0||p>=224||(p===169&&q===254)||(p===172&&q>=16&&q<=31)||(p===192&&q===168)||(p===100&&q>=64&&q<=127)};
export const blocked=a=>{if(net.isIPv4(a))return priv4(a);if(net.isIPv6(a)){const l=a.toLowerCase();if(l==='::1'||l==='::')return true;if(l.startsWith('::ffff:')&&net.isIPv4(l.slice(7)))return priv4(l.slice(7));return/^f[cd]/.test(l)||/^fe[89ab]/.test(l)}return true};
export function fetchText(url,{allowPrivate=false}={}){return new Promise((res,rej)=>{let u;try{u=new URL(url)}catch{return rej(new Error('not a valid link'))}
 if(u.protocol!=='https:'&&!(allowPrivate&&u.protocol==='http:'))return rej(new Error('link must start with https://'));
 const lookup=(host,o,cb)=>dns.lookup(host,o,(e,addr,fam)=>{if(e)return cb(e);const list=Array.isArray(addr)?addr:[{address:addr,family:fam}];if(!allowPrivate&&list.some(x=>blocked(x.address)))return cb(new Error('address not allowed'));Array.isArray(addr)?cb(null,list):cb(null,addr,fam)});
 const req=(u.protocol==='https:'?https:http).get(u,{lookup,timeout:8000,headers:{'user-agent':'Dotonomy/0.3'}},r=>{if(r.statusCode!==200){r.resume();return rej(new Error('calendar link returned status '+r.statusCode))}
  let n=0;const c=[];r.on('data',d=>{n+=d.length;if(n>2e6){req.destroy();rej(new Error('calendar file too large'))}else c.push(d)});r.on('end',()=>res(Buffer.concat(c).toString('utf8')))});
 req.on('timeout',()=>{req.destroy();rej(new Error('calendar link timed out'))});req.on('error',e=>rej(new Error(/not allowed|valid/.test(e.message)?e.message:'could not reach the calendar link')))})}
const unesc=v=>v.replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1');
const iso=v=>{const m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v);return m?`${m[1]}-${m[2]}-${m[3]}T${m[4]||'00'}:${m[5]||'00'}:${m[6]||'00'}Z`:null};
export function parseIcs(text){const lines=text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/),out=[];let cur=null;
 for(const l of lines){if(l==='BEGIN:VEVENT'){cur={att:[]};continue}if(l==='END:VEVENT'){if(cur)out.push(cur);cur=null;continue}if(!cur)continue;
  const i=l.indexOf(':');if(i<0)continue;const k=l.slice(0,i),v=l.slice(i+1),n=k.split(';')[0].toUpperCase();
  if(n==='SUMMARY')cur.title=unesc(v);else if(n==='UID')cur.id=v;else if(n==='DTSTART')cur.start=iso(v);else if(n==='DESCRIPTION')cur.desc=unesc(v);
  else if(n==='ATTENDEE'){const cn=/CN=("?)([^;:"]+)\1/.exec(k);cur.att.push(cn?cn[2]:v.replace(/^mailto:/i,''))}}
 return out.filter(e=>e.id&&e.title&&e.start)}
export const clientOf=e=>{const hay=(e.title+' '+(e.desc||'')+' '+e.att.join(' ')).toLowerCase();return Object.keys(FIX.crm).find(k=>hay.includes(k.toLowerCase()))||e.title};
export const toMeetings=(evs,now=Date.now())=>evs.filter(e=>{const t=Date.parse(e.start);return t>=now-864e5&&t<=now+14*864e5}).map(e=>({id:'ics:'+e.id.slice(0,40),title:e.title.slice(0,120),client:clientOf(e),start:e.start,attendees:e.att.length?e.att.slice(0,20):['(none listed)']}));
export const fetchMeetings=async(url,o)=>toMeetings(parseIcs(await fetchText(url,o)));
