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

const parameters = new URLSearchParams(location.search);
const locale = resolveLocale(parameters.get('locale'));
document.documentElement.lang = locale;
const scenario = parameters.get('scenario') ?? 'unconfigured';
const states: Record<string, SourceListState> = {
  loading: { kind: 'loading' },
  busy: { kind: 'failure', reason: 'busy' },
  denied: { kind: 'denied', reason: 'access-denied' },
  unnamed: { kind: 'success', snapshot: { ...snapshot, sources: snapshot.sources.map((source, index) => ({ ...source, name: index === 0 ? '' : '   ' })) } },
  many: { kind: 'success', snapshot: { ...snapshot, sources: Array.from({ length: 30 }, (_, index) => ({ ...snapshot.sources[0], id: `many-${index}`, name: `Source ${index}` })) } },
  success: { kind: 'success', snapshot },
  timestamps: { kind: 'success', snapshot: timestampSnapshot },
  'time-zones': { kind: 'success', snapshot: timeZoneSnapshot },
  empty: { kind: 'success', snapshot: { ...snapshot, sources: [] } },
  unconfigured: { kind: 'unconfigured', reason: 'adapter-not-configured' },
  failure: { kind: 'failure', reason: 'request-failed' },
  unknown: { kind: 'unknown', reason: 'unconfirmed' },
};

const control = {
  calls: 0,
  release: () => {},
  setSeed: (value: string) => { void value; },
};
Object.assign(window, { __sourceFixture: control });
const pageControl = { calls: [] as PageRequest[], release: (kind: string) => { void kind; } };
const initialPageResult: PageListResult = { kind: 'success', snapshot: pageSnapshot };
Object.assign(window, { __pageFixture: pageControl });
function loadPages(request: PageRequest): Promise<PageListResult> {
  pageControl.calls.push(request);
  return new Promise(resolve => { pageControl.release = kind => {
    if (kind === 'denied') resolve({ kind: 'denied', reason: 'access-denied' });
    else if (kind === 'unavailable') resolve({ kind: 'unavailable', reason: 'source-unavailable' });
    else if (kind === 'failure') resolve({ kind: 'failure', reason: 'request-failed' });
    else if (kind === 'unknown') resolve({ kind: 'unknown', reason: 'unsupported' });
    else resolve({ kind: 'success', snapshot: { ...pageSnapshot, sourceReference: request.source, offset: request.offset, nextOffset: request.offset + 3,
      range: 'observed-end', pages: [...pageSnapshot.pages, { ...pageSnapshot.pages[0], slug: 'additional', title: '추가 원본 / additional' }],
      observation: { startedAt: '2026-10-31T12:01:00Z', completedAt: '2026-10-31T12:01:01Z' } } });
  }; });
}
let detectedZone: unknown = parameters.get('deviceTimeZone') ?? 'UTC';
const detectZone = () => detectedZone;
Object.assign(window, { __timeZoneFixture: { setDeviceZone: (value: unknown) => { detectedZone = value; } } });

function loadSources(): Promise<SourceListResult> {
  control.calls += 1;
  return new Promise((resolve, reject) => {
    control.release = () => {
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
      initialPages={scenario.startsWith('pages-') && scenario !== 'pages-unseeded' ? initialPageResult : undefined}
      loadPages={scenario.startsWith('pages-') ? loadPages : undefined}
      timeZoneControl={<TimeZoneControl locale={locale} preference={settings.preference} zones={availableTimeZones(settings.preference, settings.deviceZone)} action={(_previous, data) => {
        setSettings(resolveTimeZone(data.get('timeZone'), detectedZone));
        return { kind: 'saved' };
      }} />} />
  </TimeZoneProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
