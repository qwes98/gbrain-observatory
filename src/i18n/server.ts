import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, resolveLocale } from "./messages";
import { deviceTimeZoneCookie, resolveTimeZone, timeZoneCookie } from "./time-zone";

export const getLocale = cache(async () => {
  return resolveLocale((await cookies()).get(localeCookie)?.value);
});

export const getTimeZoneSettings = cache(async () => {
  const jar = await cookies();
  return resolveTimeZone(jar.get(timeZoneCookie)?.value, jar.get(deviceTimeZoneCookie)?.value);
});
