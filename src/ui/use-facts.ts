"use client";

import { useEffect, useState } from "react";
import { sourceReference, type SourceListResult } from "../contracts/sources";
import type { Fact, FactDetailRequest, FactDetailResult, FactListResult, FactRequest, FactSnapshot, FactResultIssue } from "../contracts/facts";

export type FactLoader = (request: FactRequest) => Promise<FactListResult>;
export type FactDetailLoader = (request: FactDetailRequest) => Promise<FactDetailResult>;
export type FactListState = FactListResult | { kind: "loading" } | { kind: "idle" };
export type FactSourceCause = { kind: "loading" } | Extract<SourceListResult, { kind: "failure" | "unknown" | "unconfigured" }>;
export type FactDetailState = FactDetailResult | { kind: "loading" } | { kind: "source-pending"; cause: FactSourceCause };
function exactFact(fact: Fact, source: string, id?: string) { return sourceReference({ namespace: fact.namespace, id: fact.sourceId }) === source && (id === undefined || fact.id === id); }
function exactList(result: FactListResult, source: string): FactListResult {
  return result.kind === "success" && (result.snapshot.sourceReference !== source || result.snapshot.rows.some(fact => !exactFact(fact, source))) ? { kind: "unavailable", reason: "source-unavailable" } : result;
}
function exactDetail(result: FactDetailResult, request: FactDetailRequest): FactDetailResult {
  if (result.kind !== "success") return result;
  if (!exactFact(result.snapshot.fact, request.source, request.id)) return { kind: "unavailable", reason: "fact-unavailable" };
  const pages = [result.snapshot.contextPage.page, result.snapshot.storedPage.page, result.snapshot.evidence.page];
  if (pages.some(page => page && sourceReference({ namespace: page.namespace, id: page.sourceId }) !== request.source)) return { kind: "unavailable", reason: "fact-unavailable" };
  return result;
}
async function transport<Result extends FactListResult | FactDetailResult>(endpoint: string, request: FactRequest | FactDetailRequest, controller: AbortController): Promise<Result> {
  const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (response.status === 401 || response.status === 403) return { kind: "denied", reason: "access-denied" } as Result;
  if (!response.ok) return { kind: "failure", reason: "request-failed" } as Result;
  return await response.json() as Result;
}

