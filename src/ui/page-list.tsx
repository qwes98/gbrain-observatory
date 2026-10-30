"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { pageReference, type PageFieldAvailability, type PageFilter, type PageListResult } from "../contracts/pages";
import { pageMessages, formatResultCount, type Locale } from "../i18n/messages";
import { calendarDay, formatInstant, matchesCalendarFilter } from "../i18n/time-zone";
import { useTimeZone } from "./time-zone-provider";
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
      <button ref={trigger} type="button" aria-label={`${t.filter}: ${t[filter]}`} aria-haspopup="listbox" aria-expanded={open} aria-controls="page-added-options" onClick={() => setOpen(value => !value)}>{t.filter}: {t[filter]} <span aria-hidden="true">▾</span></button>
      {open && <div id="page-added-options" className="page-filter-options" role="listbox" aria-label={t.filterOptions}>{options.map(value => <button type="button" role="option" aria-selected={filter === value} key={value} onClick={() => { setFilter(filter === value ? "all" : value); close(true); }}>{t[value]}</button>)}</div>}
    </div>
  </div>;
}

export function PageList({ source, seed, endpoint, authority, filter, setFilter, query, locale, loadPages }: {
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
  const { state, snapshot, refresh, more } = usePageList(source, seed, endpoint, authority, condition, loadPages);
  const [hadMore, setHadMore] = useState(false);
  if (snapshot?.range === "more" && !hadMore) setHadMore(true);
  const rows = snapshot?.pages.filter(page => matchesCalendarFilter(page.createdAt, filter, zone, now)) ?? [];
  const canRead = !!endpoint || !!loadPages;
  const issue = state.kind === "failure" ? state.reason === "busy" ? t.busy : t.failure
    : state.kind === "denied" || state.kind === "unavailable" ? t.unavailable
    : state.kind === "unknown" ? t.unsupported : state.kind === "unconfigured" ? t.unconfigured : null;
  return <section className="page-list" aria-labelledby="pages-title" aria-busy={state.kind === "loading"}>
    <h3 id="pages-title">{t.title}</h3>
    <div className="pages-toolbar"><AddedFilter locale={locale} filter={filter} setFilter={setFilter} query={query} />
      {canRead && <form action="/" method="get" onSubmit={event => { if (enhanced) { event.preventDefault(); refresh(); } }}>
        {[...new URLSearchParams(query)].filter(([key]) => key === "source" || key === "expanded" || key === "added").map(([key, value], index) => <input type="hidden" key={`${key}-${index}`} name={key} value={value} />)}
        <button type="submit" aria-disabled={state.kind === "loading"}>{t.refresh}</button>
      </form>}
    </div>
    <div role="status" aria-live="polite" aria-atomic="true" className="page-status">
      {state.kind === "loading" && <p>{t.loading}</p>}{issue && <p>{issue}</p>}
      {snapshot && state.kind !== "success" && <p>{t.previous}</p>}
      {state.kind === "success" && <p className="sr-only">{t.complete} {t.matching}: {formatResultCount(locale, rows.length)} · {t.loaded}: {formatResultCount(locale, snapshot?.pages.length ?? 0)}</p>}
      {snapshot && rows.length === 0 && <p>{t.empty}</p>}{state.kind === "idle" && !snapshot && <p>{t.pending}</p>}
    </div>
    {snapshot && <><div className="table-board"><div className="table-scroll" role="region" aria-label={t.caption} tabIndex={0}>
      <table><caption className="sr-only">{t.caption}</caption><thead><tr><th scope="col">{t.titleColumn}</th><th scope="col">{t.kind}</th><th scope="col">{t.added}</th><th scope="col">{t.changed}</th></tr></thead>
        <tbody>{rows.map(page => <tr key={pageReference(page)}><th scope="row">{page.title.trim() ? page.title : page.slug}<small className="page-slug">{page.slug}</small>
          {page.detailObservation && <details className="page-observation"><summary>{t.detailObservation}</summary><Interval value={page.detailObservation} locale={locale} /></details>}</th>
          <td>{page.kind}</td><td><PageTime value={page.createdAt} availability={page.creationAvailability} locale={locale} /></td><td><PageTime value={page.updatedAt} availability={page.modificationAvailability} locale={locale} /></td></tr>)}</tbody>
      </table></div><div className="table-footer"><span>{t.matching}: {formatResultCount(locale, rows.length)} · {t.loaded}: {formatResultCount(locale, snapshot.pages.length)}</span><span>{zone}</span></div></div>
      <p className="scope-note">{t.listObservation}: <Interval value={snapshot.listObservation} locale={locale} /></p>
      <p className="scope-note">{t.observation}: <Interval value={snapshot.observation} locale={locale} /></p>
      <p className="scope-note">{snapshot.range === "cap" ? t.cap : snapshot.range === "observed-end" ? t.end : t.range}</p>
      {hadMore && canRead && enhanced && <button className="page-more" type="button" aria-disabled={state.kind === "loading" || snapshot.range !== "more"} onClick={more}>{t.more}</button>}
    </>}
    <p className="scope-note">{t.meaning}</p><p className="scope-note">{t.coverage}</p><p className="scope-note">{t.offsets}</p>
  </section>;
}
