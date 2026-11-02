import { boundedSourceReference } from "../../contracts/sources";
import { pageReference, type ObservationInterval, type Page } from "../../contracts/pages";
import { validPageDetailRequest, validPageSlug, verifiedPageLocation, type PageBodySection, type PageDetailRequest, type PageDetailResult, type PageDetailSnapshot, type PageMemory } from "../../contracts/page-detail";
import { isInstant } from "../../i18n/time-zone";
import { acquireConnectionLease, releaseConnectionLease, connectionNamespace, hasSafeSourceCapability, sourceRows, supportedVersion } from "./probe";
import { hasSafeDetailCapability, pageAcquisitionDeadlineMs, safeCapability } from "./pages";
import { getConnectionConfig, runCommand, type ConnectionConfig, type ProcessCause } from "./runner";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const now = () => new Date().toISOString();
const backlinkParameters: Record<string, string> = { slug: "string", status: "string?", as_of: "string?", source_id: "string?", all_sources: "boolean?", type: "string?", group: "string?", limit: "number?", cursor: "string?", all: "boolean?" };
export function hasSafeBacklinkCapability(value: unknown): boolean {
  return safeCapability(value, "get_backlinks", backlinkParameters, ["slug", "source_id", "limit"], ["slug"]);
}
export function hasSafePageDetailCapabilities(value: unknown): boolean {
  return hasSafeDetailCapability(value) && hasSafeBacklinkCapability(value);
}
const backlinkFields = ["from_source_id", "from_slug", "to_source_id", "to_slug", "link_type", "context", "link_source", "origin_source_id", "origin_slug", "origin_field", "page_status", "status", "stints", "recorded_at", "retired_at", "first_start", "truncated", "next_cursor"];
/** Public link rows are validated before their endpoints become a navigable relationship. */
function safeBacklinkRow(value: unknown): value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !backlinkFields.includes(key)) ||
      !["from_source_id", "to_source_id"].every(key => typeof value[key] === "string" && /^[a-z0-9-]{1,32}$/.test(value[key] as string)) ||
      !validPageSlug(value.from_slug) || !validPageSlug(value.to_slug) || typeof value.link_type !== "string" || typeof value.context !== "string") return false;
  if (["link_source", "origin_source_id", "origin_slug", "origin_field", "recorded_at", "retired_at", "first_start"].some(key => value[key] !== undefined && value[key] !== null && typeof value[key] !== "string")) return false;
  if (value.page_status !== undefined && typeof value.page_status !== "string") return false;
  if (value.status !== undefined && (typeof value.status !== "string" || !["live", "ended", "ended_unknown_date", "not_started", "disputed", "event", "reference"].includes(value.status))) return false;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") return false;
  if (value.next_cursor !== undefined && (typeof value.next_cursor !== "string" || !value.next_cursor.length || value.truncated !== true)) return false;
  if (value.stints !== undefined && (!Array.isArray(value.stints) || value.stints.some(stint => !record(stint) || Object.keys(stint).length !== 2 || !["from", "until"].every(key => stint[key] === null || typeof stint[key] === "string")))) return false;
  return true;
}

