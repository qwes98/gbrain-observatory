"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { defaultLocale, formatResultCount, sourceMessages, type Locale } from "../i18n/messages";
import { sourceReference, validSourceReference, type Source, type SourceListResult, type SourceListState } from "../contracts/sources";
import { formatInstant } from "../i18n/time-zone";
import { useTimeZone } from "./time-zone-provider";
import { useSourceList } from "./use-source-list";
import { sourceRowId, useSourceNavigation } from "./use-source-navigation";
import { PageList } from "./page-list";
import { ContextHelp } from "./context-help";
import type { PageListResult } from "../contracts/pages";
import type { PageLoader } from "./use-page-list";

interface SourceScreenProps {
  initialState: SourceListState;
  locale?: Locale;
  languageControl?: ReactNode;
  timeZoneControl?: ReactNode;
  connectionControl?: ReactNode;
  initialQuery?: string;
  refreshEndpoint?: string;
  nativeRefresh?: boolean;
  loadSources?: () => Promise<SourceListResult>;
  initialPages?: PageListResult;
  pagesEndpoint?: string;
  loadPages?: PageLoader;
}

function Timestamp({ value, locale }: { value: string | null; locale: Locale }) {
  const t = sourceMessages[locale];
  const zone = useTimeZone();
  if (value === null) return <span className="muted">{t.notProvided}</span>;
  const formatted = formatInstant(value, locale, zone);
  if (!formatted) return <span className="muted">{t.invalidTime}</span>;
  return <time dateTime={value} title={`${formatted.text} · ${zone} · ${formatted.offset}`}>{formatted.text} · {formatted.offset}</time>;
}

function sourceName(source: Source) { return source.name.trim() ? source.name : source.id; }

