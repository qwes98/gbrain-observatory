import "server-only";
import { getConnectionConfig } from "@/adapters/gbrain";
import type { SourceListResult } from "@/contracts/sources";

/** Connection probes do not populate the source list; Story 1.4 owns that integration. */
export function getInitialSourceList(): SourceListResult {
  return getConnectionConfig() ? { kind: "pending", reason: "integration-pending" } : { kind: "unconfigured", reason: "adapter-not-configured" };
}
