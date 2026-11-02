import type { ObservationInterval, Page } from "./pages";
import { boundedPageSlug, boundedSourceReference } from "./sources";

export type PageReaderView = "memories" | "body" | "references";
export type PageReaderMode = "panel" | "full";
export type PageBodySectionId = "compiled-truth" | "timeline" | "window";
export interface PageBodySection { id: PageBodySectionId; text: string }
/** UTF-16 offsets into the exact, unmodified public section string, never a Fact provenance claim. */
export interface PageOriginalLocation { section: PageBodySectionId; start: number; end: number }
export interface PageMemory {
  /** Page/section/original row position, deliberately distinct from a public Fact ID. */
  id: string;
  claim: string;
  kind: string;
  fields: Record<string, string>;
  location: PageOriginalLocation;
}
export interface PageDetailRequest { source: string; slug: string }
export interface PageDetailSnapshot {
  page: Page;
  sourceName: string;
  body: { availability: "available" | "partial" | "protected" | "unknown" | "failed"; sections: PageBodySection[]; observation: ObservationInterval };
  memories: { availability: "available" | "empty" | "unknown"; rows: PageMemory[] };
  backlinks: { availability: "available" | "empty" | "partial" | "failed" | "unknown"; pages: { page: Page; sourceName: string }[]; omitted: number; truncated: boolean; listObservation: ObservationInterval | null; coverage: "unknown"; candidateLimit: 10 };
  observation: ObservationInterval;
}
export type PageDetailResult =
  | { kind: "success"; snapshot: PageDetailSnapshot }
  | { kind: "unconfigured"; reason: "adapter-not-configured" }
  | { kind: "denied"; reason: "access-denied" }
  | { kind: "unavailable"; reason: "page-unavailable" }
  | { kind: "failure"; reason: "request-failed" | "busy" }
  | { kind: "unknown"; reason: "unsupported" };

export function validPageSlug(value: unknown): value is string {
  return boundedPageSlug(value);
}
export function validPageDetailRequest(value: unknown): value is PageDetailRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2 && typeof input.source === "string" && boundedSourceReference(input.source) && validPageSlug(input.slug);
}
export function resolvePageReaderView(value: unknown): PageReaderView {
  return value === "body" || value === "references" ? value : "memories";
}
export function resolvePageReaderMode(value: unknown): PageReaderMode {
  return value === "full" ? "full" : "panel";
}
export function verifiedPageLocation(sections: PageBodySection[], location: PageOriginalLocation, expected: string): boolean {
  const section = sections.find(item => item.id === location.section);
  return !!section && Number.isSafeInteger(location.start) && Number.isSafeInteger(location.end) && location.start >= 0 &&
    location.end > location.start && location.end <= section.text.length && section.text.slice(location.start, location.end) === expected;
}
