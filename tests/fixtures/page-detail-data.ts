import type { PageDetailSnapshot } from '../../src/contracts/page-detail';
import { pageRows } from './page-data';
import { sourceSnapshot } from './source-data';

// Public source content remains bilingual regardless of the interface preference.
export const originalClaim = '원본 기억 / original claim';
export const originalBody = '# 원본 본문 / original body\n<!--- gbrain:facts:begin -->\n| # | claim | kind | confidence | visibility | notability | valid_from | valid_until | source | context |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 원본 기억 / original claim | fact | 0.9 | world | high | | | original | provenance is not a Page FK |\n<!--- gbrain:facts:end -->\n<script>globalThis.readerAttack=true</script>\n![tracking](https://attacker.invalid/pixel)\n[unsafe](javascript:alert(1))\n[local](file:///private/file)\n[safe](https://example.invalid/read)';
const start = originalBody.indexOf(originalClaim);
export const pageDetailSnapshot: PageDetailSnapshot = {
  page: pageRows[0], sourceName: sourceSnapshot.sources[0].name,
  body: { availability: 'available', observation: { startedAt: '2026-10-31T12:00:00Z', completedAt: '2026-10-31T12:00:00.500Z' }, sections: [{ id: 'compiled-truth', text: originalBody }, { id: 'timeline', text: '원본 타임라인 / original timeline' }] },
  memories: { availability: 'available', rows: [{ id: 'page-local-row-1', claim: originalClaim, kind: 'fact', fields: { '#': '1', confidence: '0.9', visibility: 'world', source: 'original', context: 'provenance is not a Page FK' }, location: { section: 'compiled-truth', start, end: start + originalClaim.length } }] },
  backlinks: { coverage: 'unknown', candidateLimit: 10, availability: 'available', listObservation: { startedAt: '2026-10-31T12:00:00.500Z', completedAt: '2026-10-31T12:00:00.750Z' }, pages: [{ page: { ...pageRows[1], title: '참조 원본 / referring original' }, sourceName: sourceSnapshot.sources[0].name }], omitted: 0, truncated: false },
  observation: { startedAt: '2026-10-31T12:00:00Z', completedAt: '2026-10-31T12:00:01Z' },
};

export const publicWindowExcerpt = '공개 창의 원본 / exact public window excerpt\nOnly this supplied range is available.';
export const emptyMemoryTable = '<!--- gbrain:facts:begin -->\n| # | claim | kind | confidence | visibility | notability | valid_from | valid_until | source | context |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n<!--- gbrain:facts:end -->';
