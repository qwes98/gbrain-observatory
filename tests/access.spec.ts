import { request as httpRequest } from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse } from '@playwright/test';
import { localeCookie, sourceMessages, type Locale } from '../src/i18n/messages';
import { evaluateAccess, getAccessConfig, type AccessEnvironment } from '../src/security/policy';
import { timeZoneCookie } from '../src/i18n/time-zone';
import { configuredExternalOrigin, configuredOwner, directBackendOrigin, productionOrigin, unconfiguredOrigin, ui } from './support/ui';

async function expectRejection(response: APIResponse, status = 403) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('private');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['set-cookie']).toBeUndefined();
  const body = await response.text();
  for (const value of [configuredOwner, configuredExternalOrigin, 'other@example.test', 'hostile.example.test', ui.description, ui.issues.unconfigured.reason]) expect(body).not.toContain(value);
  expect(body).not.toMatch(/stack trace|NEXT_REDIRECT|Error:|\$ACTION_ID_/);
}

test('owner screen and RSC responses are private and bypassed API paths remain protected', async ({ request }) => {
  for (const headers of [{} as Record<string, string>, { rsc: '1' }]) {
    const response = await request.get(productionOrigin, { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('private');
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.text()).toContain(ui.description);
  }
  expect((await request.get(`${productionOrigin}/api/future`)).status()).toBe(404);
});

test('Serve emulator strips client identity and forwarded spoofing centrally', async ({ request }) => {
  const response = await request.get(productionOrigin, { headers: {
    'Tailscale-User-Login': 'other@example.test', 'Tailscale-User-Name': 'spoof',
    'X-Forwarded-Host': 'hostile.example.test', 'X-Forwarded-Proto': 'http',
    Forwarded: 'host=hostile.example.test;proto=http',
  } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(ui.issues.unconfigured.title);
});

for (const mode of ['missing', 'other', 'ambiguous', 'host']) {
  test(`${mode} access denies page, RSC, action and future API before application work`, async ({ request }) => {
    const headers = { 'x-observatory-test-access': mode };
    for (const path of ['/', '/api/future', '/_next/static/../..', '/fonts/../api/future', '/source.js', '/api/future.png', '/_next/static/fake.js', '/fonts/fake.woff2']) {
      await expectRejection(await request.get(`${productionOrigin}${path}`, { headers }));
    }
    await expectRejection(await request.get(productionOrigin, { headers: { ...headers, rsc: '1' } }));
    await expectRejection(await request.post(productionOrigin, { headers: { ...headers, origin: configuredExternalOrigin, 'next-action': 'unknown' }, data: '[]' }));
  });
}

test('direct loopback requests cannot use forwarded headers to bypass the policy', async ({ request }) => {
  await expectRejection(await request.get(directBackendOrigin));
  await expectRejection(await request.get(directBackendOrigin, { headers: {
    'x-forwarded-host': new URL(configuredExternalOrigin).host,
    'x-forwarded-proto': 'https', Forwarded: `host=${new URL(configuredExternalOrigin).host};proto=https`,
  } }));
  await expectRejection(await request.get(directBackendOrigin, { headers: {
    'tailscale-user-login': configuredOwner,
    'x-forwarded-host': new URL(configuredExternalOrigin).host,
  } }));
});

for (const origin of ['http://observatory.example.test:8443', 'https://other.example.test:8443', 'https://observatory.example.test', 'https://observatory.example.test:8444', '', 'null', 'not-an-origin', `${configuredExternalOrigin}/path`, `${configuredExternalOrigin},https://other.example.test`]) {
  test(`invalid Origin ${origin} is rejected for reads and execution`, async ({ request }) => {
    for (const path of ['/', '/api/future']) {
      await expectRejection(await request.get(`${productionOrigin}${path}`, { headers: { origin } }));
      await expectRejection(await request.post(`${productionOrigin}${path}`, { headers: { origin, 'next-action': 'unknown' }, data: '[]' }));
    }
  });
}

test('executing requests require Origin even with the owner identity', async ({ request }) => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await expectRejection(await request.fetch(`${productionOrigin}/api/future`, { method }));
  }
  await expectRejection(await request.post(productionOrigin, { headers: { 'next-action': 'unknown' }, data: '[]' }));
});

test('invalid server configuration fails closed for page, RSC, action and API', async ({ request }) => {
  for (const path of ['/', '/api/future']) {
    await expectRejection(await request.get(`${unconfiguredOrigin}${path}`), 503);
    await expectRejection(await request.post(`${unconfiguredOrigin}${path}`, { headers: { origin: configuredExternalOrigin }, data: '[]' }), 503);
  }
  await expectRejection(await request.get(unconfiguredOrigin, { headers: { rsc: '1' } }), 503);
});

for (const locale of ['en', 'ko'] as const) {
  for (const javaScriptEnabled of [true, false]) {
    for (const setting of ['language', 'timeZone'] as const) {
      test(`${locale} rejected real ${setting} form shows guidance and keeps preferences with JavaScript ${javaScriptEnabled}`, async ({ browser }) => {
        const context = await browser.newContext({ javaScriptEnabled });
        try {
          await context.addCookies([
            { name: localeCookie, value: locale, url: productionOrigin },
            { name: timeZoneCookie, value: 'Asia/Seoul', url: productionOrigin },
          ]);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          const t = sourceMessages[locale];
          await page.goto(productionOrigin);
          if (setting === 'language') await page.getByRole('combobox', { name: t.language, exact: true }).selectOption(locale === 'en' ? 'ko' : 'en');
          else await page.getByRole('combobox', { name: t.timeZone, exact: true }).selectOption('UTC');
          await context.setExtraHTTPHeaders({ 'x-observatory-test-access': 'missing' });
          const rejection = page.waitForResponse(response => response.request().method() === 'POST');
          await page.getByRole('button', { name: setting === 'language' ? t.applyLanguage : t.applyTimeZone, exact: true }).click();
          const response = await rejection;
          expect(response.status()).toBe(403);
          expect(response.headers()['set-cookie']).toBeUndefined();
          expect(response.headers()['x-action-redirect']).toBe(javaScriptEnabled ? '/;replace' : undefined);
          await expect(page.getByRole('heading', { level: 1, name: t.access.denied.title, exact: true })).toBeVisible();
          await expect(page.getByText(t.access.denied.action, { exact: true })).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          expect(errors).toEqual([]);
          const cookies = await context.cookies();
          expect(cookies.find(cookie => cookie.name === localeCookie)?.value).toBe(locale);
          expect(cookies.find(cookie => cookie.name === timeZoneCookie)?.value).toBe('Asia/Seoul');
        } finally { await context.close(); }
      });
    }
  }
}

for (const locale of ['en', 'ko'] as const satisfies readonly Locale[]) {
  for (const state of ['denied', 'unconfigured'] as const) {
    test(`${locale} ${state} guidance remains accessible at 320px and 200% text`, async ({ browser }) => {
      const origin = state === 'denied' ? productionOrigin : unconfiguredOrigin;
      const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
      try {
        await context.addCookies([{ name: localeCookie, value: locale, url: origin }, ...(state === 'denied' ? [{ name: 'observatory-test-access', value: 'missing', url: origin }] : [])]);
        const page = await context.newPage();
        const response = await page.goto(origin);
        expect(response?.status()).toBe(state === 'denied' ? 403 : 503);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('link')).toHaveCount(1);
        // Fixed examples provide independent protection against a shared catalog fallback.
        const fixed = locale === 'en' ? (state === 'denied' ? 'Private access required' : 'Private access is not ready') : (state === 'denied' ? '비공개 접근이 필요해요' : '비공개 접근이 아직 준비되지 않았어요');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(fixed);
        await expect(page).toHaveTitle(`${fixed} · GBrain Observatory`);
        expect(response?.headers()['content-language']).toBe(locale);
        const access = sourceMessages[locale].access;
        const message = state === 'denied' ? access.denied : access.unavailable;
        await expect(page.locator('meta[name=description]')).toHaveAttribute('content', message.reason);
        await expect(page.getByText(message.action, { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: access.retry, exact: true })).toHaveAttribute('href', '/');
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
        await page.screenshot({ path: `test-results/access-${locale}-${state}-320px-200pct.png`, fullPage: true });
      } finally { await context.close(); }
    });
  }
}

