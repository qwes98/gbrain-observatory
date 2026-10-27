import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { canonical, lifecycle, settings } from '../../scripts/observatory-serve.mjs';

const options = settings({ OBSERVATORY_EXTERNAL_ORIGIN: 'https://observatory.example.ts.net:8443' });
const existing = {
  TCP: { '443': { HTTPS: true }, '9000': { TCPForward: '127.0.0.1:9001' } },
  Web: { 'other.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } },
  AllowFunnel: { 'other.example.ts.net:443': true },
  Foreground: { session: { TCP: { '9443': { HTTPS: true } } } },
  Services: { 'svc:unrelated': { TCP: { '5432': { TCPForward: '127.0.0.1:5432' } } } },
};
async function harness(t, initial = existing) {
  const stateDir = await mkdtemp(join(tmpdir(), 'observatory-serve-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  let config = structuredClone(initial);
  const calls = [];
  const probes = [];
  const dependencies = { stateDir, probe: async port => { probes.push(port); }, run: async args => {
    calls.push(args);
    if (args.join(' ') === 'status --json') return JSON.stringify({ Self: { DNSName: 'observatory.example.ts.net.' } });
    if (args.join(' ') === 'serve status --json') return JSON.stringify(config);
    if (args.join(' ') === 'serve --bg --https=8443 http://127.0.0.1:3443') {
      config.TCP ??= {};
      config.TCP['8443'] = { HTTPS: true };
      config.Web ??= {};
      config.Web[options.hostPort] = { Handlers: { '/': { Proxy: options.target } } };
      return '';
    }
    if (args.join(' ') === 'serve --https=8443 off') {
      delete config.TCP['8443'];
      delete config.Web[options.hostPort];
      if (Object.keys(config.TCP).length === 0) delete config.TCP;
      if (Object.keys(config.Web).length === 0) delete config.Web;
      return '';
    }
    throw new Error('Unexpected fake CLI invocation');
  } };
  return { dependencies, calls, probes, stateDir, config: () => config, replace: value => { config = value; } };
}
const mutations = h => h.calls.filter(args => args[0] === 'serve' && args[1] !== 'status');

test('install/remove round trip preserves every unrelated mapping and Funnel flag', async t => {
  const h = await harness(t);
  await lifecycle('install', options, h.dependencies);
  assert.deepEqual(h.probes, [8443, 3443]);
  assert.equal(h.config().AllowFunnel['other.example.ts.net:443'], true);
  assert.equal(h.config().AllowFunnel[options.hostPort], undefined);
  assert.equal((await stat(join(h.stateDir, 'serve-mapping.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(h.stateDir, 'serve-mapping.json'))).phase, 'installed');
  // Legitimate unrelated changes between install/remove are preserved too.
  h.config().TCP['9999'] = { TCPForward: '127.0.0.1:9998' };
  const expected = structuredClone(existing);
  expected.TCP['9999'] = { TCPForward: '127.0.0.1:9998' };
  await lifecycle('remove', options, h.dependencies);
  assert.equal(canonical(h.config()), canonical(expected));
  assert.deepEqual(mutations(h), [['serve', '--bg', '--https=8443', options.target], ['serve', '--https=8443', 'off']]);
  await assert.rejects(readFile(join(h.stateDir, 'serve-mapping.json')), /ENOENT/);
});

for (const [name, collision] of Object.entries({
  tcp: { TCP: { '8443': { TCPForward: '127.0.0.1:7' } } },
  web: { Web: { 'another.example.ts.net:8443': { Handlers: {} } } },
  funnel: { AllowFunnel: { 'another.example.ts.net:8443': true } },
  disabledFunnel: { AllowFunnel: { 'another.example.ts.net:8443': false } },
  foreground: { Foreground: { session: { TCP: { '8443': { HTTPS: true } } } } },
  service: { Services: { 'svc:other': { TCP: { '8443': { HTTPS: true } } } } },
})) test(`refuses ${name} collision without any mutation`, async t => {
  const h = await harness(t, collision);
  await assert.rejects(lifecycle('install', options, h.dependencies), /already has/);
  assert.deepEqual(mutations(h), []);
  assert.equal(canonical(h.config()), canonical(collision));
});

test('preflight checks ports, refuses occupied app or HTTPS port and does not adopt mappings', async t => {
  for (const port of [8443, 3443]) {
    const h = await harness(t);
    h.dependencies.probe = async candidate => { if (candidate === port) throw new Error('occupied'); };
    await assert.rejects(lifecycle('install', options, h.dependencies), /occupied/);
    assert.deepEqual(mutations(h), []);
  }
  const h = await harness(t);
  await lifecycle('check', options, h.dependencies);
  assert.deepEqual(mutations(h), []);
  await assert.rejects(readFile(join(h.stateDir, 'serve-mapping.json')), /ENOENT/);
});

test('refuses removal without ownership, with mismatched origin, and with an altered endpoint', async t => {
  const h = await harness(t);
  await assert.rejects(lifecycle('remove', options, h.dependencies), /ownership record/);
  await lifecycle('install', options, h.dependencies);
  const count = mutations(h).length;
  await assert.rejects(lifecycle('remove', { ...options, target: 'http://127.0.0.1:3999' }, h.dependencies), /does not match/);
  h.config().Web[options.hostPort].Handlers['/extra'] = { Text: 'other owner' };
  await assert.rejects(lifecycle('remove', options, h.dependencies), /no longer matches/);
  assert.equal(mutations(h).length, count);
});

test('refuses removal if Funnel is enabled or another scope now uses owned port', async t => {
  for (const modify of [config => { config.AllowFunnel[options.hostPort] = true; }, config => { config.Foreground.new = { TCP: { '8443': { HTTPS: true } } }; }]) {
    const h = await harness(t);
    await lifecycle('install', options, h.dependencies);
    modify(h.config());
    await assert.rejects(lifecycle('remove', options, h.dependencies), /refusing removal/);
    assert.equal(mutations(h).length, 1);
  }
});

test('detects config changes during preflight and does not mutate', async t => {
  const h = await harness(t);
  h.dependencies.probe = async () => { h.config().AllowFunnel['new.example.ts.net:443'] = false; };
  await assert.rejects(lifecycle('install', options, h.dependencies), /changed during preflight/);
  assert.deepEqual(mutations(h), []);
});

test('failed post-install preservation check keeps private pending evidence and never resets', async t => {
  const h = await harness(t);
  const run = h.dependencies.run;
  h.dependencies.run = async args => {
    const result = await run(args);
    if (args.includes('--bg')) h.config().TCP['443'] = { TCPForward: '127.0.0.1:3333' };
    return result;
  };
  await assert.rejects(lifecycle('install', options, h.dependencies), /preservation verification failed/);
  assert.equal(JSON.parse(await readFile(join(h.stateDir, 'serve-mapping.json'))).phase, 'pending');
  assert.equal(mutations(h).length, 1);
  await assert.rejects(lifecycle('remove', options, h.dependencies), /does not match/);
});

test('failed post-remove preservation retains evidence and ownership record', async t => {
  const h = await harness(t);
  await lifecycle('install', options, h.dependencies);
  const run = h.dependencies.run;
  h.dependencies.run = async args => {
    const result = await run(args);
    if (args.at(-1) === 'off') h.config().AllowFunnel['other.example.ts.net:443'] = false;
    return result;
  };
  await assert.rejects(lifecycle('remove', options, h.dependencies), /preservation verification failed/);
  assert.equal(JSON.parse(await readFile(join(h.stateDir, 'serve-mapping.json'))).phase, 'installed');
  assert.equal(mutations(h).length, 2);
});

test('existing ownership or operation lock cannot be overwritten', async t => {
  const h = await harness(t);
  await writeFile(join(h.stateDir, 'serve-mapping.json'), 'original evidence');
  await assert.rejects(lifecycle('install', options, h.dependencies), /EEXIST/);
  assert.equal(await readFile(join(h.stateDir, 'serve-mapping.json'), 'utf8'), 'original evidence');
  assert.deepEqual(mutations(h), []);
  await writeFile(join(h.stateDir, 'serve.lock'), 'busy');
  await assert.rejects(lifecycle('install', options, h.dependencies), /Another lifecycle/);
});

test('invalid CLI output and failures fail closed without mutation', async t => {
  for (const output of ['broken', '[]', '{"TCP":[]}', '{"Foreground":false}']) {
    const h = await harness(t);
    const run = h.dependencies.run;
    h.dependencies.run = async args => args[0] === 'status' ? run(args) : output;
    await assert.rejects(lifecycle('install', options, h.dependencies), /valid/);
  }
});

test('validates fixed dedicated HTTPS and app ports without accepting arbitrary destinations', () => {
  for (const origin of [undefined, 'http://node.example.ts.net:8443', 'https://node.example.ts.net', 'https://node.example.ts.net:443', 'https://node.example.ts.net:3000', 'https://node.example.ts.net:8443/', 'https://user@node.example.ts.net:8443', 'https://outside.example:8443', 'https://node.example.ts.net:8443/path']) {
    assert.throws(() => settings({ OBSERVATORY_EXTERNAL_ORIGIN: origin }));
  }
  for (const port of ['3000', '443', '8443', '65536', 'nope']) {
    assert.throws(() => settings({ OBSERVATORY_EXTERNAL_ORIGIN: options.origin, OBSERVATORY_APP_PORT: port }));
  }
});


test('wrong local node or invalid node status refuses mapping changes', async t => {
  for (const nodeStatus of ['broken', '{}', '{"Self":{"DNSName":"another.example.ts.net."}}']) {
    const h = await harness(t);
    const run = h.dependencies.run;
    h.dependencies.run = async args => args[0] === 'status' ? nodeStatus : run(args);
    await assert.rejects(lifecycle('install', options, h.dependencies), /local Tailscale node|does not match/);
    assert.deepEqual(mutations(h), []);
  }
});


for (const action of ['install', 'remove']) {
  for (const captureFails of [false, true]) test(`${action} command partial failure preserves original error and ownership when capture ${captureFails ? 'fails' : 'succeeds'}`, async t => {
    const h = await harness(t);
    if (action === 'remove') await lifecycle('install', options, h.dependencies);
    const run = h.dependencies.run;
    const original = Object.assign(new Error('Original mutation timed out after partial work'), { code: 'ETIMEDOUT' });
    let mutationFailed = false;
    h.dependencies.run = async args => {
      if (mutationFailed && args.join(' ') === 'serve status --json' && captureFails) {
        // Log the attempted capture without invoking the fake mutation helper.
        h.calls.push(args);
        throw new Error('After-status is unavailable');
      }
      const result = await run(args);
      if ((action === 'install' && args.includes('--bg')) || (action === 'remove' && args.at(-1) === 'off')) {
        // The fake CLI already applied the change before reporting failure.
        mutationFailed = true;
        throw original;
      }
      return result;
    };
    await assert.rejects(lifecycle(action, options, h.dependencies), error => error === original);
    assert.equal(h.calls.at(-1).join(' '), 'serve status --json');
    assert.equal(JSON.parse(await readFile(join(h.stateDir, 'serve-mapping.json'))).phase, action === 'install' ? 'pending' : 'installed');
    const evidencePath = join(h.stateDir, `after-${action}.json`);
    if (captureFails) await assert.rejects(readFile(evidencePath), /ENOENT/);
    else {
      assert.equal(canonical(JSON.parse(await readFile(evidencePath, 'utf8'))), canonical(h.config()));
      assert.equal((await stat(evidencePath)).mode & 0o777, 0o600);
    }
    assert.equal(mutations(h).length, action === 'install' ? 1 : 2);
    assert.equal(canonical(JSON.parse(await readFile(join(h.stateDir, `before-${action}.json`), 'utf8'))),
      canonical(action === 'install' ? existing : JSON.parse(await readFile(join(h.stateDir, 'after-install.json'), 'utf8'))));
  });
}

async function listen(host, port = 0) {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject);
    listener.listen({ host, port, ipv6Only: host === '::1', exclusive: true }, resolveListen);
  });
  return listener;
}
async function close(listener) {
  await new Promise((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()));
}
function socketPort(listener) { return listener.address().port; }
function selectedPorts(httpsPort, appPort) {
  return settings({ OBSERVATORY_EXTERNAL_ORIGIN: `https://observatory.example.ts.net:${httpsPort}`, OBSERVATORY_APP_PORT: String(appPort) });
}
async function availablePorts() {
  const first = await listen('127.0.0.1');
  const second = await listen('127.0.0.1');
  const ports = [socketPort(first), socketPort(second)];
  await close(first);
  await close(second);
  return ports;
}

for (const host of ['127.0.0.1', '::1']) {
  for (const occupied of ['https', 'app']) test(`default production probe rejects occupied ${occupied} ${host} socket without mutation`, async t => {
    let listener;
    try { listener = await listen(host); } catch (error) {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) {
        t.skip('IPv6 loopback is unavailable');
        return;
      }
      throw error;
    }
    t.after(() => close(listener));
    const [freePort] = await availablePorts();
    const occupiedPort = socketPort(listener);
    const chosen = occupied === 'https' ? selectedPorts(occupiedPort, freePort) : selectedPorts(freePort, occupiedPort);
    const h = await harness(t, {});
    delete h.dependencies.probe;
    await assert.rejects(lifecycle('install', chosen, h.dependencies), /already occupied/);
    assert.deepEqual(mutations(h), []);
    await assert.rejects(readFile(join(h.stateDir, 'serve-mapping.json')), /ENOENT/);
  });
}

test('successful default production preflight releases both selected sockets', async t => {
  const [httpsPort, appPort] = await availablePorts();
  const h = await harness(t, {});
  delete h.dependencies.probe;
  await lifecycle('check', selectedPorts(httpsPort, appPort), h.dependencies);
  const httpsListener = await listen('::', httpsPort);
  t.after(() => close(httpsListener));
  const appListener = await listen('::', appPort);
  t.after(() => close(appListener));
  assert.deepEqual(mutations(h), []);
});
