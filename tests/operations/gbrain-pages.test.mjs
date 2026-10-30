import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, chmod, rm, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const directory = await mkdtemp(join(tmpdir(), 'observatory-pages-'));
const modules = ['src/adapters/gbrain/runner.ts', 'src/adapters/gbrain/probe.ts', 'src/adapters/gbrain/pages.ts', 'src/contracts/pages.ts', 'src/contracts/sources.ts', 'src/i18n/time-zone.ts'];
for (const path of modules) {
  const filename = path === 'src/contracts/pages.ts' ? 'page-contracts' : basename(path, '.ts');
  const source = await readFile(path, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(directory, `${filename}.mjs`), compiled.replace(/from "([.][^"]+)"/g, (_match, value) => `from "./${value.endsWith('/contracts/pages') ? 'page-contracts' : basename(value)}.mjs"`));
}
const { listPages, hasSafePageCapabilities, pageAcquisitionDeadlineMs, projectPageDetail } = await import(pathToFileURL(join(directory, 'pages.mjs')));
const { checkConnection, listSources } = await import(pathToFileURL(join(directory, 'probe.mjs')));
const { runCommand } = await import(pathToFileURL(join(directory, 'runner.mjs')));
const executable = join(directory, 'fake-gbrain');
await copyFile('tests/support/fake-gbrain.mjs', executable);
await chmod(executable, 0o700);
const config = { executable, cwd: directory };
const namespace = 'connection-' + createHash('sha256').update(JSON.stringify([executable, directory])).digest('hex');
const source = JSON.stringify([namespace, 'example']);
async function scenario(name) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

