import { requireOwnerAccess } from "@/security/server";
import { getInitialSourceList } from "@/composition/source-list";
import { getLocale, getTimeZoneSettings } from "@/i18n/server";
import { boundedSourceReference, sourceNavigationParameters, sourceNavigationPath } from "@/contracts/sources";
import { SourceScreen } from "@/ui/source-screen";
import { LanguageSwitcher } from "./language-switcher";
import { TimeZoneSettings } from "./time-zone-settings";
import { ConnectionCheck } from "./connection-check";
import { TimeZoneProvider } from "@/ui/time-zone-provider";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<{ timeZoneError?: string; source?: string | string[]; expanded?: string | string[] }> }) {
  await requireOwnerAccess();
  const [locale, settings, parameters] = await Promise.all([getLocale(), getTimeZoneSettings(), searchParams]);
  const selected = typeof parameters.source === "string" ? parameters.source : parameters.source === undefined ? null : "";
  const expanded = parameters.expanded === undefined ? [] : Array.isArray(parameters.expanded) ? parameters.expanded : [parameters.expanded];
  const query = sourceNavigationParameters(selected, expanded);
  if (selected !== null && !boundedSourceReference(selected)) query.set("source", "");
  const returnPath = sourceNavigationPath(selected, expanded);
  const screen = {
    locale, languageControl: <LanguageSwitcher locale={locale} returnPath={returnPath} />,
    timeZoneControl: <TimeZoneSettings locale={locale} settings={settings} invalid={parameters.timeZoneError === "invalid"} returnPath={returnPath} />,
    connectionControl: <ConnectionCheck locale={locale} />, nativeRefresh: true,
    refreshEndpoint: "/api/sources", initialQuery: query.size ? `?${query}` : "",
  };
  return <TimeZoneProvider settings={settings}><SourceScreen {...screen} initialState={await getInitialSourceList()} /></TimeZoneProvider>;
}
