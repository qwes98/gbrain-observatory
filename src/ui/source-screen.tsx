"use client";

import { useRef, type ReactNode } from "react";
import { defaultLocale, formatResultCount, sourceMessages, type Locale } from "../i18n/messages";
import { sourceReference, validSourceReference, type Source, type SourceListResult, type SourceListState } from "../contracts/sources";
import { formatInstant } from "../i18n/time-zone";
import { useTimeZone } from "./time-zone-provider";
import { useSourceList } from "./use-source-list";
import { sourceRowId, useSourceNavigation } from "./use-source-navigation";

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

function Navigation({ locale, sources, navigation }: { locale: Locale; sources: Source[]; navigation: ReturnType<typeof useSourceNavigation> }) {
  const t = sourceMessages[locale];
  return <nav aria-label={t.mainNavigation}>
    <a className="nav-item current" href={navigation.href(null)} onClick={event => navigation.navigate(null, event)} aria-current={navigation.selected === null ? "page" : undefined}><span aria-hidden="true">▤</span>{t.sources}</a>
    <div className="source-tree">{sources.map(source => {
      const reference = sourceReference(source);
      return <div key={reference} className="source-branch">
        <button type="button" className="source-expand" aria-expanded={navigation.expanded.includes(reference)} aria-label={`${t.expandSource}: ${sourceName(source)} · ${source.id}`} onClick={() => navigation.toggle(reference)}>{navigation.expanded.includes(reference) ? "−" : "+"}</button>
        <a href={navigation.href(reference)} aria-current={navigation.selected === reference ? "page" : undefined} onClick={event => navigation.navigate(reference, event, sourceRowId(source))}>{sourceName(source)}<small>{source.id} · {source.namespace}</small></a>
        {navigation.expanded.includes(reference) && <a className="source-branch-info" href={navigation.href(reference)} onClick={event => navigation.navigate(reference, event, sourceRowId(source))}>{t.basicInformation} · {source.id}</a>}
      </div>;
    })}</div>
    <span className="nav-item unavailable"><span aria-hidden="true">◷</span>{t.recentInput}</span>
    <span className="nav-item unavailable"><span aria-hidden="true">⌕</span>{t.search}</span>
    <p className="nav-group">{t.exploreMemory}</p>
    <span className="nav-item unavailable"><span aria-hidden="true">▧</span>{t.memories}</span>
    <span className="nav-item unavailable"><span aria-hidden="true">♧</span>{t.entities}</span>
    <span className="nav-item unavailable"><span aria-hidden="true">⇄</span>{t.relations}</span>
    <span className="nav-item unavailable"><span aria-hidden="true">□</span>{t.openLoops}</span>
    <span className="nav-item unavailable summary-item"><span aria-hidden="true">◈</span>{t.brainSummary}</span>
    <p className="nav-note">{t.comingSoon}</p>
  </nav>;
}

