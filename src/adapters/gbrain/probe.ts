import { isInstant } from "../../i18n/time-zone";
import { createHash } from "node:crypto";
import type { SourceListResult, Source } from "../../contracts/sources";
import type { ConnectionResult } from "../../contracts/connection";
import { getConnectionConfig, runCommand, type ConnectionConfig } from "./runner";

export const supportedVersion = "0.60.323.0";
const leaseKey = Symbol.for("observatory.gbrain.connection-lease");
const runtime = globalThis as typeof globalThis & { [leaseKey]?: boolean };
export function acquireConnectionLease(): boolean {
  if (runtime[leaseKey]) return false;
  runtime[leaseKey] = true;
  return true;
}
export function releaseConnectionLease(): void { runtime[leaseKey] = false; }
export function connectionNamespace(config: ConnectionConfig): string {
  return "connection-" + createHash("sha256").update(JSON.stringify([config.executable, config.cwd])).digest("hex");
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function hasSafeSourceCapability(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const candidates = value.filter(item => record(item) && item.name === "sources_list");
  if (candidates.length !== 1) return false;
  const tool = candidates[0];
  if (tool.scope !== "read" || tool.mutating !== false || tool.idempotent !== true ||
      !Array.isArray(tool.required_scopes) || tool.required_scopes.length !== 0 ||
      !record(tool.parameters) || Object.keys(tool.parameters).some(key => key !== "include_archived") ||
      tool.parameters.include_archived !== "boolean?" || !record(tool.schema)) return false;
  const schema = tool.schema;
  if (Object.keys(schema).some(key => !["type", "properties", "required", "additionalProperties"].includes(key))) return false;
  return schema.type === "object" && record(schema.properties) &&
    Object.keys(schema.properties).length === 1 && record(schema.properties.include_archived) &&
    schema.properties.include_archived.type === "boolean" &&
    Object.keys(schema.properties.include_archived).every(key => ["type", "description", "default"].includes(key)) &&
    (schema.properties.include_archived.default === undefined || schema.properties.include_archived.default === false) &&
    (schema.required === undefined || (Array.isArray(schema.required) && schema.required.length === 0));
}

/** Reject continuation/partial/unrecognized envelopes instead of claiming complete coverage. */
export function sourceRows(value: unknown): PublicSource[] | null {
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.sources)) return null;
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (!record(source) || typeof source.id !== "string" || !/^[a-z0-9-]{1,32}$/.test(source.id) || ids.has(source.id) ||
        typeof source.name !== "string" || typeof source.federated !== "boolean" ||
        !Number.isSafeInteger(source.page_count) || (source.page_count as number) < 0 ||
        !["local_path", "remote_url", "strategy", "last_sync_at"].every(key => source[key] === null || typeof source[key] === "string") ||
        (typeof source.last_sync_at === "string" && !isInstant(source.last_sync_at)) ||
        Object.keys(source).some(key => !["id", "name", "local_path", "remote_url", "federated", "strategy", "page_count", "last_sync_at"].includes(key))) return null;
    ids.add(source.id);
  }
  return value.sources as PublicSource[];
}

type PublicSource = {
  id: string; name: string; local_path: string | null; remote_url: string | null;
  federated: boolean; strategy: string | null; page_count: number; last_sync_at: string | null;
};
export function sourceProbeCount(value: unknown): number | null {
  return sourceRows(value)?.length ?? null;
}
type Acquisition = Exclude<ConnectionResult, { kind: "success" }> | {
  kind: "success"; rows: PublicSource[]; observedAt: string;
};
/** One process lease and the same three bounded commands for either public read consumer. */
async function acquire(config: ConnectionConfig | null): Promise<Acquisition> {
  if (!config) return { kind: "unconfigured", cause: "settings" };
  if (!acquireConnectionLease()) return { kind: "failure", cause: "busy" };
  try {
    const versionResult = await runCommand(config, "version");
    if (!versionResult.ok) return { kind: "failure", cause: versionResult.cause };
    const version = /^gbrain (\d+\.\d+\.\d+\.\d+)\s*$/.exec(versionResult.stdout)?.[1];
    if (version !== supportedVersion) return { kind: "failure", cause: "compatibility" };
    const capabilityResult = await runCommand(config, "capabilities");
    if (!capabilityResult.ok) return { kind: "failure", cause: capabilityResult.cause };
    if (!hasSafeSourceCapability(JSON.parse(capabilityResult.stdout))) return { kind: "failure", cause: "compatibility" };
    const sourceResult = await runCommand(config, "sources");
    if (!sourceResult.ok) return { kind: "failure", cause: sourceResult.cause };
    const rows = sourceRows(JSON.parse(sourceResult.stdout));
    if (!rows) return { kind: "failure", cause: "compatibility" };
    return { kind: "success", rows, observedAt: new Date().toISOString() };
  } catch {
    return { kind: "failure", cause: "compatibility" };
  } finally {
    releaseConnectionLease();
  }
}
export async function checkConnection(config: ConnectionConfig | null = getConnectionConfig()): Promise<ConnectionResult> {
  const result = await acquire(config);
  if (result.kind !== "success") return result;
  return { kind: "success", observation: { version: supportedVersion, observedAt: result.observedAt, scope: "local-active-sources", sourceCount: result.rows.length } };
}
export async function listSources(config: ConnectionConfig | null = getConnectionConfig()): Promise<SourceListResult> {
  const result = await acquire(config);
  if (result.kind === "unconfigured" || !config) return { kind: "unconfigured", reason: "adapter-not-configured" };
  if (result.kind === "failure") {
    if (result.cause === "compatibility") return { kind: "unknown", reason: "unsupported" };
    if (result.cause === "permission") return { kind: "denied", reason: "access-denied" };
    return { kind: "failure", reason: result.cause === "busy" ? "busy" : "request-failed" };
  }
  // Namespace is stable across reads and discloses neither executable nor working directory.
  const namespace = connectionNamespace(config);
  const sources: Source[] = result.rows.map(row => ({
    namespace, id: row.id, name: row.name, connection: {
      ...(row.local_path !== null ? { folder: row.local_path } : {}),
      ...(row.remote_url !== null ? { repository: row.remote_url } : {}),
    }, federated: row.federated, strategy: row.strategy, pageCount: row.page_count,
    sync: { status: "unknown", label: "" }, lastSyncedAt: row.last_sync_at, checkedAt: result.observedAt,
  }));
  return { kind: "success", snapshot: { sources, checkedAt: result.observedAt, scope: "returned-active-sources", coverage: "unknown" } };
}
