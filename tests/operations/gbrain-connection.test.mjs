import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, chmod, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const directory = await mkdtemp(join(tmpdir(), 'observatory-connection-'));
for (const name of ['runner', 'probe', 'time-zone']) {
  const source = await readFile(name === 'time-zone' ? 'src/i18n/time-zone.ts' : `src/adapters/gbrain/${name}.ts`, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(directory, `${name}.mjs`), compiled.replace('"./runner"', '"./runner.mjs"').replace('"../../i18n/time-zone"', '"./time-zone.mjs"'));
}
const { checkConnection, listSources, hasSafeSourceCapability, sourceProbeCount } = await import(pathToFileURL(join(directory, 'probe.mjs')));
const { getConnectionConfig, executionPolicy, runCommand } = await import(pathToFileURL(join(directory, 'runner.mjs')));
const navigationSource = await readFile('src/contracts/sources.ts', 'utf8');
await writeFile(join(directory, 'sources.mjs'), ts.transpileModule(navigationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { validatedSourceReturn, sourceNavigationPath } = await import(pathToFileURL(join(directory, 'sources.mjs')));
const executable = join(directory, 'fake-gbrain');
await copyFile('tests/support/fake-gbrain.mjs', executable);
await chmod(executable, 0o700);
const config = { executable, cwd: directory };
async function scenario(name) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

async function assertStopped(pid) {
  await new Promise(resolve => setTimeout(resolve, 100));
  try { assert.match(await readFile(`/proc/${pid}/stat`, 'utf8'), /\) Z /, 'process must no longer be running'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

try {
  await test('navigation return validation bounds expansion and rejects malformed internal addresses', () => {
    const reference = JSON.stringify(['connection-example', 'source-id']);
    const path = sourceNavigationPath(reference, [reference]);
    assert.equal(validatedSourceReturn(path), path);
    for (const value of ['/\\', '/\\\\', '//external.invalid', '/other', 'https://external.invalid']) assert.equal(validatedSourceReturn(value), '/');
    const large = sourceNavigationPath(reference, Array.from({ length: 100 }, (_, index) => JSON.stringify(['connection-example', `source-${index}`])));
    assert.ok(large.length <= 1026);
    assert.ok(new URL(large, 'https://internal.invalid').searchParams.getAll('expanded').length > 1);
    const longest = JSON.stringify(['n', 'x'.repeat(234)]);
    assert.equal(encodeURIComponent(longest).length, 256);
    const filtered = sourceNavigationPath(longest, Array.from({ length: 100 }, (_, index) => JSON.stringify(['connection-example', `source-${index}`])), 'yesterday');
    assert.ok(filtered.length <= 1026, 'the Page filter must share the existing total navigation budget');
    assert.equal(new URL(filtered, 'https://internal.invalid').searchParams.get('added'), 'yesterday');
    assert.equal(new URL(filtered, 'https://internal.invalid').searchParams.get('source'), longest);
    assert.equal(validatedSourceReturn(filtered), filtered);
  });
  await test('missing/invalid server settings never execute; explicit audit is required', async () => {
    for (const environment of [{}, { OBSERVATORY_GBRAIN_EXECUTABLE: '/bin/true', OBSERVATORY_GBRAIN_CWD: '/' },
      { OBSERVATORY_GBRAIN_EXECUTABLE: 'relative', OBSERVATORY_GBRAIN_CWD: '/', OBSERVATORY_GBRAIN_READ_AUDIT: 'local-read-reviewed' }]) assert.equal(getConnectionConfig(environment), null);
    assert.deepEqual(await checkConnection(null), { kind: 'unconfigured', cause: 'settings' });
    assert.deepEqual(getConnectionConfig({ OBSERVATORY_GBRAIN_EXECUTABLE: executable, OBSERVATORY_GBRAIN_CWD: directory, OBSERVATORY_GBRAIN_READ_AUDIT: 'local-read-reviewed' }), config);
  });
  await test('nonempty and zero probes succeed with actual scope/time and fixed sequential argv', async () => {
    for (const name of ['success', 'empty']) {
      await scenario(name);
      const before = Date.now();
      const result = await checkConnection(config);
      assert.equal(result.kind, 'success');
      assert.equal(result.observation.sourceCount, name === 'empty' ? 0 : 1);
      assert.equal(result.observation.version, '0.60.323.0');
      assert.equal(result.observation.scope, 'local-active-sources');
      assert.ok(Date.parse(result.observation.observedAt) >= before);
      assert.deepEqual((await calls()).map(call => call.args), [['--version'], ['--tools-json'], ['call', 'sources_list', '{}']]);
      assert.ok((await calls()).every(call => call.hooks === '1' && call.sweep === '0'));
      assert.doesNotMatch(JSON.stringify(result), /private|secret|example/);
    }
  });
  await test('version, capability, malformed JSON and schema failures stop before any affected read', async () => {
    for (const [name, count] of [['version', 1], ['missing', 2], ['unsafe', 2], ['archived-default', 2], ['malformed', 2], ['partial', 3], ['shape', 3]]) {
      await scenario(name);
      assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'compatibility' });
      assert.equal((await calls()).length, count);
    }
    assert.equal(sourceProbeCount({ sources: [], truncated: true }), null);
    assert.equal(sourceProbeCount({ sources: [], total: 12 }), null);
    const row = { id: 'timestamp', name: 'original', local_path: null, remote_url: null, federated: false, strategy: null, page_count: 0, last_sync_at: null };
    for (const last_sync_at of ['2026-02-30T10:00:00Z', '2026-10-27T03:00:00', 'not-a-date']) {
      assert.equal(sourceProbeCount({ sources: [{ ...row, last_sync_at }] }), null);
    }
    assert.equal(hasSafeSourceCapability({ tools: [] }), false);
    for (const override of [{ idempotent: false }, { scope: 'write' }, { required_scopes: ['admin'] }, { parameters: { required: 'string' } }, { schema: { type: 'object', properties: {}, required: ['id'] } }]) {
      const base = { name: 'sources_list', scope: 'read', mutating: false, idempotent: true, required_scopes: [], parameters: { include_archived: 'boolean?' }, schema: { type: 'object', properties: { include_archived: { type: 'boolean' } } } };
      assert.equal(hasSafeSourceCapability([{ ...base, ...override }]), false);
      assert.equal(hasSafeSourceCapability([base, base]), false);
    }
  });
  await test('confirmed execution causes are specific and unknown exit output stays private', async () => {
    assert.deepEqual(await checkConnection({ ...config, executable: join(directory, 'absent') }), { kind: 'failure', cause: 'not-found' });
    const forbidden = join(directory, 'forbidden'); await writeFile(forbidden, 'private path'); await chmod(forbidden, 0o600);
    assert.deepEqual(await checkConnection({ ...config, executable: forbidden }), { kind: 'failure', cause: 'permission' });
    assert.deepEqual(await checkConnection({ ...config, cwd: forbidden }), { kind: 'failure', cause: 'failed' });
    await scenario('nonzero');
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'failed' });
    assert.equal((await calls()).length, 1);
  });
  await test('stdout and stderr limits terminate executions without retry and release the lease', async () => {
    assert.deepEqual(executionPolicy, { timeoutMs: 15000, stdoutBytes: 1048576, stderrBytes: 65536, killGraceMs: 250 });
    for (const name of ['stdout-limit', 'stderr-limit']) {
      await scenario(name);
      assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'output-limit' });
      assert.equal((await calls()).length, 1);
    }
  });
  await test('output-limit cleanup terminates a descendant even when its parent closes first', async () => {
    await scenario('descendant');
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'output-limit' });
    const pid = Number(await readFile(join(directory, 'descendant-pid'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const status = await readFile(`/proc/${pid}/stat`, 'utf8');
      assert.match(status, /\) Z /, 'descendant must no longer be running');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  await test('successful completion kills descendants with independent stdio', async () => {
    await scenario('successful-descendant');
    assert.deepEqual(await runCommand(config, 'version'), { ok: true, stdout: 'gbrain 0.60.323.0\n' });
    await assertStopped(Number(await readFile(join(directory, 'descendant-pid'), 'utf8')));
  });
  await test('Node exit and graceful signals clean active process groups', async () => {
    const script = join(directory, 'shutdown-runner.mjs');
    await writeFile(script, `import { runCommand } from './runner.mjs';
import { writeFileSync } from 'node:fs';
if (process.argv[2] === 'once-SIGTERM') process.once('SIGTERM', () => setTimeout(() => { writeFileSync(${JSON.stringify(join(directory, 'graceful-marker'))}, 'done'); process.exit(0); }, 150));
runCommand(${JSON.stringify(config)}, 'version');
if (process.argv[2] === 'exit') setTimeout(() => process.exit(0), 500);`);
    for (const mode of ['exit', 'SIGTERM', 'SIGINT', 'once-SIGTERM']) {
      await scenario('shutdown');
      await rm(join(directory, 'descendant-pid'), { force: true });
      const parent = spawn(process.execPath, [script, mode], { stdio: 'ignore' });
      const closed = once(parent, 'close');
      let descendantPid;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { descendantPid = Number(await readFile(join(directory, 'descendant-pid'), 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
      }
      assert.ok(descendantPid, 'fake command descendant must start');
      const wrapperPid = (await calls())[0].pid;
      if (mode !== 'exit') parent.kill(mode === 'once-SIGTERM' ? 'SIGTERM' : mode);
      const [code, signal] = await closed;
      if (mode === 'once-SIGTERM') {
        assert.equal(code, 0);
        assert.equal(await readFile(join(directory, 'graceful-marker'), 'utf8'), 'done');
      } else if (mode !== 'exit') assert.equal(signal, mode);
      await assertStopped(wrapperPid);
      await assertStopped(descendantPid);
    }
  });
  await test('concurrent checks refuse immediately instead of queuing extra processes', async () => {
    await scenario('slow');
    const first = checkConnection(config);
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'busy' });
    assert.equal((await first).kind, 'success');
    assert.equal((await calls()).length, 3);
  });
  await test('real list projection preserves independent fields, duplicate names, timestamps and unknown coverage', async () => {
    await scenario('fields');
    const result = await listSources(config);
    assert.equal(result.kind, 'success');
    const { snapshot } = result;
    assert.equal(snapshot.scope, 'returned-active-sources');
    assert.equal(snapshot.coverage, 'unknown');
    assert.equal(snapshot.sources.length, 3);
    const [folder, git, neither] = snapshot.sources;
    assert.equal(folder.name, git.name);
    assert.notEqual(folder.id, git.id);
    assert.match(folder.namespace, /^connection-[a-f0-9]{64}$/);
    assert.doesNotMatch(folder.namespace, new RegExp(directory));
    assert.equal(folder.connection.folder, '/원본/<script>/긴 경로');
    assert.equal(folder.connection.repository, undefined);
    assert.equal(git.connection.folder, undefined);
    assert.equal(git.connection.repository, 'javascript:alert(1)');
    assert.deepEqual(neither.connection, {});
    assert.equal(folder.lastSyncedAt, '2026-10-27T03:00:00+09:00');
    assert.equal(folder.sync.status, 'unknown');
    assert.equal(folder.federated, false);
    assert.equal(folder.pageCount, 3);
    assert.equal(git.strategy, 'original-strategy');
    assert.equal(folder.checkedAt, snapshot.checkedAt);
    const again = await listSources(config);
    assert.equal(again.snapshot.sources[0].namespace, folder.namespace);
    assert.equal((await calls()).length, 6);
    const alternateExecutable = join(directory, 'alternate-gbrain');
    await copyFile(executable, alternateExecutable); await chmod(alternateExecutable, 0o700);
    const executableResult = await listSources({ ...config, executable: alternateExecutable });
    const alternateDirectory = await mkdtemp(join(tmpdir(), 'observatory-other-source-'));
    try {
      await writeFile(join(alternateDirectory, 'scenario'), 'fields'); await writeFile(join(alternateDirectory, 'calls'), '');
      const directoryResult = await listSources({ ...config, cwd: alternateDirectory });
      assert.equal(executableResult.kind, 'success'); assert.equal(directoryResult.kind, 'success');
      assert.equal(executableResult.snapshot.sources[0].id, folder.id);
      assert.equal(directoryResult.snapshot.sources[0].id, folder.id);
      assert.notEqual(executableResult.snapshot.sources[0].namespace, folder.namespace);
      assert.notEqual(directoryResult.snapshot.sources[0].namespace, folder.namespace);
      assert.notEqual(directoryResult.snapshot.sources[0].namespace, executableResult.snapshot.sources[0].namespace);
    } finally { await rm(alternateDirectory, { recursive: true, force: true }); }
  });
  await test('list empty, unsupported, failed and denied execution have explicit sanitized states', async () => {
    await scenario('empty');
    assert.deepEqual((await listSources(config)).snapshot.sources, []);
    for (const name of ['version', 'missing', 'unsafe', 'malformed', 'partial', 'shape']) {
      await scenario(name);
      assert.deepEqual(await listSources(config), { kind: 'unknown', reason: 'unsupported' });
    }
    await scenario('nonzero');
    assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'request-failed' });
    const forbidden = join(directory, 'forbidden');
    assert.deepEqual(await listSources({ ...config, executable: forbidden }), { kind: 'denied', reason: 'access-denied' });
    assert.deepEqual(await listSources(null), { kind: 'unconfigured', reason: 'adapter-not-configured' });
  });
  await test('list and count probe share one lease in both directions', async () => {
    await scenario('slow');
    const list = listSources(config);
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'busy' });
    assert.equal((await list).kind, 'success');
    const check = checkConnection(config);
    assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'busy' });
    assert.equal((await check).kind, 'success');
    assert.equal((await calls()).length, 6);
  });
  await test('a SIGTERM-resistant command is killed/reaped within the fixed deadline with no retry', async () => {
    await scenario('timeout');
    const before = Date.now();
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'timeout' });
    assert.ok(Date.now() - before >= 15000);
    assert.ok(Date.now() - before < 18000);
    assert.equal((await calls()).length, 1);
    await scenario('success');
    assert.equal((await checkConnection(config)).kind, 'success');
  });
} finally { await rm(directory, { recursive: true, force: true }); }