function NavigationIcon({ name }: { name: "sources" | "page" | "recent" | "search" | "memories" | "entities" | "relations" | "loops" | "summary" | "chevron" }) {
  const shapes = {
    sources: <path d="M3 5h7l2 2h9v13H3z" />,
    page: <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6" />,
    recent: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    memories: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
    entities: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    relations: <path d="m10 14 4-4M9 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />,
    loops: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>,
    summary: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
    chevron: <path d="m9 6 6 6-6 6" />,
  };
  return <svg className="navigation-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}

function Navigation({ locale, sources, navigation, sourcesOpen, toggleSources }: { locale: Locale; sources: Source[]; navigation: ReturnType<typeof useSourceNavigation>; sourcesOpen: boolean; toggleSources: () => void }) {
  const t = sourceMessages[locale];
  const sourceTreeId = useId();
  return <nav aria-label={t.mainNavigation}>
    <div className="source-navigation-heading">
      <a className={`nav-item${navigation.selected === null ? " current" : ""}`} href={navigation.href(null)} onClick={event => navigation.navigate(null, event)} aria-current={navigation.selected === null ? "page" : undefined}><NavigationIcon name="sources" /><span>{t.sources}</span></a>
      {sources.length > 0 && <button type="button" className="source-expand" aria-expanded={sourcesOpen} aria-controls={sourceTreeId} aria-label={t.toggleSources} onClick={toggleSources}><NavigationIcon name="chevron" /></button>}
    </div>
    <div className="source-tree" id={sourceTreeId} hidden={!sourcesOpen || sources.length === 0}>{sources.map(source => {
      const reference = sourceReference(source);
      return <div key={reference} className="source-branch">
        <a className="source-navigation-link" href={navigation.href(reference)} aria-current={navigation.selected === reference ? "page" : undefined} onClick={event => navigation.navigate(reference, event, sourceRowId(source))}><NavigationIcon name="page" /><span>{sourceName(source)}{sources.filter(candidate => sourceName(candidate) === sourceName(source)).length > 1 && <small>{source.id} · {source.namespace}</small>}</span></a>
        <button type="button" className="source-expand" aria-expanded={navigation.expanded.includes(reference)} aria-label={`${t.expandSource}: ${sourceName(source)} · ${source.id}`} onClick={() => navigation.toggle(reference)}><NavigationIcon name="chevron" /></button>
        {navigation.expanded.includes(reference) && <a className="source-branch-info" href={navigation.href(reference)} onClick={event => navigation.navigate(reference, event, sourceRowId(source))}>{t.basicInformation} · {source.id}</a>}
      </div>;
    })}</div>
    <span className="nav-item unavailable"><NavigationIcon name="recent" /><span>{t.recentInput}</span></span>
    <span className="nav-item unavailable"><NavigationIcon name="search" /><span>{t.search}</span></span>
    <div className="memory-navigation" role="group" aria-label={t.exploreMemory}>
      <p className="nav-group">{t.exploreMemory}</p>
      <div className="memory-navigation-items">
        <span className="nav-item unavailable"><NavigationIcon name="memories" /><span>{t.memories}</span></span>
        <span className="nav-item unavailable"><NavigationIcon name="entities" /><span>{t.entities}</span></span>
        <span className="nav-item unavailable"><NavigationIcon name="relations" /><span>{t.relations}</span></span>
        <span className="nav-item unavailable"><NavigationIcon name="loops" /><span>{t.openLoops}</span></span>
      </div>
    </div>
    <span className="nav-item unavailable summary-item"><NavigationIcon name="summary" /><span>{t.brainSummary}</span></span>
    <p className="nav-note">{t.comingSoon}</p>
  </nav>;
}

export function SourceScreen({ initialState, loadSources, refreshEndpoint, nativeRefresh = false, initialQuery = "", locale = defaultLocale, languageControl, timeZoneControl, connectionControl, initialPages, pagesEndpoint, loadPages }: SourceScreenProps) {
  const t = sourceMessages[locale];
  const zone = useTimeZone();
  const loader = loadSources ?? (refreshEndpoint ? async (): Promise<SourceListResult> => {
    const controller = new AbortController();
    // Above three server command budgets plus termination overhead; transport can still stall.
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(refreshEndpoint, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { kind: "denied", reason: "access-denied" };
      if (!response.ok) return { kind: "failure", reason: "request-failed" };
      return await response.json() as SourceListResult;
    } finally { clearTimeout(timer); }
  } : undefined);
  const { state, snapshot, refresh, authority } = useSourceList(initialState, loader);
  const navigation = useSourceNavigation(initialQuery);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const toggleSources = () => setSourcesOpen(open => !open);
  const selectedSource = navigation.selected !== null && validSourceReference(navigation.selected)
    ? snapshot?.sources.find(source => sourceReference(source) === navigation.selected) : undefined;
  const initialSelections = new URLSearchParams(initialQuery).getAll("source");
  const initialPagesSource = initialSelections.length === 1 ? initialSelections[0] : null;
  const [pageSeed, setPageSeed] = useState({ seed: initialPages, usable: true });
  let currentPageSeed = pageSeed;
  if (pageSeed.seed !== initialPages) {
    currentPageSeed = { seed: initialPages, usable: initialPagesSource === navigation.selected && !!selectedSource };
    setPageSeed(currentPageSeed);
  } else if (pageSeed.usable && (initialPagesSource !== navigation.selected || (navigation.selected !== null && !selectedSource))) {
    currentPageSeed = { ...pageSeed, usable: false };
    setPageSeed(currentPageSeed);
  }
  // Leaving consumes the original server seed: returning must not revive denied or superseded rows.
  const scopedInitialPages = currentPageSeed.usable && initialPagesSource === navigation.selected ? currentPageSeed.seed : undefined;
  const guide = useRef<HTMLDialogElement>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const previous = !!snapshot && state.kind !== "success";
  const issue = state.kind === "unconfigured" || state.kind === "failure" || state.kind === "unknown" || state.kind === "denied"
    ? t.issues[state.kind] : undefined;
  const showSourceDetail = navigation.selected !== null && !(state.kind === "loading" && !snapshot);
  const canReload = (!!loader || nativeRefresh) && state.kind !== "unconfigured";

  return <>
    <a className="skip-link" href="#main">{t.skipToMain}</a>
    <aside className="sidebar" aria-label={t.appNavigation}>
      <div className="brand"><svg className="brand-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false"><ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(-28 12 12)" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /><circle cx="20.2" cy="7.6" r="1.3" fill="currentColor" stroke="none" /></svg><strong>GBrain Observatory</strong></div>
      <div className="desktop-navigation"><Navigation locale={locale} sources={snapshot?.sources ?? []} navigation={navigation} sourcesOpen={sourcesOpen} toggleSources={toggleSources} /></div>
      <details className="mobile-navigation"><summary>{t.navigationMenu}</summary><Navigation locale={locale} sources={snapshot?.sources ?? []} navigation={navigation} sourcesOpen={sourcesOpen} toggleSources={toggleSources} /></details>
      <div className="sidebar-footer"><span className="brain-dot" aria-hidden="true" />{t.myBrain}</div>
    </aside>
    <div className="workspace">
      <header className="context-bar"><span>{t.myBrain}</span><span aria-hidden="true">/</span><span aria-current={navigation.selected === null ? "page" : undefined}>{t.sources}</span>{selectedSource && <><span aria-hidden="true">/</span><span aria-current="page">{sourceName(selectedSource)}</span></>}</header>
      <main id="main" tabIndex={-1} className="min-w-0">
        <div className="desk" onSubmitCapture={event => {
          const input = (event.target as HTMLFormElement).querySelector<HTMLInputElement>('input[name="sourceReturn"]');
          if (input) input.value = `/${navigation.href(navigation.selected)}`;
        }}>
          <div className={`page-heading${showSourceDetail ? " source-heading" : ""}`}>
            {showSourceDetail ? <>
              <a className="return-list" href={navigation.href(null)} onClick={event => navigation.navigate(null, event)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>{t.returnToList}</a>
              <h1 id="source-detail-title" tabIndex={-1}>{selectedSource ? sourceName(selectedSource) : t.selectionUnavailable}</h1>
            </> : <h1>{t.sources}</h1>}
          </div>
          <div className="workspace-controls"><div className="source-toolbar">
            <span className={`section-label${navigation.selected !== null ? " sr-only" : ""}`} id="source-list-title" tabIndex={-1}>{t.sourceList}</span>
            <div className="toolbar-actions">
              {languageControl}
              {canReload && <form action="/" method="get" onSubmit={event => { if (loader) { event.preventDefault(); void refresh(); } }}>
                {Array.from(new URLSearchParams(navigation.href(navigation.selected).slice(1))).filter(([key]) => key === "source" || key === "expanded" || key === "added").map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
                <button type="submit" aria-disabled={state.kind === "loading"}>{state.kind === "loading" ? t.refreshing : t.refresh}</button>
              </form>}
              <button type="button" ref={guideTrigger} onClick={() => guide.current?.showModal()}>{t.guide}</button>
            </div>
          </div>
          {timeZoneControl}</div>
          {connectionControl}
          <div className="state-announcement" role="status" aria-live="polite" aria-atomic="true">
            {state.kind === "loading" && <p>{t.loading}</p>}
            {state.kind === "success" && <p className="sr-only">{t.finished} {formatResultCount(locale, state.snapshot.sources.length)} · {t.checkedAt}: <Timestamp locale={locale} value={state.snapshot.checkedAt} /> · {zone}</p>}
            {state.kind === "unknown" && state.reason === "unsupported" && <p>{t.unsupported}</p>}
            {state.kind === "failure" && state.reason === "busy" && <p>{t.busySources}</p>}
            {issue && <div className="issue-board"><span className="issue-icon" aria-hidden="true">!</span><div><h2>{issue.title}</h2><p>{issue.reason}</p><p>{issue.action}</p></div></div>}
            {previous && <p className="previous-notice">{t.previous} · {t.checkedAt}: <Timestamp locale={locale} value={snapshot.checkedAt} /> · {zone}</p>}
            {state.kind === "success" && snapshot?.sources.length === 0 && <div className="empty-board"><h2>{t.emptyTitle}</h2><p>{t.emptyDescription}</p></div>}
          </div>
          {showSourceDetail && <section className="source-detail" aria-labelledby="source-detail-title">
            {selectedSource ? <><div className="source-fields">
              <div className="source-cards">
                <section className="source-card source-sync" aria-labelledby="source-sync-title">
                  <div className="help-heading"><h2 id="source-sync-title">{t.sourceSync}</h2><ContextHelp locale={locale} label={t.syncHelp} title={t.sourceSync}><p>{t.scopeNote}</p><p>{t.guideAction}</p></ContextHelp></div>
                  <span className="sync-status unknown"><span aria-hidden="true" className="status-dot" />{t.syncUnknown}</span>
                  <dl className="source-times">
                    <div><dt>{t.lastSyncedAt}</dt><dd><Timestamp locale={locale} value={selectedSource.lastSyncedAt} /></dd></div>
                    <div><dt>{t.checkedAt}</dt><dd><Timestamp locale={locale} value={selectedSource.checkedAt} /></dd></div>
                  </dl>
                </section>
                <section className="source-card" aria-labelledby="source-connection-title">
                  <h2 id="source-connection-title">{t.connection}</h2>
                  <dl className="source-connections">
                    <div><dt>{t.folder}</dt><dd>{selectedSource.connection.folder ?? t.notProvided}</dd></div>
                    <div><dt>{t.repository}</dt><dd>{selectedSource.connection.repository ?? t.notProvided}</dd></div>
                  </dl>
                  <details className="source-metadata"><summary><h3>{t.basicInformation}</h3></summary><dl className="source-connections">
                    <div><dt>{t.sourceId}</dt><dd>{selectedSource.id}</dd></div>
                    <div><dt>{t.connectionIdentity}</dt><dd>{selectedSource.namespace}</dd></div>
                    <div><dt>{t.federated}</dt><dd>{selectedSource.federated ? t.yes : t.no}</dd></div>
                    <div><dt>{t.strategy}</dt><dd>{selectedSource.strategy ?? t.notProvided}</dd></div>
                    <div><dt>{t.pageCount}</dt><dd>{new Intl.NumberFormat(locale).format(selectedSource.pageCount)}</dd></div>
                    {selectedSource.lastSyncedAt !== null && <div><dt>{t.lastSyncedAt}</dt><dd><code>{selectedSource.lastSyncedAt}</code></dd></div>}
                    {selectedSource.checkedAt !== null && <div><dt>{t.checkedAt}</dt><dd><code>{selectedSource.checkedAt}</code></dd></div>}
                  </dl></details>
                </section>
                <section className="source-card" aria-labelledby="source-service-title">
                  <h2 id="source-service-title">{t.ingestionService}</h2>
                  <p>{t.serviceNotProvided}</p>
                </section>
              </div>
            </div><PageList key={sourceReference(selectedSource)} source={sourceReference(selectedSource)} seed={scopedInitialPages} endpoint={pagesEndpoint} authority={authority} filter={navigation.filter} setFilter={navigation.setFilter} query={navigation.href(navigation.selected).slice(1)} locale={locale} loadPages={loadPages} />
            </> : <p>{t.selectionUnavailableReason}</p>}
          </section>}
          <div className="table-board" hidden={navigation.selected !== null} aria-busy={state.kind === "loading"}>
            <div className="table-scroll" role="region" aria-label={t.sourceList} tabIndex={0}>
              <table>
                <caption className="sr-only">{t.tableCaption}</caption>
                <thead><tr><th scope="col">{t.source}</th><th scope="col">{t.connection}</th><th scope="col">{t.syncResult}</th><th scope="col" aria-label={t.lastSyncedAt}>{t.lastSyncedAt} <ContextHelp locale={locale} label={t.syncHelp} title={t.sourceSync}><p>{t.scopeNote}</p></ContextHelp></th><th scope="col">{t.checkedAt}</th></tr></thead>
                <tbody>{snapshot?.sources.map(source => <tr key={sourceReference(source)}>
                  <th scope="row"><a id={sourceRowId(source)} href={navigation.href(sourceReference(source))} onClick={event => navigation.navigate(sourceReference(source), event, sourceRowId(source))}>{sourceName(source)}</a>{snapshot.sources.filter(candidate => sourceName(candidate) === sourceName(source)).length > 1 && <small className="source-disambiguation">{source.id} · {source.namespace}</small>}<details className="source-identity"><summary aria-label={`${t.basicInformation}: ${sourceName(source)} · ${source.id}`}>{t.basicInformation}</summary><dl className="connection-values"><div><dt>{t.sourceId}</dt><dd>{source.id}</dd></div><div><dt>{t.connectionIdentity}</dt><dd>{source.namespace}</dd></div></dl></details></th>
                  <td><dl className="connection-values"><div><dt>{t.folder}</dt><dd>{source.connection.folder ?? t.notProvided}</dd></div><div><dt>{t.repository}</dt><dd>{source.connection.repository ?? t.notProvided}</dd></div></dl></td>
                  <td><span className={`sync-status ${source.sync.status}`}><span aria-hidden="true" className="status-dot" />{source.sync.label || t.syncUnknown}</span></td>
                  <td><Timestamp locale={locale} value={source.lastSyncedAt} /></td><td><Timestamp locale={locale} value={source.checkedAt} /></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="table-footer">{snapshot && <div className="context-value"><span>{formatResultCount(locale, snapshot.sources.length)} · {t.coverageSummary}</span><ContextHelp locale={locale} label={t.sourceScopeHelp} title={t.sources}><p>{t.coverageUnknown}</p></ContextHelp></div>}{!snapshot && <span>{t.listPending}</span>}{snapshot && <span>{t.checkedAt}: <Timestamp locale={locale} value={snapshot.checkedAt} /> · {zone}</span>}</div>
          </div>
        </div>
      </main>
    </div>
    <dialog className="connection-guide" ref={guide} aria-labelledby="guide-title" aria-describedby="guide-intro" onClose={() => guideTrigger.current?.focus()}>
      <div className="guide-header"><h2 id="guide-title">{t.guide}</h2><button type="button" onClick={() => guide.current?.close()}>{t.close}</button></div>
      <div className="guide-body"><p id="guide-intro">{issue?.reason ?? t.guideIntro}</p><h3>{t.guideHeading}</h3><p>{issue?.action ?? t.guideAction}</p>
        <p>{t.scopeNote}</p><details><summary>{t.detailedChecks}</summary><ul><li>{t.checkServer}</li><li>{t.checkPermissions}</li><li>{t.checkUnknown}</li></ul></details>
      </div>
    </dialog>
  </>;
}
