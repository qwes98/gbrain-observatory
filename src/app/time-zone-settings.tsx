import { validatedSourceReturn } from "@/contracts/sources";
import { requireOwnerAccess } from "@/security/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/messages";
import { availableTimeZones, isTimeZone, timeZoneCookie, type TimeZoneSettings as Settings } from "@/i18n/time-zone";
import { preferenceCookieOptions } from "@/i18n/server";
import { TimeZoneControl, type TimeZoneActionResult } from "@/ui/time-zone-control";

async function changeTimeZone(_previous: TimeZoneActionResult | undefined, data: FormData): Promise<TimeZoneActionResult> {
  "use server";
  void _previous;
  await requireOwnerAccess("POST");
  const enhanced = (await headers()).has("next-action");
  const value = data.get("timeZone");
  const returnPath = validatedSourceReturn(data.get("sourceReturn"));
  if (value !== "auto" && !isTimeZone(value)) {
    if (enhanced) return { kind: "invalid" };
    redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}timeZoneError=invalid`);
  }
  (await cookies()).set(timeZoneCookie, value, preferenceCookieOptions);
  if (!enhanced) redirect(returnPath);
  return { kind: "saved" };
}

export function TimeZoneSettings({ locale, settings, invalid, returnPath = "/" }: { locale: Locale; settings: Settings; invalid: boolean; returnPath?: string }) {
  return <TimeZoneControl locale={locale} preference={settings.preference} zones={availableTimeZones(settings.preference, settings.deviceZone)} action={changeTimeZone} invalid={invalid} returnPath={returnPath} />;
}
