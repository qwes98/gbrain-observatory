#!/usr/bin/env node
// Test-only public-CLI double. Behavior is fixed by temporary operator files, never app requests.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = process.cwd();
const scenario = readFileSync(join(directory, 'scenario'), 'utf8').trim();
const args = process.argv.slice(2);
appendFileSync(join(directory, 'calls'), JSON.stringify({ args, pid: process.pid, hooks: process.env.GBRAIN_SKIP_STARTUP_HOOKS, sweep: process.env.GBRAIN_SWEEP }) + '\n');
const capabilities = [{ name: 'sources_list', scope: 'read', mutating: false, idempotent: true,
  required_scopes: [], parameters: { include_archived: 'boolean?' },
  schema: { type: 'object', properties: { include_archived: { type: 'boolean' } } } },
  { name: 'list_pages', scope: 'read', mutating: false, idempotent: true, required_scopes: [],
    parameters: { source_id: 'string?', sort: 'string?', limit: 'number?', offset: 'number?', tag: 'string?', include_deleted: 'boolean?' },
    schema: { type: 'object', properties: { source_id: { type: 'string' }, sort: { type: 'string', enum: ['slug', 'created_desc', 'updated_desc'] }, limit: { type: 'number' }, offset: { type: 'number' }, tag: { type: 'string' }, include_deleted: { type: 'boolean' } } } },
  { name: 'get_page', scope: 'read', mutating: false, idempotent: true, required_scopes: [],
    parameters: { slug: 'string', source_id: 'string?', fuzzy: 'boolean?', body: 'string?', view: 'string?', min_trust: 'string?', lines: 'object?', bytes: 'object?', context_lines: 'number?' },
    schema: { type: 'object', properties: { slug: { type: 'string' }, source_id: { type: 'string' }, fuzzy: { type: 'boolean' },
      body: { type: 'string', enum: ['auto', 'full', 'none', 'outline', 'window'] }, view: { type: 'string', enum: ['read', 'markdown'] },
      min_trust: { type: 'string', enum: ['user_confirmed', 'operator_curated', 'tool_observed', 'agent_written', 'unknown', 'external_untrusted'] },
      lines: { type: 'object', properties: { from: { type: 'number' }, count: { type: 'number' } }, required: ['from', 'count'], additionalProperties: false },
      bytes: { type: 'object', properties: { offset: { type: 'number' }, length: { type: 'number' } }, required: ['offset', 'length'], additionalProperties: false },
      context_lines: { type: 'number' } }, required: ['slug'] } }];
const source = { id: 'example', name: 'connection-private-source-name', local_path: '/connection-private/path',
  remote_url: 'https://secret-token@example.test/private', federated: true, strategy: null, page_count: 3, last_sync_at: null };
