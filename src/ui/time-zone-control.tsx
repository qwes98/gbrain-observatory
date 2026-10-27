"use client";

import { sourceMessages, type Locale } from "../i18n/messages";
import { useTimeZone } from "./time-zone-provider";

export function TimeZoneControl({ locale, preference, zones, action, invalid = false }: {
  locale: Locale;
  preference: string;
  zones: string[];
  action: (data: FormData) => void | Promise<void>;
  invalid?: boolean;
}) {
  const t = sourceMessages[locale];
  const zone = useTimeZone();
  return <div className="time-zone-settings">
    <form action={action} className="time-zone-form">
      <label htmlFor="time-zone">{t.timeZone}</label>
      <select id="time-zone" name="timeZone" defaultValue={preference} aria-describedby={invalid ? "time-zone-error" : undefined} aria-invalid={invalid || undefined}>
        <option value="auto">{t.autoTimeZone}</option>
        {zones.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="submit">{t.applyTimeZone}</button>
    </form>
    <p className="effective-time-zone" role="status">{t.effectiveTimeZone}: {zone}</p>
    {invalid && <p id="time-zone-error" role="alert" className="time-zone-error">{t.invalidTimeZone}</p>}
  </div>;
}
