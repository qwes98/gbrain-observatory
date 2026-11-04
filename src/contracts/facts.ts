import { boundedSourceReference, boundedFactId } from "./sources";
import type { ObservationInterval, Page } from "./pages";
import type { PageBodySection, PageOriginalLocation } from "./page-detail";

export const factCandidateLimit = 100;
export type FactFieldAvailability = "available" | "missing" | "null" | "invalid";
export interface Fact {
  namespace: string; sourceId: string; id: string; content: string; kind: string;
  sourceDescription: string | null; provenance: string | null;
  /** Unmodified public provenance context, including any annotations. */
  context: string | null; contextAvailability: FactFieldAvailability;
  createdAt: string | null; creationAvailability: FactFieldAvailability;
  recordedBy: string | null; recorderAvailability: FactFieldAvailability;
}
export interface FactRequest { source: string }
export interface FactDetailRequest extends FactRequest { id: string }
export interface FactSnapshot {
  sourceReference: string; rows: Fact[]; coverage: "unknown"; candidateLimit: 100;
  continuation: "unsupported"; capped: boolean; omitted: number; observation: ObservationInterval;
}
export type FactResultIssue =
  | { kind: "unconfigured"; reason: "adapter-not-configured" }
  | { kind: "denied"; reason: "access-denied" }
  | { kind: "unavailable"; reason: "fact-unavailable" | "source-unavailable" }
  | { kind: "failure"; reason: "request-failed" | "busy" }
  | { kind: "unknown"; reason: "unsupported" };
export type FactListResult = { kind: "success"; snapshot: FactSnapshot } | FactResultIssue;
export type FactLinkAvailability = "available" | "missing" | "unknown" | "invalid" | "denied" | "failed";
export interface FactPageLink { availability: FactLinkAvailability; page: Page | null }
export interface FactEvidence {
  availability: "available" | "missing" | "unknown" | "invalid" | "mismatch" | "partial" | "protected" | "denied" | "failed";
  level: "context-page"; page: Page | null; quote: string | null; location: PageOriginalLocation | null;
  body: { availability: "available" | "partial" | "protected" | "unknown" | "failed"; sections: PageBodySection[] };
}
export interface FactDetailSnapshot {
  fact: Fact; sourceName: string; contextPage: FactPageLink; storedPage: FactPageLink;
  evidence: FactEvidence; observation: ObservationInterval;
}
export type FactDetailResult = { kind: "success"; snapshot: FactDetailSnapshot } | FactResultIssue;
export function factReference(fact: Pick<Fact, "namespace" | "sourceId" | "id">): string { return JSON.stringify([fact.namespace, fact.sourceId, fact.id]); }
export function validFactId(value: unknown): value is string {
  return boundedFactId(value);
}
export function validFactRequest(value: unknown): value is FactRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && typeof input.source === "string" && boundedSourceReference(input.source);
}
export function validFactDetailRequest(value: unknown): value is FactDetailRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2 && typeof input.source === "string" && boundedSourceReference(input.source) && validFactId(input.id);
}
