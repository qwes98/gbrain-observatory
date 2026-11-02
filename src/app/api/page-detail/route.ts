import { headers } from "next/headers";
import { evaluateAccess } from "@/security/policy";
import { privateCacheControl } from "@/security/rejection";
import { getPageDetail } from "@/composition/page-detail";
import { validPageDetailRequest } from "@/contracts/page-detail";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const decision = evaluateAccess(await headers(), "POST");
  const responseHeaders = { "Cache-Control": privateCacheControl };
  if (!decision.allowed) return Response.json({ kind: "denied", reason: "access-denied" }, { status: decision.status, headers: responseHeaders });
  const rejected = () => Response.json({ kind: "unavailable", reason: "page-unavailable" }, { status: 400, headers: responseHeaders });
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
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!validPageDetailRequest(body)) return rejected();
    return Response.json(await getPageDetail(body), { headers: responseHeaders });
  } catch { return rejected(); }
}
