import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, resolveLocale } from "./messages";
import { deviceTimeZoneCookie, resolveTimeZone, timeZoneCookie } from "./time-zone";

export const preferenceCookieOptions = {
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export const getLocale = cache(async () => {
  return resolveLocale((await cookies()).get(localeCookie)?.value);
});

export const getTimeZoneSettings = cache(async () => {
  const jar = await cookies();
  return resolveTimeZone(jar.get(timeZoneCookie)?.value, jar.get(deviceTimeZoneCookie)?.value);
});
