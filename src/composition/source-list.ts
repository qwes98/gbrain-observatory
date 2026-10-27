import "server-only";
import type { SourceListResult } from "@/contracts/sources";

/** Story 1.1 has no configured adapter or live request path. */
export function getInitialSourceList(): SourceListResult {
  return { kind: "unconfigured", reason: "adapter-not-configured" };
}