if (['descendant', 'successful-descendant', 'shutdown'].includes(scenario)) {
  const descendant = spawn(process.execPath, ['-e', `require('node:fs').writeFileSync('descendant-pid', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`], { stdio: 'ignore' });
  descendant.unref();
  if (scenario === 'descendant') setTimeout(() => process.stdout.write('x'.repeat(1_048_577)), 150);
  else if (scenario === 'successful-descendant') setTimeout(() => { console.log('gbrain 0.60.323.0'); process.exit(0); }, 150);
  else setInterval(() => {}, 1000);
}
else if (scenario === 'timeout') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else if (scenario === 'stdout-limit') { process.stdout.write('x'.repeat(1_048_577)); }
else if (scenario === 'stderr-limit') { process.stderr.write('private-error'.repeat(6000)); }
else if (scenario === 'nonzero') { process.stderr.write('connection-private-error secret-token'); process.exitCode = 12; }
else if (args[0] === '--version') console.log(scenario === 'version' ? 'gbrain 9.9.9.9' : 'gbrain 0.60.323.0');
else if (args[0] === '--tools-json') {
  if (scenario === 'malformed') console.log('{not json');
  else if (scenario === 'missing') console.log('[]');
  else { if (scenario === 'archived-default') capabilities[0].schema.properties.include_archived.default = true; if (scenario === 'unsafe') capabilities[0].mutating = true; if (scenario === 'pages-unsafe-list') capabilities[1].mutating = true; if (scenario === 'pages-unsafe-detail') capabilities[2].mutating = true; console.log(JSON.stringify(capabilities)); }
} else if (JSON.stringify(args) === JSON.stringify(['call', 'sources_list', '{}'])) {
  const rows = scenario === 'fields' ? [
    { ...source, id: 'folder-only', name: '동일 이름 / duplicate', local_path: '/원본/<script>/긴 경로', remote_url: null, federated: false, last_sync_at: '2026-10-27T03:00:00+09:00' },
    { ...source, id: 'git-only', name: '동일 이름 / duplicate', local_path: null, remote_url: 'javascript:alert(1)', strategy: 'original-strategy' },
    { ...source, id: 'neither', name: '둘 다 없음', local_path: null, remote_url: null },
  ] : [source];
  const respond = () => console.log(JSON.stringify(scenario === 'partial' ? { sources: [source], next_cursor: 'private-cursor' } : scenario === 'shape' ? { sources: [{}] } : { sources: scenario === 'empty' || scenario === 'pages-omitted' ? [] : rows }));
  if (scenario === 'slow' || scenario === 'concurrent') setTimeout(respond, scenario === 'concurrent' ? 2000 : 800); else respond();
} else if (args[0] === 'call' && args[1] === 'list_pages') {
  const input = JSON.parse(args[2]);
  if (scenario === 'pages-list-failure' || (scenario === 'pages-more-failure' && input.offset > 0)) { process.stderr.write('page-private-error secret-token'); process.exitCode = 12; }
  else {
    const count = scenario === 'pages-cap' ? 100 : scenario.startsWith('pages-') ? 13 : 0;
    const all = Array.from({ length: count }, (_, index) => ({ slug: `page-${String(index).padStart(3, '0')}`, source_id: input.source_id, type: index % 2 ? 'person' : 'source', title: `원본 Page ${index}`, updated_at: '2026-10-30T14:00:00Z', updated_at_iso: '2026-10-30T14:00:00Z' }));
    let result = all.slice(input.offset, input.offset + input.limit);
    if (scenario === 'pages-duplicates' && input.offset === 0) result[8] = result[7];
    if (scenario === 'pages-wrong-source') result = result.map(row => ({ ...row, source_id: 'other-source' }));
    const respond = () => console.log(JSON.stringify(scenario === 'pages-partial-list' ? { pages: result, next_cursor: 'private-cursor' } : result));
    if (scenario === 'pages-slow') setTimeout(respond, 800); else respond();
  }
} else if (args[0] === 'call' && args[1] === 'get_page') {
  const input = JSON.parse(args[2]);
  const index = Number(input.slug.split('-').at(-1));
  if (scenario === 'pages-detail-failure' && index === 1) { process.stderr.write('detail-private-error secret-token'); process.exitCode = 12; }
  else if (scenario === 'pages-budget' && index === 0) { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
  else if (scenario === 'pages-detail-large' && index === 1) process.stdout.write('x'.repeat(1_048_577));
  else {
    const created_at = index === 0 ? '2026-10-31T00:30:00Z' : index === 1 ? '2026-10-30T23:30:00Z' : '2026-10-29T03:00:00Z';
    const detail = { slug: input.slug, source_id: input.source_id, title: `원본 Page ${index}`, type: index % 2 ? 'person' : 'source', created_at, updated_at: '2026-10-30T14:00:00Z', body: 'PRIVATE_PAGE_BODY_MUST_NEVER_RENDER', frontmatter: { private: 'PRIVATE_FRONTMATTER_MUST_NEVER_RENDER' } };
    if (scenario === 'pages-detail-missing' && index === 1) delete detail.created_at;
    if (scenario === 'pages-detail-invalid' && index === 1) detail.created_at = '2026-02-30T00:00:00Z';
    if (scenario === 'pages-detail-identity' && index === 1) detail.source_id = 'other-source';
    if (scenario === 'pages-detail-partial' && index === 1) detail.partial = true;
    console.log(JSON.stringify(detail));
  }
} else { process.stderr.write('Unexpected argv'); process.exitCode = 14; }
