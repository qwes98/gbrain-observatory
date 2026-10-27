#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

const marker = 'gbrain-observatory-serve-v1';
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function settings(env = process.env) {
  let origin;
  try { origin = new URL(env.OBSERVATORY_EXTERNAL_ORIGIN); } catch { throw new Error('Configure a dedicated HTTPS external origin first.'); }
  requireCondition(origin.protocol === 'https:' && origin.origin === env.OBSERVATORY_EXTERNAL_ORIGIN &&
    origin.hostname.endsWith('.ts.net') && origin.username === '' && origin.password === '' &&
    origin.port !== '' && Number(origin.port) >= 1024 && Number(origin.port) !== 3000,
  'Use a canonical Tailscale HTTPS origin with a dedicated port above 1023, excluding 3000.');
  const appPort = Number(env.OBSERVATORY_APP_PORT ?? 3443);
  requireCondition(Number.isInteger(appPort) && appPort >= 1024 && appPort <= 65535 && appPort !== 3000 && appPort !== Number(origin.port),
    'Use an unoccupied dedicated application port above 1023, excluding 3000 and the HTTPS port.');
  return { origin: origin.origin, hostPort: origin.host, httpsPort: Number(origin.port), appPort, target: `http://127.0.0.1:${appPort}` };
}

// Walk all known scopes, including foreground sessions and Services. Unknown fields
// remain in the preservation comparison, so a CLI schema change fails verification.
function scopes(config) {
  requireCondition(object(config), 'Serve returned an invalid configuration.');
  const result = [config];
  for (const name of ['Foreground', 'Services']) {
    if (config[name] !== undefined) {
      requireCondition(object(config[name]), 'Serve returned an invalid configuration scope.');
      for (const child of Object.values(config[name])) result.push(...scopes(child));
    }
  }
  return result;
}
function usesPort(scope, port) {
  for (const name of ['TCP', 'Web', 'AllowFunnel']) {
    if (scope[name] !== undefined) requireCondition(object(scope[name]), 'Serve returned an invalid endpoint map.');
    for (const key of Object.keys(scope[name] ?? {})) {
      if ((name === 'TCP' && key === String(port)) || (name !== 'TCP' && key.endsWith(`:${port}`))) return true;
    }
  }
  return false;
}
export function hasCollision(config, port) { return scopes(config).some(scope => usesPort(scope, port)); }
export function withoutEndpoint(config, options) {
  const remaining = copy(config);
  for (const [name, key] of [['TCP', String(options.httpsPort)], ['Web', options.hostPort], ['AllowFunnel', options.hostPort]]) {
    if (remaining[name]) {
      delete remaining[name][key];
      if (Object.keys(remaining[name]).length === 0) delete remaining[name];
    }
  }
  return remaining;
}
function owned(config, options) {
  requireCondition(canonical(config.TCP?.[options.httpsPort]) === canonical({ HTTPS: true }) &&
    canonical(config.Web?.[options.hostPort]) === canonical({ Handlers: { '/': { Proxy: options.target } } }) &&
    config.AllowFunnel?.[options.hostPort] !== true,
  'The dedicated endpoint no longer matches the owned private mapping; refusing removal.');
  requireCondition(!hasCollision(withoutEndpoint(config, options), options.httpsPort),
    'Another endpoint or scope uses the selected port; refusing removal.');
}
export async function portFree(port) {
  const listener = createServer();
  await new Promise((resolveCheck, reject) => {
    listener.once('error', () => reject(new Error('A selected port is already occupied.')));
    // An unspecified bind catches public as well as loopback listeners.
    listener.listen({ port, host: '::', ipv6Only: false, exclusive: true }, resolveCheck);
  });
  await new Promise((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()));
}
function cli(args) {
  const result = spawnSync('tailscale', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024, shell: false });
  requireCondition(!result.error && result.status === 0, 'Tailscale command failed; inspect its state privately before retrying.');
  return result.stdout;
}

