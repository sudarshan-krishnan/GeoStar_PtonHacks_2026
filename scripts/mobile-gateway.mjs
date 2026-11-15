#!/usr/bin/env node
// Lets the PlotStar phone app reach this laptop without opening the web app to the network.
//
// The Next.js app deliberately listens on 127.0.0.1 only (see README). This gateway listens on the
// network and forwards only the phone routes to it (/api/mobile/facilities[/<id>] and
// /api/mobile/drone/...), and only with the MOBILE_API_KEY bearer token. Everything else gets
// a 404. By default it only accepts connections from this Mac and from an iPhone hotspot's network
// (172.20.10.x), so it stays unreachable on venue Wi-Fi even when it's left running.
//
//   npm run dev                 # the web app, as usual
//   npm run mobile:gateway      # then scan the QR code with the iPhone camera
//   npm run mobile:pair         # show the pairing QR code again (e.g. for the background service)
//
// Env (or .env): MOBILE_API_KEY (created in .env if missing), MOBILE_PORT=3100,
// MOBILE_HOST=0.0.0.0, NEXT_URL=http://127.0.0.1:3000,
// MOBILE_ALLOW=127.0.0.1,::1,172.20.10. (address prefixes; "all" accepts any network).
// Flags: --no-qr, --pair (show the QR code and exit).
//
// Pairing roles: the app keeps a data link (sites and incidents) and a drone link. A laptop QR code
// sets both. Once the web app is deployed, point the data link at it and keep the laptop for the
// drone (the deployment needs the same MOBILE_API_KEY, or pass that deployment's key in the env):
//   npm run mobile:pair -- --url https://your-deployment.example --role data
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
import { networkInterfaces, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const PORT = Number(process.env.MOBILE_PORT || 3100);
const HOST = process.env.MOBILE_HOST || '0.0.0.0';
const NEXT = new URL(process.env.NEXT_URL || 'http://127.0.0.1:3000');
const ALLOWED =
  /^\/api\/mobile\/(probe|facilities(\/[a-z0-9-]{1,150})?|drone\/(status|video|snapshots|command|snapshot|captures\/[0-9]{8}-[0-9]{6}(-[0-9]{3})?(-sim)?\.jpg))$/;
const PEERS = (process.env.MOBILE_ALLOW || '127.0.0.1,::1,172.20.10.')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const peerAllowed = (address = '') => {
  const a = address.replace(/^::ffff:/, '');
  return PEERS.includes('all') || PEERS.some((p) => (p.endsWith('.') ? a.startsWith(p) : a === p));
};
const PAIR_ONLY = process.argv.includes('--pair');

// ---------------------------------------------------------------- the shared key
function keyFromEnv() {
  if (process.env.MOBILE_API_KEY) return process.env.MOBILE_API_KEY;
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').match(/^MOBILE_API_KEY\s*=\s*"?([^"\r\n]*)"?\s*$/m);
  return line ? line[1].trim() : '';
}
let key = keyFromEnv();
if (!key) {
  key = randomBytes(18).toString('base64url');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const entry = `MOBILE_API_KEY="${key}"`;
  writeFileSync(
    envPath,
    /^MOBILE_API_KEY\s*=.*$/m.test(text)
      ? text.replace(/^MOBILE_API_KEY\s*=.*$/m, entry)
      : `${text.replace(/\n?$/, '\n')}# Phone app access (scripts/mobile-gateway.mjs)\n${entry}\n`,
  );
  console.log('Created MOBILE_API_KEY in .env. If `npm run dev` was already running, restart it.\n');
}
if (process.argv.includes('--ensure-key')) process.exit(0); // used by scripts/mobile-service.sh
const expected = Buffer.from(key);
const authorized = (header = '') => {
  const token = Buffer.from(header.replace(/^Bearer /, ''));
  return token.length === expected.length && timingSafeEqual(token, expected);
};

// ---------------------------------------------------------------- the proxy
const hits = new Map();
const limited = (address) => {
  const now = Date.now();
  const entry = hits.get(address);
  const next = entry && now - entry.since < 60_000 ? { since: entry.since, n: entry.n + 1 } : { since: now, n: 1 };
  if (hits.size > 1000) hits.clear();
  hits.set(address, next);
  return next.n > 600; // a phone polling every 1-2 s uses well under this
};

const server = createServer((req, res) => {
  const started = Date.now();
  const address = req.socket.remoteAddress || '?';
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const log = (status) => console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - started} ms · ${address}`);
  // The URL parser resolves "..", "%2e" and backslashes, so the allow-list sees the real path.
  let url;
  try {
    url = new URL(req.url || '/', 'http://gateway');
  } catch {
    return reply(400, { error: 'Bad request.' });
  }
  if (url.pathname === '/health') return reply(200, { ok: true, service: 'plotstar-mobile-gateway' });
  if (!ALLOWED.test(url.pathname) || !['GET', 'POST'].includes(req.method || '')) {
    log(404);
    return reply(404, { error: 'Not found.' });
  }
  if (!authorized(req.headers.authorization)) {
    log(401);
    return reply(401, { error: 'Invalid phone access token.' });
  }
  if (limited(address)) {
    log(429);
    return reply(429, { error: 'Too many requests.' });
  }
  const upstream = forward(
    {
      hostname: NEXT.hostname,
      port: NEXT.port || 80,
      path: url.pathname + url.search,
      method: req.method,
      timeout: 30_000, // drone moves can take ~25 s; the video stream is never idle that long
      headers: {
        authorization: req.headers.authorization,
        accept: 'application/json',
        ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
    },
    (up) => {
      log(up.statusCode);
      res.writeHead(up.statusCode || 502, {
        'content-type': up.headers['content-type'] || 'application/json',
        'cache-control': 'no-store',
      });
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    log(502);
    reply(502, { error: `The PlotStar web app isn't answering at ${NEXT.origin}. Is \`npm run dev\` running?` });
  });
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 65_536) {
      upstream.destroy();
      req.destroy();
      if (!res.headersSent) reply(413, { error: 'Request too large.' });
    }
  });
  req.pipe(upstream);
});