const validEnvironment = { OBSERVATORY_OWNER_LOGIN: configuredOwner, OBSERVATORY_EXTERNAL_ORIGIN: configuredExternalOrigin };

function ownerHeaders() {
  return new Headers({ host: new URL(configuredExternalOrigin).host, 'tailscale-user-login': configuredOwner });
}

test('configuration validation rejects absent and malformed settings without request fallback', () => {
  const invalid: AccessEnvironment[] = [
    {}, { OBSERVATORY_EXTERNAL_ORIGIN: configuredExternalOrigin }, { OBSERVATORY_OWNER_LOGIN: configuredOwner },
    ...['', ' owner@example.test', 'owner@example.test ', 'owner', 'one@example.test,two@example.test', 'a\\n@example.test'].map(owner => ({ ...validEnvironment, OBSERVATORY_OWNER_LOGIN: owner })),
    ...['', 'http://observatory.example.test:8443', 'https://owner:secret@observatory.example.test:8443', `${configuredExternalOrigin}/`, `${configuredExternalOrigin}/path`, `${configuredExternalOrigin}?query`, `${configuredExternalOrigin}#fragment`, 'https://*.example.test', 'not-a-url', ` ${configuredExternalOrigin}`, 'https://observatory.example.test.', 'https://observatory.example.test:0'].map(origin => ({ ...validEnvironment, OBSERVATORY_EXTERNAL_ORIGIN: origin })),
  ];
  for (const environment of invalid) {
    expect(getAccessConfig(environment)).toBeNull();
    expect(evaluateAccess(ownerHeaders(), 'GET', environment)).toEqual({ allowed: false, status: 503 });
  }
  expect(getAccessConfig(validEnvironment)).toEqual({ owner: configuredOwner, origin: configuredExternalOrigin, host: new URL(configuredExternalOrigin).host });
});

