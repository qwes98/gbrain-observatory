import { boundedSourceReference } from "../../contracts/sources";
import { factCandidateLimit, validFactId, validFactRequest, validFactDetailRequest, type Fact, type FactSnapshot, type FactRequest, type FactDetailRequest, type FactListResult, type FactDetailResult, type FactPageLink, type FactEvidence, type FactFieldAvailability, type FactResultIssue } from "../../contracts/facts";
import { validPageSlug } from "../../contracts/page-detail";
import type { PageDetailSnapshot } from "../../contracts/page-detail";
import { isInstant } from "../../i18n/time-zone";
import { acquireConnectionLease, releaseConnectionLease, connectionNamespace, hasSafeSourceCapability, sourceRows, supportedVersion } from "./probe";
import { safeCapability, hasSafeDetailCapability, pageAcquisitionDeadlineMs } from "./pages";
import { projectPublicPageDetail } from "./page-detail";
import { getConnectionConfig, runCommand, type ConnectionConfig, type ProcessCause } from "./runner";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const now = () => new Date().toISOString();
const recallParameters = { entity: "string?", question: "string?", query: "string?", budget_tokens: "number?", budget_policy: "string?", source_id: "string?", since: "string?", session_id: "string?", include_expired: "boolean?", supersessions: "boolean?", limit: "number?", grep: "string?", include_pending: "boolean?", return_unit: "string?", return_window: "number?", min_trust: "string?" };
const trajectoryParameters = { entity_slug: "string?", metric: "string?", kind: "string?", since: "string?", until: "string?", limit: "number?" };
export function hasSafeFactCapabilities(value: unknown): boolean {
  return safeCapability(value, "recall", recallParameters, ["source_id", "limit"], []);
}
export function hasSafeTrajectoryCapability(value: unknown): boolean {
  return safeCapability(value, "find_trajectory", trajectoryParameters, ["entity_slug", "kind", "limit"], []);
}
function failed(cause: ProcessCause): FactResultIssue {
  return cause === "permission" ? { kind: "denied", reason: "access-denied" } : { kind: "failure", reason: "request-failed" };
}
function field(value: unknown, valid: (value: unknown) => value is string): { value: string | null; availability: FactFieldAvailability } {
  return value === undefined ? { value: null, availability: "missing" } : value === null ? { value: null, availability: "null" } : valid(value) ? { value, availability: "available" } : { value: null, availability: "invalid" };
}
interface Candidate { fact: Fact; context: unknown; entity: unknown }
/** Invalid identity rows are omitted, never repaired using descriptions, content or local row numbers. */
export function projectPublicFacts(value: unknown, source: string, observation: FactSnapshot["observation"]): { snapshot: FactSnapshot; candidates: Candidate[] } | null {
  if (!boundedSourceReference(source) || !record(value) || !Array.isArray(value.facts) || value.facts.length > factCandidateLimit || value.protocol_version !== 1 || value.facts_order !== "newest" || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || Object.keys(value).some(key => !["facts", "total", "facts_order", "protocol_version"].includes(key))) return null;
  const [namespace, sourceId] = JSON.parse(source) as [string, string];
  const counts = new Map<string, number>();
  for (const row of value.facts) if (record(row) && validFactId(row.fact_id)) counts.set(row.fact_id, (counts.get(row.fact_id) ?? 0) + 1);
  const candidates: Candidate[] = [];
  let omitted = 0;
  for (const row of value.facts) {
    if (!record(row) || row.source_id !== sourceId || !validFactId(row.fact_id) || counts.get(row.fact_id) !== 1 ||
        (row.id !== undefined && (!Number.isSafeInteger(row.id) || String(row.id) !== row.fact_id)) || typeof row.fact !== "string" || !row.fact.length || typeof row.kind !== "string" || !row.kind.length) { omitted++; continue; }
    const created = field(row.created_at, isInstant);
    const context = field(row.context, (value): value is string => typeof value === "string");
    // No public recorder field has been established; session/origin are not people.
    candidates.push({ fact: { namespace, sourceId, id: row.fact_id, content: row.fact, kind: row.kind,
      context: context.value, contextAvailability: context.availability,
      sourceDescription: typeof row.source === "string" ? row.source : null, provenance: typeof row.provenance === "string" ? row.provenance : null,
      createdAt: created.value, creationAvailability: created.availability, recordedBy: null, recorderAvailability: "missing" }, context: row.context, entity: row.entity_slug });
  }
  return { candidates, snapshot: { sourceReference: source, rows: candidates.map(item => item.fact), coverage: "unknown", candidateLimit: 100, continuation: "unsupported", capped: value.facts.length === factCandidateLimit, omitted, observation } };
}
interface Acquired { kind: "success"; config: ConnectionConfig; capabilities: unknown; sourceName: string; namespace: string; sourceId: string; candidates: Candidate[]; snapshot: FactSnapshot }
async function acquire(request: FactRequest, config: ConnectionConfig, deadline: number, startedAt: string): Promise<Acquired | FactResultIssue> {
  const [namespace, sourceId] = JSON.parse(request.source) as [string, string];
  const version = await runCommand(config, "version", deadline);
  if (!version.ok) return failed(version.cause);
  if (/^gbrain (\d+\.\d+\.\d+\.\d+)\s*$/.exec(version.stdout)?.[1] !== supportedVersion) return { kind: "unknown", reason: "unsupported" };
  const catalog = await runCommand(config, "capabilities", deadline);
  if (!catalog.ok) return failed(catalog.cause);
  const capabilities: unknown = JSON.parse(catalog.stdout);
  if (!hasSafeSourceCapability(capabilities) || !hasSafeFactCapabilities(capabilities)) return { kind: "unknown", reason: "unsupported" };
  const sources = await runCommand(config, "sources", deadline);
  if (!sources.ok) return failed(sources.cause);
  const allowed = sourceRows(JSON.parse(sources.stdout));
  if (!allowed) return { kind: "unknown", reason: "unsupported" };
  const selected = allowed.find(item => item.id === sourceId);
  if (!selected) return { kind: "unavailable", reason: "source-unavailable" };
  const recall = await runCommand(config, { kind: "facts", sourceId }, deadline);
  if (!recall.ok) return failed(recall.cause);
  const projected = projectPublicFacts(JSON.parse(recall.stdout), request.source, { startedAt, completedAt: now() });
  return projected ? { kind: "success", config, capabilities, sourceName: selected.name, namespace, sourceId, ...projected } : { kind: "unknown", reason: "unsupported" };
}
function validScope(request: FactRequest, config: ConnectionConfig): boolean {
  const [namespace, id] = JSON.parse(request.source) as [string, string];
  return namespace === connectionNamespace(config) && /^[a-z0-9-]{1,32}$/.test(id);
}
export async function listFacts(request: FactRequest, config: ConnectionConfig | null = getConnectionConfig()): Promise<FactListResult> {
  if (!validFactRequest(request)) return { kind: "unavailable", reason: "source-unavailable" };
  if (!config) return { kind: "unconfigured", reason: "adapter-not-configured" };
  if (!validScope(request, config)) return { kind: "unavailable", reason: "source-unavailable" };
  if (!acquireConnectionLease()) return { kind: "failure", reason: "busy" };
  try {
    const result = await acquire(request, config, Date.now() + pageAcquisitionDeadlineMs, now());
    return result.kind === "success" ? { kind: "success", snapshot: result.snapshot } : result;
  } catch { return { kind: "unknown", reason: "unsupported" }; }
  finally { releaseConnectionLease(); }
}
interface PageRead { link: FactPageLink; snapshot: PageDetailSnapshot | null; raw: Record<string, unknown> | null }
async function exactPage(slug: unknown, scope: Acquired, source: string, deadline: number): Promise<PageRead> {
  const empty = (availability: FactPageLink["availability"]): PageRead => ({ link: { availability, page: null }, snapshot: null, raw: null });
  if (slug === undefined || slug === null || slug === "") return empty("missing");
  if (!validPageSlug(slug)) return empty("invalid");
  if (!hasSafeDetailCapability(scope.capabilities)) return empty("unknown");
  const startedAt = now();
  const result = await runCommand(scope.config, { kind: "page", sourceId: scope.sourceId, slug }, deadline);
  if (!result.ok) return empty(result.cause === "permission" ? "denied" : "failed");
  let raw: unknown;
  try { raw = JSON.parse(result.stdout); } catch { return empty("unknown"); }
  const snapshot = projectPublicPageDetail(raw, { source, slug }, scope.namespace, scope.sourceName, { startedAt, completedAt: now() });
  if (!snapshot || !record(raw)) return empty("unknown");
  return { link: { availability: "available", page: snapshot.page }, snapshot, raw };
}
const pageExtractionSources = new Set(["mcp:put_page", "sync:import", "file_upload", "code_import"]);
/** Match the pinned upstream recordedPageSlug contract before attempting any Page read. */
async function contextPage(candidate: Candidate, scope: Acquired, source: string, deadline: number): Promise<PageRead> {
  const empty = (availability: FactPageLink["availability"]): PageRead => ({ link: { availability, page: null }, snapshot: null, raw: null });
  if (candidate.context === undefined || candidate.context === null || candidate.context === "") return empty("missing");
  if (typeof candidate.context !== "string") return empty("invalid");
  if (!pageExtractionSources.has(candidate.fact.sourceDescription ?? "")) return empty("unknown");
  const head = candidate.context.split(" — ", 1)[0].trim();
  if (!head || !head.includes("/") || /\s/.test(head)) return empty("unknown");
  return exactPage(head, scope, source, deadline);
}
function emptyEvidence(availability: FactEvidence["availability"]): FactEvidence {
  return { availability, level: "context-page", page: null, quote: null, location: null, body: { availability: "unknown", sections: [] } };
}
async function evidenceFor(context: PageRead, scope: Acquired, source: string, deadline: number): Promise<FactEvidence> {
  if (!context.snapshot || !context.raw) return emptyEvidence(context.link.availability);
  if (context.snapshot.body.availability === "protected") return emptyEvidence("protected");
  if (context.snapshot.body.availability === "partial") return emptyEvidence("partial");
  if (!record(context.raw.frontmatter)) return emptyEvidence("missing");
  const frontmatter = context.raw.frontmatter;
  const target = await exactPage(frontmatter.source_slug, scope, source, deadline);
  if (!target.snapshot || !target.raw) return emptyEvidence(target.link.availability);
  const { page, body } = target.snapshot;
  if (body.availability === "protected") return { ...emptyEvidence("protected"), page, body: { availability: "protected", sections: [] } };
  const base = { ...emptyEvidence("missing"), page, body: { availability: body.availability, sections: body.sections } };
  if (body.availability !== "available") return { ...base, availability: body.availability === "partial" ? "partial" : "unknown" };
  const quote = frontmatter.source_quote, offset = frontmatter.source_quote_offset;
  if (quote === undefined || quote === null || quote === "") return base;
  if (typeof quote !== "string" || !Array.isArray(offset) || offset.length !== 2 || !offset.every(Number.isSafeInteger)) return { ...base, availability: "invalid" };
  const [start, end] = offset as [number, number];
  const text = body.sections.find(item => item.id === "compiled-truth")?.text;
  if (typeof text !== "string" || start < 0 || end <= start || end > text.length || text.slice(start, end) !== quote) return { ...base, availability: "mismatch" };
  return { ...base, availability: "available", quote, location: { section: "compiled-truth", start, end } };
}
/** A fresh bounded recall proves the exact public Fact before composing any page-level provenance. */
export async function readFactDetail(request: FactDetailRequest, config: ConnectionConfig | null = getConnectionConfig()): Promise<FactDetailResult> {
  if (!validFactDetailRequest(request)) return { kind: "unavailable", reason: "fact-unavailable" };
  if (!config) return { kind: "unconfigured", reason: "adapter-not-configured" };
  if (!validScope(request, config)) return { kind: "unavailable", reason: "fact-unavailable" };
  if (!acquireConnectionLease()) return { kind: "failure", reason: "busy" };
  const startedAt = now(), deadline = Date.now() + pageAcquisitionDeadlineMs;
  try {
    const scope = await acquire(request, config, deadline, startedAt);
    if (scope.kind !== "success") return scope;
    const candidate = scope.candidates.find(item => item.fact.id === request.id);
    if (!candidate) return { kind: "unavailable", reason: "fact-unavailable" };
    const context = await contextPage(candidate, scope, request.source, deadline);
    const evidence = await evidenceFor(context, scope, request.source, deadline);
    let storedPage: FactPageLink = { availability: "missing", page: null };
    if (candidate.entity !== undefined && candidate.entity !== null) {
      storedPage = { availability: validPageSlug(candidate.entity) ? "unknown" : "invalid", page: null };
      if (validPageSlug(candidate.entity) && hasSafeTrajectoryCapability(scope.capabilities)) {
        const result = await runCommand(config, { kind: "trajectory", sourceId: scope.sourceId, entity: candidate.entity }, deadline);
        if (!result.ok) storedPage.availability = result.cause === "permission" ? "denied" : "failed";
        else {
          let trajectory: unknown;
          try { trajectory = JSON.parse(result.stdout); } catch { trajectory = null; }
          if (record(trajectory) && Array.isArray(trajectory.points) && trajectory.points.length <= 100 && trajectory.schema_version === 1) {
            const matches = trajectory.points.filter(point => record(point) && (validFactId(point.fact_id) || (Number.isSafeInteger(point.fact_id) && (point.fact_id as number) > 0)) && String(point.fact_id) === request.id && (point.source_id === undefined || point.source_id === scope.sourceId));
            if (matches.length === 1 && record(matches[0])) storedPage = (await exactPage(matches[0].source_markdown_slug, scope, request.source, deadline)).link;
          }
        }
      }
    }
    return { kind: "success", snapshot: { fact: candidate.fact, sourceName: scope.sourceName, contextPage: context.link, storedPage, evidence, observation: { startedAt, completedAt: now() } } };
  } catch { return { kind: "unknown", reason: "unsupported" }; }
  finally { releaseConnectionLease(); }
}
