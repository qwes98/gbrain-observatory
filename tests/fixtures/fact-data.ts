import type { Fact, FactSnapshot, FactDetailSnapshot } from '../../src/contracts/facts';
import { sourceReference } from '../../src/contracts/sources';
import { pageRows } from './page-data';
import { sourceSnapshot } from './source-data';

export const factClaim = '김민준은 다음 과정으로 React 기초를 수강한다. / Original memory 🌿';
export const factRawContext = 'notes/fact-context — extracted from original';
export const factQuote = '김민준 학생은 JavaScript 복습을 마쳤고, 다음 과정으로 React 기초를 수강하기로 했다.';
export const factBody = `😀 원본 문맥 / Original context\n김민준 학생은 JavaScript 함수와 배열 메서드를 스스로 설명할 수 있다.\n${factQuote}\n다음 수업 전까지 배열 메서드 복습 과제를 제출하기로 했다.\n<script>globalThis.factAttack=true</script>\n![tracking](https://attacker.invalid/fact-pixel)\n[unsafe](javascript:alert(1))\n[local](file:///private/file)`;
const source = sourceSnapshot.sources[0];
export const factRows: Fact[] = [
  { namespace: source.namespace, sourceId: source.id, id: '17', content: factClaim, kind: 'fact', sourceDescription: 'mcp:put_page', provenance: null, context: factRawContext, contextAvailability: 'available', createdAt: '2026-11-03T00:30:00Z', creationAvailability: 'available', recordedBy: null, recorderAvailability: 'missing' },
  { namespace: source.namespace, sourceId: source.id, id: '18', content: '원본 믿음 / Original belief', kind: 'belief', sourceDescription: null, provenance: null, context: null, contextAvailability: 'missing', createdAt: null, creationAvailability: 'null', recordedBy: null, recorderAvailability: 'missing' },
];
const observation = { startedAt: '2026-11-03T01:00:00Z', completedAt: '2026-11-03T01:00:01Z' };
export const factSnapshot: FactSnapshot = { sourceReference: sourceReference(source), rows: factRows, candidateLimit: 100, continuation: 'unsupported', capped: false, omitted: 0, coverage: 'unknown', observation };
const start = factBody.indexOf(factQuote);
export const factDetailSnapshot: FactDetailSnapshot = {
  fact: factRows[0], sourceName: source.name,
  contextPage: { availability: 'available', page: { ...pageRows[0], slug: 'notes/fact-context', title: '김민준 · JavaScript 4회차 수업일지' } },
  storedPage: { availability: 'missing', page: null },
  evidence: { availability: 'available', level: 'context-page', page: { ...pageRows[0], slug: 'notes/fact-original', title: '원본 문맥 / Original context' }, quote: factQuote, location: { section: 'compiled-truth', start, end: start + factQuote.length }, body: { availability: 'available', sections: [{ id: 'compiled-truth', text: factBody }] } },
  observation,
};
