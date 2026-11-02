"use client";

import { useEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { sourceNavigationParameters, sourceReference, type Source } from "../contracts/sources";
import type { PageFilter } from "../contracts/pages";

const event = "observatory-source-navigation";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(event, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(event, listener); };
}
export function sourceRowId(source: Source) { return `source-${encodeURIComponent(sourceReference(source))}`; }
type ReturnContext = { focus: string; top: number; left: number };

/** Only navigation identity and position enter History; source content stays in React memory. */
export function useSourceNavigation(initialQuery: string) {
  const query = useSyncExternalStore(subscribe, () => window.location.search, () => initialQuery);
  const parameters = new URLSearchParams(query);
  const selections = parameters.getAll("source");
  const selected = selections.length === 0 ? null : selections.length === 1 ? selections[0] : "";
  const filters = parameters.getAll("added");
  const filter: PageFilter = filters.length === 1 && (filters[0] === "today" || filters[0] === "yesterday") ? filters[0] : "all";
  const expanded = sourceNavigationParameters(selected, parameters.getAll("expanded")).getAll("expanded");
  function href(value: string | null) {
    const next = new URLSearchParams(query);
    next.delete("source"); next.delete("expanded"); next.delete("added"); next.delete("page"); next.delete("view"); next.delete("reading");
    for (const [key, item] of sourceNavigationParameters(value, expanded, filter)) next.append(key, item);
    return `?${next}`;
  }
  const prior = useRef(selected);

  useEffect(() => {
    if (prior.current === selected) return;
    prior.current = selected;
    if (selected !== null) {
      document.getElementById("source-detail-title")?.focus();
    } else {
      const context = window.history.state?.sourceReturn as ReturnContext | undefined;
      const target = context?.focus ? document.getElementById(context.focus) : null;
      (target ?? document.getElementById("source-list-title"))?.focus({ preventScroll: true });
      if (context) {
        window.scrollTo(0, context.top);
        const table = document.querySelector(".table-scroll");
        if (table) table.scrollLeft = context.left;
      }
    }
  }, [selected]);

  function navigate(value: string | null, click: MouseEvent<HTMLAnchorElement>, focus?: string) {
    if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    click.preventDefault();
    const url = new URL(window.location.href);
    const sourceReturn: ReturnContext | undefined = selected === null ? {
      focus: focus ?? "source-list-title", top: window.scrollY,
      left: document.querySelector(".table-scroll")?.scrollLeft ?? 0,
    } : window.history.state?.sourceReturn;
    if (selected === null) window.history.replaceState({ sourceReturn }, "", window.location.href);
    url.search = href(value);
    window.history.pushState({ sourceReturn }, "", url);
    window.dispatchEvent(new Event(event));
  }
  function toggle(value: string) {
    const url = new URL(window.location.href);
    const next = expanded.includes(value) ? expanded.filter(item => item !== value) : [...expanded, value];
    url.searchParams.delete("expanded");
    for (const item of sourceNavigationParameters(selected, next).getAll("expanded")) url.searchParams.append("expanded", item);
    window.history.replaceState({ ...window.history.state, sourceReturn: window.history.state?.sourceReturn }, "", url);
    window.dispatchEvent(new Event(event));
  }
  function setFilter(value: "all" | "today" | "yesterday") {
    const url = new URL(window.location.href);
    url.searchParams.delete("added");
    if (value !== "all") url.searchParams.set("added", value);
    window.history.pushState({ ...window.history.state, sourceReturn: window.history.state?.sourceReturn }, "", url);
    window.dispatchEvent(new Event(event));
  }
  return { selected, expanded, navigate, toggle, href, filter, setFilter };
}
