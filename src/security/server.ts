import 'server-only';
import { headers } from 'next/headers';
import { evaluateAccess } from './policy';

/** Recheck at the data/action boundary even when Proxy already authorized the request. */
export async function requireOwnerAccess(method: 'GET' | 'POST' = 'GET'): Promise<void> {
  const decision = evaluateAccess(await headers(), method);
  if (!decision.allowed) throw new Error('Private access is unavailable.');
}
