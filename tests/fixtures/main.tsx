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
    <SourceScreen locale={locale} initialState={initialState} loadSources={scenario === 'unconfigured' ? undefined : loadSources}
      timeZoneControl={<TimeZoneControl locale={locale} preference={settings.preference} zones={availableTimeZones(settings.preference, settings.deviceZone)} action={(_previous, data) => {
        setSettings(resolveTimeZone(data.get('timeZone'), detectedZone));
        return { kind: 'saved' };
      }} />} />
  </TimeZoneProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
