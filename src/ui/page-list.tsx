"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { pageReference, type Page, type PageFieldAvailability, type PageFilter, type PageListResult } from "../contracts/pages";
import { pageMessages, formatResultCount, type Locale } from "../i18n/messages";
import { calendarDay, formatInstant, matchesCalendarFilter } from "../i18n/time-zone";
import { useTimeZone } from "./time-zone-provider";
import { boundedPageSlug } from "../contracts/sources";
import { pageRowId } from "./use-page-navigation";
import { ContextHelp } from "./context-help";
import { usePageList, type PageLoader } from "./use-page-list";

const subscribeHydration = () => () => {};
const filterOptions = ["all", "today", "yesterday"] as const;
function createCalendarClock(initialNow: string) {
  let now = initialNow;
  return { get: () => now, server: () => initialNow, subscribe: (notify: () => void) => {
    function tick() { const next = new Date().toISOString(); if (next !== now) { now = next; notify(); } }
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick); window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", tick); tick();
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); window.removeEventListener("pageshow", tick); document.removeEventListener("visibilitychange", tick); };
  } };
}
function PageTime({ value, availability, locale }: { value: string | null; availability: PageFieldAvailability; locale: Locale }) {
  const zone = useTimeZone();
  const t = pageMessages[locale];
  const formatted = value ? formatInstant(value, locale, zone) : null;
  if (formatted && value) return <time dateTime={value} title={`${formatted.text} · ${zone} · ${formatted.offset}`}>{formatted.text} · {formatted.offset}</time>;
  const labels = { available: t.invalid, missing: t.unknown, invalid: t.invalid, partial: t.partial, failed: t.failed, unsupported: t.unsupportedTime };
  return <span className="muted">{labels[availability]}</span>;
}
function Interval({ value, locale }: { value: { startedAt: string; completedAt: string }; locale: Locale }) {
  return <><PageTime value={value.startedAt} availability="available" locale={locale} /> – <PageTime value={value.completedAt} availability="available" locale={locale} /></>;
}

