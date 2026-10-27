import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, resolveLocale } from "./messages";

export const getLocale = cache(async () => {
  return resolveLocale((await cookies()).get(localeCookie)?.value);
});
