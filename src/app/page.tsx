import { requireOwnerAccess } from "@/security/server";
import { getInitialSourceList } from "@/composition/source-list";
import { getSourcePages } from "@/composition/pages";
import { getPageDetail } from "@/composition/page-detail";
import { getLocale, getTimeZoneSettings } from "@/i18n/server";
import { boundedSourceReference, sourceReference, sourceNavigationParameters, sourceNavigationPath, parsePageNavigation } from "@/contracts/sources";
import { resolvePageFilter } from "@/contracts/pages";
import { SourceScreen } from "@/ui/source-screen";
import { LanguageSwitcher } from "./language-switcher";
import { TimeZoneSettings } from "./time-zone-settings";
import { ConnectionCheck } from "./connection-check";
import { TimeZoneProvider } from "@/ui/time-zone-provider";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<{ timeZoneError?: string; source?: string | string[]; expanded?: string | string[]; added?: string | string[]; page?: string | string[]; view?: string | string[]; reading?: string | string[] }> }) {
  await requireOwnerAccess();
  const [locale, settings, parameters] = await Promise.all([getLocale(), getTimeZoneSettings(), searchParams]);
  const selected = typeof parameters.source === "string" ? parameters.source : parameters.source === undefined ? null : "";
  const expanded = parameters.expanded === undefined ? [] : Array.isArray(parameters.expanded) ? parameters.expanded : [parameters.expanded];
  const filter = resolvePageFilter(parameters.added);
  const readerQuery = new URLSearchParams();
  for (const key of ["page", "view", "reading"] as const) {
    const value = parameters[key];
    for (const part of Array.isArray(value) ? value : value === undefined ? [] : [value]) readerQuery.append(key, part);
  }
  const detail = parsePageNavigation(readerQuery);
  const query = sourceNavigationParameters(selected, expanded, filter, detail);
  if (selected !== null && !boundedSourceReference(selected)) query.set("source", "");
  const returnPath = sourceNavigationPath(selected, expanded, filter, detail);
  const initialState = await getInitialSourceList();
  const permittedSelection = selected !== null && boundedSourceReference(selected) && initialState.kind === "success" &&
    initialState.snapshot.sources.some(source => sourceReference(source) === selected);
  const initialPages = permittedSelection && detail?.mode !== "full" ? await getSourcePages({ source: selected, offset: 0 }) : undefined;
  const initialDetail = permittedSelection && detail ? await getPageDetail({ source: selected, slug: detail.slug }) : undefined;
  const screen = {
    locale, languageControl: <LanguageSwitcher locale={locale} returnPath={returnPath} />,
    timeZoneControl: <TimeZoneSettings locale={locale} settings={settings} invalid={parameters.timeZoneError === "invalid"} returnPath={returnPath} />,
    connectionControl: <ConnectionCheck locale={locale} />, nativeRefresh: true,
    refreshEndpoint: "/api/sources", pagesEndpoint: "/api/pages", detailEndpoint: "/api/page-detail", initialPages, initialDetail, initialQuery: query.size ? `?${query}` : "",
  };
  return <TimeZoneProvider settings={settings}><SourceScreen {...screen} initialState={initialState} /></TimeZoneProvider>;
}
