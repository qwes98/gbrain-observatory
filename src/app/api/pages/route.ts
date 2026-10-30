import { headers } from "next/headers";
import { evaluateAccess } from "@/security/policy";
import { privateCacheControl } from "@/security/rejection";
import { getSourcePages } from "@/composition/pages";
import { boundedSourceReference } from "@/contracts/sources";
import { validPageOffset } from "@/contracts/pages";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const decision = evaluateAccess(await headers(), "POST");
  const responseHeaders = { "Cache-Control": privateCacheControl };
  if (!decision.allowed) return Response.json({ kind: "denied", reason: "access-denied" }, { status: decision.status, headers: responseHeaders });
  const rejected = () => Response.json({ kind: "unavailable", reason: "source-unavailable" }, { status: 400, headers: responseHeaders });
  // Bound bytes before JSON parsing; copied requests can choose only validated scope and raw offset.
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return rejected();
  const reader = request.body?.getReader();
  if (!reader) return rejected();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return rejected(); }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return rejected();
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["source", "offset"].includes(key)) || typeof input.source !== "string" || !boundedSourceReference(input.source) || !validPageOffset(input.offset)) return rejected();
    return Response.json(await getSourcePages({ source: input.source, offset: input.offset }), { headers: responseHeaders });
  } catch { return rejected(); }
}