export function SourceScreen({ initialState, loadSources, refreshEndpoint, nativeRefresh = false, initialQuery = "", locale = defaultLocale, languageControl, timeZoneControl, connectionControl }: SourceScreenProps) {
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
  const { state, snapshot, refresh } = useSourceList(initialState, loader);
  const navigation = useSourceNavigation(initialQuery);
  const selectedSource = navigation.selected !== null && validSourceReference(navigation.selected)
    ? snapshot?.sources.find(source => sourceReference(source) === navigation.selected) : undefined;
  const guide = useRef<HTMLDialogElement>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const previous = !!snapshot && state.kind !== "success";
  const issue = state.kind === "unconfigured" || state.kind === "failure" || state.kind === "unknown" || state.kind === "denied"
    ? t.issues[state.kind] : undefined;
  const canReload = (!!loader || nativeRefresh) && state.kind !== "unconfigured";

  return <>
    <a className="skip-link" href="#main">{t.skipToMain}</a>
    <aside className="sidebar" aria-label={t.appNavigation}>
      <div className="brand"><span className="brand-mark" aria-hidden="true">◎</span><strong>GBrain Observatory</strong></div>
      <div className="desktop-navigation"><Navigation locale={locale} sources={snapshot?.sources ?? []} navigation={navigation} /></div>
      <details className="mobile-navigation"><summary>{t.navigationMenu}</summary><Navigation locale={locale} sources={snapshot?.sources ?? []} navigation={navigation} /></details>
      <div className="sidebar-footer"><span className="brain-dot" aria-hidden="true" />{t.myBrain}</div>
    </aside>
    <div className="workspace">
      <header className="context-bar"><span>{t.myBrain}</span><span aria-hidden="true">/</span><span aria-current="page">{t.sources}</span></header>
      <main id="main" tabIndex={-1} className="min-w-0">
        <div className="desk" onSubmitCapture={event => {
          const input = (event.target as HTMLFormElement).querySelector<HTMLInputElement>('input[name="sourceReturn"]');
          if (input) input.value = `/${navigation.href(navigation.selected)}`;
        }}>
          <div className="page-heading"><p className="eyebrow">{t.myBrain}</p><h1>{t.sources}</h1><p>{t.description}</p></div>
          <div className="source-toolbar">
            <span className="section-label" id="source-list-title" tabIndex={-1}>{t.sourceList}</span>
            <div className="toolbar-actions">
              {languageControl}
              {canReload && <form action="/" method="get" onSubmit={event => { if (loader) { event.preventDefault(); void refresh(); } }}>
                {Array.from(new URLSearchParams(navigation.href(navigation.selected).slice(1))).filter(([key]) => key === "source" || key === "expanded").map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
                <button type="submit" aria-disabled={state.kind === "loading"}>{state.kind === "loading" ? t.refreshing : t.refresh}</button>
              </form>}
              <button type="button" ref={guideTrigger} onClick={() => guide.current?.showModal()}>{t.guide}</button>
            </div>
          </div>
          {timeZoneControl}
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
          {navigation.selected !== null && !(state.kind === "loading" && !snapshot) && <section className="source-detail" aria-labelledby="source-detail-title">
            <a className="return-list" href={navigation.href(null)} onClick={event => navigation.navigate(null, event)}>{t.returnToList}</a>
            <h2 id="source-detail-title" tabIndex={-1}>{selectedSource ? sourceName(selectedSource) : t.selectionUnavailable}</h2>
            {selectedSource ? <><h3>{t.basicInformation}</h3><dl className="source-fields">
              <div><dt>{t.sourceId}</dt><dd>{selectedSource.id}</dd></div>
              <div><dt>{t.connectionIdentity}</dt><dd>{selectedSource.namespace}</dd></div>
              <div><dt>{t.folder}</dt><dd>{selectedSource.connection.folder ?? t.notProvided}</dd></div>
              <div><dt>{t.repository}</dt><dd>{selectedSource.connection.repository ?? t.notProvided}</dd></div>
              <div><dt>{t.federated}</dt><dd>{selectedSource.federated ? t.yes : t.no}</dd></div>
              <div><dt>{t.strategy}</dt><dd>{selectedSource.strategy ?? t.notProvided}</dd></div>
              <div><dt>{t.pageCount}</dt><dd>{new Intl.NumberFormat(locale).format(selectedSource.pageCount)}</dd></div>
              <div><dt>{t.syncResult}</dt><dd>{t.syncUnknown}</dd></div>
              <div><dt>{t.lastSyncedAt}</dt><dd><Timestamp locale={locale} value={selectedSource.lastSyncedAt} />{selectedSource.lastSyncedAt !== null && <code>{selectedSource.lastSyncedAt}</code>}</dd></div>
              <div><dt>{t.checkedAt}</dt><dd><Timestamp locale={locale} value={selectedSource.checkedAt} />{selectedSource.checkedAt !== null && <code>{selectedSource.checkedAt}</code>}</dd></div>
              <div><dt>{t.connectorProvider}</dt><dd>{t.notProvided}</dd></div>
            </dl></> : <p>{t.selectionUnavailableReason}</p>}
          </section>}
          <div className="table-board" hidden={navigation.selected !== null} aria-busy={state.kind === "loading"}>
            <div className="table-scroll" role="region" aria-label={t.sourceList} tabIndex={0}>
              <table>
                <caption className="sr-only">{t.tableCaption}</caption>
                <thead><tr><th scope="col">{t.source}</th><th scope="col">{t.connection}</th><th scope="col">{t.syncResult}</th><th scope="col">{t.lastSyncedAt}</th><th scope="col">{t.checkedAt}</th></tr></thead>
                <tbody>{snapshot?.sources.map(source => <tr key={sourceReference(source)}>
                  <th scope="row"><a id={sourceRowId(source)} href={navigation.href(sourceReference(source))} onClick={event => navigation.navigate(sourceReference(source), event, sourceRowId(source))}>{sourceName(source)}</a></th>
                  <td><dl className="connection-values"><div><dt>{t.sourceId}</dt><dd>{source.id}</dd></div><div><dt>{t.connectionIdentity}</dt><dd>{source.namespace}</dd></div><div><dt>{t.folder}</dt><dd>{source.connection.folder ?? t.notProvided}</dd></div><div><dt>{t.repository}</dt><dd>{source.connection.repository ?? t.notProvided}</dd></div></dl></td>
                  <td><span className={`sync-status ${source.sync.status}`}><span aria-hidden="true" className="status-dot" />{source.sync.label || t.syncUnknown}</span></td>
                  <td><Timestamp locale={locale} value={source.lastSyncedAt} /></td><td><Timestamp locale={locale} value={source.checkedAt} /></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="table-footer">{snapshot && <span>{formatResultCount(locale, snapshot.sources.length)}</span>}{!snapshot && <span>{t.listPending}</span>}{snapshot && <span>{t.checkedAt}: <Timestamp locale={locale} value={snapshot.checkedAt} /> · {zone}</span>}</div>
          </div>
          <p className="scope-note">{t.scopeNote}</p><p className="scope-note">{t.coverageUnknown}</p>
        </div>
      </main>
    </div>
    <dialog className="connection-guide" ref={guide} aria-labelledby="guide-title" aria-describedby="guide-intro" onClose={() => guideTrigger.current?.focus()}>
      <div className="guide-header"><h2 id="guide-title">{t.guide}</h2><button type="button" onClick={() => guide.current?.close()}>{t.close}</button></div>
      <div className="guide-body"><p id="guide-intro">{issue?.reason ?? t.guideIntro}</p><h3>{t.guideHeading}</h3><p>{issue?.action ?? t.guideAction}</p>
        <details><summary>{t.detailedChecks}</summary><ul><li>{t.checkServer}</li><li>{t.checkPermissions}</li><li>{t.checkUnknown}</li></ul></details>
      </div>
    </dialog>
  </>;
}
