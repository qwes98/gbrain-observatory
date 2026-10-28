import { requireOwnerAccess } from "@/security/server";
import { getInitialSourceList } from "@/composition/source-list";
import { getLocale, getTimeZoneSettings } from "@/i18n/server";
import { SourceScreen } from "@/ui/source-screen";
import { LanguageSwitcher } from "./language-switcher";
import { TimeZoneSettings } from "./time-zone-settings";
import { ConnectionCheck } from "./connection-check";
import { TimeZoneProvider } from "@/ui/time-zone-provider";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ timeZoneError?: string }> }) {
  await requireOwnerAccess();
  const [locale, settings, parameters] = await Promise.all([getLocale(), getTimeZoneSettings(), searchParams]);
  return <TimeZoneProvider settings={settings}><SourceScreen locale={locale}
    languageControl={<LanguageSwitcher locale={locale} />}
    timeZoneControl={<TimeZoneSettings locale={locale} settings={settings} invalid={parameters.timeZoneError === "invalid"} />}
    connectionControl={<ConnectionCheck locale={locale} />}
    initialState={getInitialSourceList()} /></TimeZoneProvider>;
}
