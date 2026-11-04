"use client";

import { useEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { factReference, type Fact, type FactFieldAvailability, type FactListResult, type FactResultIssue } from "../contracts/facts";
import { factMessages, formatResultCount, memoryKindLabel, type Locale } from "../i18n/messages";
import { formatInstant } from "../i18n/time-zone";
import { ContextHelp } from "./context-help";
import { useTimeZone } from "./time-zone-provider";
import { useFacts, type FactLoader } from "./use-facts";

const subscribeHydration = () => () => {};
export function factRowId(fact: Pick<Fact, "namespace" | "sourceId" | "id">) { return `fact-${encodeURIComponent(factReference(fact))}`; }
export function FactTime({ value, availability, locale }: { value: string | null; availability: FactFieldAvailability; locale: Locale }) {
  const t = factMessages[locale], zone = useTimeZone();
  const formatted = value ? formatInstant(value, locale, zone) : null;
  return formatted && value ? <time dateTime={value} title={`${formatted.text} · ${zone} · ${formatted.offset}`}>{formatted.text} · {formatted.offset}</time> : <span className="muted">{availability === "invalid" || availability === "available" ? t.invalid : availability === "null" ? t.nullValue : t.notProvided}</span>;
}
export function FactList({ source, seed, endpoint, authority, enabled, allowed, blocked = false, query, locale, loadFacts, selectedFact, factHref, openFact, onAccessLost, enable, enableHref, accessIssue }: {
  source: string; seed?: FactListResult; endpoint?: string; authority: object; enabled: boolean; allowed: boolean; blocked?: boolean; query: string; locale: Locale; loadFacts?: FactLoader;
  selectedFact?: string | null; factHref: (fact: Fact) => string; openFact: (fact: Fact, event?: MouseEvent<HTMLAnchorElement>) => void;
  onAccessLost?: (issue: FactResultIssue) => void; enable: (event?: MouseEvent<HTMLAnchorElement>) => void; enableHref: string; accessIssue?: FactResultIssue;
}) {
  const t = factMessages[locale], zone = useTimeZone();
  const enhanced = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const { state, snapshot, refresh } = useFacts(source, seed, endpoint, authority, enabled, allowed, blocked, loadFacts, accessIssue);
  const reportedIssue = useRef<FactResultIssue | null>(null);
  useEffect(() => {
    if ((state.kind === "denied" || (state.kind === "unavailable" && state.reason === "source-unavailable")) && reportedIssue.current !== state) {
      reportedIssue.current = state; onAccessLost?.(state);
    }
  }, [state, onAccessLost]);
  const issue = state.kind === "unavailable" && state.reason === "source-unavailable" ? t.sourceUnavailable : state.kind === "failure" ? state.reason === "busy" ? t.busy : t.failure : state.kind !== "success" && state.kind !== "idle" && state.kind !== "loading" ? t[state.kind] : null;
  const rangeHelp = <ContextHelp locale={locale} label={t.rangeHelp} title={t.rangeTitle}><p>{t.rangeHelpText}</p>{snapshot && <p>{t.observation}: <FactTime value={snapshot.observation.startedAt} availability="available" locale={locale} /> – <FactTime value={snapshot.observation.completedAt} availability="available" locale={locale} /></p>}</ContextHelp>;
  return <section className="fact-list" aria-labelledby="facts-title" aria-busy={state.kind === "loading"}>
    <div className="fact-board">
      <div className="pages-toolbar"><h2 id="facts-title" tabIndex={-1}>{t.title}</h2>{!snapshot && rangeHelp}
        {!enabled && (allowed ? <a className="fact-load" href={enableHref} onClick={enable}>{t.load}</a> : <button className="fact-load" type="button" disabled>{t.load}</button>)}
        {enabled && <form className="page-refresh" action="/" method="get" onSubmit={event => { if (enhanced) { event.preventDefault(); refresh(); } }}>
          {[...new URLSearchParams(query)].filter(([key]) => ["source", "expanded", "added", "page", "view", "reading", "fact", "factReading"].includes(key)).map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}<input type="hidden" name="facts" value="1" />
          <button type="submit" disabled={blocked || !allowed || state.kind === "loading"} aria-disabled={blocked || !allowed || state.kind === "loading"}>{t.refresh}</button>
        </form>}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="page-status">
        {state.kind === "loading" && <p>{t.loading}</p>}{issue && <p>{issue}</p>}{state.kind === "idle" && <p>{t.pending}</p>}
        {snapshot && state.kind !== "success" && <p>{t.previous}</p>}{state.kind === "success" && <p className="sr-only">{t.complete} {formatResultCount(locale, snapshot?.rows.length ?? 0)}</p>}
      </div>
      {snapshot && <div className="page-table"><div className="table-scroll" role="region" aria-label={t.caption} tabIndex={0}>
        <table><colgroup><col className="fact-content-column" /><col className="fact-kind-column" /><col className="fact-source-column" /><col className="fact-time-column" /></colgroup><caption className="sr-only">{t.caption}</caption>
          <thead><tr><th scope="col">{t.content}</th><th scope="col">{t.kind}</th><th scope="col">{t.sourceAttribution}</th><th scope="col">{t.recordedAt}</th></tr></thead>
          <tbody>{snapshot.rows.map(fact => <tr key={factReference(fact)} className={selectedFact === fact.id ? "fact-row-selected" : undefined} onClick={event => {
            if (state.kind === "loading" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || window.getSelection()?.toString() || (event.target as Element).closest("a,button,input,select,textarea,summary,details,label")) return;
            openFact(fact);
          }}><th scope="row"><a id={factRowId(fact)} href={factHref(fact)} title={fact.content} onClick={event => { if (state.kind === "loading" && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); return; } openFact(fact, event); }}>{fact.content}</a></th>
            <td title={fact.kind}>{memoryKindLabel(locale, fact.kind)}</td><td title={fact.sourceDescription ?? undefined}>{fact.sourceDescription ?? t.notProvided}</td><td><FactTime value={fact.createdAt} availability={fact.creationAvailability} locale={locale} /></td></tr>)}</tbody>
        </table>
      </div>{snapshot.rows.length === 0 && <p className="page-empty">{t.empty}</p>}
      <div className="table-footer"><div className="context-value"><span>{formatResultCount(locale, snapshot.rows.length)} · {t.coverage}</span>{rangeHelp}</div><span>{zone}</span></div>
      </div>}
    </div>
    {snapshot?.capped && <p className="scope-note">{t.cap}</p>}{!!snapshot?.omitted && <p className="scope-note">{t.partial} {t.omitted}: {new Intl.NumberFormat(locale).format(snapshot.omitted)}</p>}
  </section>;
}
