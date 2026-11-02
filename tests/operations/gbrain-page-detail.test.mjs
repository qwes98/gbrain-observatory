import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, chmod, rm, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const directory = await mkdtemp(join(tmpdir(), 'observatory-page-reader-'));
const modules = ['src/adapters/gbrain/runner.ts', 'src/adapters/gbrain/probe.ts', 'src/adapters/gbrain/pages.ts', 'src/adapters/gbrain/page-detail.ts', 'src/contracts/pages.ts', 'src/contracts/sources.ts', 'src/contracts/page-detail.ts', 'src/i18n/time-zone.ts'];
function moduleName(path) {
  return path.endsWith('contracts/pages.ts') ? 'page-contracts' : path.endsWith('contracts/page-detail.ts') ? 'detail-contracts' : basename(path, '.ts');
}
for (const path of modules) {
  const compiled = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(directory, `${moduleName(path)}.mjs`), compiled.replace(/from "([.][^"]+)"/g, (_match, value) => `from "./${moduleName(value + '.ts')}.mjs"`));
}
const { readPageDetail, projectPublicPageDetail, parsePublicMemories, hasSafePageDetailCapabilities } = await import(pathToFileURL(join(directory, 'page-detail.mjs')));
const { verifiedPageLocation, validPageDetailRequest } = await import(pathToFileURL(join(directory, 'detail-contracts.mjs')));
const { listSources } = await import(pathToFileURL(join(directory, 'probe.mjs')));
const { runCommand } = await import(pathToFileURL(join(directory, 'runner.mjs')));
const executable = join(directory, 'fake-gbrain');
await copyFile('tests/support/fake-gbrain.mjs', executable); await chmod(executable, 0o700);
const config = { executable, cwd: directory };
const namespace = 'connection-' + createHash('sha256').update(JSON.stringify([executable, directory])).digest('hex');
const source = JSON.stringify([namespace, 'example']);
const request = { source, slug: 'page-000' };
const observation = { startedAt: '2026-11-02T00:00:00Z', completedAt: '2026-11-02T00:00:01Z' };
async function scenario(name) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

