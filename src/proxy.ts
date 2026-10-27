import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAccess } from './security/policy';
import { accessRejection, privateCacheControl } from './security/rejection';

export function proxy(request: NextRequest) {
  const decision = evaluateAccess(request.headers, request.method);
  if (!decision.allowed) return accessRejection(request.headers, decision.status);
  const response = NextResponse.next();
  response.headers.set('Cache-Control', privateCacheControl);
  // Same-origin referrers preserve the browser's Origin on native preference forms.
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

// Protect static requests too, so no asset-shaped URL or Server Action can bypass the policy.
export const config = { matcher: ['/:path*'] };
