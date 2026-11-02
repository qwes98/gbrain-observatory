"use client";

import { useEffect, useState } from "react";
import { pageReference, type PageListResult, type PageSnapshot } from "../contracts/pages";
import { calendarDay } from "../i18n/time-zone";
export type PageLoader = (request: { source: string; offset: number }) => Promise<PageListResult>;

type State = PageListResult | { kind: "loading" } | { kind: "idle" };
interface PageAcquisition { generation: number | null; references: string[] }
type Job = { generation: number; offset: number; condition: string; authority: object; previous?: PageSnapshot; previousState: State };

/** Page bodies never enter state or History. Jobs are tied to their exact authority and conditions. */
export function usePageList(source: string, seed: PageListResult | undefined, endpoint: string | undefined, authority: object, condition: string, loadPages?: PageLoader, deferInitial = false) {
  const initial = seed?.kind === "success" && seed.snapshot.sourceReference !== source ? undefined : seed;
  const startInitially = !initial && !deferInitial && !!(endpoint || loadPages);
  const [stored, setStored] = useState<{
    seed: PageListResult | undefined; authority: object; condition: string;
    state: State; snapshot?: PageSnapshot; job: Job | null; deferred: boolean; issued: number; acquisition?: PageAcquisition;
  }>(() => ({ seed: initial, authority, condition, state: initial ?? (!deferInitial && (endpoint || loadPages) ? { kind: "loading" } : { kind: "idle" }),
    snapshot: initial?.kind === "success" ? initial.snapshot : undefined,
    acquisition: initial?.kind === "success" ? { generation: null, references: initial.snapshot.pages.map(pageReference) } : undefined,
    deferred: !initial && deferInitial && !!(endpoint || loadPages), issued: startInitially ? 1 : 0,
    job: startInitially ? { generation: 1, offset: 0, authority, condition, previousState: { kind: "idle" } } : null }));
  let current = stored;
  if (stored.seed !== initial || stored.authority !== authority) {
    const newSeed = stored.seed !== initial;
    const purge = newSeed && (initial?.kind === "denied" || initial?.kind === "unavailable" || initial?.kind === "unconfigured");
    const snapshot = newSeed && initial?.kind === "success" ? initial.snapshot : purge ? undefined : stored.snapshot;
    current = { seed: initial, authority, condition, snapshot, job: null, issued: stored.issued,
      acquisition: newSeed && initial?.kind === "success" ? { generation: null, references: initial.snapshot.pages.map(pageReference) } : purge ? undefined : stored.acquisition, deferred: newSeed && !!initial ? false : stored.deferred,
      state: newSeed && initial ? initial : stored.job?.previousState ?? stored.state };
    setStored(current);
  } else if (stored.condition !== condition) {
    // Display conditions do not change the unfiltered Source operation or its acquisition status.
    current = { ...stored, condition };
    setStored(current);
  }
  if (current.deferred && !deferInitial && !current.job && (endpoint || loadPages)) {
    // The reader owns the shared lease first; closing it explicitly enters the empty list.
    current = { ...current, deferred: false, issued: current.issued + 1, state: { kind: "loading" }, job: { generation: current.issued + 1, offset: 0, authority, condition, previousState: current.state } };
    setStored(current);
  }
  const { job } = current;
  useEffect(() => {
    if (!job || (!endpoint && !loadPages)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    async function read(): Promise<PageListResult> {
      try {
        if (loadPages) return await loadPages({ source, offset: job!.offset });
        const response = await fetch(endpoint!, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, offset: job!.offset }) });
        if (response.status === 401 || response.status === 403) return { kind: "denied", reason: "access-denied" };
        if (!response.ok) return { kind: "failure", reason: "request-failed" };
        return await response.json() as PageListResult;
      } catch { return { kind: "failure", reason: "request-failed" }; }
    }
    void read().then(result => setStored(value => {
      if (value.job !== job || value.authority !== job.authority) return value;
      // Removal applies to this Source authority regardless of local display conditions.
      if (result.kind === "denied" || result.kind === "unavailable" || result.kind === "unconfigured") return { ...value, job: null, snapshot: undefined, state: result };
      let snapshot = value.snapshot;
      if (result.kind === "success") {
        if (result.snapshot.sourceReference !== source || result.snapshot.offset !== job.offset) return { ...value, job: null, state: { kind: "failure", reason: "request-failed" } };
        const [, zone, day] = value.condition.split("|");
        // The first unfiltered range can be displayed under the latest conditions. A replacement
        // or continuation of an existing range keeps its captured condition and prior status.
        if (job.previous && (job.condition !== value.condition || calendarDay(new Date().toISOString(), zone) !== day)) return { ...value, job: null, state: job.previousState };
        snapshot = result.snapshot;
        if (job.offset > 0 && job.previous) {
          const previous = job.previous;
          const seen = new Set(previous.pages.map(page => JSON.stringify([page.namespace, page.sourceId, page.slug])));
          snapshot = { ...snapshot, pages: [...previous.pages, ...snapshot.pages.filter(page => {
            const reference = JSON.stringify([page.namespace, page.sourceId, page.slug]);
            if (seen.has(reference)) return false;
            seen.add(reference); return true;
          })], observation: { startedAt: previous.observation.startedAt, completedAt: snapshot.observation.completedAt },
            listObservation: { startedAt: previous.listObservation.startedAt, completedAt: snapshot.listObservation.completedAt } };
        }
        return { ...value, job: null, snapshot, acquisition: { generation: job.generation, references: result.snapshot.pages.map(pageReference) }, state: { kind: "success", snapshot } };
      }
      return { ...value, job: null, snapshot, state: result };
    })).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [job, endpoint, source, loadPages]);

  function acquire(offset: number) {
    if ((!endpoint && !loadPages) || current.job || (deferInitial && !current.snapshot)) return;
    setStored(value => ({ ...value, deferred: false, issued: value.issued + 1, state: { kind: "loading" }, job: { generation: value.issued + 1, offset, authority, condition, previous: value.snapshot, previousState: value.state } }));
  }
  return { state: current.state, snapshot: current.snapshot, acquisition: current.acquisition, issuedSequence: current.issued, refresh: () => acquire(0), more: () => {
    if (current.snapshot?.range === "more") acquire(current.snapshot.nextOffset);
  } };
}
