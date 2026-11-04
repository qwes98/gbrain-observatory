import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, chmod, rm, copyFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const directory = await mkdtemp(join(tmpdir(), 'observatory-facts-'));
const modules = ['src/adapters/gbrain/runner.ts', 'src/adapters/gbrain/probe.ts', 'src/adapters/gbrain/pages.ts', 'src/adapters/gbrain/page-detail.ts', 'src/adapters/gbrain/facts.ts', 'src/contracts/pages.ts', 'src/contracts/sources.ts', 'src/contracts/page-detail.ts', 'src/contracts/facts.ts', 'src/i18n/time-zone.ts'];
function moduleName(path) { return path.includes('contracts/') ? `contracts-${basename(path, '.ts')}` : basename(path, '.ts'); }
for (const path of modules) {
  const compiled = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(directory, `${moduleName(path)}.mjs`), compiled.replace(/from "([.][^"]+)"/g, (_match, value) => `from "./${moduleName(join(dirname(path), value + '.ts'))}.mjs"`));
}
const { listFacts, readFactDetail, hasSafeFactCapabilities, hasSafeTrajectoryCapability } = await import(pathToFileURL(join(directory, 'facts.mjs')));
const { validFactDetailRequest, factReference } = await import(pathToFileURL(join(directory, 'contracts-facts.mjs')));
const { runCommand } = await import(pathToFileURL(join(directory, 'runner.mjs')));
const { listSources } = await import(pathToFileURL(join(directory, 'probe.mjs')));
const { verifiedPageLocation } = await import(pathToFileURL(join(directory, 'contracts-page-detail.mjs')));
const executable = join(directory, 'fake-gbrain');
await copyFile('tests/support/fake-gbrain.mjs', executable); await chmod(executable, 0o700);
const config = { executable, cwd: directory };
const namespace = 'connection-' + createHash('sha256').update(JSON.stringify([executable, directory])).digest('hex');
const source = JSON.stringify([namespace, 'example']);
async function scenario(name) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line).args); }
try {
  await test('Source-scoped recall uses fixed public argv and preserves public Fact identity and original fields', async () => {
    await scenario('facts-success');
    const result = await listFacts({ source }, config);
    assert.equal(result.kind, 'success');
    const { snapshot } = result;
    assert.equal(snapshot.sourceReference, source); assert.equal(snapshot.coverage, 'unknown');
    assert.equal(snapshot.candidateLimit, 100); assert.equal(snapshot.continuation, 'unsupported'); assert.equal(snapshot.capped, false);
    assert.equal(snapshot.rows.length, 1);
    const fact = snapshot.rows[0];
    assert.equal(fact.id, '17'); assert.equal(fact.sourceId, 'example'); assert.equal(fact.namespace, namespace);
    assert.equal(fact.kind, 'belief'); assert.equal(fact.content, '원본 기억 🌿 / original public fact');
    assert.equal(fact.sourceDescription, 'mcp:put_page');
    assert.equal(fact.context, 'notes/fact-context — extracted from original'); assert.equal(fact.contextAvailability, 'available'); assert.equal(fact.recordedBy, null);
    assert.equal(factReference(fact), JSON.stringify([namespace, 'example', '17']));
    assert.deepEqual((await calls()).at(-1), ['call', '--source', 'example', 'recall', JSON.stringify({ source_id: 'example', limit: 100 })]);
  });
  await test('empty, cap, malformed identities and invalid recorded time remain distinct', async () => {
    await scenario('facts-empty'); let result = await listFacts({ source }, config); assert.equal(result.kind, 'success'); assert.equal(result.snapshot.rows.length, 0);
    await scenario('facts-cap'); result = await listFacts({ source }, config); assert.equal(result.kind, 'success'); assert.equal(result.snapshot.rows.length, 100); assert.equal(result.snapshot.capped, true);
    for (const name of ['facts-wrong-source', 'facts-missing-id', 'facts-conflicting-id', 'facts-duplicates']) {
      await scenario(name); result = await listFacts({ source }, config); assert.equal(result.kind, 'success'); assert.equal(result.snapshot.rows.length, 0); assert.ok(result.snapshot.omitted > 0);
    }
    await scenario('facts-invalid-time'); result = await listFacts({ source }, config); assert.equal(result.kind, 'success'); assert.equal(result.snapshot.rows[0].creationAvailability, 'invalid'); assert.equal(result.snapshot.rows[0].createdAt, null);
  });
  await test('detail re-reads exact public ID and independently verifies context, stored Page and UTF-16 Page quote', async () => {
    await scenario('facts-success'); const result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
    const { snapshot } = result;
    assert.equal(snapshot.fact.id, '17'); assert.equal(snapshot.contextPage.availability, 'available'); assert.equal(snapshot.contextPage.page.slug, 'notes/fact-context');
    assert.equal(snapshot.storedPage.availability, 'available'); assert.equal(snapshot.storedPage.page.slug, 'notes/fact-stored');
    const evidence = snapshot.evidence;
    assert.equal(evidence.level, 'context-page'); assert.equal(evidence.availability, 'available'); assert.equal(evidence.page.slug, 'notes/fact-original');
    assert.equal(evidence.quote, '원문 인용 🌿 / exact original quote'); assert.equal(verifiedPageLocation(evidence.body.sections, evidence.location, evidence.quote), true);
    assert.match(evidence.body.sections[0].text, /^😀 Intro/);
    const invoked = await calls(); assert.equal(invoked.filter(args => args[3] === 'recall').length, 1);
    assert.deepEqual(invoked.find(args => args[3] === 'find_trajectory'), ['call', '--source', 'example', 'find_trajectory', JSON.stringify({ entity_slug: 'entity-example', kind: 'all', limit: 100 })]);
    assert.ok(invoked.filter(args => args[1] === 'get_page').every(args => JSON.parse(args[2]).fuzzy === false));
    await scenario('facts-success'); const absent = await readFactDetail({ source, id: '18' }, config); assert.equal(absent.kind, 'unavailable'); assert.equal((await calls()).filter(args => args[1] === 'get_page').length, 0);
  });
  await test('only the four exact extraction producers qualify a trimmed annotated path head', async () => {
    for (const [name, producer] of [['facts-success', 'mcp:put_page'], ['facts-producer-sync', 'sync:import'], ['facts-producer-upload', 'file_upload'], ['facts-producer-code', 'code_import']]) {
      await scenario(name); const result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
      assert.equal(result.snapshot.fact.sourceDescription, producer);
      assert.equal(result.snapshot.fact.sourceId, 'example'); assert.equal(result.snapshot.fact.recordedBy, null);
      assert.equal(result.snapshot.fact.context, 'notes/fact-context — extracted from original');
      assert.equal(result.snapshot.contextPage.page.slug, 'notes/fact-context'); assert.equal(result.snapshot.evidence.availability, 'available');
      assert.ok((await calls()).filter(args => args[1] === 'get_page').every(args => !JSON.parse(args[2]).slug.includes(' — ')));
    }
    await scenario('facts-context-annotated'); const annotated = await readFactDetail({ source, id: '17' }, config); assert.equal(annotated.kind, 'success');
    assert.equal(annotated.snapshot.fact.context, '  notes/fact-context  — first note — second note  ');
    assert.equal(annotated.snapshot.contextPage.page.slug, 'notes/fact-context'); assert.equal(annotated.snapshot.evidence.availability, 'available');
  });
  await test('free-text and unrecognized producers cannot attribute an existing same-Source path', async () => {
    for (const name of ['facts-context-free-path', 'facts-context-wrong-case', 'facts-context-unknown-source', 'facts-context-source-suffix', 'facts-context-missing-producer', 'facts-context-free-text', 'facts-context-no-path', 'facts-context-spaced-path', 'facts-context-empty-head']) {
      await scenario(name); const result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
      assert.equal(result.snapshot.contextPage.availability, 'unknown', name); assert.equal(result.snapshot.contextPage.page, null);
      assert.equal(result.snapshot.evidence.availability, 'unknown'); assert.equal(result.snapshot.evidence.page, null);
      assert.equal(result.snapshot.evidence.quote, null); assert.equal(result.snapshot.evidence.location, null); assert.deepEqual(result.snapshot.evidence.body.sections, []);
      assert.equal(result.snapshot.fact.contextAvailability, 'available'); assert.equal(typeof result.snapshot.fact.context, 'string');
      assert.equal((await calls()).filter(args => args[1] === 'get_page' || args[3] === 'find_trajectory').length, 0, name);
    }
  });
  await test('missing, null, empty and malformed public contexts remain distinct without Page calls', async () => {
    for (const [name, relation, field, raw] of [['facts-no-context', 'missing', 'missing', null], ['facts-context-null', 'missing', 'null', null], ['facts-context-empty', 'missing', 'available', ''], ['facts-context-invalid-type', 'invalid', 'invalid', null], ['facts-context-invalid-slug', 'invalid', 'available', 'notes/\u0000broken']]) {
      await scenario(name); const result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
      assert.equal(result.snapshot.contextPage.availability, relation, name); assert.equal(result.snapshot.evidence.availability, relation);
      assert.equal(result.snapshot.fact.contextAvailability, field); assert.equal(result.snapshot.fact.context, raw);
      assert.equal((await calls()).filter(args => args[1] === 'get_page').length, 0);
    }
  });
  await test('current quote mismatch, missing quote, protected and partial originals never gain an accepted location', async () => {
    for (const [name, expected] of [['facts-quote-mismatch', 'mismatch'], ['facts-quote-missing', 'missing'], ['facts-protected', 'protected'], ['facts-partial', 'partial']]) {
      await scenario(name); const result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
      assert.equal(result.snapshot.evidence.availability, expected, name); assert.equal(result.snapshot.evidence.location, null, name);
      assert.doesNotMatch(JSON.stringify(result), /PROTECTED_FACT_BODY_MUST_NOT_RENDER/);
    }
  });
  await test('context and trajectory mismatches or failed Page reads cannot create evidence', async () => {
    await scenario('facts-page-failure'); const failedPage = await readFactDetail({ source, id: '17' }, config);
    assert.equal(failedPage.kind, 'success'); assert.equal(failedPage.snapshot.fact.id, '17');
    assert.equal(failedPage.snapshot.contextPage.availability, 'failed'); assert.equal(failedPage.snapshot.contextPage.page, null);
    assert.equal(failedPage.snapshot.evidence.availability, 'failed'); assert.equal(failedPage.snapshot.evidence.page, null);
    assert.deepEqual(failedPage.snapshot.evidence.body.sections, []); assert.equal(failedPage.snapshot.evidence.location, null);
    await scenario('facts-context-wrong-source'); let result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success'); assert.notEqual(result.snapshot.contextPage.availability, 'available'); assert.equal(result.snapshot.evidence.page, null);
    for (const name of ['facts-trajectory-wrong-id', 'facts-trajectory-wrong-source']) {
      await scenario(name); result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success'); assert.notEqual(result.snapshot.storedPage.availability, 'available'); assert.equal(result.snapshot.storedPage.page, null);
    }
    await scenario('facts-original-wrong-slug'); result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success'); assert.notEqual(result.snapshot.evidence.availability, 'available'); assert.equal(result.snapshot.evidence.location, null);
    for (const name of ['facts-invalid-entity', 'facts-empty-entity']) {
      await scenario(name); result = await readFactDetail({ source, id: '17' }, config); assert.equal(result.kind, 'success');
      assert.equal(result.snapshot.storedPage.availability, 'invalid'); assert.equal(result.snapshot.storedPage.page, null);
      assert.equal(result.snapshot.evidence.availability, 'available');
      assert.equal((await calls()).filter(args => args[3] === 'find_trajectory').length, 0);
    }
  });
  await test('hostile requests spawn nothing and unsafe capabilities fail closed', async () => {
    for (const input of [{ source: '/bin/sh', id: '17' }, { source, id: '017' }, { source, id: 'bad\n' }, { source, id: '17', command: 'write' }]) {
      await scenario('facts-success'); assert.equal(validFactDetailRequest(input), false); assert.notEqual((await readFactDetail(input, config)).kind, 'success'); assert.deepEqual(await calls(), []);
    }
    await scenario('facts-unsafe-recall'); assert.equal((await listFacts({ source }, config)).kind, 'unknown'); assert.equal((await calls()).filter(args => args[3] === 'recall').length, 0);
    await scenario('facts-failure'); const failed = await listFacts({ source }, config); assert.equal(failed.kind, 'failure'); assert.doesNotMatch(JSON.stringify(failed), /private|secret-token/);
  });
  await test('Fact reads share the connection lease and release it after failure and permission denial', async () => {
    await scenario('facts-slow');
    const pending = listFacts({ source }, config);
    assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'busy' });
    assert.deepEqual(await readFactDetail({ source, id: '17' }, config), { kind: 'failure', reason: 'busy' });
    assert.equal((await pending).kind, 'success');
    await scenario('facts-failure'); assert.equal((await listFacts({ source }, config)).kind, 'failure');
    await scenario('facts-success');
    await chmod(executable, 0o600);
    try { assert.deepEqual(await listFacts({ source }, config), { kind: 'denied', reason: 'access-denied' }); }
    finally { await chmod(executable, 0o700); }
    assert.equal((await listFacts({ source }, config)).kind, 'success');
  });
  await test('the cumulative acquisition deadline shortens recall and reaps it before releasing the lease', async () => {
    await scenario('facts-slow');
    const actualNow = Date.now, base = actualNow(), started = performance.now();
    Date.now = () => {
      const count = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).length;
      return base + [0, 11_000, 22_000, 44_700, 45_000][Math.min(count, 4)];
    };
    let result;
    try { result = await listFacts({ source }, config); } finally { Date.now = actualNow; }
    assert.equal(result.kind, 'failure');
    assert.ok(performance.now() - started < 2_000, 'recall receives only the remaining 300ms');
    assert.equal((await calls()).length, 4);
    await scenario('facts-success'); assert.equal((await listFacts({ source }, config)).kind, 'success');
  });
  await test('detail consumes one deadline across recall, context, original and trajectory and reaps each expired child', async () => {
    for (const [name, stage] of [['facts-slow', 4], ['facts-budget-context', 5], ['facts-budget-original', 6], ['facts-budget-trajectory', 7]]) {
      await scenario(name);
      const actualNow = Date.now, base = actualNow(), started = performance.now();
      Date.now = () => {
        const count = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).length;
        return base + (count < stage - 1 ? count * 5_000 : count === stage - 1 ? 44_700 : 45_000);
      };
      let result;
      try {
        const pending = readFactDetail({ source, id: '17' }, config);
        assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'busy' });
        result = await pending;
      } finally { Date.now = actualNow; }
      assert.ok(performance.now() - started < 2_000, `${name}: only the remaining 300ms plus cleanup is available`);
      const invoked = await calls();
      assert.equal(invoked.length, stage, `${name}: no later command may spawn after expiry`);
      const last = JSON.parse(readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').at(-1));
      assert.throws(() => process.kill(last.pid, 0), { code: 'ESRCH' }, `${name}: expired process must be reaped before completion`);
      if (stage === 4) assert.equal(result.kind, 'failure');
      else {
        assert.equal(result.kind, 'success'); assert.equal(result.snapshot.fact.id, '17');
        assert.equal(result.snapshot.storedPage.availability, 'failed');
        assert.equal(result.snapshot.contextPage.availability, stage === 5 ? 'failed' : 'available');
        assert.equal(result.snapshot.evidence.availability, stage === 7 ? 'available' : 'failed');
        if (stage !== 7) assert.equal(result.snapshot.evidence.location, null);
      }
      await scenario('facts-success'); assert.equal((await listFacts({ source }, config)).kind, 'success', `${name}: lease is released after cleanup`);
    }
  });
  await test('detail does not spawn an unfunded context, original, trajectory or stored Page command', async () => {
    for (const completed of [4, 5, 6, 7]) {
      await scenario('facts-success');
      const actualNow = Date.now, base = actualNow();
      Date.now = () => {
        const count = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).length;
        return base + (count >= completed ? 45_000 : count * 5_000);
      };
      let result;
      try { result = await readFactDetail({ source, id: '17' }, config); } finally { Date.now = actualNow; }
      assert.equal(result.kind, 'success'); assert.equal(result.snapshot.fact.id, '17');
      assert.equal((await calls()).length, completed, `only ${completed} funded commands may start`);
      assert.equal(result.snapshot.storedPage.availability, 'failed');
      if (completed < 6) assert.equal(result.snapshot.evidence.location, null);
      await scenario('facts-success'); assert.equal((await listFacts({ source }, config)).kind, 'success');
    }
  });
  await test('catalog duplicates, unsafe declarations and changed schemas block their exact capability', async () => {
    await scenario('facts-success');
    const result = await runCommand(config, 'capabilities'); assert.equal(result.ok, true);
    const tools = JSON.parse(result.stdout);
    for (const [name, check] of [['recall', hasSafeFactCapabilities], ['find_trajectory', hasSafeTrajectoryCapability]]) {
      const tool = tools.find(item => item.name === name);
      assert.equal(check(tools), true);
      assert.equal(check([...tools, tool]), false);
      if (name === 'find_trajectory') {
        const withKinds = values => tools.map(item => item.name === name ? { ...item, schema: { ...item.schema, properties: { ...item.schema.properties, kind: { ...item.schema.properties.kind, enum: values } } } } : item);
        assert.equal(check(withKinds(['all'])), true);
        assert.equal(check(withKinds(['metric', 'event'])), false);
      }
      for (const override of [{ mutating: true }, { idempotent: false }, { scope: 'write' }, { required_scopes: ['admin'] }, { parameters: { ...tool.parameters, executable: 'string?' } }, { schema: { ...tool.schema, required: ['limit'] } }]) {
        assert.equal(check(tools.map(item => item.name === name ? { ...item, ...override } : item)), false);
      }
    }
    for (const name of ['facts-unsafe-trajectory', 'facts-trajectory-no-all']) {
      await scenario(name);
      const detail = await readFactDetail({ source, id: '17' }, config); assert.equal(detail.kind, 'success');
      assert.equal(detail.snapshot.storedPage.availability, 'unknown');
      assert.equal(detail.snapshot.evidence.availability, 'available');
      assert.equal((await calls()).filter(args => args[3] === 'find_trajectory').length, 0);
    }
  });
} finally { await rm(directory, { recursive: true, force: true }); }
