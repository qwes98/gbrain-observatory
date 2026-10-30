/** Sanitized, transient display contracts. Page bodies/frontmatter never enter this surface. */
export type PageFilter = "all" | "today" | "yesterday";
export type PageFieldAvailability = "available" | "missing" | "invalid" | "partial" | "failed" | "unsupported";
export interface ObservationInterval { startedAt: string; completedAt: string }
export interface Page {
  namespace: string;
  sourceId: string;
  slug: string;
  title: string;
  kind: string;
  createdAt: string | null;
  updatedAt: string | null;
  creationAvailability: PageFieldAvailability;
  modificationAvailability: PageFieldAvailability;
  detailObservation: ObservationInterval | null;
}
export interface PageSnapshot {
  sourceReference: string;
  pages: Page[];
  offset: number;
  nextOffset: number;
  range: "more" | "observed-end" | "cap";
  listObservation: ObservationInterval;
  observation: ObservationInterval;
  coverage: "unknown";
}
export type PageListResult =
  | { kind: "success"; snapshot: PageSnapshot }
  | { kind: "unconfigured"; reason: "adapter-not-configured" }
  | { kind: "denied"; reason: "access-denied" }
  | { kind: "unavailable"; reason: "source-unavailable" }
  | { kind: "failure"; reason: "request-failed" | "busy" }
  | { kind: "unknown"; reason: "unsupported" };
export interface PageRequest { source: string; offset: number }
export const pageBatchSize = 10;
export const pageCandidateCap = 100;
export function pageReference(page: Pick<Page, "namespace" | "sourceId" | "slug">): string {
  return JSON.stringify([page.namespace, page.sourceId, page.slug]);
}
export function validPageOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < pageCandidateCap && value % pageBatchSize === 0;
}
export function resolvePageFilter(value: unknown): PageFilter {
  return value === "today" || value === "yesterday" ? value : "all";
}
