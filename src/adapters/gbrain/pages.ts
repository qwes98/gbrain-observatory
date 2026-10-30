import { boundedSourceReference, sourceReference } from "../../contracts/sources";
import { pageBatchSize, pageCandidateCap, pageReference, validPageOffset, type Page, type PageListResult, type PageRequest, type ObservationInterval } from "../../contracts/pages";
import { isInstant } from "../../i18n/time-zone";
import { acquireConnectionLease, releaseConnectionLease, connectionNamespace, hasSafeSourceCapability, sourceRows, supportedVersion } from "./probe";
import { getConnectionConfig, runCommand, type ConnectionConfig, type ProcessCause } from "./runner";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const listParameters: Record<string, string> = { type: "string?", tag: "string?", limit: "number?", offset: "number?", updated_after: "string?", updated_after_slug: "string?", sort: "string?", include_deleted: "boolean?", source_id: "string?" };
const detailParameters: Record<string, string> = { slug: "string", fuzzy: "boolean?", include_content: "boolean?", content_only: "boolean?", body: "string?", lines: "object?", bytes: "object?", around_chunk_id: "number?", context_lines: "number?", cursor: "string?", max_bytes: "number?", view: "string?", outline_from: "number?", include_deleted: "boolean?", include_timeline_entries: "boolean?", grammar_diagnostics: "boolean?", source_id: "string?", include_quarantined: "boolean?", min_trust: "string?", known_as_of: "string?" };

const supportedEnums: Record<string, readonly string[]> = {
  sort: ["updated_desc", "updated_asc", "created_desc", "slug"],
  body: ["auto", "full", "none", "outline", "window"],
  view: ["read", "markdown"],
  min_trust: ["user_confirmed", "operator_curated", "tool_observed", "agent_written", "unknown", "external_untrusted"],
};
function safeProperty(value: unknown, type: string, name: string): boolean {
  if (!record(value) || value.type !== type || (value.description !== undefined && typeof value.description !== "string")) return false;
  const objectFields = name === "lines" ? ["from", "count"] : name === "bytes" ? ["offset", "length"] : null;
  const allowed = ["type", "description", "default", ...(supportedEnums[name] ? ["enum"] : []), ...(objectFields ? ["properties", "required", "additionalProperties"] : [])];
  if (Object.keys(value).some(key => !allowed.includes(key)) || (value.default !== undefined && !(type === "boolean" && value.default === false))) return false;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || new Set(value.enum).size !== value.enum.length || value.enum.some(item => !supportedEnums[name].includes(item)))) return false;
  if (type !== "object") return true;
  if (!objectFields || !record(value.properties) || value.additionalProperties !== false || !Array.isArray(value.required)) return false;
  const properties = value.properties;
  return Object.keys(properties).length === objectFields.length && value.required.length === objectFields.length &&
    objectFields.every(key => (value.required as unknown[]).includes(key) && safeProperty(properties[key], "number", key));
}