export async function lifecycle(action, options, dependencies = {}) {
  requireCondition(['check', 'install', 'remove'].includes(action), 'Usage: node scripts/observatory-serve.mjs check|install|remove');
  const run = dependencies.run ?? cli;
  const probe = dependencies.probe ?? portFree;
  const stateDir = dependencies.stateDir ?? join(homedir(), '.local', 'state', 'gbrain-observatory');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const lockPath = join(stateDir, 'serve.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Another lifecycle operation is active; inspect the private lock before retrying.'); });
  const manifestPath = join(stateDir, 'serve-mapping.json');
  const readStatus = async () => {
    let config;
    try { config = JSON.parse(await run(['serve', 'status', '--json'])); } catch { throw new Error('Could not read valid Serve status; no further changes attempted.'); }
    // A fresh node may have no stored configuration.
    config ??= {};
    scopes(config);
    return config;
  };
  const mutate = async (args, phase) => {
    try {
      await run(args);
    } catch (error) {
      // A failing or timed-out command may already have changed the endpoint.
      // Capture current state without a compensating mutation or replacing the
      // original failure if status or evidence writing is unavailable.
      try {
        const after = await readStatus();
        await writeFile(join(stateDir, `after-${phase}.json`), JSON.stringify(after), { mode: 0o600 });
      } catch {
        // The original command failure remains the actionable result.
      }
      throw error;
    }
  };
  try {
    let node;
    try { node = JSON.parse(await run(['status', '--json'])); } catch { throw new Error('Could not verify the local Tailscale node.'); }
    requireCondition(typeof node?.Self?.DNSName === 'string' && node.Self.DNSName.replace(/\.$/, '') === new URL(options.origin).hostname,
      'The configured external origin does not match this Tailscale node.');
    const before = await readStatus();
    if (action === 'remove') {
      let manifest;
      try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error('No readable Observatory ownership record; refusing removal.'); }
      requireCondition(manifest.marker === marker && manifest.phase === 'installed' && canonical(manifest.options) === canonical(options),
        'Ownership record does not match this mapping; refusing removal.');
      owned(before, options);
      const rechecked = await readStatus();
      requireCondition(canonical(before) === canonical(rechecked), 'Serve changed during preflight; retry after other operations finish.');
      await writeFile(join(stateDir, 'before-remove.json'), JSON.stringify(before), { mode: 0o600 });
      await mutate(['serve', `--https=${options.httpsPort}`, 'off'], 'remove');
      const after = await readStatus();
      await writeFile(join(stateDir, 'after-remove.json'), JSON.stringify(after), { mode: 0o600 });
      requireCondition(!hasCollision(after, options.httpsPort) && canonical(withoutEndpoint(before, options)) === canonical(after),
        'Removal preservation verification failed; evidence retained. Do not reset or replace Serve configuration.');
      await unlink(manifestPath);
      return;
    }
    requireCondition(!hasCollision(before, options.httpsPort), 'The selected HTTPS port already has a Serve/Funnel mapping.');
    await probe(options.httpsPort);
    await probe(options.appPort);
    const rechecked = await readStatus();
    requireCondition(canonical(before) === canonical(rechecked), 'Serve changed during preflight; retry after other operations finish.');
    if (action === 'check') return;
    // Exclusive creation prevents adopting an existing mapping or overwriting evidence.
    const manifest = { marker, phase: 'pending', options };
    await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    await writeFile(join(stateDir, 'before-install.json'), JSON.stringify(before), { mode: 0o600 });
    await mutate(['serve', '--bg', `--https=${options.httpsPort}`, options.target], 'install');
    const after = await readStatus();
    await writeFile(join(stateDir, 'after-install.json'), JSON.stringify(after), { mode: 0o600 });
    owned(after, options);
    requireCondition(canonical(before) === canonical(withoutEndpoint(after, options)),
      'Installation preservation verification failed; evidence retained. Do not reset or replace Serve configuration.');
    manifest.phase = 'installed';
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await lifecycle(process.argv[2], settings());
    console.log('Observatory Serve operation completed; unrelated configuration preservation verified.');
  } catch (error) {
    // CLI output and configuration may contain identities; never echo them here.
    console.error(error instanceof Error ? error.message : 'Observatory Serve operation failed.');
    process.exitCode = 1;
  }
}