const begin = "<!--- gbrain:facts:begin -->", end = "<!--- gbrain:facts:end -->";
const columns = ["#", "claim", "kind", "confidence", "visibility", "notability", "valid_from", "valid_until", "source", "context", "claim_metric", "claim_value", "claim_unit", "claim_period", "attributed_to"];
const optional = new Set(["context", "claim_metric", "claim_value", "claim_unit", "claim_period", "attributed_to"]);
type Line = { text: string; start: number };
function originalLines(text: string): Line[] {
  const lines: Line[] = [];
  const expression = /([^\r\n]*)(?:\r\n|\r|\n|$)/g;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    lines.push({ text: match[1], start: match.index });
    if (expression.lastIndex === text.length) break;
  }
  return lines;
}
/** Ignore quoted marker syntax, including unclosed and variable-length Markdown code fences. */
function liveLines(text: string): Line[] {
  let fence: string | null = null;
  return originalLines(text).filter(line => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
      return false;
    }
    if (match && !(match[1][0] === "`" && match[2].includes("`"))) { fence = match[1]; return false; }
    return !/^(?: {4}|\t)/.test(line.text);
  });
}
type Cell = { raw: string; start: number; end: number };
function cellsOf(line: Line): Cell[] | null {
  const first = line.text.indexOf("|");
  if (first < 0 || line.text.slice(0, first).trim() || !line.text.trimEnd().endsWith("|")) return null;
  const cells: Cell[] = [];
  let start = first + 1;
  for (let index = start; index < line.text.length; index++) {
    if (line.text[index] === "\\" && line.text[index + 1] === "|") { index++; continue; }
    if (line.text[index] !== "|") continue;
    const raw = line.text.slice(start, index);
    const left = raw.length - raw.trimStart().length, right = raw.trimEnd().length;
    cells.push({ raw: raw.trim(), start: line.start + start + left, end: line.start + start + right });
    start = index + 1;
  }
  return cells;
}
const plainNumber = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function validTypedNumber(value: string): boolean {
  if (!value) return true;
  const match = /^([+-]?)[$€£]?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)((?:[eE][+-]?\d+)?)\s*([kmb]?)$/i.exec(value);
  return !!match && Number.isFinite(Number(match[1] + match[2].replace(/,/g, "") + match[3]) * ({ "": 1, k: 1e3, m: 1e6, b: 1e9 }[match[4].toLowerCase()] ?? 1));
}

/** Parse only complete, public, verifiable page-local tables. This never queries or invents a Fact ID. */
export function parsePublicMemories(sections: PageBodySection[], complete: boolean, pageIdentity: string): PageDetailSnapshot["memories"] {
  if (!complete) return { availability: "unknown", rows: [] };
  const rows: PageMemory[] = [];
  let malformed = false;
  for (const section of sections) {
    const lines = liveLines(section.text);
    const markers = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.text.trim() === begin || line.text.trim() === end);
    if (!markers.length) continue;
    if (markers.length !== 2 || markers[0].line.text.trim() !== begin || markers[1].line.text.trim() !== end) { malformed = true; continue; }
    const inner = originalLines(section.text).filter(line => line.start > markers[0].line.start && line.start < markers[1].line.start && line.text.trim());
    if (!inner.length) continue;
    const header = cellsOf(inner[0]);
    if (!header) { malformed = true; continue; }
    const names = header.map(cell => cell.raw.toLowerCase());
    if (new Set(names).size !== names.length || names.some(name => !columns.includes(name)) || columns.some(name => !optional.has(name) && !names.includes(name))) { malformed = true; continue; }
    const canonical = names.every((name, index) => name === columns[index]);
    const layout = canonical ? columns : names;
    const seen = new Set<string>();
    for (const line of inner.slice(1)) {
      const cells = cellsOf(line);
      if (!cells) { malformed = true; continue; }
      if (cells.length && cells.every(cell => /^[-:\s]+$/.test(cell.raw))) continue;
      if (cells.slice(layout.length).some(cell => cell.raw) || layout.slice(cells.length, names.length).some(name => !optional.has(name))) { malformed = true; continue; }
      const fields = Object.fromEntries(layout.map((name, index) => [name, cells[index]?.raw ?? ""]));
      const confidence = fields.confidence;
      if (!/^[1-9]\d*$/.test(fields["#"]) || !Number.isSafeInteger(Number(fields["#"])) || seen.has(fields["#"]) || !fields.claim ||
          !["event", "preference", "commitment", "belief", "fact", "idea"].includes(fields.kind.toLowerCase()) ||
          !["private", "world"].includes(fields.visibility.toLowerCase()) || !["high", "medium", "low"].includes(fields.notability.toLowerCase()) ||
          !plainNumber.test(confidence) || !Number.isFinite(Number(confidence)) || Number(confidence) < 0 || Number(confidence) > 1 ||
          !validTypedNumber(fields.claim_value ?? "") || (fields.attributed_to && !["user", "assistant", "other"].includes(fields.attributed_to.toLowerCase()))) { malformed = true; continue; }
      seen.add(fields["#"]);
      const claim = cells[layout.indexOf("claim")];
      const location = { section: section.id, start: claim.start, end: claim.end };
      if (!verifiedPageLocation(sections, location, fields.claim)) { malformed = true; continue; }
      rows.push({ id: JSON.stringify([pageIdentity, section.id, line.start]), claim: fields.claim, kind: fields.kind, fields, location });
    }
  }
  // A malformed region cannot support a statement that the published memory section was verified.
  if (malformed) return { availability: "unknown", rows: [] };
  return { availability: rows.length ? "available" : "empty", rows };
}

