import type { Locale } from "./messages";

export const timeZoneCookie = "observatory-time-zone";
export const deviceTimeZoneCookie = "observatory-device-time-zone";
export type TimeZonePreference = "auto" | string;
export interface TimeZoneSettings {
  preference: TimeZonePreference;
  deviceZone: string | null;
  effectiveZone: string;
}

/** Accept named zones and supported aliases, never offset-only identifiers. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(preference: unknown, device: unknown): TimeZoneSettings {
  const selected = isTimeZone(preference) ? preference : "auto";
  const deviceZone = isTimeZone(device) ? device : null;
  return { preference: selected, deviceZone, effectiveZone: selected === "auto" ? deviceZone ?? "UTC" : selected };
}

export function availableTimeZones(...saved: unknown[]): string[] {
  return [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone"), ...saved.filter(isTimeZone)])].sort();
}

/** Preserve the existing calendar checks before parsing an explicit-offset instant. */
export function isInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return !!daysInMonth && day >= 1 && day <= daysInMonth && Number(parts[4]) <= 23 &&
    Number(parts[5]) <= 59 && Number(parts[6]) <= 59 && Number(parts[7] ?? 0) <= 23 &&
    Number(parts[8] ?? 0) <= 59 && !Number.isNaN(Date.parse(value));
}

export function formatInstant(value: unknown, locale: Locale, zone: string): { text: string; offset: string } | null {
  if (!isInstant(value) || !isTimeZone(zone)) return null;
  const date = new Date(value);
  const text = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  const offsetPart = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(date).find(part => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = offsetPart === "GMT" ? "UTC+00:00" : offsetPart.replace("GMT", "UTC");
  return { text, offset };
}

/** Calendar identity in the effective zone, independent of 23/25-hour DST days. */
export function calendarDay(value: string, zone: string): string | null {
  if (!isInstant(value) || !isTimeZone(zone)) return null;
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", era: "short" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${get("era")}-${get("year")}-${get("month")}-${get("day")}`;
}

export function matchesCalendarFilter(value: string | null, filter: "all" | "today" | "yesterday", zone: string, now: string): boolean {
  if (filter === "all") return true;
  if (!value || !isInstant(now)) return false;
  const day = calendarDay(now, zone);
  if (!day) return false;
  // Subtract from the local calendar date, never from the current instant.
  const local = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(local.find(part => part.type === type)?.value);
  const yesterday = new Date(0);
  yesterday.setUTCFullYear(get("year"), get("month") - 1, get("day") - 1);
  yesterday.setUTCHours(12, 0, 0, 0);
  const previous = `AD-${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  return calendarDay(value, zone) === (filter === "today" ? day : previous);
}
