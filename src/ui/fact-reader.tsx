"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { FactEvidence, FactLinkAvailability, FactPageLink } from "../contracts/facts";
import type { Page } from "../contracts/pages";
import { verifiedPageLocation } from "../contracts/page-detail";
import { factMessages, sourceMessages, memoryKindLabel, type Locale } from "../i18n/messages";
import { ContextHelp } from "./context-help";
import { FactTime } from "./fact-list";
import type { FactDetailState } from "./use-facts";

export interface FactReading { id: string; mode: "panel" | "full" }
export interface FactPresentation { bodyOpen: boolean; highlight: boolean }
const subscribeHydration = () => () => {};
function fieldLabel(locale: Locale, availability: FactLinkAvailability | FactEvidence["availability"]) {
  const t = factMessages[locale];
  return availability === "missing" ? t.missing : availability === "denied" ? t.fieldDenied : availability === "failed" ? t.failed : availability === "invalid" ? t.invalid : availability === "mismatch" ? t.mismatch : availability === "partial" ? t.partialProvenance : availability === "protected" ? t.protected : t.fieldUnknown;
}
function PageLink({ value, locale, pageHref, openPage }: { value: FactPageLink; locale: Locale; pageHref?: (page: Page) => string; openPage?: (page: Page, event?: MouseEvent<HTMLAnchorElement>) => void }) {
  return value.availability === "available" && value.page ? pageHref ? <a href={pageHref(value.page)} onClick={event => openPage?.(value.page!, event)}>{value.page.title.trim() ? value.page.title : value.page.slug}<span aria-hidden="true"> →</span></a> : <span>{value.page.title.trim() ? value.page.title : value.page.slug}</span> : <span>{fieldLabel(locale, value.availability)}</span>;
}
export function FactReader({ state, detail, locale, href, move, pageHref, openPage, sourceHref, sourceOpen, preferences, initialPresentation, onPresentationChange, sourceRecovery }: {
  state: FactDetailState; detail: FactReading; locale: Locale; query: string;
  href: (next: FactReading | null) => string; move: (next: FactReading | null, event?: MouseEvent<HTMLAnchorElement>) => void;
  pageHref?: (page: Page) => string; openPage?: (page: Page, event?: MouseEvent<HTMLAnchorElement>) => void; sourceHref?: string; sourceOpen?: (event: MouseEvent<HTMLAnchorElement>) => void; preferences?: ReactNode; sourceRecovery?: ReactNode; initialPresentation?: FactPresentation; onPresentationChange?: (value: FactPresentation) => void;
}) {
  const t = factMessages[locale], root = useRef<HTMLElement>(null), passage = useRef<HTMLElement>(null);
  const enhanced = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [bodyOpen, setBodyOpen] = useState(initialPresentation?.bodyOpen === true), [highlight, setHighlight] = useState(initialPresentation?.bodyOpen === true && initialPresentation?.highlight === true);
  const [presentationRestored, setPresentationRestored] = useState(initialPresentation !== undefined);
  if (!presentationRestored && initialPresentation) {
    setPresentationRestored(true);
    setBodyOpen(initialPresentation.bodyOpen);
    setHighlight(initialPresentation.bodyOpen && initialPresentation.highlight);
  }
  const [findActivation, setFindActivation] = useState(0);
  const snapshot = state.kind === "success" ? state.snapshot : undefined;
  const evidence = snapshot?.evidence;
  const verified = !!evidence && evidence.availability === "available" && !!evidence.quote && !!evidence.location && evidence.body.availability === "available" && verifiedPageLocation(evidence.body.sections, evidence.location, evidence.quote);
  useEffect(() => { document.getElementById("fact-reader-title")?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (findActivation > 0 && highlight && bodyOpen && verified) { passage.current?.focus(); passage.current?.scrollIntoView({ block: "center" }); } }, [findActivation, highlight, bodyOpen, verified]);
  const Title = detail.mode === "full" ? "h1" : "h2";
  const sourceText = sourceMessages[locale];
  const sourceIssue = state.kind === "source-pending" ? state.cause.kind === "loading" ? sourceText.loading : state.cause.kind === "failure" ? state.cause.reason === "busy" ? sourceText.busySources : sourceText.issues.failure.reason : state.cause.kind === "unknown" ? state.cause.reason === "unsupported" ? sourceText.unsupported : sourceText.issues.unknown.reason : sourceText.issues.unconfigured.reason : null;
  const issue = state.kind === "source-pending" ? sourceIssue : state.kind === "loading" ? t.detailLoading : state.kind === "failure" ? state.reason === "busy" ? t.busy : t.failure : state.kind !== "success" ? t[state.kind] : null;
  return <aside ref={root} className={`page-reader page-reader-${detail.mode} fact-reader`} aria-labelledby="fact-reader-title" aria-busy={state.kind === "loading" || state.kind === "source-pending" && state.cause.kind === "loading"} onSubmitCapture={event => {
    const input = (event.target as HTMLFormElement).querySelector<HTMLInputElement>('input[name="sourceReturn"]');
    if (input) input.value = `${window.location.pathname}${window.location.search}`;
  }} onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented && !root.current?.querySelector(":popover-open,dialog[open],[aria-expanded='true'][aria-haspopup]")) { event.preventDefault(); move(null); }
  }}>
    <header className="page-reader-top"><strong>{t.detailTitle}</strong><div className="page-reader-actions">
      {detail.mode === "panel" && <a href={href({ ...detail, mode: "full" })} onClick={event => move({ ...detail, mode: "full" }, event)}><span aria-hidden="true">↗</span> {t.fullReading}</a>}
      <a href={href(null)} onClick={event => move(null, event)}><span aria-hidden="true">{detail.mode === "full" ? "‹" : "×"}</span> {detail.mode === "full" ? t.returnToList : t.close}</a>
    </div></header>
    <div className="page-reader-scroll">{preferences}
      <div className="reader-title"><Title id="fact-reader-title" tabIndex={-1}>{t.heading}</Title>
        {snapshot && <dl className="reader-metadata">
          <div><dt>{t.source}</dt><dd><a href={sourceHref ?? href(null)} onClick={sourceOpen ?? (event => move(null, event))}>{snapshot.sourceName.trim() ? snapshot.sourceName : snapshot.fact.sourceId}<span aria-hidden="true"> →</span></a></dd></div>
          <div><dt>{t.contextPage}</dt><dd><PageLink value={snapshot.contextPage} locale={locale} pageHref={pageHref} openPage={openPage} /></dd></div>
          <div><dt>{t.storedPage}</dt><dd><PageLink value={snapshot.storedPage} locale={locale} pageHref={pageHref} openPage={openPage} /></dd></div>
          <div><dt>{t.recordedAt}</dt><dd><FactTime value={snapshot.fact.createdAt} availability={snapshot.fact.creationAvailability} locale={locale} /></dd></div>
          <div><dt>{t.recorder}</dt><dd>{snapshot.fact.recordedBy ?? (snapshot.fact.recorderAvailability === "invalid" ? t.invalid : snapshot.fact.recorderAvailability === "null" ? t.nullValue : t.notProvided)}</dd></div>
        </dl>}
      </div>
      {issue && <p role="status" className="reader-issue">{issue}</p>}
      {state.kind === "source-pending" && sourceRecovery && <div className="reader-native-actions" style={{ gridColumn: 1 }}>{sourceRecovery}</div>}
      {snapshot && <div className="fact-reading-content">
        <article className="fact-memory"><span className="reader-kind">{memoryKindLabel(locale, snapshot.fact.kind)}</span><p className="reader-claim">{snapshot.fact.content}</p>
          {verified && evidence && <div className="fact-evidence"><div className="help-heading"><h3>{t.pageQuote}</h3><ContextHelp locale={locale} label={t.evidenceHelp} title={t.evidenceTitle}><p>{t.evidenceHelpText}</p></ContextHelp></div><blockquote>{evidence.quote}</blockquote>
            {enhanced && <button id="fact-find-body" type="button" aria-expanded={bodyOpen} aria-controls="fact-source-body" onClick={() => { setBodyOpen(true); setHighlight(true); setFindActivation(value => value + 1); onPresentationChange?.({ bodyOpen: true, highlight: true }); }}>{t.showInBody}</button>}
          </div>}
          {!verified && evidence && <p className="fact-provenance-status" role="status">{evidence.availability === "missing" && `${t.pageQuote}: `}{fieldLabel(locale, evidence.availability === "available" ? "mismatch" : evidence.availability)}</p>}
        </article>
        {evidence && evidence.page && <div className="fact-original-page"><span>{t.originalPage}: </span><PageLink value={{ availability: "available", page: evidence.page }} locale={locale} pageHref={pageHref} openPage={openPage} /></div>}
        {evidence?.page && <details id="fact-source-body" className="fact-source-body" open={bodyOpen} onToggle={event => { const open = event.currentTarget.open; setBodyOpen(open); if (!open) setHighlight(false); onPresentationChange?.({ bodyOpen: open, highlight: open && highlight }); }}>
          <summary>{bodyOpen ? t.hideBody : t.showBody}</summary><h3>{t.body}</h3>
          {evidence.body.availability !== "available" && <p className="reader-issue">{evidence.body.availability === "protected" ? t.protected : evidence.body.availability === "partial" ? t.partialBody : evidence.body.availability === "failed" ? t.failed : t.bodyUnknown}</p>}
          {evidence.body.sections.map(section => <div className="reader-prose" key={section.id}>{verified && highlight && evidence.location?.section === section.id ? <>{section.text.slice(0, evidence.location.start)}<mark id="fact-verified-passage" ref={passage} className="reader-passage" tabIndex={-1}>{section.text.slice(evidence.location.start, evidence.location.end)}</mark>{section.text.slice(evidence.location.end)}</> : section.text}</div>)}
        </details>}
        <details className="reader-original"><summary>{t.originalFields}</summary><dl>
          <div><dt>{t.publicId}</dt><dd>{snapshot.fact.id}</dd></div><div><dt>kind</dt><dd>{snapshot.fact.kind}</dd></div>
          <div><dt>source</dt><dd>{snapshot.fact.sourceDescription ?? t.notProvided}</dd></div><div><dt>provenance</dt><dd>{snapshot.fact.provenance ?? t.notProvided}</dd></div>
          <div><dt>{t.originalContext}</dt><dd>{snapshot.fact.contextAvailability === "available" ? snapshot.fact.context ?? t.invalid : snapshot.fact.contextAvailability === "null" ? t.nullValue : snapshot.fact.contextAvailability === "invalid" ? t.invalid : t.notProvided}</dd></div>
        </dl></details>
      </div>}
    </div>
  </aside>;
}