function exactPage(value: unknown, request: PageDetailRequest): value is Record<string, unknown> {
  const [, sourceId] = JSON.parse(request.source) as [string, string];
  return record(value) && value.slug === request.slug && value.source_id === sourceId &&
    (value.resolved_slug === undefined || value.resolved_slug === request.slug) && typeof value.title === "string" && typeof value.type === "string" &&
    !value.deleted_at;
}
function timestamp(value: unknown): { value: string | null; availability: "available" | "missing" | "invalid" } {
  if (value === undefined || value === null) return { value: null, availability: "missing" };
  return isInstant(value) ? { value, availability: "available" } : { value: null, availability: "invalid" };
}
function metadata(value: Record<string, unknown>, request: PageDetailRequest, namespace: string, observation: ObservationInterval): Page {
  const [, sourceId] = JSON.parse(request.source) as [string, string];
  const created = timestamp(value.created_at), modified = timestamp(value.updated_at);
  return { namespace, sourceId, slug: request.slug, title: value.title as string, kind: value.type as string,
    createdAt: created.value, updatedAt: modified.value, creationAvailability: created.availability, modificationAvailability: modified.availability, detailObservation: observation };
}
export function projectPublicPageDetail(value: unknown, request: PageDetailRequest, namespace: string, sourceName: string, observation: ObservationInterval): PageDetailSnapshot | null {
  if (!validPageDetailRequest(request) || (JSON.parse(request.source) as [string, string])[0] !== namespace || !exactPage(value, request)) return null;
  const page = metadata(value, request, namespace, observation);
  const protectedBody = value.body_omitted === true || (record(value.quarantined) && value.quarantined.body_omitted === true);
  const partial = value.truncated === true || value.partial === true || value.next_cursor !== undefined || value.window !== undefined || ["none", "outline", "window"].includes(String(value.body));
  const sections: PageBodySection[] = [];
  if (!protectedBody) {
    if (typeof value.compiled_truth === "string") sections.push({ id: "compiled-truth", text: value.compiled_truth });
    if (typeof value.timeline === "string") sections.push({ id: "timeline", text: value.timeline });
    if (record(value.window) && typeof value.window.text === "string") sections.push({ id: "window", text: value.window.text });
  }
  const complete = !protectedBody && !partial && typeof value.compiled_truth === "string" && typeof value.timeline === "string";
  const availability = protectedBody ? "protected" : complete ? "available" : partial || sections.length ? "partial" : "unknown";
  return { page, sourceName, body: { availability, sections, observation }, memories: parsePublicMemories(sections, complete, pageReference(page)),
    backlinks: { availability: "unknown", pages: [], omitted: 0, truncated: false, listObservation: null, coverage: "unknown", candidateLimit: 10 }, observation };
}
function failed(cause: ProcessCause): PageDetailResult {
  return cause === "permission" ? { kind: "denied", reason: "access-denied" } : { kind: "failure", reason: "request-failed" };
}

