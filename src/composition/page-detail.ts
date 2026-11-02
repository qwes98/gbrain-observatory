import "server-only";
import { readPageDetail } from "@/adapters/gbrain";
import type { PageDetailRequest, PageDetailResult } from "@/contracts/page-detail";

/** Transport authorization is checked first; the adapter revalidates exact Source authority on every read. */
export async function getPageDetail(request: PageDetailRequest): Promise<PageDetailResult> {
  return readPageDetail(request);
}