try {
  await test('Page reads verify current exact source scope and use only fixed public arguments', async () => {
    await scenario('pages-success');
    const before = Date.now();
    const result = await listPages({ source, offset: 0 }, config);
    assert.equal(result.kind, 'success');
    const snapshot = result.snapshot;
    assert.equal(snapshot.sourceReference, source);
    assert.equal(snapshot.coverage, 'unknown');
    assert.equal(snapshot.offset, 0);
    assert.equal(snapshot.nextOffset, 10);
    assert.equal(snapshot.range, 'more');
    assert.equal(snapshot.pages.length, 10);
    assert.deepEqual(snapshot.pages.map(page => page.slug), Array.from({ length: 10 }, (_, index) => `page-${String(index).padStart(3, '0')}`));
    const page = snapshot.pages[0];
    assert.equal(page.namespace, namespace);
    assert.equal(page.sourceId, 'example');
    assert.equal(page.title, '원본 Page 0');
    assert.equal(page.kind, 'source');
    assert.equal(page.createdAt, '2026-10-31T00:30:00Z');
    assert.equal(page.updatedAt, '2026-10-30T14:00:00Z');
    assert.equal(page.creationAvailability, 'available');
    assert.ok(Date.parse(snapshot.observation.startedAt) >= before);
    assert.ok(Date.parse(snapshot.observation.completedAt) >= Date.parse(snapshot.listObservation.completedAt));
    assert.ok(page.detailObservation);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PAGE_BODY|PRIVATE_FRONTMATTER|private-error|secret-token/);
    const invoked = (await calls()).map(call => call.args);
    assert.deepEqual(invoked.slice(0, 3), [['--version'], ['--tools-json'], ['call', 'sources_list', '{}']]);
    assert.equal(invoked[3][1], 'list_pages');
    assert.deepEqual(JSON.parse(invoked[3][2]), { source_id: 'example', sort: 'created_desc', limit: 10, offset: 0 });
    assert.ok(invoked.slice(4).every(args => args[0] === 'call' && args[1] === 'get_page' && JSON.parse(args[2]).source_id === 'example' && JSON.parse(args[2]).fuzzy === false));
  });

  await test('hostile or out-of-range Page requests never become executable arguments', async () => {
    for (const input of [{ source: '/bin/sh', offset: 0 }, { source, offset: -1 }, { source, offset: 100 }, { source, offset: 1.5 }]) {
      await scenario('pages-success');
      const result = await listPages(input, config);
      assert.notEqual(result.kind, 'success');
      assert.equal((await calls()).length, 0);
    }
    await scenario('pages-success');
    assert.equal((await listPages({ source: JSON.stringify(['different-connection', 'example']), offset: 0 }, config)).kind, 'unavailable');
    assert.ok((await calls()).every(call => call.args[1] !== 'list_pages'));
    await scenario('pages-omitted');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'unavailable');
    assert.equal((await calls()).length, 3);
  });

  await test('detail failures, partials and missing fields never substitute modification for creation', async () => {
    for (const name of ['pages-detail-failure', 'pages-detail-large', 'pages-detail-missing', 'pages-detail-invalid', 'pages-detail-identity', 'pages-detail-partial']) {
      await scenario(name);
      const result = await listPages({ source, offset: 0 }, config);
      assert.equal(result.kind, 'success', name);
      const page = result.snapshot.pages[1];
      assert.equal(page.createdAt, null, name);
      assert.notEqual(page.creationAvailability, 'available', name);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PAGE_BODY|PRIVATE_FRONTMATTER|private-error|secret-token/);
      assert.equal(result.snapshot.pages[0].createdAt, '2026-10-31T00:30:00Z', name);
    }
  });

  await test('invalid or absent detail modification preserves independent valid list evidence', () => {
    const valid = '2026-10-30T14:00:00Z';
    const observation = { startedAt: valid, completedAt: valid };
    const base = { namespace, sourceId: 'example', slug: 'page-000', title: 'original', kind: 'source', createdAt: null,
      updatedAt: valid, creationAvailability: 'missing', modificationAvailability: 'available', detailObservation: null };
    for (const updated_at of ['2026-02-30T00:00:00Z', null, undefined]) {
      const projected = projectPageDetail({ slug: base.slug, source_id: base.sourceId, updated_at }, base, observation);
      assert.equal(projected.updatedAt, valid);
      assert.equal(projected.modificationAvailability, 'available');
    }
    for (const modificationAvailability of ['missing', 'invalid']) {
      const page = { ...base, updatedAt: null, modificationAvailability };
      const invalid = projectPageDetail({ slug: base.slug, source_id: base.sourceId, updated_at: 'bad' }, page, observation);
      assert.equal(invalid.updatedAt, null);
      assert.equal(invalid.modificationAvailability, 'invalid');
      const missing = projectPageDetail({ slug: base.slug, source_id: base.sourceId }, page, observation);
      assert.equal(missing.updatedAt, null);
      assert.equal(missing.modificationAvailability, modificationAvailability);
      const verified = projectPageDetail({ slug: base.slug, source_id: base.sourceId, updated_at: valid }, page, observation);
      assert.equal(verified.updatedAt, valid);
      assert.equal(verified.modificationAvailability, 'available');
    }
  });

  await test('a full raw batch advances offset ten despite a duplicate identity and continues correctly', async () => {
    await scenario('pages-duplicates');
    const first = await listPages({ source, offset: 0 }, config);
    assert.equal(first.kind, 'success');
    assert.equal(first.snapshot.pages.length, 9);
    assert.equal(first.snapshot.nextOffset, 10);
    assert.equal(first.snapshot.range, 'more');
    assert.deepEqual(first.snapshot.pages.map(page => page.slug), ['page-000', 'page-001', 'page-002', 'page-003', 'page-004', 'page-005', 'page-006', 'page-007', 'page-009']);
    assert.equal((await calls()).filter(call => call.args[1] === 'get_page').length, 9);
    const next = await listPages({ source, offset: first.snapshot.nextOffset }, config);
    assert.equal(next.kind, 'success');
    assert.equal(next.snapshot.offset, 10);
    assert.equal(next.snapshot.nextOffset, 13);
    assert.equal(next.snapshot.range, 'observed-end');
    assert.deepEqual(next.snapshot.pages.map(page => page.slug), ['page-010', 'page-011', 'page-012']);
    assert.deepEqual((await calls()).filter(call => call.args[1] === 'list_pages').map(call => JSON.parse(call.args[2]).offset), [0, 10]);
  });

  await test('observed end, application cap and additional-read failure remain distinct', async () => {
    await scenario('pages-success');
    const ending = await listPages({ source, offset: 10 }, config);
    assert.equal(ending.kind, 'success');
    assert.equal(ending.snapshot.range, 'observed-end');
    assert.equal(ending.snapshot.nextOffset, 13);
    await scenario('pages-cap');
    const capped = await listPages({ source, offset: 90 }, config);
    assert.equal(capped.kind, 'success');
    assert.equal(capped.snapshot.range, 'cap');
    assert.equal(capped.snapshot.nextOffset, 100);
    await scenario('pages-more-failure');
    assert.equal((await listPages({ source, offset: 10 }, config)).kind, 'failure');
    await scenario('pages-wrong-source');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'unknown');
    await scenario('pages-partial-list');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'unknown');
  });

  await test('Pages, source lists and connection counts share one lease with immediate refusal', async () => {
    await scenario('pages-slow');
    const pending = listPages({ source, offset: 0 }, config);
    assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'busy' });
    assert.deepEqual(await checkConnection(config), { kind: 'failure', cause: 'busy' });
    assert.equal((await pending).kind, 'success');
    await scenario('pages-success');
    assert.equal((await checkConnection(config)).kind, 'success');
    assert.equal((await calls()).length, 3);
  });

  await test('the overall Page deadline shortens a command budget and still reaps its child', async () => {
    assert.equal(pageAcquisitionDeadlineMs, 45_000);
    await scenario('timeout');
    const before = Date.now();
    assert.deepEqual(await runCommand(config, 'version', before + 60), { ok: false, cause: 'timeout' });
    assert.ok(Date.now() - before < 2_000);
    const [invocation] = await calls();
    try { assert.match(await readFile(`/proc/${invocation.pid}/stat`, 'utf8'), /\) Z /); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await scenario('pages-success');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'success');
  });

  await test('listPages propagates its cumulative deadline, stops remaining details and releases the lease', async () => {
    await scenario('pages-budget');
    const actualNow = Date.now;
    const base = actualNow();
    const started = performance.now();
    // Advance the acquisition clock after real child invocations. Timers and child cleanup stay real.
    Date.now = () => {
      const count = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).length;
      return base + [0, 11_000, 22_000, 33_000, 44_700, 45_000][Math.min(count, 5)];
    };
    let result;
    try { result = await listPages({ source, offset: 0 }, config); }
    finally { Date.now = actualNow; }
    assert.ok(performance.now() - started < 2_000, 'the detail must use the remaining 300ms instead of a new 15s budget');
    assert.equal(result.kind, 'success');
    assert.equal(result.snapshot.pages.length, 10);
    assert.ok(result.snapshot.pages.every(page => page.createdAt === null && page.creationAvailability === 'failed'));
    assert.ok(result.snapshot.pages[0].detailObservation);
    assert.ok(result.snapshot.pages.slice(1).every(page => page.detailObservation === null));
    const invocations = await calls();
    assert.equal(invocations.length, 5);
    assert.equal(invocations.at(-1).args[1], 'get_page');
    const pid = invocations.at(-1).pid;
    try { assert.match(await readFile(`/proc/${pid}/stat`, 'utf8'), /\) Z /, 'timed-out detail child must be reaped'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await scenario('pages-success');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'success', 'a later acquisition must reuse the released shared lease');
  });

  await test('unsafe duplicate Page capability declarations are rejected before Page reads', async () => {
    await scenario('pages-success');
    const result = await runCommand(config, 'capabilities');
    assert.equal(result.ok, true);
    const catalog = JSON.parse(result.stdout);
    assert.equal(hasSafePageCapabilities(catalog), true);
    // These include the installed catalog's nested object and enum definitions.
    for (const [name, property, mutation] of [
      ['list_pages', 'tag', { $ref: '#/unexpected' }],
      ['list_pages', 'tag', { minLength: 1 }],
      ['list_pages', 'include_deleted', { default: true }],
      ['get_page', 'context_lines', { minimum: 1 }],
      ['get_page', 'body', { $ref: '#/unexpected' }],
      ['get_page', 'body', { enum: ['auto', 'unsupported'] }],
      ['get_page', 'lines', { additionalProperties: true }],
      ['get_page', 'lines', { required: ['from', 'from'] }],
      ['get_page', 'bytes', { properties: { offset: { type: 'number', minimum: 0 }, length: { type: 'number' } } }],
    ]) {
      const changed = structuredClone(catalog);
      Object.assign(changed.find(tool => tool.name === name).schema.properties[property], mutation);
      assert.equal(hasSafePageCapabilities(changed), false, `${name}.${property}: ${JSON.stringify(mutation)}`);
    }
    for (const name of ['list_pages', 'get_page']) {
      const capability = catalog.find(tool => tool.name === name);
      assert.equal(hasSafePageCapabilities([...catalog, capability]), false);
      for (const override of [{ mutating: true }, { idempotent: false }, { scope: 'write' }, { required_scopes: ['admin'] }, { parameters: { shell: 'string' } }]) {
        assert.equal(hasSafePageCapabilities(catalog.map(tool => tool.name === name ? { ...tool, ...override } : tool)), false);
      }
    }
    assert.equal(hasSafePageCapabilities([]), false);
    assert.equal(hasSafePageCapabilities({ tools: [] }), false);
    await scenario('pages-unsafe-list');
    assert.equal((await listPages({ source, offset: 0 }, config)).kind, 'unknown');
    assert.equal((await calls()).length, 2);
    await scenario('pages-unsafe-detail');
    const unsupported = await listPages({ source, offset: 0 }, config);
    assert.equal(unsupported.kind, 'success');
    assert.ok(unsupported.snapshot.pages.every(page => page.createdAt === null && page.creationAvailability === 'unsupported'));
    assert.equal((await calls()).length, 4);
  });
} finally { await rm(directory, { recursive: true, force: true }); }
