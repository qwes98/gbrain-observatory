import { headers } from "next/headers";
import { evaluateAccess } from "@/security/policy";
import { privateCacheControl } from "@/security/rejection";
import { getInitialSourceList } from "@/composition/source-list";

export const dynamic = "force-dynamic";
export async function POST() {
  const decision = evaluateAccess(await headers(), "POST");
  const responseHeaders = { "Cache-Control": privateCacheControl };
  if (!decision.allowed) return Response.json({ kind: "denied", reason: "access-denied" }, { status: decision.status, headers: responseHeaders });
  // No request body, query, path or client-provided command reaches the adapter.
  return Response.json(await getInitialSourceList(), { headers: responseHeaders });
}