try {
  await test('public reader verifies namespace, current Source, exact Page and candidate endpoints before projection', async () => {
    await scenario('detail-success');
    const result = await readPageDetail(request, config);
    assert.equal(result.kind, 'success');
    const snapshot = result.snapshot;
    assert.equal(snapshot.page.namespace, namespace); assert.equal(snapshot.page.sourceId, 'example'); assert.equal(snapshot.page.slug, request.slug);
    assert.equal(snapshot.body.availability, 'available'); assert.equal(snapshot.body.sections.length, 2);
    assert.ok(snapshot.body.observation); assert.ok(snapshot.backlinks.listObservation);
    assert.equal(snapshot.backlinks.coverage, 'unknown'); assert.equal(snapshot.backlinks.candidateLimit, 10);
    assert.equal(snapshot.memories.availability, 'available'); assert.equal(snapshot.memories.rows.length, 1);
    const memory = snapshot.memories.rows[0];
    assert.equal(memory.claim, '원본 기억 / original claim'); assert.equal(memory.kind, 'fact');
    assert.equal(verifiedPageLocation(snapshot.body.sections, memory.location, memory.claim), true);
    assert.notEqual(memory.id, '1');
    assert.equal(snapshot.backlinks.pages.length, 1); assert.equal(snapshot.backlinks.pages[0].page.title, 'Verified title ref-001');
    assert.ok(snapshot.backlinks.omitted >= 2);
    const invoked = (await calls()).map(call => call.args);
    assert.deepEqual(invoked.slice(0, 3), [['--version'], ['--tools-json'], ['call', 'sources_list', '{}']]);
    assert.deepEqual(JSON.parse(invoked.find(args => args[1] === 'get_backlinks')[2]), { source_id: 'example', slug: request.slug, limit: 10 });
    const reads = invoked.filter(args => args[1] === 'get_page').map(args => JSON.parse(args[2]));
    assert.deepEqual(reads, [{ source_id: 'example', slug: request.slug, fuzzy: false }, { source_id: 'example', slug: 'ref-001', fuzzy: false }]);
    assert.ok(invoked.every(args => !['recall', 'get_fact'].includes(args[1])));
    assert.doesNotMatch(JSON.stringify(result), /private-continuation|PRIVATE_FRONTMATTER|secret-token/);
  });

  await test('cross-Source references retain separately verified exact identities and permit an exact target read', async () => {
    await scenario('detail-cross-source');
    const result = await readPageDetail(request, config); assert.equal(result.kind, 'success');
    assert.equal(result.snapshot.backlinks.availability, 'available');
    const [target] = result.snapshot.backlinks.pages;
    assert.equal(target.page.namespace, namespace); assert.equal(target.page.sourceId, 'another');
    assert.equal(target.page.slug, 'cross-target'); assert.equal(target.page.title, 'Cross Source target');
    assert.equal(target.sourceName, 'Cross Source');
    const exact = await readPageDetail({ source: JSON.stringify([namespace, 'another']), slug: 'cross-target' }, config);
    assert.equal(exact.kind, 'success'); assert.equal(exact.snapshot.page.sourceId, 'another');
    assert.match(exact.snapshot.body.sections[0].text, /Cross Source body another\/cross-target/);
    assert.equal(exact.snapshot.backlinks.availability, 'empty');
  });

  await test('a disappearing backlink Source is excluded while the current permitted Page stays readable', async () => {
    await scenario('detail-cross-source-omitted');
    const result = await readPageDetail(request, config); assert.equal(result.kind, 'success');
    assert.equal(result.snapshot.page.sourceId, 'example');
    assert.equal(result.snapshot.body.availability, 'available');
    assert.equal(result.snapshot.backlinks.availability, 'partial');
    assert.deepEqual(result.snapshot.backlinks.pages, []);
    assert.equal(result.snapshot.backlinks.omitted, 1);
    const reads = (await calls()).filter(call => call.args[1] === 'get_page').map(call => JSON.parse(call.args[2]));
    assert.deepEqual(reads, [{ source_id: 'example', slug: request.slug, fuzzy: false }]);
  });

  await test('hostile request scope is rejected without spawning and omitted source cannot read a Page', async () => {
    for (const input of [{ source: '/bin/sh', slug: request.slug }, { source, slug: '' }, { source, slug: 'bad\nslug' }, { source, slug: 'a'.repeat(1025) }, { ...request, executable: '/bin/sh' }]) {
      await scenario('detail-success');
      assert.equal(validPageDetailRequest(input), false);
      assert.notEqual((await readPageDetail(input, config)).kind, 'success');
      assert.equal((await calls()).length, 0);
    }
    await scenario('detail-omitted-source');
    assert.equal((await readPageDetail(request, config)).kind, 'unavailable');
    assert.equal((await calls()).length, 3);
  });

  await test('wrong identity and protected bodies never expose returned source text', async () => {
    for (const name of ['detail-wrong-source', 'detail-wrong-slug']) {
      await scenario(name); assert.notEqual((await readPageDetail(request, config)).kind, 'success', name);
    }
    for (const name of ['detail-quarantined', 'detail-body-omitted']) {
      await scenario(name); const result = await readPageDetail(request, config);
      assert.equal(result.kind, 'success'); assert.equal(result.snapshot.body.availability, 'protected');
      assert.deepEqual(result.snapshot.body.sections, []); assert.equal(result.snapshot.memories.availability, 'unknown');
      assert.doesNotMatch(JSON.stringify(result), /PROTECTED_BODY_MUST_NOT_RENDER/);
    }
  });

  await test('complete absent memory sections, partial bodies and malformed fences have separate meanings', async () => {
    for (const [name, availability] of [['detail-empty', 'empty'], ['detail-partial', 'unknown'], ['detail-outline', 'unknown'], ['detail-invalid-fence', 'unknown'], ['detail-code-fence', 'empty']]) {
      await scenario(name); const result = await readPageDetail(request, config);
      assert.equal(result.kind, 'success', name); assert.equal(result.snapshot.memories.availability, availability, name);
      assert.equal(result.snapshot.memories.rows.length, 0, name);
    }
    const projected = projectPublicPageDetail({ slug: request.slug, source_id: 'example', title: 'title', type: 'source', body: 'NEVER_USE_BODY', content: 'NEVER_USE_CONTENT', frontmatter: { private: true } }, request, namespace, 'source', observation);
    assert.ok(projected); assert.equal(projected.body.availability, 'unknown'); assert.deepEqual(projected.body.sections, []);
    assert.doesNotMatch(JSON.stringify(projected), /NEVER_USE|frontmatter/);
  });

  await test('a public window preserves its exact excerpt while body completeness and memory linkage stay unconfirmed', async () => {
    await scenario('detail-window');
    const result = await readPageDetail(request, config);
    assert.equal(result.kind, 'success');
    assert.equal(result.snapshot.body.availability, 'partial');
    assert.deepEqual(result.snapshot.body.sections, [{ id: 'window', text: '# 공개 일부 / public excerpt\r\n원본 🌿 <script>window.excerptAttack=true</script>\n| literal | text |' }]);
    assert.equal(result.snapshot.memories.availability, 'unknown');
    assert.deepEqual(result.snapshot.memories.rows, []);
    assert.doesNotMatch(JSON.stringify(result), /private-window-continuation/);
  });

  await test('public fact tables preserve typed fields and reject malformed or ambiguous structures', () => {
    const header = '| # | claim | kind | confidence | visibility | notability | valid_from | valid_until | source | context | claim_metric | claim_value | claim_unit | claim_period | attributed_to |';
    const row = '| 7 | 매출 \\| revenue | fact | 0.95 | world | high | 2026-01-01 | | original | free provenance | revenue | $1.2m | USD | 2026-Q1 | user |';
    const body = `<!--- gbrain:facts:begin -->\n${header}\n${row}\n<!--- gbrain:facts:end -->`;
    const parsed = parsePublicMemories([{ id: 'compiled-truth', text: body }], true, 'page-key');
    assert.equal(parsed.availability, 'available'); assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].fields.claim_metric, 'revenue'); assert.equal(parsed.rows[0].fields.claim_value, '$1.2m');
    assert.equal(parsed.rows[0].fields.attributed_to, 'user');
    assert.equal(verifiedPageLocation([{ id: 'compiled-truth', text: body }], parsed.rows[0].location, parsed.rows[0].claim), true);
    for (const text of [body.replace('0.95', 'NaN'), body.replace('world', 'unknown'), body.replace('$1.2m', 'arbitrary'), body.replace('<!--- gbrain:facts:end -->', ''), body.replace(row, row + '\n' + row), body + '\n<!--- gbrain:facts:begin -->']) {
      const result = parsePublicMemories([{ id: 'compiled-truth', text }], true, 'page-key');
      assert.equal(result.availability, 'unknown'); assert.deepEqual(result.rows, []);
    }
    for (const text of [`\`\`\`\`md\n${body}\n\`\`\`\``, `~~~markdown\n${body}\n~~~`, body.split('\n').map(line => '    ' + line).join('\n')]) {
      assert.equal(parsePublicMemories([{ id: 'compiled-truth', text }], true, 'page-key').availability, 'empty');
    }
  });

  await test('original locations reject guessed, altered and out-of-range claims', () => {
    const sections = [{ id: 'compiled-truth', text: 'prefix 원본 기억 suffix' }];
    assert.equal(verifiedPageLocation(sections, { section: 'compiled-truth', start: 7, end: 12 }, '원본 기억'), true);
    for (const location of [{ section: 'timeline', start: 7, end: 12 }, { section: 'compiled-truth', start: -1, end: 12 }, { section: 'compiled-truth', start: 7, end: 999 }, { section: 'compiled-truth', start: 6, end: 12 }]) assert.equal(verifiedPageLocation(sections, location, '원본 기억'), false);
    assert.equal(verifiedPageLocation(sections, { section: 'compiled-truth', start: 7, end: 12 }, 'changed'), false);
    assert.equal(parsePublicMemories(sections, false, 'page-key').availability, 'unknown');
  });

  await test('backlink truncation, failed reads, identity mismatch and bounded candidates never fabricate complete coverage', async () => {
    await scenario('detail-backlinks-empty'); let result = await readPageDetail(request, config);
    assert.equal(result.kind, 'success'); assert.equal(result.snapshot.backlinks.availability, 'empty');
    for (const name of ['detail-backlinks-truncated', 'detail-ref-wrong-identity', 'detail-backlinks-cap']) {
      await scenario(name); result = await readPageDetail(request, config); assert.equal(result.kind, 'success', name);
      assert.notEqual(result.snapshot.backlinks.availability, 'available', name);
      assert.ok((await calls()).filter(call => call.args[1] === 'get_page').length <= 11, name);
      if (name === 'detail-backlinks-truncated') assert.equal(result.snapshot.backlinks.truncated, true);
      if (name === 'detail-ref-wrong-identity') assert.equal(result.snapshot.backlinks.pages.length, 0);
    }
  });

  await test('failed backlinks retain the same current Page body and memories with an explicit failed reference state', async () => {
    await scenario('detail-success');
    const successful = await readPageDetail(request, config);
    assert.equal(successful.kind, 'success');
    await scenario('detail-backlinks-failure');
    const result = await readPageDetail(request, config);
    assert.equal(result.kind, 'success');
    assert.equal(result.snapshot.backlinks.availability, 'failed');
    assert.deepEqual(result.snapshot.backlinks.pages, []);
    assert.equal(result.snapshot.body.availability, 'available');
    assert.deepEqual(result.snapshot.body.sections, successful.snapshot.body.sections);
    assert.deepEqual(result.snapshot.memories, successful.snapshot.memories);
    const invoked = await calls();
    assert.equal(invoked.filter(call => call.args[1] === 'get_page').length, 1);
    assert.equal(invoked.filter(call => call.args[1] === 'get_backlinks').length, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-backlink-error|secret-token/);
  });

  await test('detail and other connection reads share immediate lease refusal and release after failures', async () => {
    await scenario('detail-slow');
    const pending = readPageDetail(request, config);
    assert.deepEqual(await listSources(config), { kind: 'failure', reason: 'busy' });
    assert.deepEqual(await readPageDetail(request, config), { kind: 'failure', reason: 'busy' });
    assert.equal((await pending).kind, 'success');
    await scenario('detail-failure'); assert.equal((await readPageDetail(request, config)).kind, 'failure');
    await scenario('detail-success'); assert.equal((await readPageDetail(request, config)).kind, 'success');
  });

  await test('the cumulative reader budget shortens its child timeout and releases the shared lease', async () => {
    await scenario('detail-budget');
    const actualNow = Date.now, base = actualNow(), started = performance.now();
    Date.now = () => {
      const count = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).length;
      return base + [0, 11_000, 22_000, 44_700, 45_000][Math.min(count, 4)];
    };
    let result;
    try { result = await readPageDetail(request, config); } finally { Date.now = actualNow; }
    assert.equal(result.kind, 'failure');
    assert.ok(performance.now() - started < 2_000, 'reader must use remaining 300ms, not a fresh command budget');
    const invoked = await calls(); assert.equal(invoked.length, 4); assert.equal(invoked.at(-1).args[1], 'get_page');
    try { assert.match(await readFile(`/proc/${invoked.at(-1).pid}/stat`, 'utf8'), /\) Z /); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await scenario('detail-success'); assert.equal((await readPageDetail(request, config)).kind, 'success');
  });

  await test('unsafe catalog metadata blocks only its permitted projection and never executes an unsafe operation', async () => {
    await scenario('detail-success'); const catalog = await runCommand(config, 'capabilities'); assert.equal(catalog.ok, true);
    const tools = JSON.parse(catalog.stdout); assert.equal(hasSafePageDetailCapabilities(tools), true);
    for (const name of ['get_page', 'get_backlinks']) {
      const tool = tools.find(row => row.name === name);
      assert.equal(hasSafePageDetailCapabilities([...tools, tool]), false);
      for (const override of [{ mutating: true }, { idempotent: false }, { scope: 'write' }, { required_scopes: ['admin'] }]) assert.equal(hasSafePageDetailCapabilities(tools.map(row => row.name === name ? { ...row, ...override } : row)), false);
    }
    await scenario('detail-unsafe-page'); assert.notEqual((await readPageDetail(request, config)).kind, 'success');
    assert.ok((await calls()).every(call => call.args[1] !== 'get_page'));
    await scenario('detail-unsafe-backlinks'); const result = await readPageDetail(request, config);
    assert.equal(result.kind, 'success'); assert.equal(result.snapshot.backlinks.availability, 'unknown');
    assert.ok((await calls()).every(call => call.args[1] !== 'get_backlinks'));
  });
} finally { await rm(directory, { recursive: true, force: true }); }
