"use client";

import { useEffect, useState } from "react";
import type { PageDetailRequest, PageDetailResult } from "../contracts/page-detail";
import { matchesCalendarFilter } from "../i18n/time-zone";
import type { PageFilter } from "../contracts/pages";
import { sourceReference } from "../contracts/sources";

export type PageDetailLoader = (request: PageDetailRequest) => Promise<PageDetailResult>;
export type PageDetailState = PageDetailResult | { kind: "loading" } | { kind: "outside" };
interface Scope { permittedSources: string; sourceScope: string | null; key: string; authority: object; condition: string; intent: number; allowed: boolean }
interface Stored extends Scope { seed?: PageDetailResult; state: PageDetailState; job: object | null }
function exact(result: PageDetailResult, request: PageDetailRequest, condition: string, permittedSources: string): PageDetailState {
  const [filter, zone] = condition.split("|");
  if (result.kind === "success" && !matchesCalendarFilter(result.snapshot.page.createdAt, filter as PageFilter, zone, new Date().toISOString())) return { kind: "outside" };
  if (result.kind !== "success") return result;
  if (sourceReference({ namespace: result.snapshot.page.namespace, id: result.snapshot.page.sourceId }) !== request.source || result.snapshot.page.slug !== request.slug) return { kind: "unavailable", reason: "page-unavailable" };
  const permitted = new Set<string>(JSON.parse(permittedSources));
  const pages = result.snapshot.backlinks.pages.filter(item => permitted.has(sourceReference({ namespace: item.page.namespace, id: item.page.sourceId })));
  const removed = result.snapshot.backlinks.pages.length - pages.length;
  if (!removed) return result;
  return { ...result, snapshot: { ...result.snapshot, backlinks: { ...result.snapshot.backlinks, pages, availability: "partial", omitted: result.snapshot.backlinks.omitted + removed } } };
}

/** Source content remains transient and cannot survive a superseded scope or request. */
export function usePageDetail(request: PageDetailRequest | null, seed: PageDetailResult | undefined, endpoint: string | undefined,
  authority: object, condition: string, allowed: boolean, intent: number, sourceScope: string | null, currentSources: string[], loadDetail?: PageDetailLoader) {
  const key = request ? JSON.stringify([request.source, request.slug]) : "";
  const permittedSources = JSON.stringify([...new Set(currentSources)].sort());
  const scope = { permittedSources, key, sourceScope, authority, condition, intent, allowed };
  function start(useSeed = true): Stored {
    const initial = useSeed && request && seed ? exact(seed, request, condition, permittedSources) : undefined;
    return { ...scope, seed, state: !allowed || !request ? { kind: "unavailable", reason: "page-unavailable" } : initial ?? (endpoint || loadDetail ? { kind: "loading" } : { kind: "unknown", reason: "unsupported" }),
      job: allowed && request && !initial && (endpoint || loadDetail) ? {} : null };
  }
  const [stored, setStored] = useState<Stored>(start);
  let current = stored;
  if (stored.state.kind === "outside" && stored.condition !== condition) {
    // The discarded result cannot judge a restored condition. Stay closed, or read
    // afresh when user navigation has brought the exact Page back into the URL.
    current = start(false); setStored(current);
  } else if (!request && stored.key && stored.sourceScope === sourceScope && allowed && stored.allowed) {
    // One last permitted result survives closing in component memory so passive Back is exact.
    // Explicit reopening advances intent; changing Source or revoking scope destroys this result.
    const [cachedSource, cachedSlug] = JSON.parse(stored.key) as [string, string];
    const state = stored.state.kind === "success" ? exact(stored.state, { source: cachedSource, slug: cachedSlug }, condition, permittedSources)
      : stored.state.kind === "loading" ? { kind: "failure" as const, reason: "request-failed" as const } : stored.state;
    if (stored.job || stored.seed !== seed || stored.condition !== condition || stored.authority !== authority || stored.permittedSources !== permittedSources || state !== stored.state) {
      current = { ...stored, seed, state, job: null, condition, authority, permittedSources }; setStored(current);
    }
  } else if (stored.key !== key || stored.intent !== intent || stored.seed !== seed || stored.sourceScope !== sourceScope) {
    current = start(stored.intent === intent); setStored(current);
  } else if (stored.authority !== authority || stored.condition !== condition || stored.allowed !== allowed || stored.permittedSources !== permittedSources) {
    const preserve = allowed && stored.allowed;
    const state = preserve && stored.state.kind === "success" && request ? exact(stored.state, request, condition, permittedSources)
      : preserve ? stored.state : { kind: "unavailable" as const, reason: "page-unavailable" as const };
    current = { ...scope, seed, job: preserve ? stored.job : null, state };
    setStored(current);
  }
  const job = current.job;
  const requestSource = request?.source, requestSlug = request?.slug;
  useEffect(() => {
    if (!job || !requestSource || !requestSlug) return;
    const capturedRequest = { source: requestSource, slug: requestSlug };
    const controller = new AbortController();
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    async function read(): Promise<PageDetailResult> {
      if (loadDetail) return loadDetail(capturedRequest);
      const response = await fetch(endpoint!, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(capturedRequest) });
      if (response.status === 401 || response.status === 403) return { kind: "denied", reason: "access-denied" };
      if (!response.ok) return { kind: "failure", reason: "request-failed" };
      return await response.json() as PageDetailResult;
    }
    const deadline = new Promise<PageDetailResult>(resolve => { timeout = setTimeout(() => {
      controller.abort(); resolve({ kind: "failure", reason: "request-failed" });
    }, 60_000); });
    void Promise.race([read(), deadline]).catch((): PageDetailResult => ({ kind: "failure", reason: "request-failed" })).then(result => {
      if (!active) return;
      setStored(value => value.job === job ? { ...value, state: exact(result, capturedRequest, value.condition, value.permittedSources), job: null } : value);
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [job, endpoint, loadDetail, requestSource, requestSlug]);
  return current.state;
}