/** Validate every advertised parameter against supported public metadata, including unused options. */
function safeCapability(value: unknown, name: string, declared: Record<string, string>, used: string[], required: string[]): boolean {
  if (!Array.isArray(value)) return false;
  const candidates = value.filter(item => record(item) && item.name === name);
  if (candidates.length !== 1) return false;
  const tool = candidates[0];
  if (tool.scope !== "read" || tool.mutating !== false || tool.idempotent !== true || !Array.isArray(tool.required_scopes) || tool.required_scopes.length !== 0 || !record(tool.parameters) || !record(tool.schema)) return false;
  const parameters = tool.parameters;
  if (Object.keys(parameters).some(key => parameters[key] !== declared[key]) || used.some(key => parameters[key] !== declared[key])) return false;
  const schema = tool.schema;
  if (schema.type !== "object" || !record(schema.properties) || Object.keys(schema).some(key => !["type", "properties", "required", "additionalProperties"].includes(key)) || (schema.additionalProperties !== undefined && schema.additionalProperties !== false)) return false;
  const properties = schema.properties;
  if (Object.keys(properties).length !== Object.keys(parameters).length || Object.keys(properties).some(key => !Object.hasOwn(declared, key) || !Object.hasOwn(parameters, key) || !safeProperty(properties[key], declared[key].replace("?", ""), key))) return false;
  if (used.some(key => !record(properties[key]))) return false;
  const actualRequired = schema.required ?? [];
  if (!Array.isArray(actualRequired) || actualRequired.length !== required.length || required.some(key => !actualRequired.includes(key))) return false;
  if (name === "list_pages" && (!record(properties.sort) || !Array.isArray(properties.sort.enum) || !properties.sort.enum.includes("created_desc"))) return false;
  return true;
}
export function hasSafePageCapabilities(value: unknown): boolean {
  return safeCapability(value, "list_pages", listParameters, ["source_id", "sort", "limit", "offset"], []) &&
    safeCapability(value, "get_page", detailParameters, ["source_id", "slug", "fuzzy"], ["slug"]);
}
function hasSafeListCapability(value: unknown): boolean {
  return safeCapability(value, "list_pages", listParameters, ["source_id", "sort", "limit", "offset"], []);
}
function hasSafeDetailCapability(value: unknown): boolean {
  return safeCapability(value, "get_page", detailParameters, ["source_id", "slug", "fuzzy"], ["slug"]);
}

export interface PublicPageRow { slug: string; source_id: string; type: string; title: string; updated_at?: unknown; updated_at_iso?: unknown }
/** Raw count is kept independently of deduplication so offsets advance over all returned candidates. */
export function pageRows(value: unknown, sourceId: string): PublicPageRow[] | null {
  if (!Array.isArray(value) || value.length > pageBatchSize) return null;
  if (value.some(row => !record(row) || row.source_id !== sourceId || typeof row.slug !== "string" || !row.slug.length || row.slug.length > 1024 || /[\0\r\n]/.test(row.slug) || typeof row.type !== "string" || typeof row.title !== "string" || Object.keys(row).some(key => !["slug", "source_id", "type", "title", "updated_at", "updated_at_iso"].includes(key)))) return null;
  return value as PublicPageRow[];
}
function timestamp(value: unknown): { value: string | null; availability: "available" | "missing" | "invalid" } {
  if (value === null || value === undefined) return { value: null, availability: "missing" };
  return isInstant(value) ? { value, availability: "available" } : { value: null, availability: "invalid" };
}
export function projectPageDetail(value: unknown, page: Page, observation: ObservationInterval): Page {
  // A differently identified response never contributes timestamps, even when its dates look valid.
  if (!record(value) || value.slug !== page.slug || value.source_id !== page.sourceId || (value.resolved_slug !== undefined && value.resolved_slug !== page.slug)) return { ...page, creationAvailability: "failed", detailObservation: observation };
  const partial = value.truncated === true || value.partial === true || value.next_cursor !== undefined || value.window !== undefined || value.body_omitted === true || ["none", "outline", "window"].includes(String(value.body));
  if (partial) return { ...page, creationAvailability: "partial", detailObservation: observation };
  const created = timestamp(value.created_at);
  const modified = timestamp(value.updated_at);
  return { ...page, createdAt: created.value, creationAvailability: created.availability,
    // Keep valid list evidence when detail is unusable, and retain an invalid observation over an absent one.
    ...(modified.availability === "available" || (modified.availability === "invalid" && page.modificationAvailability !== "available") ? { updatedAt: modified.value, modificationAvailability: modified.availability } : {}), detailObservation: observation };
}
function failed(cause: ProcessCause): PageListResult {
  return cause === "permission" ? { kind: "denied", reason: "access-denied" } : { kind: "failure", reason: "request-failed" };
}
const now = () => new Date().toISOString();
export const pageAcquisitionDeadlineMs = 45_000;

