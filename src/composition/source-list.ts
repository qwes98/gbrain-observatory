import "server-only";
import { listSources } from "@/adapters/gbrain";
import type { SourceListResult } from "@/contracts/sources";

/** Called only after the request's owner guard, never during a static build. */
export async function getInitialSourceList(): Promise<SourceListResult> {
  return listSources();
}