test('policy matches exact owner, host, forwarded fields and Origin', () => {
  expect(evaluateAccess(ownerHeaders(), 'GET', validEnvironment)).toEqual({ allowed: true });
  expect(evaluateAccess(ownerHeaders(), 'HEAD', validEnvironment)).toEqual({ allowed: true });
  const validExecution = ownerHeaders();
  validExecution.set('origin', configuredExternalOrigin);
  expect(evaluateAccess(validExecution, 'POST', validEnvironment)).toEqual({ allowed: true });
  for (const [header, value] of [
    ['tailscale-user-login', 'other@example.test'], ['tailscale-user-login', configuredOwner.toUpperCase()],
    ['tailscale-user-login', `${configuredOwner}, ${configuredOwner}`],
    ['host', 'hostile.example.test:8443'], ['host', 'observatory.example.test'],
    ['x-forwarded-host', 'hostile.example.test:8443'], ['x-forwarded-proto', 'http'],
    ['forwarded', `host=${new URL(configuredExternalOrigin).host};proto=https`],
  ]) {
    const headers = ownerHeaders();
    headers.set(header, value);
    expect(evaluateAccess(headers, 'GET', validEnvironment)).toEqual({ allowed: false, status: 403 });
  }
  const duplicate = ownerHeaders();
  duplicate.append('tailscale-user-login', configuredOwner);
  expect(evaluateAccess(duplicate, 'GET', validEnvironment)).toEqual({ allowed: false, status: 403 });
});

for (const javaScriptEnabled of [true, false]) {
  test(`wrong Origin rejects a real preference action with JavaScript ${javaScriptEnabled}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    try {
      await context.addCookies([{ name: localeCookie, value: 'en', url: productionOrigin }]);
      const page = await context.newPage();
      await page.goto(productionOrigin);
      await page.getByRole('combobox', { name: ui.language, exact: true }).selectOption('ko');
      await context.setExtraHTTPHeaders({ 'x-observatory-test-access': 'origin' });
      const rejected = page.waitForResponse(response => response.request().method() === 'POST');
      await page.getByRole('button', { name: ui.applyLanguage, exact: true }).click();
      const response = await rejected;
      expect(response.status()).toBe(403);
      expect(response.headers()['set-cookie']).toBeUndefined();
      expect((await context.cookies()).find(cookie => cookie.name === localeCookie)?.value).toBe('en');
    } finally { await context.close(); }
  });
}

test('real duplicate identity fields are rejected before Next rendering', async () => {
  const response = await new Promise<{ status: number; cacheControl: string | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(`${directBackendOrigin}/`, { headers: [
      'Host', new URL(configuredExternalOrigin).host,
      'Tailscale-User-Login', configuredOwner, 'Tailscale-User-Login', configuredOwner,
    ] }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode || 0, cacheControl: incoming.headers['cache-control'], body }));
    });
    request.on('error', reject);
    request.end();
  });
  expect(response.status).toBe(403);
  expect(response.cacheControl).toContain('private');
  expect(response.cacheControl).toContain('no-store');
  expect(response.body).not.toContain(configuredOwner);
  expect(response.body).not.toContain(ui.description);
});
