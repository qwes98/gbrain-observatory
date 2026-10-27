"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { deviceTimeZoneCookie, isTimeZone, type TimeZoneSettings } from "../i18n/time-zone";

const TimeZoneContext = createContext("UTC");
export const useTimeZone = () => useContext(TimeZoneContext);

function detectDeviceZone(): unknown {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
}

function createZoneStore(settings: TimeZoneSettings, detect: () => unknown) {
  let effective = settings.effectiveZone;
  return {
    getSnapshot: () => effective,
    getServerSnapshot: () => settings.effectiveZone,
    subscribe: (notify: () => void) => {
      let persistedDetection: string | undefined;
      function check() {
        let detected: unknown;
        try { detected = detect(); } catch { return; }
        if (!isTimeZone(detected)) return;
        // Persistence is an effect, never a snapshot getter. Storage may be unavailable.
        if (detected !== persistedDetection) {
          try {
            document.cookie = `${deviceTimeZoneCookie}=${detected}; Path=/; Max-Age=31536000; SameSite=Lax`;
            persistedDetection = detected;
          } catch { /* Keep retrying persistence while rendering without storage. */ }
        }
        const next = settings.preference === "auto" ? detected : settings.preference;
        if (next !== effective) { effective = next; notify(); }
      }
      function visibleCheck() { if (document.visibilityState === "visible") check(); }
      window.addEventListener("focus", check);
      window.addEventListener("pageshow", check);
      document.addEventListener("visibilitychange", visibleCheck);
      const interval = window.setInterval(visibleCheck, 60_000);
      check();
      return () => {
        window.removeEventListener("focus", check);
        window.removeEventListener("pageshow", check);
        document.removeEventListener("visibilitychange", visibleCheck);
        window.clearInterval(interval);
      };
    },
  };
}

export function TimeZoneProvider({ settings, children, detect = detectDeviceZone }: {
  settings: TimeZoneSettings;
  children: ReactNode;
  detect?: () => unknown;
}) {
  const store = useMemo(() => createZoneStore(settings, detect), [settings, detect]);
  const effective = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return <TimeZoneContext.Provider value={effective}>{children}</TimeZoneContext.Provider>;
}
