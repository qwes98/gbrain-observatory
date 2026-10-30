import "server-only";
import { listPages } from "@/adapters/gbrain";
import type { PageListResult, PageRequest } from "@/contracts/pages";

/** Owner authorization belongs to the transport; exact Source scope is rechecked by the adapter. */
export async function getSourcePages(request: PageRequest): Promise<PageListResult> {
  return listPages(request);
}
