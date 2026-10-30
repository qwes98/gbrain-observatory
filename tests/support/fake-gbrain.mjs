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
  schema: { type: 'object', properties: { include_archived: { type: 'boolean' } } } }];
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
  else { if (scenario === 'archived-default') capabilities[0].schema.properties.include_archived.default = true; if (scenario === 'unsafe') capabilities[0].mutating = true; console.log(JSON.stringify(capabilities)); }
} else if (JSON.stringify(args) === JSON.stringify(['call', 'sources_list', '{}'])) {
  const rows = scenario === 'fields' ? [
    { ...source, id: 'folder-only', name: '동일 이름 / duplicate', local_path: '/원본/<script>/긴 경로', remote_url: null, federated: false, last_sync_at: '2026-10-27T03:00:00+09:00' },
    { ...source, id: 'git-only', name: '동일 이름 / duplicate', local_path: null, remote_url: 'javascript:alert(1)', strategy: 'original-strategy' },
    { ...source, id: 'neither', name: '둘 다 없음', local_path: null, remote_url: null },
  ] : [source];
  const respond = () => console.log(JSON.stringify(scenario === 'partial' ? { sources: [source], next_cursor: 'private-cursor' } : scenario === 'shape' ? { sources: [{}] } : { sources: scenario === 'empty' ? [] : rows }));
  if (scenario === 'slow' || scenario === 'concurrent') setTimeout(respond, scenario === 'concurrent' ? 2000 : 800); else respond();
} else { process.stderr.write('Unexpected argv'); process.exitCode = 14; }
