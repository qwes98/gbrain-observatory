import { requireOwnerAccess } from "@/security/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/messages";
import { availableTimeZones, isTimeZone, timeZoneCookie, type TimeZoneSettings as Settings } from "@/i18n/time-zone";
import { preferenceCookieOptions } from "@/i18n/server";
import { TimeZoneControl } from "@/ui/time-zone-control";

async function changeTimeZone(data: FormData) {
  "use server";
  await requireOwnerAccess("POST");
  const value = data.get("timeZone");
  if (value !== "auto" && !isTimeZone(value)) redirect("/?timeZoneError=invalid");
  (await cookies()).set(timeZoneCookie, value, preferenceCookieOptions);
  redirect("/");
}

export function TimeZoneSettings({ locale, settings, invalid }: { locale: Locale; settings: Settings; invalid: boolean }) {
  return <TimeZoneControl locale={locale} preference={settings.preference} zones={availableTimeZones(settings.preference, settings.deviceZone)} action={changeTimeZone} invalid={invalid} />;
}
