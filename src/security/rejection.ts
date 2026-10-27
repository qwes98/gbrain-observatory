import { localeCookie, resolveLocale, sourceMessages } from '@/i18n/messages';

export const privateCacheControl = 'private, no-store, max-age=0';

export function accessRejection(headers: Pick<Headers, 'get'>, status: 403 | 503): Response {
  const storedLocale = headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${localeCookie}=`))?.slice(localeCookie.length + 1);
  const locale = resolveLocale(storedLocale);
  const t = sourceMessages[locale].access;
  const message = status === 503 ? t.unavailable : t.denied;
  // Only typed, fixed catalog text is rendered. Request and configuration values never enter the response.
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${message.title} · GBrain Observatory</title><meta name="description" content="${message.reason}"><style>body{margin:0;background:#f8f9fa;color:#202124;font:1rem/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:42rem;margin:8vh auto;padding:1rem;overflow-wrap:anywhere}h1{font-size:1.75em;line-height:1.3}a{display:inline-block;color:#174ea6;min-height:44px;align-content:center}p{margin-block:1rem}</style></head><body><main><h1>${message.title}</h1><p>${message.reason}</p><p>${message.action}</p><a href="/">${t.retry}</a></main></body></html>`;
  return new Response(html, { status, headers: {
    // Next's action reducer recognizes this fixed destination and performs a full navigation.
    // Keep the rejection status and never reflect an untrusted return URL.
    ...(headers.get('next-action') !== null ? { 'x-action-redirect': '/;replace' } : {}),
    'content-type': 'text/html; charset=utf-8',
    'content-language': locale,
    'cache-control': privateCacheControl,
    'vary': 'Cookie',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}