// Drop connections from networks outside the allow-list before any HTTP is read.
const refused = new Set();
server.on('connection', (socket) => {
  if (peerAllowed(socket.remoteAddress)) return;
  const who = (socket.remoteAddress || '?').replace(/^::ffff:/, '');
  if (!refused.has(who) && refused.size < 200) {
    refused.add(who);
    console.log(`Refused a connection from ${who} (not this Mac or the hotspot; see MOBILE_ALLOW).`);
  }
  socket.destroy();
});

// ---------------------------------------------------------------- pairing
function lanAddresses() {
  const all = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  // An iPhone hotspot hands out 172.20.10.x; prefer it when present.
  return all.map((a) => a.address).sort((a, b) => Number(b.startsWith('172.20.10.')) - Number(a.startsWith('172.20.10.')));
}

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
function pair({ openQR }) {
  const deployed = flag('--url');
  const role = flag('--role') || (deployed ? 'data' : 'both');
  if (!['data', 'drone', 'both'].includes(role)) throw new Error('--role must be data, drone or both');
  const local = HOST === '0.0.0.0' ? lanAddresses() : [HOST];
  const usable = local.filter(peerAllowedForPhone);
  const base = deployed ? new URL(deployed).origin : `http://${usable[0] || local[0] || '127.0.0.1'}:${PORT}`;
  const link = `plotstar://connect?url=${encodeURIComponent(base)}&token=${encodeURIComponent(key)}&role=${role}`;
  if (!deployed && !usable.length)
    console.log('This Mac is not on an iPhone hotspot, so the phone cannot connect yet. Join the hotspot, then run `npm run mobile:pair`.\n');
  const what = { both: 'sites and drone', data: 'sites and incidents', drone: 'the drone' }[role];
  console.log(`Pair the app (${what}): scan the QR code with the iPhone camera, or enter\n  address: ${base}\n  access code: ${key}\n`);
  if (!openQR || platform() !== 'darwin') return;
  const png = join(tmpdir(), 'plotstar-pair.png');
  execFile('swift', [join(root, 'scripts', 'pair-qr.swift'), link, png], (err) => {
    if (err) return console.log('(Could not draw the QR code; enter the address and code instead.)');
    execFile('open', [png]);
  });
}
// The phone connects from the same network as this address; is that network allowed?
function peerAllowedForPhone(address) {
  return PEERS.includes('all') || PEERS.some((p) => p.endsWith('.') && address.startsWith(p));
}

if (PAIR_ONLY) {
  pair({ openQR: true });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`PlotStar phone gateway → ${NEXT.origin} (only /api/mobile/facilities and /api/mobile/drone)`);
    console.log(`  accepting: ${PEERS.join(', ')}`);
    for (const a of HOST === '0.0.0.0' ? lanAddresses() : [HOST]) console.log(`  listening on http://${a}:${PORT}`);
    console.log('');
    // A background service has no terminal and should not pop windows up.
    pair({ openQR: !process.argv.includes('--no-qr') && process.stdout.isTTY });
  });
}
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Set MOBILE_PORT to another port.` : err.message);
  process.exit(1);
});
