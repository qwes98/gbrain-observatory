"use client";

import { useRef, useState, type ReactNode } from "react";
import { defaultLocale, formatResultCount, sourceMessages, type Locale } from "../i18n/messages";
import Link from "next/link";
import type { SourceListResult, SourceListState, SourceSnapshot } from "../contracts/sources";

interface SourceScreenProps {
  initialState: SourceListState;
  locale?: Locale;
  languageControl?: ReactNode;
  loadSources?: () => Promise<SourceListResult>;
}

function checkedSnapshot(state: SourceListState): SourceSnapshot | undefined {
  if (state.kind === "success") return state.snapshot;
  return "previous" in state ? state.previous : undefined;
}

function Timestamp({ value, locale }: { value: string | null; locale: Locale }) {
  const t = sourceMessages[locale];
  if (value === null) return <span className="muted">{t.notProvided}</span>;
  // Reject local/offset-free values and calendar rollovers before interpreting an instant.
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  const year = Number(parts?.[1]);
  const month = Number(parts?.[2]);
  const day = Number(parts?.[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!parts || day < 1 || day > daysInMonth || !daysInMonth || Number(parts[4]) > 23 ||
      Number(parts[5]) > 59 || Number(parts[6]) > 59 || Number(parts[7] ?? 0) > 23 ||
      Number(parts[8] ?? 0) > 59 || Number.isNaN(Date.parse(value))) {
    return <span className="muted">{t.invalidTime}</span>;
  }
  const text = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
  return <time dateTime={value}>{text}</time>;
}

function Navigation({ locale }: { locale: Locale }) {
  const t = sourceMessages[locale];
  return <nav aria-label={t.mainNavigation}>
    <Link className="nav-item current" href="/" aria-current="page"><span aria-hidden="true">▤</span>{t.sources}</Link>
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

export function SourceScreen({ initialState, loadSources, locale = defaultLocale, languageControl }: SourceScreenProps) {
  const t = sourceMessages[locale];
  const [state, setState] = useState(initialState);
  const inFlight = useRef(false);
  const guide = useRef<HTMLDialogElement>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const snapshot = checkedSnapshot(state);
  const previous = !!snapshot && state.kind !== "success";
  const issue = state.kind === "unconfigured" || state.kind === "failure" || state.kind === "unknown"
    ? t.issues[state.kind] : undefined;
  const canReload = !!loadSources && state.kind !== "unconfigured";

  async function refresh() {
    if (!loadSources || inFlight.current || state.kind === "loading") return;
    inFlight.current = true;
    setState({ kind: "loading", previous: snapshot });
    try {
      const result = await loadSources();
      if (result.kind === "failure" || result.kind === "unknown") {
        setState({ ...result, previous: snapshot });
      } else {
        setState(result);
      }
    } catch {
      // Raw errors may include private paths, addresses, or credentials.
      setState({ kind: "failure", reason: "request-failed", previous: snapshot });
    } finally {
      inFlight.current = false;
    }
  }

  return <>
    <a className="skip-link" href="#main">{t.skipToMain}</a>
    <aside className="sidebar" aria-label={t.appNavigation}>
      <div className="brand"><span className="brand-mark" aria-hidden="true">◎</span><strong>GBrain Observatory</strong></div>
      <div className="desktop-navigation"><Navigation locale={locale} /></div>
      <details className="mobile-navigation"><summary>{t.navigationMenu}</summary><Navigation locale={locale} /></details>
      <div className="sidebar-footer"><span className="brain-dot" aria-hidden="true" />{t.myBrain}</div>
    </aside>
    <div className="workspace">
      <header className="context-bar"><span>{t.myBrain}</span><span aria-hidden="true">/</span><span aria-current="page">{t.sources}</span></header>
      <main id="main" tabIndex={-1} className="min-w-0">
        <div className="desk">
          <div className="page-heading"><p className="eyebrow">{t.myBrain}</p><h1>{t.sources}</h1><p>{t.description}</p></div>
          <div className="source-toolbar">
            <span className="section-label">{t.sourceList}</span>
            <div className="toolbar-actions">
              {languageControl}
              {canReload && <button type="button" onClick={refresh} aria-disabled={state.kind === "loading"}>{state.kind === "loading" ? t.refreshing : t.refresh}</button>}
              <button type="button" ref={guideTrigger} onClick={() => guide.current?.showModal()}>{t.guide}</button>
            </div>
          </div>
          <div className="state-announcement" role="status" aria-live="polite" aria-atomic="true">
            {state.kind === "loading" && <p>{t.loading}</p>}
            {state.kind === "success" && <p className="sr-only">{t.finished} {formatResultCount(locale, state.snapshot.sources.length)} · {t.checkedAt}: <Timestamp locale={locale} value={state.snapshot.checkedAt} /> · {t.koreaTime}</p>}
            {issue && <div className="issue-board"><span className="issue-icon" aria-hidden="true">!</span><div><h2>{issue.title}</h2><p>{issue.reason}</p><p>{issue.action}</p></div></div>}
            {previous && <p className="previous-notice">{t.previous} · {t.checkedAt}: <Timestamp locale={locale} value={snapshot.checkedAt} /> · {t.koreaTime}</p>}
            {state.kind === "success" && snapshot?.sources.length === 0 && <div className="empty-board"><h2>{t.emptyTitle}</h2><p>{t.emptyDescription}</p></div>}
          </div>
          <div className="table-board" aria-busy={state.kind === "loading"}>
            <div className="table-scroll" role="region" aria-label={t.sourceList} tabIndex={0}>
              <table>
                <caption className="sr-only">{t.tableCaption}</caption>
                <thead><tr><th scope="col">{t.source}</th><th scope="col">{t.connection}</th><th scope="col">{t.syncResult}</th><th scope="col">{t.lastSyncedAt}</th><th scope="col">{t.checkedAt}</th></tr></thead>
                <tbody>{snapshot?.sources.map(source => <tr key={source.id}>
                  <th scope="row">{source.name}</th>
                  <td>{source.connection.folder || source.connection.repository ? <dl className="connection-values">{source.connection.folder && <div><dt>{t.folder}</dt><dd>{source.connection.folder}</dd></div>}{source.connection.repository && <div><dt>{t.repository}</dt><dd>{source.connection.repository}</dd></div>}</dl> : <span className="muted">{t.connectionNotProvided}</span>}</td>
                  <td><span className={`sync-status ${source.sync.status}`}><span aria-hidden="true" className="status-dot" />{source.sync.label}</span></td>
                  <td><Timestamp locale={locale} value={source.lastSyncedAt} /></td><td><Timestamp locale={locale} value={source.checkedAt} /></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="table-footer">{snapshot && <span>{formatResultCount(locale, snapshot.sources.length)}</span>}{!snapshot && <span>{t.listPending}</span>}{snapshot && <span>{t.checkedAt}: <Timestamp locale={locale} value={snapshot.checkedAt} /> · {t.koreaTime}</span>}</div>
          </div>
          <p className="scope-note">{t.scopeNote}</p>
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
