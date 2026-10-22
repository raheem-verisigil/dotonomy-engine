// Offline receipt check: node verify-cli.js receipt.json public-key.pem
import fs from 'node:fs';import crypto from 'node:crypto';import {verifyReceipt} from './engine.js';
const[,,rf,kf]=process.argv;if(!rf||!kf){console.log('usage: node verify-cli.js receipt.json public-key.pem');process.exit(2)}
const r=verifyReceipt(JSON.parse(fs.readFileSync(rf,'utf8')),crypto.createPublicKey(fs.readFileSync(kf)));console.log(r.valid?'VALID':'INVALID',r.reason);process.exit(r.valid?0:1)