/** Fixed public operations under the shared lease; exact current Source authority precedes content reads. */
export async function readPageDetail(request: PageDetailRequest, config: ConnectionConfig | null = getConnectionConfig()): Promise<PageDetailResult> {
  if (!validPageDetailRequest(request)) return { kind: "unavailable", reason: "page-unavailable" };
  if (!config) return { kind: "unconfigured", reason: "adapter-not-configured" };
  const [namespace, sourceId] = JSON.parse(request.source) as [string, string];
  if (namespace !== connectionNamespace(config) || !/^[a-z0-9-]{1,32}$/.test(sourceId)) return { kind: "unavailable", reason: "page-unavailable" };
  if (!acquireConnectionLease()) return { kind: "failure", reason: "busy" };
  const startedAt = now(), deadline = Date.now() + pageAcquisitionDeadlineMs;
  try {
    const version = await runCommand(config, "version", deadline);
    if (!version.ok) return failed(version.cause);
    if (/^gbrain (\d+\.\d+\.\d+\.\d+)\s*$/.exec(version.stdout)?.[1] !== supportedVersion) return { kind: "unknown", reason: "unsupported" };
    const catalog = await runCommand(config, "capabilities", deadline);
    if (!catalog.ok) return failed(catalog.cause);
    const capabilities: unknown = JSON.parse(catalog.stdout);
    if (!hasSafeSourceCapability(capabilities) || !hasSafeDetailCapability(capabilities)) return { kind: "unknown", reason: "unsupported" };
    const sources = await runCommand(config, "sources", deadline);
    if (!sources.ok) return failed(sources.cause);
    const allowed = sourceRows(JSON.parse(sources.stdout));
    if (!allowed) return { kind: "unknown", reason: "unsupported" };
    const selectedSource = allowed.find(source => source.id === sourceId);
    if (!selectedSource) return { kind: "unavailable", reason: "page-unavailable" };
    const detailStartedAt = now();
    const result = await runCommand(config, { kind: "page", sourceId, slug: request.slug }, deadline);
    if (!result.ok) return failed(result.cause);
    const snapshot = projectPublicPageDetail(JSON.parse(result.stdout), request, namespace, selectedSource.name, { startedAt: detailStartedAt, completedAt: now() });
    if (!snapshot) return { kind: "unavailable", reason: "page-unavailable" };
    if (hasSafeBacklinkCapability(capabilities)) {
      const backlinkStartedAt = now();
      const backlinks = await runCommand(config, { kind: "backlinks", sourceId, slug: request.slug }, deadline);
      const listObservation = { startedAt: backlinkStartedAt, completedAt: now() };
      snapshot.backlinks.listObservation = listObservation;
      if (!backlinks.ok) {
        if (backlinks.cause === "permission") return failed(backlinks.cause);
        snapshot.backlinks.availability = "failed";
      } else {
        let candidates: unknown;
        try { candidates = JSON.parse(backlinks.stdout); } catch { candidates = null; }
        if (Array.isArray(candidates) && candidates.length <= 10) {
          const confirmed: PageDetailSnapshot["backlinks"]["pages"] = [];
          const seen = new Set<string>();
          let omitted = 0, truncated = false;
          for (const candidate of candidates) {
            if (record(candidate) && candidate.truncated === true) truncated = true;
            if (!safeBacklinkRow(candidate) || candidate.to_source_id !== sourceId || candidate.to_slug !== request.slug ||
                typeof candidate.from_source_id !== "string" || !validPageSlug(candidate.from_slug)) { omitted++; continue; }
            const source = allowed.find(item => item.id === candidate.from_source_id);
            const reference = JSON.stringify([namespace, candidate.from_source_id]);
            if (!source || !boundedSourceReference(reference)) { omitted++; continue; }
            const endpoint = { source: reference, slug: candidate.from_slug };
            const key = JSON.stringify([reference, candidate.from_slug]);
            if (seen.has(key)) continue;
            seen.add(key);
            if (Date.now() >= deadline) { omitted++; continue; }
            const endpointStartedAt = now();
            const endpointResult = await runCommand(config, { kind: "page", sourceId: source.id, slug: endpoint.slug }, deadline);
            if (!endpointResult.ok) {
              if (endpointResult.cause === "permission") return failed(endpointResult.cause);
              omitted++; continue;
            }
            let value: unknown;
            try { value = JSON.parse(endpointResult.stdout); } catch { omitted++; continue; }
            if (!exactPage(value, endpoint)) { omitted++; continue; }
            // Endpoint reads contribute identity and metadata only. Their body/frontmatter is discarded.
            confirmed.push({ page: metadata(value, endpoint, namespace, { startedAt: endpointStartedAt, completedAt: now() }), sourceName: source.name });
          }
          snapshot.backlinks = { pages: confirmed, omitted, truncated, listObservation, coverage: "unknown", candidateLimit: 10,
            availability: omitted || truncated ? "partial" : confirmed.length ? "available" : "empty" };
        } else if (Array.isArray(candidates)) {
          // An upstream violation of the requested limit is untrusted, but its overflow is not hidden.
          snapshot.backlinks.omitted = candidates.length;
          snapshot.backlinks.truncated = true;
        }
      }
    }
    snapshot.observation = { startedAt, completedAt: now() };
    return { kind: "success", snapshot };
  } catch { return { kind: "unknown", reason: "unsupported" }; }
  finally { releaseConnectionLease(); }
}
