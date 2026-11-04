import "server-only";
import { listFacts, readFactDetail } from "@/adapters/gbrain";
import type { FactRequest, FactDetailRequest, FactListResult, FactDetailResult } from "@/contracts/facts";

export async function getSourceFacts(request: FactRequest): Promise<FactListResult> { return listFacts(request); }
export async function getFactDetail(request: FactDetailRequest): Promise<FactDetailResult> { return readFactDetail(request); }
