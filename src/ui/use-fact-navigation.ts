"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { captureParentPage, restoreParentPage, type ParentPagePosition } from "./use-page-navigation";
import type { FactPresentation } from "./fact-reader";
import type { Fact } from "../contracts/facts";
import { factReference } from "../contracts/facts";
import { parseFactNavigation, parsePageNavigation, sourceNavigationPath } from "../contracts/sources";

const changed = "observatory-source-navigation";
const subscribeHydration = () => () => {};
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(changed, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(changed, listener); };
}
type Detail = { id: string; mode: "panel" | "full" };
interface Position { top: number; left: number; focus: string }
function ordinary(event: MouseEvent) { return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey; }
export function factRowId(fact: Pick<Fact, "namespace" | "sourceId" | "id">) { return `fact-${encodeURIComponent(factReference(fact))}`; }

/** History stores positions, never fact contents, original passages or offsets. */
export function useFactNavigation(initialQuery: string, selected: string | null, expanded: string[], filter: string) {
  const query = useSyncExternalStore(subscribe, () => window.location.search, () => initialQuery);
  const parameters = new URLSearchParams(query), navigation = parseFactNavigation(parameters);
  const detail: Detail | null = navigation.id ? { id: navigation.id, mode: navigation.mode } : null;
  const parent = useMemo(() => parsePageNavigation(new URLSearchParams(query)), [query]);
  const [intent, setIntent] = useState(0);
  const [lastSelection, setLastSelection] = useState<{ source: string; id: string } | null>(detail && selected ? { source: selected, id: detail.id } : null);
  const presentationKey = detail ? JSON.stringify([selected, detail.id]) : null;
  // The server and first hydration render cannot observe browser History.
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const recordedPresentation = hydrated ? window.history.state?.factPresentation : undefined;
  const presentation: FactPresentation | undefined = recordedPresentation?.key === presentationKey && typeof recordedPresentation.bodyOpen === "boolean" && typeof recordedPresentation.highlight === "boolean" ? { bodyOpen: recordedPresentation.bodyOpen, highlight: recordedPresentation.highlight } : undefined;
  function setPresentation(value: FactPresentation) {
    if (!presentationKey) return;
    window.history.replaceState({ ...window.history.state, factPresentation: { key: presentationKey, bodyOpen: value.bodyOpen === true, highlight: value.bodyOpen === true && value.highlight === true } }, "", window.location.href);
  }
  useEffect(() => {
    function remember(event: FocusEvent) {
      if (!(event.target instanceof HTMLElement) || !event.target.id || !event.target.closest(".fact-reader .page-reader-scroll")) return;
      const root = event.target.closest<HTMLElement>(".fact-reader");
      if (root) root.dataset.readerFocus = event.target.id;
    }
    document.addEventListener("focusin", remember); return () => document.removeEventListener("focusin", remember);
  }, []);
  const key = detail ? JSON.stringify([selected, detail.id, detail.mode]) : null;
  const prior = useRef(key);
  useEffect(() => {
    if (prior.current === key) return;
    const previous = prior.current; prior.current = key;
    const frame = requestAnimationFrame(() => {
      if (key) {
        const context = window.history.state?.factReader as Position | undefined;
        const reader = document.querySelector<HTMLElement>(".fact-reader .page-reader-scroll");
        if (context) { if (document.querySelector(".fact-reader.page-reader-full")) window.scrollTo(0, context.top); else if (reader) reader.scrollTop = context.top; }
        const candidate = context?.focus ? document.getElementById(context.focus) : null;
        (candidate?.closest(".fact-reader") ? candidate : document.getElementById("fact-reader-title"))?.focus({ preventScroll: true });
      } else if (previous) {
        const context = window.history.state?.factReturn as Position | undefined;
        const candidate = context?.focus ? document.getElementById(context.focus) : null;
        const target = candidate?.getClientRects().length && !candidate.closest("[hidden],[inert]") ? candidate :
          document.getElementById("page-reader-title") ?? document.getElementById("facts-title") ?? document.getElementById("source-detail-title") ?? document.getElementById("source-list-title");
        target?.focus({ preventScroll: true });
        restoreParentPage(window.history.state?.factParent as ParentPagePosition | undefined, selected, parent);
        if (context) { window.scrollTo(0, context.top); const table = document.querySelector(".fact-list .table-scroll"); if (table) table.scrollLeft = context.left; }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [key, parent, selected]);
  function href(next: Detail | null) { return sourceNavigationPath(selected, expanded, filter, parent, { loaded: true, id: next?.id ?? null, mode: next?.mode ?? "panel" }); }
  function move(next: Detail | null, event?: MouseEvent<HTMLAnchorElement>, focus?: string) {
    if (event && !ordinary(event)) return;
    event?.preventDefault();
    const state = window.history.state ?? {};
    const position: Position = { top: window.scrollY, left: document.querySelector(".fact-list .table-scroll")?.scrollLeft ?? 0, focus: document.activeElement instanceof HTMLElement ? document.activeElement.id : "" };
    const factReturn = detail ? state.factReturn : { ...position, focus: focus ?? position.focus };
    const reader = document.querySelector<HTMLElement>(".fact-reader .page-reader-scroll");
    const factReader = detail ? { ...position, top: detail.mode === "full" ? window.scrollY : reader?.scrollTop ?? 0, focus: position.focus || reader?.closest<HTMLElement>(".fact-reader")?.dataset.readerFocus || "" } : undefined;
    const factParent = !detail && parent && selected ? captureParentPage(selected, parent) : state.factParent;
    window.history.replaceState({ ...state, factReturn, factParent, ...(factReader ? { factReader } : {}) }, "", window.location.href);
    window.history.pushState({ ...state, factReturn, factParent, factReader: detail && next?.id === detail.id ? factReader : undefined,
      factPresentation: detail && next?.id === detail.id ? window.history.state?.factPresentation : undefined }, "", href(next));
    window.dispatchEvent(new Event(changed));
  }
  function open(fact: Fact, event?: MouseEvent<HTMLAnchorElement>) {
    if (event && !ordinary(event)) return;
    if (detail?.id === fact.id) window.history.replaceState({ ...window.history.state, factPresentation: undefined }, "", window.location.href);
    setIntent(value => value + 1);
    if (selected) setLastSelection({ source: selected, id: fact.id });
    move({ id: fact.id, mode: "panel" }, event, factRowId(fact));
  }
  function load(event?: MouseEvent<HTMLAnchorElement>) { move(null, event); }
  function closeInvalid(preserveSource = true) {
    const state = window.history.state ?? {};
    const destination = sourceNavigationPath(preserveSource ? selected : null, expanded, filter, null,
      { loaded: preserveSource, id: null, mode: "panel" });
    window.history.replaceState({ ...state, factPresentation: undefined, factParent: undefined, factReader: undefined, factReturn: state.factReturn ? { ...state.factReturn, focus: "" } : undefined }, "", destination);
    window.dispatchEvent(new Event(changed));
  }
  return { query, detail, presentation, setPresentation, loaded: navigation.loaded, intent, href, move, open, load, closeInvalid, lastSelection };
}
