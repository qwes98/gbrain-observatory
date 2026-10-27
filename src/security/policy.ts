/** Server configuration is fixed at process startup, never derived from a request. */
export type AccessEnvironment = {
  OBSERVATORY_OWNER_LOGIN?: string;
  OBSERVATORY_EXTERNAL_ORIGIN?: string;
};
export type AccessConfig = { owner: string; origin: string; host: string };
export type AccessDecision = { allowed: true } | { allowed: false; status: 403 | 503 };

function runtimeEnvironment(): AccessEnvironment {
  return {
    OBSERVATORY_OWNER_LOGIN: process.env.OBSERVATORY_OWNER_LOGIN,
    OBSERVATORY_EXTERNAL_ORIGIN: process.env.OBSERVATORY_EXTERNAL_ORIGIN,
  };
}

const loginPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;

export function getAccessConfig(environment: AccessEnvironment = runtimeEnvironment()): AccessConfig | null {
  const owner = environment.OBSERVATORY_OWNER_LOGIN;
  const origin = environment.OBSERVATORY_EXTERNAL_ORIGIN;
  if (!owner || owner.length > 254 || !loginPattern.test(owner) || !origin) return null;
  const [local, domain] = owner.split('@');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      domain.split('.').some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) return null;
  try {
    const url = new URL(origin);
    // Canonical serialization rejects credentials, paths, fragments, whitespace and alternate spellings.
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password ||
        url.port === '0' || !url.hostname || url.hostname.includes('*') || url.hostname.endsWith('.')) return null;
    return { owner, origin, host: url.host };
  } catch {
    return null;
  }
}

/** Trust the identity only behind Serve on a loopback listener with trusted local processes. */
export function evaluateAccess(
  headers: Pick<Headers, 'get'>,
  method: string,
  environment: AccessEnvironment = runtimeEnvironment(),
): AccessDecision {
  const config = getAccessConfig(environment);
  if (!config) return { allowed: false, status: 503 };
  const deny = { allowed: false, status: 403 } as const;
  // Headers merges duplicate field values with commas; equality rejects ambiguous identities and hosts.
  if (headers.get('tailscale-user-login') !== config.owner || headers.get('host') !== config.host) return deny;
  const forwardedHost = headers.get('x-forwarded-host');
  const forwardedProtocol = headers.get('x-forwarded-proto');
  if ((forwardedHost !== null && forwardedHost !== config.host) ||
      (forwardedProtocol !== null && forwardedProtocol !== 'https') || headers.get('forwarded') !== null) return deny;
  const origin = headers.get('origin');
  const navigation = method === 'GET' || method === 'HEAD';
  if (origin !== null ? origin !== config.origin : !navigation) return deny;
  return { allowed: true };
}