/** Explicit bounded observations only. A reader owns the lease before a pending first list. */
export function useFacts(source: string, seed: FactListResult | undefined, endpoint: string | undefined, authority: object, enabled: boolean, allowed: boolean, blocked: boolean, loadFacts?: FactLoader, accessIssue?: FactResultIssue) {
  interface Stored { source: string; seed?: FactListResult; authority: object; allowed: boolean; enabled: boolean; attempted: boolean; state: FactListState; snapshot?: FactSnapshot; job: object | null }
  function start(): Stored {
    const initial = allowed && seed ? exactList(seed, source) : undefined;
    return { source, seed, authority, allowed, enabled, attempted: !!initial || !allowed, state: !allowed ? accessIssue ?? { kind: "denied", reason: "access-denied" } : initial ?? { kind: "idle" }, snapshot: initial?.kind === "success" ? initial.snapshot : undefined, job: null };
  }
  const [stored, setStored] = useState<Stored>(start);
  let current = stored;
  if (stored.source !== source) { current = start(); setStored(current); }
  else if (stored.allowed !== allowed) {
    const issue = stored.state.kind === "denied" || stored.state.kind === "unavailable" || stored.state.kind === "unconfigured" ? stored.state : accessIssue ?? { kind: "denied" as const, reason: "access-denied" as const };
    current = { ...stored, seed, authority, allowed, attempted: true, state: issue, snapshot: undefined, job: null }; setStored(current);
  } else if (stored.seed !== seed) {
    if (allowed && seed) { current = start(); setStored(current); }
    else { current = { ...stored, seed, snapshot: allowed ? stored.snapshot : undefined }; setStored(current); }
  }
  else if (stored.authority !== authority) {
    current = { ...stored, authority, job: null, state: stored.job ? stored.snapshot ? { kind: "success", snapshot: stored.snapshot } : { kind: "idle" } : stored.state };
    setStored(current);
  }
  if (current.enabled !== enabled) {
    current = { ...current, enabled, attempted: enabled ? false : current.attempted }; setStored(current);
  }
  const canRead = !!(endpoint || loadFacts);
  if (allowed && enabled && !blocked && !current.attempted && canRead) {
    current = { ...current, attempted: true, state: { kind: "loading" }, job: {} }; setStored(current);
  }
  const job = current.job;
  useEffect(() => {
    if (!job || !allowed) return;
    const controller = new AbortController();
    let active = true, timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<FactListResult>(resolve => { timeout = setTimeout(() => { controller.abort(); resolve({ kind: "failure", reason: "request-failed" }); }, 60_000); });
    const read = loadFacts ? loadFacts({ source }) : transport<FactListResult>(endpoint!, { source }, controller);
    void Promise.race([read, deadline]).catch((): FactListResult => ({ kind: "failure", reason: "request-failed" })).then(raw => {
      if (!active) return;
      const result = exactList(raw, source);
      setStored(value => value.job !== job || value.authority !== authority ? value : { ...value, job: null, state: result,
        snapshot: result.kind === "success" ? result.snapshot : result.kind === "denied" || result.kind === "unavailable" || result.kind === "unconfigured" ? undefined : value.snapshot });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [job, source, endpoint, loadFacts, allowed, authority]);
  const state: FactListState = !enabled && (current.state.kind === "success" || current.state.kind === "loading") ? { kind: "idle" } : current.state;
  return { state, snapshot: allowed && enabled ? current.snapshot : undefined, refresh: () => {
    if (allowed && !blocked && !current.job && canRead) setStored(value => ({ ...value, attempted: true, job: {}, state: { kind: "loading" } }));
  } };
}
export const useFactList = useFacts;

/** One permitted snapshot may survive Close for passive Back; explicit reopening advances intent. */
export function useFactDetail(request: FactDetailRequest | null, seed: FactDetailResult | undefined, endpoint: string | undefined, authority: object, allowed: boolean, intent: number, sourceScope: string | null, loadFactDetail?: FactDetailLoader, pendingSource?: FactSourceCause) {
  interface Stored { waitingForSource: boolean; sourceStatus: string; key: string; sourceScope: string | null; seed?: FactDetailResult; authority: object; allowed: boolean; intent: number; state: FactDetailState; job: object | null }
  const key = request ? JSON.stringify([request.source, request.id]) : "";
  const sourceStatus = pendingSource ? JSON.stringify([pendingSource.kind, "reason" in pendingSource ? pendingSource.reason : null]) : "";
  function start(useSeed = true): Stored {
    const initial = allowed && request && seed && useSeed ? exactDetail(seed, request) : undefined;
    return { key, sourceScope, seed, authority, allowed, intent, sourceStatus, waitingForSource: !allowed && !!request && !!pendingSource,
      state: !request ? { kind: "unavailable", reason: "fact-unavailable" } : !allowed ? pendingSource ? { kind: "source-pending", cause: pendingSource } : { kind: "unavailable", reason: "fact-unavailable" } : initial ?? (endpoint || loadFactDetail ? { kind: "loading" } : { kind: "unknown", reason: "unsupported" }),
      job: allowed && request && !initial && (endpoint || loadFactDetail) ? {} : null };
  }
  const [stored, setStored] = useState<Stored>(start);
  let current = stored;
  if (allowed && request && stored.waitingForSource) {
    current = start(false); setStored(current);
  } else if (!allowed || stored.sourceScope !== sourceScope || stored.seed !== seed || stored.intent !== intent || stored.sourceStatus !== sourceStatus) {
    if (stored.allowed !== allowed || stored.sourceScope !== sourceScope || stored.seed !== seed || stored.intent !== intent || stored.sourceStatus !== sourceStatus) { current = start(stored.intent === intent); setStored(current); }
  } else if (!request && stored.key) {
    if (stored.job || stored.authority !== authority) { current = { ...stored, authority, job: null, state: stored.state.kind === "loading" ? { kind: "failure", reason: "request-failed" } : stored.state }; setStored(current); }
  } else if (stored.key !== key) { current = start(); setStored(current); }
  else if (stored.authority !== authority || stored.allowed !== allowed) {
    current = { ...stored, authority, allowed, job: null, state: stored.job ? { kind: "failure", reason: "request-failed" } : stored.state }; setStored(current);
  }
  const job = current.job, requestSource = request?.source, requestId = request?.id;
  useEffect(() => {
    if (!job || !requestSource || !requestId) return;
    const captured = { source: requestSource, id: requestId }, controller = new AbortController();
    let active = true, timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<FactDetailResult>(resolve => { timeout = setTimeout(() => { controller.abort(); resolve({ kind: "failure", reason: "request-failed" }); }, 60_000); });
    const read = loadFactDetail ? loadFactDetail(captured) : transport<FactDetailResult>(endpoint!, captured, controller);
    void Promise.race([read, deadline]).catch((): FactDetailResult => ({ kind: "failure", reason: "request-failed" })).then(result => {
      if (active) setStored(value => value.job !== job ? value : { ...value, job: null, state: exactDetail(result, captured) });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [job, requestSource, requestId, endpoint, loadFactDetail]);
  return current.state;
}
