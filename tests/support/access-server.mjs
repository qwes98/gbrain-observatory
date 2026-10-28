// Test-only Serve emulator. This file is never imported by application code.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const connectionDirectory = mkdtempSync(join(tmpdir(), 'observatory-browser-connection-'));
const connectionExecutable = join(connectionDirectory, 'gbrain');
copyFileSync('tests/support/fake-gbrain.mjs', connectionExecutable);
chmodSync(connectionExecutable, 0o700);
writeFileSync(join(connectionDirectory, 'scenario'), 'success');
writeFileSync(join(connectionDirectory, 'calls'), '');
writeFileSync('.next/connection-test-path', connectionDirectory);
process.on('exit', () => rmSync(connectionDirectory, { recursive: true, force: true }));

const owner = 'owner@example.test';
const externalOrigin = 'https://observatory.example.test:8443';
const browserOrigin = 'http://127.0.0.1:4173';
const children = [];
const servers = [];
let shuttingDown = false;

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const server of servers) server.close();
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function startNext(port, config) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, OBSERVATORY_GBRAIN_EXECUTABLE: '', OBSERVATORY_GBRAIN_CWD: '', OBSERVATORY_GBRAIN_READ_AUDIT: '', ...config }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  child.on('exit', code => { if (!shuttingDown) { stop(); process.exitCode = code || 1; } });
}

async function ready(port) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error('Test application did not become ready');
}

function proxy(port, backendPort) {
  const server = http.createServer((request, response) => {
    const headers = { ...request.headers };
    const cookieMode = /(?:^|;\s*)observatory-test-access=([^;]+)/.exec(headers.cookie || '')?.[1];
    const mode = headers['x-observatory-test-access'] || cookieMode || 'owner';
    // Simulate Serve's overwriting of incoming identity; browser values never survive.
    for (const name of Object.keys(headers)) {
      if (name.startsWith('tailscale-') || name.startsWith('x-forwarded-') || name.startsWith('x-observatory-test-') || name === 'forwarded' || name === 'x-real-ip') delete headers[name];
    }
    headers.host = new URL(externalOrigin).host;
    headers['x-forwarded-host'] = headers.host;
    headers['x-forwarded-proto'] = 'https';
    if (mode !== 'missing') headers['tailscale-user-login'] = mode === 'other' ? 'other@example.test' : mode === 'ambiguous' ? `${owner},other@example.test` : owner;
    if (mode === 'host') headers.host = 'hostile.example.test:8443';
    if (mode === 'origin' && request.method === 'POST') headers.origin = 'https://attacker.example.test';
    if (headers.origin === browserOrigin || headers.origin === `http://127.0.0.1:${port}`) headers.origin = externalOrigin;
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method, headers }, incoming => {
      response.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end('Test proxy unavailable'); });
    request.pipe(upstream);
  });
  servers.push(server);
  return new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
}

startNext(4175, { OBSERVATORY_OWNER_LOGIN: owner, OBSERVATORY_EXTERNAL_ORIGIN: externalOrigin });
startNext(4176, { OBSERVATORY_OWNER_LOGIN: '', OBSERVATORY_EXTERNAL_ORIGIN: 'http://invalid.example.test' });
startNext(4178, { OBSERVATORY_OWNER_LOGIN: owner, OBSERVATORY_EXTERNAL_ORIGIN: externalOrigin,
  OBSERVATORY_GBRAIN_EXECUTABLE: connectionExecutable, OBSERVATORY_GBRAIN_CWD: connectionDirectory, OBSERVATORY_GBRAIN_READ_AUDIT: 'local-read-reviewed' });
await Promise.all([ready(4175), ready(4176), ready(4178)]);
await Promise.all([proxy(4173, 4175), proxy(4177, 4176), proxy(4179, 4178)]);
