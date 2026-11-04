import { resolveLocale } from '../../src/i18n/messages';
import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import { SourceScreen } from '../../src/ui/source-screen';
import type { SourceListResult, SourceListState } from '../../src/contracts/sources';
import '../../src/app/globals.css';
import { sourceSnapshot as snapshot, timestampSnapshot, timeZoneSnapshot } from './source-data';
import { availableTimeZones, resolveTimeZone } from '../../src/i18n/time-zone';
import { TimeZoneProvider } from '../../src/ui/time-zone-provider';
import { TimeZoneControl } from '../../src/ui/time-zone-control';
import type { PageListResult, PageRequest } from '../../src/contracts/pages';
import { pageSnapshot } from './page-data';
import type { PageDetailRequest, PageDetailResult } from '../../src/contracts/page-detail';
import { pageDetailSnapshot, publicWindowExcerpt, emptyMemoryTable } from './page-detail-data';
import type { FactRequest, FactDetailRequest, FactListResult, FactDetailResult } from '../../src/contracts/facts';
import { factRows, factSnapshot, factDetailSnapshot, factRawContext } from './fact-data';

const parameters = new URLSearchParams(location.search);
const locale = resolveLocale(parameters.get('locale'));
document.documentElement.lang = locale;
const scenario = parameters.get('scenario') ?? 'unconfigured';
const states: Record<string, SourceListState> = {
  loading: { kind: 'loading' },
  'facts-cold-failure': { kind: 'failure', reason: 'request-failed' },
  'facts-cold-seed': { kind: 'failure', reason: 'request-failed' },
  'facts-cold-busy': { kind: 'failure', reason: 'busy' },
  'facts-cold-unknown': { kind: 'unknown', reason: 'unconfirmed' },
  'facts-cold-unsupported': { kind: 'unknown', reason: 'unsupported' },
  'facts-cold-unconfigured': { kind: 'unconfigured', reason: 'adapter-not-configured' },
  'facts-cold-loading': { kind: 'loading' },
  'facts-cold-denied': { kind: 'denied', reason: 'access-denied' },
  'facts-cold-absent': { kind: 'success', snapshot: { ...snapshot, sources: [] } },
  busy: { kind: 'failure', reason: 'busy' },
  denied: { kind: 'denied', reason: 'access-denied' },
  unnamed: { kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.map((source, index) => ({ ...source, name: index === 0 ? '' : '   ' })) } },
  many: { kind: 'success', snapshot: { ...snapshot, sources: Array.from({ length: 30 }, (_, index) => ({ ...snapshot.sources[0], id: `many-${index}`, name: `Source ${index}` })) } },
  success: { kind: 'success', snapshot },
  'long-names': { kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.map(source => ({ ...source, name: 'Source'.repeat(20) })) } },
  timestamps: { kind: 'success', snapshot: timestampSnapshot },
  'time-zones': { kind: 'success', snapshot: timeZoneSnapshot },
  empty: { kind: 'success', snapshot: { ...snapshot, sources: [] } },
  unconfigured: { kind: 'unconfigured', reason: 'adapter-not-configured' },
  failure: { kind: 'failure', reason: 'request-failed' },
  unknown: { kind: 'unknown', reason: 'unconfirmed' },
};

