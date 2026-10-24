import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { FIX } from '../engine.js';

const in4 = (a, base, bits) => {
  const n = a.split('.').reduce((v, x) => (v * 256) + Number(x), 0);
  const b = base.split('.').reduce((v, x) => (v * 256) + Number(x), 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
};

const private4 = a => [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
].some(([base, bits]) => in4(a, base, bits));

const private6 = a => {
  const s = a.toLowerCase().split('%')[0];

  // Only allow global-unicast space (2000::/3), then exclude
  // known special-purpose, documentation and transition ranges.
  if (!/^[23]/.test(s)) return true;
  if (s.startsWith('2001:db8:')) return true;
  // Block the full 2001::/23 special-purpose range.
  if (s.startsWith('2001:')) {
    const second = s.split(':')[1] || '0';
    if (/^[0-9a-f]{1,4}$/.test(second) &&
        parseInt(second, 16) < 0x200) return true;
  }
  if (s.startsWith('2002:')) return true;
  if (s.startsWith('3fff:')) return true;
  return false;
};

export const blocked = address => {
  if (net.isIPv4(address)) return private4(address);
  if (net.isIPv6(address)) return private6(address);
  return true;
};

export function fetchText(url, { allowPrivate = false, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      reject(new Error('not a valid link'));
      return;
    }

    if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) {
      reject(new Error('link must start with https://'));
      return;
    }

    // IP literals may connect without invoking the custom DNS lookup callback.
    // Reject blocked literals before opening the connection.
    const literalHost = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(literalHost) && blocked(literalHost)) {
      reject(new Error('address not allowed'));
      return;
    }

    let settled = false;
    let deadline;
    let req;
    const deadlineMs = Number.isFinite(timeoutMs)
      ? Math.max(1, Math.min(timeoutMs, 8000))
      : 8000;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (err) reject(err);
      else resolve(value);
    };

    const lookup = (host, options, callback) => {
      // Resolve all answers once, reject mixed public/private answers,
      // then give the socket only addresses from that validated result.
      dns.lookup(host, { all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses.length) return callback(new Error('address not allowed'));

        if (!allowPrivate && addresses.some(x => blocked(x.address))) {
          return callback(new Error('address not allowed'));
        }

        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    };

    // Start the overall deadline before the request so DNS time counts too.
    deadline = setTimeout(() => {
      finish(new Error('calendar link timed out'));
      req?.destroy();
    }, deadlineMs);

    const transport = u.protocol === 'https:' ? https : http;
    req = transport.get(u, {
      lookup,
      timeout: 8000,
      headers: { 'user-agent': 'Dotonomy/0.5' }
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(new Error('calendar link returned status ' + response.statusCode));
        return;
      }

      let size = 0;
      const chunks = [];

      response.on('data', chunk => {
        if (settled) return;
        size += chunk.length;

        if (size > 2_000_000) {
          finish(new Error('calendar file too large'));
          response.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        if (!settled) finish(null, Buffer.concat(chunks).toString('utf8'));
      });

      response.on('error', () => {
        finish(new Error('could not read the calendar response'));
      });

      response.on('aborted', () => {
        finish(new Error('calendar response was interrupted'));
      });
    });

    req.on('timeout', () => {
      finish(new Error('calendar link timed out'));
      req.destroy();
    });

    req.on('error', err => {
      finish(new Error(
        /not allowed|valid/.test(err.message)
          ? err.message
          : 'could not reach the calendar link'
      ));
    });
  });
}

const unesc = value =>
  value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

const iso = value => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  return m
    ? `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}Z`
    : null;
};

export function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { att: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const i = line.indexOf(':');
    if (i < 0) continue;

    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    const name = key.split(';')[0].toUpperCase();

    if (name === 'SUMMARY') current.title = unesc(value);
    else if (name === 'UID') current.id = value;
    else if (name === 'DTSTART') current.start = iso(value);
    else if (name === 'DESCRIPTION') current.desc = unesc(value);
    else if (name === 'ATTENDEE') {
      const cn = /CN=("?)([^;:"]+)\1/.exec(key);
      current.att.push(cn ? cn[2] : value.replace(/^mailto:/i, ''));
    }
  }

  return events.filter(event => event.id && event.title && event.start);
}

export const clientOf = event => {
  const haystack = (
    event.title + ' ' + (event.desc || '') + ' ' + event.att.join(' ')
  ).toLowerCase();

  return Object.keys(FIX.crm).find(key =>
    haystack.includes(key.toLowerCase())
  ) || event.title;
};

export const toMeetings = (events, now = Date.now()) =>
  events.filter(event => {
    const time = Date.parse(event.start);
    return time >= now - 864e5 && time <= now + 14 * 864e5;
  }).map(event => ({
    id: 'ics:' + event.id.slice(0, 40),
    title: event.title.slice(0, 120),
    client: clientOf(event),
    start: event.start,
    attendees: event.att.length ? event.att.slice(0, 20) : ['(none listed)']
  }));

export const fetchMeetings = async (url, options) =>
  toMeetings(parseIcs(await fetchText(url, options)));
