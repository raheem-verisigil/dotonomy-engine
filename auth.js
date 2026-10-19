import crypto from 'node:crypto';
const b=x=>Buffer.from(x).toString('base64url');
export const hashPassword=pw=>{const s=crypto.randomBytes(16);return `s1$${s.toString('base64url')}$${crypto.scryptSync(pw,s,32).toString('base64url')}`};
export const verifyPassword=(pw,h)=>{try{const[,s,k]=h.split('$'),d=crypto.scryptSync(pw,Buffer.from(s,'base64url'),32),e=Buffer.from(k,'base64url');return d.length===e.length&&crypto.timingSafeEqual(d,e)}catch{return false}};
export const signToken=(sub,secret,ttl=7*864e5)=>{const p=b(JSON.stringify({sub,exp:Date.now()+ttl}));return p+'.'+crypto.createHmac('sha256',secret).update(p).digest('base64url')};
export const verifyToken=(t,secret)=>{try{const[p,s]=t.split('.'),e=crypto.createHmac('sha256',secret).update(p).digest('base64url');
 if(s.length!==e.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return null;const o=JSON.parse(Buffer.from(p,'base64url'));return o.exp>Date.now()?o.sub:null}catch{return null}};
export const parseCookies=h=>Object.fromEntries((h||'').split(';').map(c=>c.trim().split('=')).filter(x=>x[0]).map(([k,...v])=>[k,v.join('=')]));