const control = {
  calls: 0,
  release: (_kind?: string) => { void _kind; },
  setSeed: (value: string) => { void value; },
};
Object.assign(window, { __sourceFixture: control });
const pageControl = { calls: [] as PageRequest[], release: (kind: string) => { void kind; } };
const initialPageResult: PageListResult = { kind: 'success', snapshot: { ...pageSnapshot, pages: scenario === 'pages-empty' ? [] : scenario === 'pages-dated' ? pageSnapshot.pages.filter(page => page.createdAt !== null) : pageSnapshot.pages } };
Object.assign(window, { __pageFixture: pageControl });
function loadPages(request: PageRequest): Promise<PageListResult> {
  pageControl.calls.push(request);
  return new Promise(resolve => { pageControl.release = kind => {
    if (kind === 'unconfigured') resolve({ kind: 'unconfigured', reason: 'adapter-not-configured' });
    else if (kind === 'denied') resolve({ kind: 'denied', reason: 'access-denied' });
    else if (kind === 'unavailable') resolve({ kind: 'unavailable', reason: 'source-unavailable' });
    else if (kind === 'failure') resolve({ kind: 'failure', reason: 'request-failed' });
    else if (kind === 'unknown') resolve({ kind: 'unknown', reason: 'unsupported' });
    else resolve({ kind: 'success', snapshot: { ...pageSnapshot, sourceReference: request.source, offset: request.offset, nextOffset: request.offset + 3,
      range: 'observed-end', pages: [...((scenario === 'reader-denied' || scenario === 'reader-unavailable' || scenario === 'reader-race') && request.offset > 0 ? [] : pageSnapshot.pages), { ...pageSnapshot.pages[0], slug: 'additional', title: '추가 원본 / additional' }],
      observation: { startedAt: '2026-10-31T12:01:00Z', completedAt: '2026-10-31T12:01:01Z' } } });
  }; });
}
const sourceSnapshotForReference = snapshot.sources[1];
const detailPending: ((kind: string) => void)[] = [];
const detailControl = { calls: [] as PageDetailRequest[], release: (kind = 'success', index = detailPending.length - 1) => detailPending[index]?.(kind) };
Object.assign(window, { __detailFixture: detailControl });
function detailResult(request: PageDetailRequest, kind: string): PageDetailResult {
  if (kind === 'denied') return { kind: 'denied', reason: 'access-denied' };
  if (kind === 'unavailable') return { kind: 'unavailable', reason: 'page-unavailable' };
  if (kind === 'failure') return { kind: 'failure', reason: 'request-failed' };
  if (kind === 'unknown') return { kind: 'unknown', reason: 'unsupported' };
  let snapshot = { ...pageDetailSnapshot, page: { ...pageDetailSnapshot.page, slug: request.slug, title: pageSnapshot.pages.find(page => page.slug === request.slug)?.title ?? request.slug } };
  if (scenario.startsWith('reader-cross-source')) snapshot = { ...snapshot, backlinks: { ...snapshot.backlinks, pages: [{ page: { ...snapshot.backlinks.pages[0].page, sourceId: sourceSnapshotForReference.id, title: '다른 소스의 참조 / other Source reference' }, sourceName: sourceSnapshotForReference.name }] } };
  if (kind === 'window') return { kind: 'success', snapshot: { ...snapshot, body: { ...snapshot.body, availability: 'partial', sections: [{ id: 'window', text: publicWindowExcerpt }] }, memories: { availability: 'unknown', rows: [] } } };
  if (kind === 'backlinks-failed') return { kind: 'success', snapshot: { ...snapshot, backlinks: { ...snapshot.backlinks, availability: 'failed', pages: [], omitted: 0, truncated: false } } };
  if (kind === 'empty-table') return { kind: 'success', snapshot: { ...snapshot, body: { ...snapshot.body, sections: [{ id: 'compiled-truth', text: emptyMemoryTable }, { id: 'timeline', text: '' }] }, memories: { availability: 'empty', rows: [] } } };
  if (kind === 'uppercase-kind') return { kind: 'success', snapshot: { ...snapshot, body: { ...snapshot.body, sections: snapshot.body.sections.map(section => ({ ...section, text: section.text.replace('| fact |', '| Fact |') })) }, memories: { ...snapshot.memories, rows: snapshot.memories.rows.map(row => ({ ...row, kind: 'Fact', fields: { ...row.fields, kind: 'Fact' } })) } } };
  if (kind === 'empty') return { kind: 'success', snapshot: { ...snapshot, memories: { availability: 'empty', rows: [] }, backlinks: { ...snapshot.backlinks, availability: 'empty', listObservation: null, pages: [], omitted: 0, truncated: false } } };
  if (kind === 'partial') return { kind: 'success', snapshot: { ...snapshot, body: { ...snapshot.body, availability: 'partial' }, memories: { availability: 'unknown', rows: [] }, backlinks: { ...snapshot.backlinks, availability: 'partial', omitted: 2, truncated: true } } };
  if (kind === 'protected') return { kind: 'success', snapshot: { ...snapshot, body: { ...snapshot.body, availability: 'protected', sections: [] }, memories: { availability: 'unknown', rows: [] } } };
  return { kind: 'success', snapshot };
}
function loadDetail(request: PageDetailRequest): Promise<PageDetailResult> {
  detailControl.calls.push(request);
  if (scenario !== 'reader-pending' && scenario !== 'reader-race' && scenario !== 'reader-cross-source-pending' && scenario !== 'facts-seeded-parent-denied') return Promise.resolve(detailResult(request, scenario.replace('reader-', '')));
  return new Promise(resolve => { detailPending.push(kind => resolve(detailResult(request, kind))); });
}
const factListPending: ((kind: string) => void)[] = [];
const factDetailPending: ((kind: string) => void)[] = [];
const factControl = {
  calls: [] as FactRequest[], detailCalls: [] as FactDetailRequest[],
  release: (kind = 'success', index = factListPending.length - 1) => factListPending[index]?.(kind),
  releaseDetail: (kind = 'success', index = factDetailPending.length - 1) => factDetailPending[index]?.(kind),
};
Object.assign(window, { __factFixture: factControl });
function factListResult(request: FactRequest, kind: string): FactListResult {
  if (kind === 'unconfigured') return { kind: 'unconfigured', reason: 'adapter-not-configured' };
  if (kind === 'denied') return { kind: 'denied', reason: 'access-denied' };
  if (kind === 'failure') return { kind: 'failure', reason: 'request-failed' };
  if (kind === 'source-unavailable') return { kind: 'unavailable', reason: 'source-unavailable' };
  return { kind: 'success', snapshot: { ...factSnapshot, sourceReference: request.source,
    rows: kind === 'empty' ? [] : kind === 'context-unknown' ? factSnapshot.rows.map((fact, index) => index === 0 ? { ...fact, sourceDescription: 'mcp:remember', context: factRawContext } : fact) : factSnapshot.rows, capped: kind === 'cap', omitted: kind === 'partial' ? 2 : 0 } };
}
function loadFacts(request: FactRequest): Promise<FactListResult> {
  factControl.calls.push(request);
  if (scenario !== 'facts-list-pending' && scenario !== 'facts-seeded-denied') return Promise.resolve(factListResult(request, scenario.replace('facts-', '')));
  return new Promise(resolve => factListPending.push(kind => resolve(factListResult(request, kind))));
}
function factDetailResult(request: FactDetailRequest, kind: string): FactDetailResult {
  kind = kind.replace('detail-', '');
  if (kind === 'seeded-denied' || kind === 'seeded-parent-denied') kind = 'denied';
  if (kind === 'denied') return { kind: 'denied', reason: 'access-denied' };
  if (kind === 'source-unavailable') return { kind: 'unavailable', reason: 'source-unavailable' };
  if (kind === 'unavailable') return { kind: 'unavailable', reason: 'fact-unavailable' };
  if (kind === 'failure') return { kind: 'failure', reason: 'request-failed' };
  const [namespace, sourceId] = JSON.parse(request.source) as [string, string];
  const fact = { ...(factRows.find(row => row.id === request.id) ?? factRows[0]), namespace, sourceId, id: request.id };
  if (kind === 'context-unknown') return { kind: 'success', snapshot: { ...factDetailSnapshot, fact: { ...fact, sourceDescription: 'mcp:remember', context: factRawContext }, contextPage: { availability: 'unknown', page: null }, evidence: { availability: 'unknown', level: 'context-page', page: null, quote: null, location: null, body: { availability: 'unknown', sections: [] } } } };
  const snapshot = { ...factDetailSnapshot, fact };
  if (kind === 'context-protected') return { kind: 'success', snapshot: { ...snapshot, contextPage: { availability: 'available', page: factDetailSnapshot.contextPage.page }, evidence: { availability: 'protected', level: 'context-page', page: null, quote: null, location: null, body: { availability: 'unknown', sections: [] } } } };
  if (kind === 'mismatch') return { kind: 'success', snapshot: { ...snapshot, evidence: { ...snapshot.evidence, availability: 'mismatch', location: null } } };
  if (kind === 'partial-provenance' || kind === 'partial-body') return { kind: 'success', snapshot: { ...snapshot, evidence: { ...snapshot.evidence, availability: 'partial', quote: null, location: null, body: kind === 'partial-body' ? { ...snapshot.evidence.body, availability: 'partial' } : { availability: 'unknown', sections: [] } } } };
  if (kind === 'protected') return { kind: 'success', snapshot: { ...snapshot, evidence: { ...snapshot.evidence, availability: 'protected', quote: null, location: null, body: { availability: 'protected', sections: [] } } } };
  if (kind === 'missing') return { kind: 'success', snapshot: { ...snapshot, contextPage: { availability: 'missing', page: null }, evidence: { ...snapshot.evidence, availability: 'missing', page: null, quote: null, location: null, body: { availability: 'unknown', sections: [] } } } };
  return { kind: 'success', snapshot };
}
function loadFactDetail(request: FactDetailRequest): Promise<FactDetailResult> {
  factControl.detailCalls.push(request);
  if (scenario !== 'facts-detail-pending') return Promise.resolve(factDetailResult(request, scenario.replace('facts-', '')));
  return new Promise(resolve => factDetailPending.push(kind => resolve(factDetailResult(request, kind))));
}
let detectedZone: unknown = parameters.get('deviceTimeZone') ?? 'UTC';
const detectZone = () => detectedZone;
Object.assign(window, { __timeZoneFixture: { setDeviceZone: (value: unknown) => { detectedZone = value; } } });