/** Every batch independently verifies the configured namespace and current returned Source scope. */
export async function listPages(request: PageRequest, config: ConnectionConfig | null = getConnectionConfig()): Promise<PageListResult> {
  if (!boundedSourceReference(request.source) || !validPageOffset(request.offset)) return { kind: "unavailable", reason: "source-unavailable" };
  if (!config) return { kind: "unconfigured", reason: "adapter-not-configured" };
  const [namespace, sourceId] = JSON.parse(request.source) as [string, string];
  if (namespace !== connectionNamespace(config) || !/^[a-z0-9-]{1,32}$/.test(sourceId)) return { kind: "unavailable", reason: "source-unavailable" };
  if (!acquireConnectionLease()) return { kind: "failure", reason: "busy" };
  const startedAt = now();
  const deadline = Date.now() + pageAcquisitionDeadlineMs;
  try {
    const version = await runCommand(config, "version", deadline);
    if (!version.ok) return failed(version.cause);
    if (/^gbrain (\d+\.\d+\.\d+\.\d+)\s*$/.exec(version.stdout)?.[1] !== supportedVersion) return { kind: "unknown", reason: "unsupported" };
    const catalog = await runCommand(config, "capabilities", deadline);
    if (!catalog.ok) return failed(catalog.cause);
    const capabilities: unknown = JSON.parse(catalog.stdout);
    if (!hasSafeSourceCapability(capabilities) || !hasSafeListCapability(capabilities)) return { kind: "unknown", reason: "unsupported" };
    const sources = await runCommand(config, "sources", deadline);
    if (!sources.ok) return failed(sources.cause);
    const allowed = sourceRows(JSON.parse(sources.stdout));
    if (!allowed) return { kind: "unknown", reason: "unsupported" };
    if (!allowed.some(source => sourceReference({ namespace, id: source.id }) === request.source)) return { kind: "unavailable", reason: "source-unavailable" };
    const listStartedAt = now();
    const list = await runCommand(config, { kind: "pages", sourceId, offset: request.offset }, deadline);
    const listCompletedAt = now();
    if (!list.ok) return failed(list.cause);
    const rows = pageRows(JSON.parse(list.stdout), sourceId);
    if (!rows) return { kind: "unknown", reason: "unsupported" };
    const canReadDetail = hasSafeDetailCapability(capabilities);
    const pages: Page[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const modified = timestamp(row.updated_at_iso);
      let page: Page = { namespace, sourceId, slug: row.slug, title: row.title, kind: row.type, createdAt: null, updatedAt: modified.value,
        creationAvailability: canReadDetail ? "failed" : "unsupported", modificationAvailability: modified.availability, detailObservation: null };
      const reference = pageReference(page);
      if (seen.has(reference)) continue;
      seen.add(reference);
      if (canReadDetail && Date.now() < deadline) {
        const detailStartedAt = now();
        const detail = await runCommand(config, { kind: "page", sourceId, slug: row.slug }, deadline);
        const observation = { startedAt: detailStartedAt, completedAt: now() };
        if (detail.ok) {
          try { page = projectPageDetail(JSON.parse(detail.stdout), page, observation); }
          catch { page = { ...page, detailObservation: observation }; }
        } else {
          if (detail.cause === "permission") return { kind: "denied", reason: "access-denied" };
          page = { ...page, detailObservation: observation };
        }
      }
      pages.push(page);
    }
    const nextOffset = request.offset + rows.length;
    return { kind: "success", snapshot: { sourceReference: request.source, pages, offset: request.offset, nextOffset,
      range: rows.length < pageBatchSize ? "observed-end" : nextOffset >= pageCandidateCap ? "cap" : "more",
      listObservation: { startedAt: listStartedAt, completedAt: listCompletedAt }, observation: { startedAt, completedAt: now() }, coverage: "unknown" } };
  } catch { return { kind: "unknown", reason: "unsupported" }; }
  finally { releaseConnectionLease(); }
}