function AddedFilter({ locale, filter, setFilter, query }: { locale: Locale; filter: PageFilter; setFilter: (value: PageFilter) => void; query: string }) {
  const t = pageMessages[locale];
  const enhanced = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = filterOptions;
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !popover.current) return;
      const bounds = trigger.current.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) { setOpen(false); return; }
      const width = popover.current.getBoundingClientRect().width;
      const below = Math.max(0, window.innerHeight - bounds.bottom - 12);
      const above = Math.max(0, bounds.top - 12);
      const upward = below < popover.current.scrollHeight && above > below;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: upward ? undefined : bounds.bottom + 4,
        bottom: upward ? window.innerHeight - bounds.top + 4 : undefined,
        maxHeight: Math.max(44, upward ? above : below),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  function close(focus: boolean) { setOpen(false); if (focus) trigger.current?.focus(); }
  function focusOption(index: number) { root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus(); }
  useEffect(() => {
    if (!open) return;
    focusOption(options.indexOf(filter));
    function outside(event: PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, filter, options]);
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    if (event.key === "Tab") { close(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const nodes = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = nodes.findIndex(node => node === document.activeElement);
    focusOption(event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowUp" ? 2 : 1)) % 3);
  }
  return <div className="page-filter" ref={root} onKeyDown={keydown}>
    <form hidden={enhanced} action="/" method="get">
      {[...new URLSearchParams(query)].filter(([key]) => key === "source" || key === "expanded").map(([key, value], index) => <input type="hidden" key={`${key}-${index}`} name={key} value={value} />)}
      <label htmlFor="page-added-filter">{t.filter}</label><select id="page-added-filter" name="added" defaultValue={filter} key={filter}>{options.map(value => <option key={value} value={value}>{t[value]}</option>)}</select>
      <button type="submit">{t.apply}</button>
    </form>
    <div hidden={!enhanced}>
      <button className="page-filter-trigger" data-selected={filter !== "all"} ref={trigger} type="button" aria-label={`${t.filter}: ${t[filter]}`} aria-haspopup="listbox" aria-expanded={open} aria-controls="page-added-options" onClick={() => setOpen(value => !value)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg><span>{t.filter}</span>{" "}{filter !== "all" && <span className="page-filter-value">{t[filter]}</span>}</button>
      {open && <div ref={popover} style={position} id="page-added-options" className="page-filter-options" role="listbox" aria-label={t.filterOptions}><div className="page-filter-title" aria-hidden="true">{t.filter}</div>{options.map(value => <button type="button" role="option" aria-selected={filter === value} key={value} onClick={() => { setFilter(filter === value ? "all" : value); close(true); }}><span>{t[value]}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></button>)}</div>}
    </div>
  </div>;
}

export function PageList({ source, seed, endpoint, authority, filter, setFilter, query, locale, loadPages, selectedPage, pageHref, openPage, onAccessLost, deniedPage, deferInitial = false }: {
  deferInitial?: boolean; deniedPage?: { slug: string; token: object; intent: number }; selectedPage?: string | null; pageHref?: (page: Page) => string; openPage?: (page: Page, event?: MouseEvent<HTMLAnchorElement>) => void; onAccessLost?: () => void;
  source: string; seed?: PageListResult; endpoint?: string; authority: object; filter: PageFilter;
  setFilter: (filter: PageFilter) => void; query: string; locale: Locale; loadPages?: PageLoader;
}) {
  const t = pageMessages[locale];
  const zone = useTimeZone();
  const enhanced = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [mountedAt] = useState(() => new Date().toISOString());
  const initialNow = seed?.kind === "success" ? seed.snapshot.observation.completedAt : mountedAt;
  const clock = useMemo(() => createCalendarClock(initialNow), [initialNow]);
  const now = useSyncExternalStore(clock.subscribe, clock.get, clock.server);
  const condition = `${filter}|${zone}|${calendarDay(now, zone) ?? ""}`;
  const { state, snapshot, acquisition, issuedSequence, refresh, more } = usePageList(source, seed, endpoint, authority, condition, loadPages, deferInitial);
  useEffect(() => { if (["denied", "unavailable", "unconfigured"].includes(state.kind)) onAccessLost?.(); }, [state.kind, onAccessLost]);
  const [hadMore, setHadMore] = useState(false);
  if (snapshot?.range === "more" && !hadMore) setHadMore(true);
  const [restrictions, setRestrictions] = useState<{ acquisition: typeof acquisition; rows: { slug: string; afterGeneration: number }[]; token?: object; intent?: number }>({ acquisition, rows: [] });
  let currentRestrictions = restrictions;
  if (acquisition !== restrictions.acquisition && state.kind === "success") {
    // Returned identity and a post-restriction request are both required. Carried append rows,
    // old in-flight replies and server seeds without initiation proof cannot restore access.
    const returned = new Set(acquisition?.references);
    const generation = acquisition?.generation;
    currentRestrictions = { ...restrictions, acquisition, rows: restrictions.rows.filter(row => generation == null || generation <= row.afterGeneration || !snapshot?.pages.some(page => page.slug === row.slug && returned.has(pageReference(page)))) }; setRestrictions(currentRestrictions);
  }
  if (deniedPage && (currentRestrictions.token !== deniedPage.token || currentRestrictions.intent !== deniedPage.intent)) {
    currentRestrictions = { ...currentRestrictions, token: deniedPage.token, intent: deniedPage.intent, rows: [...currentRestrictions.rows.filter(row => row.slug !== deniedPage.slug), { slug: deniedPage.slug, afterGeneration: issuedSequence }] };
    setRestrictions(currentRestrictions);
  }
  const rows = snapshot?.pages.filter(page => !currentRestrictions.rows.some(row => row.slug === page.slug) && matchesCalendarFilter(page.createdAt, filter, zone, now)) ?? [];
  const excludesUnknownDates = filter !== "all" && snapshot?.pages.some(page => !page.createdAt || calendarDay(page.createdAt, zone) === null);
  const canRead = !!endpoint || !!loadPages;
  const issue = state.kind === "failure" ? state.reason === "busy" ? t.busy : t.failure
    : state.kind === "denied" || state.kind === "unavailable" ? t.unavailable
    : state.kind === "unknown" ? t.unsupported : state.kind === "unconfigured" ? t.unconfigured : null;
  return <section className="page-list" aria-labelledby="pages-title" aria-busy={state.kind === "loading"}>
    <div className="page-board">
    <div className="pages-toolbar"><h2 id="pages-title" tabIndex={-1}>{t.title}</h2><AddedFilter locale={locale} filter={filter} setFilter={setFilter} query={query} /><ContextHelp locale={locale} label={t.dateHelp} title={t.added}><p>{t.meaning}</p><p>{t.coverage}</p><p>{t.offsets}</p></ContextHelp>
      {canRead && <form className="page-refresh" action="/" method="get" onSubmit={event => { if (enhanced) { event.preventDefault(); refresh(); } }}>
        {[...new URLSearchParams(query)].filter(([key]) => key === "source" || key === "expanded" || key === "added" || key === "page" || key === "view" || key === "reading").map(([key, value], index) => <input type="hidden" key={`${key}-${index}`} name={key} value={value} />)}
        <button type="submit" aria-disabled={state.kind === "loading" || (deferInitial && !snapshot)}>{t.refresh}</button>
      </form>}
    </div>
    <div role="status" aria-live="polite" aria-atomic="true" className="page-status">
      {state.kind === "loading" && <p>{t.loading}</p>}{issue && <p>{issue}</p>}
      {snapshot && state.kind !== "success" && <p>{t.previous}</p>}
      {state.kind === "success" && <p className="sr-only">{t.complete} {filter !== "all" && <>{t.matching}: {formatResultCount(locale, rows.length)} · </>}{t.loaded}: {formatResultCount(locale, snapshot?.pages.length ?? 0)}</p>}
      {snapshot && rows.length === 0 && <p className="sr-only">{t.empty}</p>}{state.kind === "idle" && !snapshot && <p>{t.pending}</p>}
    </div>
    {snapshot && <div className="page-table"><div className="table-scroll" role="region" aria-label={t.caption} tabIndex={0}>
      <table><colgroup><col /><col className="page-kind-column" /><col className="page-time-column" /><col className="page-time-column" /></colgroup><caption className="sr-only">{t.caption}</caption><thead><tr><th scope="col">{t.titleColumn}</th><th scope="col">{t.kind}</th><th scope="col" aria-label={t.added}>{t.added}</th><th scope="col">{t.changed}</th></tr></thead>
        <tbody>{rows.map(page => <tr key={pageReference(page)} className={selectedPage === page.slug ? "page-row-selected" : undefined} onClick={event => {
          if (!openPage || !boundedPageSlug(page.slug) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || window.getSelection()?.toString()) return;
          if ((event.target as Element).closest("a,button,input,select,textarea,summary,details,label")) return;
          openPage(page);
        }}><th scope="row">{pageHref && boundedPageSlug(page.slug) ? <a id={pageRowId(page)} href={pageHref(page)} onClick={event => openPage?.(page, event)}>{page.title.trim() ? page.title : page.slug}</a> : page.title.trim() ? page.title : page.slug}
          {rows.filter(candidate => (candidate.title.trim() ? candidate.title : candidate.slug) === (page.title.trim() ? page.title : page.slug)).length > 1 && <small className="page-slug">{page.slug}</small>}
          <details className="page-observation"><summary aria-label={`${t.pageInformation}: ${page.title.trim() ? page.title : page.slug} · ${page.slug}`}>{t.pageInformation}</summary><small className="page-slug">{page.slug}</small>{page.detailObservation && <><span>{t.detailObservation}</span><Interval value={page.detailObservation} locale={locale} /></>}</details></th>
          <td>{page.kind}</td><td><PageTime value={page.createdAt} availability={page.creationAvailability} locale={locale} /></td><td><PageTime value={page.updatedAt} availability={page.modificationAvailability} locale={locale} /></td></tr>)}</tbody>
      </table></div>{rows.length === 0 && <p className="page-empty">{t.empty}</p>}<div className="table-footer"><div className="context-value"><span>{filter !== "all" && <>{t.matching}: {formatResultCount(locale, rows.length)} · </>}{t.loaded}: {formatResultCount(locale, snapshot.pages.length)}</span><ContextHelp locale={locale} label={t.rangeHelp} title={t.rangeTitle}>
        <p>{t.coverage}</p><p>{t.offsets}</p>
        <p>{t.listObservation}: <Interval value={snapshot.listObservation} locale={locale} /></p>
        <p>{t.observation}: <Interval value={snapshot.observation} locale={locale} /></p>
      </ContextHelp></div><span>{zone}</span></div></div>}
    </div>
    {snapshot && <>
      {excludesUnknownDates && <p className="scope-note">{t.unknownDatesExcluded}</p>}
      <p className="scope-note">{snapshot.range === "cap" ? t.cap : snapshot.range === "observed-end" ? t.end : t.range}</p>
      {hadMore && canRead && enhanced && <button className="page-more" type="button" aria-disabled={state.kind === "loading" || snapshot.range !== "more"} onClick={more}>{t.more}</button>}
    </>}

  </section>;
}