function loadSources(): Promise<SourceListResult> {
  control.calls += 1;
  return new Promise((resolve, reject) => {
    control.release = (kind = 'success') => {
      if (kind === 'without-alpha') { resolve({ kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.slice(1) } }); return; }
      if (kind === 'without-beta') { resolve({ kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.filter(source => source.id !== snapshot.sources[1].id), checkedAt: '2026-10-31T12:03:00Z' } }); return; }
      if (scenario === 'retry-reject') {
        reject(new Error('RAW_FIXTURE_ERROR: private-token-must-never-render'));
      } else if (scenario === 'retry-failure') {
        resolve({ kind: 'failure', reason: 'request-failed' });
      } else if (scenario === 'retry-unknown') {
        resolve({ kind: 'unknown', reason: 'unconfirmed' });
      } else if (scenario === 'retry-denied') {
        resolve({ kind: 'denied', reason: 'access-denied' });
      } else if (scenario === 'retry-omitted') {
        resolve({ kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.slice(1) } });
      } else if (scenario === 'retry-unconfigured') {
        resolve({ kind: 'unconfigured', reason: 'adapter-not-configured' });
      } else {
        resolve({ kind: 'success', snapshot: { ...snapshot, checkedAt: '2026-10-27T04:00:00.000Z' } });
      }
    };
  });
}

