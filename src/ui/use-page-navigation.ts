"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { pageReference, type Page } from "../contracts/pages";
import { parsePageNavigation, sourceNavigationPath, type PageNavigation } from "../contracts/sources";

const changed = "observatory-source-navigation";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(changed, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(changed, listener); };
}
export function pageRowId(page: Pick<Page, "namespace" | "sourceId" | "slug">) { return `page-${encodeURIComponent(pageReference(page))}`; }
function ordinary(event: MouseEvent) { return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey; }
interface Position { top: number; left: number; focus: string }
function position(): Position {
  return { top: window.scrollY, left: document.querySelector(".page-list .table-scroll")?.scrollLeft ?? 0,
    focus: document.activeElement instanceof HTMLElement ? document.activeElement.id : "" };
}

/** History carries positions and focus only; URL carries bounded identity and reading mode. */
export function usePageNavigation(initialQuery: string, selected: string | null, expanded: string[], filter: string) {
  const query = useSyncExternalStore(subscribe, () => window.location.search, () => initialQuery);
  const detail = parsePageNavigation(new URLSearchParams(query));
  const [intent, setIntent] = useState(0);
  const prior = useRef<string | null>(detail ? `${selected}|${detail.slug}|${detail.mode}` : null);
  const [lastSelection, setLastSelection] = useState<{source: string; slug: string} | null>(detail && selected ? { source: selected, slug: detail.slug } : null);
  const detailKey = detail ? `${selected}|${detail.slug}|${detail.mode}` : null;
  useEffect(() => {
    if (prior.current === detailKey) return;
    const previous = prior.current; prior.current = detailKey;
    if (detailKey) {
      const frame = requestAnimationFrame(() => {
        const context = window.history.state?.pageReader as Position | undefined;
        const reader = document.querySelector<HTMLElement>(".page-reader-scroll");
        if (context) { if (document.querySelector(".page-reader-full")) window.scrollTo(0, context.top); else if (reader) reader.scrollTop = context.top; }
        const target = context?.focus ? document.getElementById(context.focus) : null;
        (target?.closest(".page-reader") ? target : document.getElementById("page-reader-title"))?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (previous) {
      const frame = requestAnimationFrame(() => {
        const context = window.history.state?.pageReturn as Position | undefined;
        const candidate = context?.focus ? document.getElementById(context.focus) : null;
        const target = candidate?.getClientRects().length && !candidate.closest("[inert],[hidden]") ? candidate :
          document.querySelector<HTMLElement>(".page-filter-trigger") ?? document.getElementById("pages-title") ?? document.getElementById("source-detail-title");
        target?.focus({ preventScroll: true });
        if (context) { window.scrollTo(0, context.top); const table = document.querySelector(".page-list .table-scroll"); if (table) table.scrollLeft = context.left; }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [detailKey]);
  function href(next: PageNavigation | null, source = selected) { return sourceNavigationPath(source, expanded, filter, next); }
  function move(next: PageNavigation | null, event?: MouseEvent<HTMLAnchorElement>, source = selected, focus?: string) {
    if (event && !ordinary(event)) return;
    event?.preventDefault();
    const historyState = window.history.state ?? {};
    const pageReturn = !detail ? { ...position(), focus: focus ?? position().focus } : historyState.pageReturn;
    const reader = document.querySelector<HTMLElement>(".page-reader-scroll");
    const pageReader = detail ? { top: detail.mode === "full" ? window.scrollY : reader?.scrollTop ?? 0, left: 0, focus: document.activeElement instanceof HTMLElement ? document.activeElement.id : "" } : undefined;
    window.history.replaceState({ ...historyState, pageReturn, ...(pageReader ? { pageReader } : {}) }, "", window.location.href);
    window.history.pushState({ sourceReturn: historyState.sourceReturn, pageReturn }, "", href(next, source));
    window.dispatchEvent(new Event(changed));
  }
  function open(page: Page, event?: MouseEvent<HTMLAnchorElement>) {
    if (event && !ordinary(event)) return;
    setIntent(value => value + 1);
    setLastSelection({ source: JSON.stringify([page.namespace, page.sourceId]), slug: page.slug });
    move({ slug: page.slug, view: "memories", mode: "panel" }, event, JSON.stringify([page.namespace, page.sourceId]), pageRowId(page));
  }
  function closeInvalid() {
    const state = window.history.state ?? {};
    const pageReturn = state.pageReturn ? { ...state.pageReturn, focus: "" } : undefined;
    window.history.replaceState({ ...state, pageReturn }, "", href(null));
    window.dispatchEvent(new Event(changed));
  }
  function setView(view: PageNavigation["view"]) {
    if (!detail) return;
    const url = href({ ...detail, view });
    window.history.replaceState(window.history.state, "", url); window.dispatchEvent(new Event(changed));
  }
  return { query, detail, intent, href, open, move, closeInvalid, setView, lastSelection };
}
