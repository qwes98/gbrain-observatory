"use client";

import { useActionState, useEffect } from "react";
import { sourceMessages, type Locale } from "../i18n/messages";
import { useTimeZone } from "./time-zone-provider";

export type TimeZoneActionResult = { kind: "saved" } | { kind: "invalid" };

export function TimeZoneControl({ locale, preference, zones, action, invalid = false, returnPath = "/" }: {
  locale: Locale;
  preference: string;
  zones: string[];
  action: (previous: TimeZoneActionResult | undefined, data: FormData) => TimeZoneActionResult | Promise<TimeZoneActionResult>;
  invalid?: boolean;
  returnPath?: string;
}) {
  const [result, formAction] = useActionState(action, undefined);
  const showInvalid = result ? result.kind === "invalid" : invalid;
  useEffect(() => {
    if (!result) return;
    const url = new URL(window.location.href);
    if (result.kind === "invalid") url.searchParams.set("timeZoneError", "invalid");
    else url.searchParams.delete("timeZoneError");
    if (url.href === window.location.href) return;
    window.history.replaceState({ sourceReturn: window.history.state?.sourceReturn }, "", url);
    window.dispatchEvent(new Event("observatory-source-navigation"));
  }, [result]);
  const t = sourceMessages[locale];
  const zone = useTimeZone();
  return <div className="time-zone-settings">
    <form action={formAction} className="time-zone-form">
      <input type="hidden" name="sourceReturn" value={returnPath} />
      <label htmlFor="time-zone">{t.timeZone}</label>
      <select key={preference} id="time-zone" name="timeZone" defaultValue={preference} aria-describedby={showInvalid ? "time-zone-error" : undefined} aria-invalid={showInvalid || undefined}>
        <option value="auto">{t.autoTimeZone}</option>
        {zones.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="submit">{t.applyTimeZone}</button>
    </form>
    <p className="effective-time-zone" role="status">{t.effectiveTimeZone}: {zone}</p>
    {showInvalid && <p id="time-zone-error" role="alert" className="time-zone-error">{t.invalidTimeZone}</p>}
  </div>;
}