function Fixture() {
  const [initialState, setInitialState] = useState(states[scenario] ?? states.success);
  useEffect(() => { control.setSeed = value => setInitialState({ ...states[value] }); }, []);
  const [settings, setSettings] = useState(() => resolveTimeZone(parameters.get('timeZone'), parameters.get('savedDeviceTimeZone')));
  return <TimeZoneProvider settings={settings} detect={detectZone}>
    <SourceScreen locale={locale} initialState={initialState} initialQuery={location.search} loadSources={scenario === 'unconfigured' ? undefined : loadSources}
      initialPages={(scenario.startsWith('reader-') || scenario.startsWith('pages-') || scenario.startsWith('facts-')) && scenario !== 'pages-unseeded' && scenario !== 'facts-unseeded' ? initialPageResult : undefined}
      loadPages={scenario.startsWith('reader-') || scenario.startsWith('pages-') || scenario.startsWith('facts-') ? loadPages : undefined}
      loadDetail={scenario.startsWith('reader-') || scenario.startsWith('facts-') ? loadDetail : undefined}
      loadFacts={scenario.startsWith('facts-') ? loadFacts : undefined}
      initialFactDetail={scenario === 'facts-cold-seed' ? { kind: 'success', snapshot: { ...factDetailSnapshot, fact: { ...factDetailSnapshot.fact, content: 'UNVALIDATED_COLD_SEED' } } } : scenario === 'facts-seeded-detail' ? { kind: 'success', snapshot: factDetailSnapshot } : undefined}
      initialFacts={scenario === 'facts-seeded-denied' || scenario === 'facts-seeded-parent-denied' ? { kind: 'success', snapshot: factSnapshot } : undefined}
      loadFactDetail={scenario.startsWith('facts-') ? loadFactDetail : undefined}
      initialDetail={scenario === 'facts-seeded-parent-denied' ? { kind: 'success', snapshot: { ...pageDetailSnapshot, body: { ...pageDetailSnapshot.body, sections: [{ id: 'compiled-truth', text: 'DISCARDED_SSR_PARENT_ONLY' }] } } } : scenario === 'reader-seeded-failure' ? { kind: 'failure', reason: 'request-failed' } : undefined}
      timeZoneControl={<TimeZoneControl locale={locale} preference={settings.preference} zones={availableTimeZones(settings.preference, settings.deviceZone)} action={(_previous, data) => {
        setSettings(resolveTimeZone(data.get('timeZone'), detectedZone));
        return { kind: 'saved' };
      }} />} />
  </TimeZoneProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
