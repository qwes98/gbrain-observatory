"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { verifiedPageLocation, type PageMemory } from "../contracts/page-detail";
import type { Page, PageFieldAvailability } from "../contracts/pages";
import { sourceReference, type PageNavigation } from "../contracts/sources";
import { readerMessages, pageMessages, memoryKindLabel, type Locale } from "../i18n/messages";
import { formatInstant } from "../i18n/time-zone";
import { ContextHelp } from "./context-help";
import { useTimeZone } from "./time-zone-provider";
import type { PageDetailState } from "./use-page-detail";

const subscribeHydration = () => () => {};
function SafeText({ text }: { text: string }) {
  const pieces: ReactNode[] = [];
  const links = /\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0, match: RegExpExecArray | null;
  while ((match = links.exec(text))) {
    let safe = false;
    try { const url = new URL(match[1]); safe = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !/[\u0000-\u001f\u007f]/.test(match[1]); } catch { /* Preserve invalid links as text. */ }
    if (!safe) continue;
    pieces.push(text.slice(cursor, match.index));
    pieces.push(<a key={match.index} href={match[1]} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{match[0]}</a>);
    cursor = match.index + match[0].length;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}
function ReaderTime({ value, availability, locale }: { value: string | null; availability: PageFieldAvailability; locale: Locale }) {
  const t = readerMessages[locale], zone = useTimeZone();
  const formatted = value ? formatInstant(value, locale, zone) : null;
  const missing = availability === "invalid" ? t.invalidTime : availability === "partial" ? pageMessages[locale].partial : availability === "failed" ? pageMessages[locale].failed : availability === "unsupported" ? pageMessages[locale].unsupportedTime : t.notProvided;
  return !value ? <span>{missing}</span> : formatted ? <time dateTime={value} title={`${formatted.text} · ${zone} · ${formatted.offset}`}>{formatted.text} · {formatted.offset}</time> : <span>{t.invalidTime}</span>;
}
export function PageReader({ state, detail, locale, query, href, move, setView, open, outside = false, preferences }: {
  state: PageDetailState; detail: PageNavigation; locale: Locale; query: string;
  href: (next: PageNavigation | null, source?: string) => string;
  move: (next: PageNavigation | null, event?: MouseEvent<HTMLAnchorElement>, source?: string) => void;
  setView: (view: PageNavigation["view"]) => void;
  open: (page: Page, event?: MouseEvent<HTMLAnchorElement>) => void; outside?: boolean; preferences?: ReactNode;
}) {
  const t = readerMessages[locale], id = useId();
  const root = useRef<HTMLElement>(null), passage = useRef<HTMLElement>(null);
  const enhanced = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const snapshot = !outside && state.kind === "success" ? state.snapshot : undefined;
  const candidate = snapshot?.memories.rows.find(memory => memory.id === highlight);
  const selected = candidate && snapshot && detail.view === "body" && verifiedPageLocation(snapshot.body.sections, candidate.location, candidate.claim) ? candidate : null;
  useEffect(() => { document.getElementById("page-reader-title")?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (selected) { passage.current?.focus(); passage.current?.scrollIntoView({ block: "center" }); } }, [selected]);
  const title = snapshot ? snapshot.page.title.trim() ? snapshot.page.title : snapshot.page.slug : t.title;
  const Title = detail.mode === "full" ? "h1" : "h2";
  const issue = outside ? t.outside : state.kind === "loading" ? t.loading : state.kind === "failure" ? state.reason === "busy" ? t.busy : t.failure : state.kind === "success" ? null : t[state.kind];
  const navigationFields = [...new URLSearchParams(query)].filter(([key]) => !["view", "reading"].includes(key));
  function select(view: PageNavigation["view"]) { setHighlight(null); setView(view); }
  function find(memory: PageMemory) {
    if (!snapshot || !verifiedPageLocation(snapshot.body.sections, memory.location, memory.claim)) return;
    setHighlight(memory.id); setView("body");
  }
  const metadata = snapshot && <dl className="reader-metadata">
    <div><dt>{t.source}</dt><dd><a href={href(null)} onClick={event => move(null, event)}>{snapshot.sourceName.trim() ? snapshot.sourceName : snapshot.page.sourceId}<span aria-hidden="true"> →</span></a></dd></div>
    <div><dt>{t.added}</dt><dd><ReaderTime value={snapshot.page.createdAt} availability={snapshot.page.creationAvailability} locale={locale} /></dd></div>
    <div><dt>{t.changed}</dt><dd><ReaderTime value={snapshot.page.updatedAt} availability={snapshot.page.modificationAvailability} locale={locale} /></dd></div>
  </dl>;
  return <aside ref={root} className={`page-reader page-reader-${detail.mode}`} aria-labelledby="page-reader-title" aria-busy={state.kind === "loading"} onSubmitCapture={event => {
    const input = (event.target as HTMLFormElement).querySelector<HTMLInputElement>('input[name="sourceReturn"]');
    if (input) input.value = `${window.location.pathname}${window.location.search}`;
  }} onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented && !root.current?.querySelector(":popover-open,dialog[open],[aria-expanded='true'][aria-haspopup]")) { event.preventDefault(); move(null); }
  }}>
    <header className="page-reader-top"><strong>{t.title}</strong><div className="page-reader-actions">
      {detail.mode === "panel" && <a className="reader-full-enhanced" hidden={!enhanced} href={href({ ...detail, mode: "full" })} onClick={event => move({ ...detail, mode: "full" }, event)}><span aria-hidden="true">↗</span> {t.fullReading}</a>}
      <a href={href(null)} onClick={event => move(null, event)}><span aria-hidden="true">{detail.mode === "full" ? "‹" : "×"}</span> {detail.mode === "full" ? t.returnToList : t.close}</a>
    </div></header>
    <div className="page-reader-scroll">{preferences}
      <div className="reader-title"><Title id="page-reader-title" tabIndex={-1}>{title}</Title>{metadata}</div>
      {issue && <p className="reader-issue" role="status">{issue}</p>}
      <form className="reader-reading-form" action="/" method="get">
        {navigationFields.map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
        {detail.mode === "full" && <input type="hidden" name="reading" value="full" />}
        {!snapshot && <input type="hidden" name="view" value={detail.view} />}
        {snapshot && <div className="reader-switch" role="group" aria-label={t.chooseView}>
          {(["memories", "body", "references"] as const).map(view => <input key={view} className={`reader-radio reader-radio-${view}`} id={`${id}-${view}`} type="radio" name="view" value={view} checked={detail.view === view} onClick={() => setHighlight(null)} onChange={() => select(view)} />)}
          <div className="reader-switch-band"><div className="reader-labels">{(["memories", "body", "references"] as const).map(view => <label key={view} htmlFor={`${id}-${view}`}>{t[view]}</label>)}</div></div>
          <section className="reader-view reader-memories" aria-label={t.memoryTitle}><div className="help-heading"><h3>{t.memoryTitle}</h3><ContextHelp locale={locale} label={t.originalLocation} title={t.originalLocationTitle}><p>{t.originalLocationHelp}</p></ContextHelp></div>
            {snapshot && (snapshot.memories.availability === "available" ? snapshot.memories.rows.map((memory, index) => <article key={memory.id} className="reader-memory" aria-label={`${t.memory} ${new Intl.NumberFormat(locale).format(index + 1)}`}>
              <span className="reader-kind">{memoryKindLabel(locale, memory.kind)}</span><p className="reader-claim">{memory.claim}</p>
              {enhanced && verifiedPageLocation(snapshot.body.sections, memory.location, memory.claim) && <button type="button" onClick={() => find(memory)}>{t.showInBody}</button>}
              <details className="reader-original"><summary>{t.originalFields}</summary><dl>{Object.entries({ kind: memory.kind, ...memory.fields }).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl></details>
            </article>) : <p>{snapshot.memories.availability === "empty" ? t.memoryEmpty : t.memoryUnknown}</p>)}
          </section>
          <section className="reader-view reader-body" aria-label={t.bodyTitle}><h3>{t.bodyTitle}</h3>
            {snapshot && <>{snapshot.body.availability !== "available" && <p className="reader-issue">{snapshot.body.availability === "partial" ? t.partial : snapshot.body.availability === "protected" ? t.protected : snapshot.body.availability === "failed" ? t.bodyFailed : t.bodyUnknown}</p>}
              {snapshot.body.sections.map(section => <article key={section.id} className="reader-body-section"><h4>{section.id === "compiled-truth" ? t.compiledTruth : section.id === "timeline" ? t.timeline : t.window}</h4><div className="reader-prose">{selected?.location.section === section.id ? <><SafeText text={section.text.slice(0, selected.location.start)} /><mark ref={passage} tabIndex={-1} className="reader-passage"><SafeText text={section.text.slice(selected.location.start, selected.location.end)} /></mark><SafeText text={section.text.slice(selected.location.end)} /></> : <SafeText text={section.text} />}</div></article>)}
              {snapshot.body.availability === "available" && snapshot.body.sections.every(section => !section.text) && <p>{t.bodyEmpty}</p>}</>}
          </section>
          <section className="reader-view reader-references" aria-label={t.referencesTitle}><div className="help-heading"><h3>{t.referencesTitle}</h3><span className="reader-reference-scope">{t.referenceScope}</span><ContextHelp locale={locale} label={t.rangeHelp} title={t.rangeTitle}><p>{t.rangeHelpText}</p></ContextHelp></div>
            {snapshot && <>{snapshot.backlinks.availability !== "available" && <p>{snapshot.backlinks.availability === "empty" ? t.referencesEmpty : snapshot.backlinks.availability === "partial" ? t.referencesPartial : snapshot.backlinks.availability === "failed" ? t.referencesFailed : t.referencesUnknown}</p>}
              <ul className="reader-reference-list">{snapshot.backlinks.pages.map(item => <li key={JSON.stringify([item.page.namespace, item.page.sourceId, item.page.slug])}><a href={href({ slug: item.page.slug, view: "memories", mode: detail.mode }, sourceReference({ namespace: item.page.namespace, id: item.page.sourceId }))} onClick={event => {
                if (detail.mode === "full") move({ slug: item.page.slug, view: "memories", mode: "full" }, event, sourceReference({ namespace: item.page.namespace, id: item.page.sourceId })); else open(item.page, event);
              }}>{item.page.title.trim() ? item.page.title : item.page.slug}<span aria-hidden="true"> →</span></a><span>{t.source} · {item.sourceName.trim() ? item.sourceName : item.page.sourceId}</span></li>)}</ul>
              {snapshot.backlinks.omitted > 0 && <p>{t.omitted}: {new Intl.NumberFormat(locale).format(snapshot.backlinks.omitted)}</p>}{snapshot.backlinks.truncated && <p>{t.truncated}</p>}</>}
          </section>
        </div>}
        <div hidden={enhanced} className="reader-native-actions"><button type="submit">{t.applyView}</button>{detail.mode === "panel" && <button type="submit" name="reading" value="full">↗ {t.fullReading}</button>}</div>
      </form>
    </div>
  </aside>;
}
