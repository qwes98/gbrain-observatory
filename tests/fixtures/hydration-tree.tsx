import { useLayoutEffect } from 'react';
import { resolveTimeZone } from '../../src/i18n/time-zone';
import { SourceScreen } from '../../src/ui/source-screen';
import { TimeZoneProvider } from '../../src/ui/time-zone-provider';
import { timeZoneSnapshot } from './source-data';

const settings = resolveTimeZone(undefined, undefined);

function FirstCommitObservation() {
  // Layout effects run before the provider's detection subscription updates the zone.
  useLayoutEffect(() => {
    Object.assign(window, { __hydrationFixture: {
      initialTimes: Array.from(document.querySelectorAll('time'), element => ({
        dateTime: element.getAttribute('datetime'), text: element.textContent,
      })),
    } });
  }, []);
  return null;
}

export function HydrationFixture() {
  return <TimeZoneProvider settings={settings}>
    <SourceScreen initialState={{ kind: 'success', snapshot: timeZoneSnapshot }} />
    <FirstCommitObservation />
  </TimeZoneProvider>;
}
