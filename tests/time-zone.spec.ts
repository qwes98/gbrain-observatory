import { expect, test, type Page } from '@playwright/test';
import { localeCookie, sourceMessages, type Locale } from '../src/i18n/messages';
import { deviceTimeZoneCookie, formatInstant, isTimeZone, resolveTimeZone, timeZoneCookie, availableTimeZones } from '../src/i18n/time-zone';
import { sourceSnapshot, timeZoneSnapshot } from './fixtures/source-data';
import { fixtureOrigin, productionOrigin, ui as t } from './support/ui';
import { localeExpectations } from './support/locale-expectations';

// These expectations are fixed independently of Intl and the application formatter.
const anchors = {
  UTC: [
    ['01/01/2026, 00:15', 'UTC+00:00'], ['15/01/2026, 12:00', 'UTC+00:00'],
    ['15/07/2026, 12:00', 'UTC+00:00'], ['01/11/2026, 08:30', 'UTC+00:00'], ['01/11/2026, 09:30', 'UTC+00:00'],
  ],
  'Asia/Seoul': [
    ['01/01/2026, 09:15', 'UTC+09:00'], ['15/01/2026, 21:00', 'UTC+09:00'],
    ['15/07/2026, 21:00', 'UTC+09:00'], ['01/11/2026, 17:30', 'UTC+09:00'], ['01/11/2026, 18:30', 'UTC+09:00'],
  ],
  'America/Los_Angeles': [
    ['31/12/2025, 16:15', 'UTC-08:00'], ['15/01/2026, 04:00', 'UTC-08:00'],
    ['15/07/2026, 05:00', 'UTC-07:00'], ['01/11/2026, 01:30', 'UTC-07:00'], ['01/11/2026, 01:30', 'UTC-08:00'],
  ],
} as const;

async function fixture(page: Page, scenario: string, zone = 'auto', locale: Locale = 'en') {
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario, timeZone: zone, locale })}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sourceMessages[locale].sources);
}

async function setDeviceZone(page: Page, zone: string) {
  await page.evaluate(value => {
    (window as unknown as { __timeZoneFixture: { setDeviceZone: (zone: string) => void } }).__timeZoneFixture.setDeviceZone(value);
  }, zone);
}

async function applyZone(page: Page, zone: string, locale: Locale = 'en') {
  const messages = sourceMessages[locale];
  await page.getByRole('combobox', { name: messages.timeZone, exact: true }).selectOption(zone);
  await page.getByRole('button', { name: messages.applyTimeZone, exact: true }).click();
}

test('named-zone validation and preference precedence reject malformed values without losing valid aliases', () => {
  for (const value of [null, undefined, '', 'auto', '+09:00', '-08:00', 'UTC+09:00', 'No/Such_Zone', {}, 1]) {
    expect(isTimeZone(value), String(value)).toBe(false);
  }
  for (const zone of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'US/Pacific', 'Etc/GMT+8']) expect(isTimeZone(zone)).toBe(true);
  expect(resolveTimeZone('Asia/Seoul', 'America/Los_Angeles').effectiveZone).toBe('Asia/Seoul');
  expect(resolveTimeZone('auto', 'America/Los_Angeles').effectiveZone).toBe('America/Los_Angeles');
  expect(resolveTimeZone(undefined, undefined).effectiveZone).toBe('UTC');
  expect(resolveTimeZone('No/Such_Zone', '+09:00').effectiveZone).toBe('UTC');
  expect(resolveTimeZone('No/Such_Zone', 'Asia/Seoul').preference).toBe('auto');
  expect(resolveTimeZone('No/Such_Zone', 'Asia/Seoul').effectiveZone).toBe('Asia/Seoul');
  const choices = availableTimeZones('US/Pacific');
  expect(choices).toContain('UTC');
  expect(choices).toContain('US/Pacific');
  expect(new Set(choices).size).toBe(choices.length);
});

test('instant parsing rejects missing, invalid, local and date-only inputs without inventing midnight', () => {
  for (const value of ['', 'not-a-date', '2026-02-30T10:00:00Z', '2026-10-27', '2026-10-27T03:00:00', '2026-10-27T24:00:00Z', '2026-10-27T03:00:00+99:00', '2026-01-00T00:00:00Z', '2026-13-01T00:00:00Z']) {
    expect(formatInstant(value, 'en', 'UTC'), value).toBeNull();
  }
  expect(formatInstant('2024-02-29T00:00:00Z', 'en', 'UTC')?.text).toBe('29/02/2024, 00:00');
  expect(formatInstant('2025-02-29T00:00:00Z', 'en', 'UTC')).toBeNull();
});

for (const zone of Object.keys(anchors) as (keyof typeof anchors)[]) {
  test(`${zone} keeps midnight dates and per-instant winter/summer/fall-back offsets honest`, async ({ page }) => {
    await fixture(page, 'time-zones', zone);
    for (const [index, source] of timeZoneSnapshot.sources.entries()) {
      const [text, offset] = anchors[zone][index];
      expect(formatInstant(source.lastSyncedAt!, 'en', zone)).toMatchObject({ text, offset });
      const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: source.name, exact: true }) });
      const timestamp = row.getByRole('cell').nth(2).locator('time');
      await expect(timestamp).toHaveText(`${text} · ${offset}`);
      await expect(timestamp).toHaveAttribute('datetime', source.lastSyncedAt!);
      await expect(timestamp).toHaveAttribute('title', new RegExp(offset.replace(/[+]/g, '\\+')));
    }
  });
}

test('Korean Los Angeles timestamp preserves the previous calendar day, visible offset and original instant', async ({ page }) => {
  await fixture(page, 'time-zones', 'America/Los_Angeles', 'ko');
  const source = timeZoneSnapshot.sources[0];
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: source.name, exact: true }) });
  const timestamp = row.getByRole('cell').nth(2).locator('time');
  await expect(timestamp).toHaveText('2025. 12. 31. 16:15 · UTC-08:00');
  await expect(timestamp).toHaveAttribute('datetime', '2026-01-01T00:15:00Z');
});

test('first request uses UTC before hydration, then detects the browser without hydration errors', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const html = await (await context.request.get(productionOrigin)).text();
  const serverStatus = html.match(/class="effective-time-zone"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  expect(serverStatus?.replace(/<!--[\s\S]*?-->/g, '')).toBe('Effective time zone: UTC');
  await page.goto(productionOrigin);
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
  expect(errors).toEqual([]);
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === deviceTimeZoneCookie)?.value).toBe('America/Los_Angeles');
  expect(cookies.find(cookie => cookie.name === timeZoneCookie)).toBeUndefined();
  const nextHtml = await (await context.request.get(productionOrigin)).text();
  const savedStatus = nextHtml.match(/class="effective-time-zone"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  expect(savedStatus?.replace(/<!--[\s\S]*?-->/g, '')).toBe('Effective time zone: America/Los_Angeles');
  await context.close();
});

test('timestamp-bearing SSR hydrates its UTC tree before device reconciliation', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await context.request.get(`${fixtureOrigin}/hydration`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const serverTimes = [...html.matchAll(/<time\b[^>]*\bdateTime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/gi)].map(match => ({
    dateTime: match[1], text: match[2].replace(/<!--[\s\S]*?-->/g, ''),
  }));
  expect(serverTimes).toHaveLength(12);
  expect(serverTimes[0]).toEqual({ dateTime: '2026-01-01T00:15:00Z', text: '01/01/2026, 00:15 · UTC+00:00' });
  expect(serverTimes.every(time => time.text.endsWith('UTC+00:00'))).toBe(true);
  await page.goto(`${fixtureOrigin}/hydration`);
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    __hydrationFixture?: { initialTimes: { dateTime: string; text: string }[] };
  }).__hydrationFixture?.initialTimes)).toEqual(serverTimes);
  await expect(page.locator('.table-footer time')).toHaveText('31/12/2025, 16:15 · UTC-08:00');
  expect(await page.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')))).toEqual(serverTimes.map(time => time.dateTime));
  expect(errors).toEqual([]);
  expect((await context.request.get(`${productionOrigin}/hydration`)).status()).toBe(404);
  await context.close();
});

test('unchanged device checks skip persisted cookie writes and retry after a storage error', async ({ page }) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    const probe = { attempts: 0, failNext: false };
    Object.assign(window, { __cookieProbe: probe });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => descriptor.get!.call(document),
      set: (value: string) => {
        probe.attempts += 1;
        if (probe.failNext) { probe.failNext = false; throw new Error('Temporary storage failure'); }
        descriptor.set!.call(document, value);
      },
    });
  });
  await fixture(page, 'success');
  const attempts = () => page.evaluate(() => (window as unknown as { __cookieProbe: { attempts: number } }).__cookieProbe.attempts);
  const initial = await attempts();
  expect(initial).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await attempts()).toBe(initial);
  await setDeviceZone(page, 'America/Los_Angeles');
  await page.evaluate(() => {
    (window as unknown as { __cookieProbe: { failNext: boolean } }).__cookieProbe.failNext = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
  expect(await attempts()).toBe(initial + 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await attempts()).toBe(initial + 2);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await attempts()).toBe(initial + 2);
});

test('production manual-to-auto submission persists the device zone independently of language', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  await page.goto(productionOrigin);
  await applyZone(page, 'Asia/Seoul');
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await page.getByRole('combobox', { name: t.language, exact: true }).selectOption('ko');
  await page.getByRole('button', { name: t.applyLanguage, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await applyZone(page, 'auto', 'ko');
  await expect(page.getByRole('combobox', { name: sourceMessages.ko.timeZone, exact: true })).toHaveValue('auto');
  await expect(page.locator('.effective-time-zone')).toHaveText('적용 시간대: America/Los_Angeles');
  const preference = (await context.cookies()).find(cookie => cookie.name === timeZoneCookie);
  expect(preference?.value).toBe('auto');
  expect(preference?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page).toHaveTitle('소스 · GBrain Observatory');
  await expect(page.getByRole('combobox', { name: sourceMessages.ko.timeZone, exact: true })).toHaveValue('auto');
  await expect(page.locator('.effective-time-zone')).toHaveText('적용 시간대: America/Los_Angeles');
  await context.close();
});

for (const event of ['focus', 'pageshow', 'visibilitychange', 'interval']) {
  test(`automatic mode follows changed devices on ${event} and leaves explicit preference untouched`, async ({ page, context }) => {
    if (event === 'interval') await page.clock.install();
    await fixture(page, 'success');
    await setDeviceZone(page, 'Asia/Seoul');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
    await setDeviceZone(page, 'America/Los_Angeles');
    if (event === 'interval') await page.clock.fastForward(60_000);
    else if (event === 'visibilitychange') await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    else await page.evaluate(name => window.dispatchEvent(new Event(name)), event);
    await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
    const cookies = await context.cookies(fixtureOrigin);
    expect(cookies.find(cookie => cookie.name === deviceTimeZoneCookie)?.value).toBe('America/Los_Angeles');
    expect(cookies.find(cookie => cookie.name === timeZoneCookie)).toBeUndefined();
  });
}

test('automatic checks pause while hidden and resume on visibility; unavailable detection keeps the last valid zone', async ({ page }) => {
  await page.clock.install();
  await fixture(page, 'success');
  await setDeviceZone(page, 'Asia/Seoul');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await setDeviceZone(page, 'America/Los_Angeles');
  await page.clock.fastForward(120_000);
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
  await setDeviceZone(page, 'No/Such_Zone');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
});

test('manual selection wins over late device changes; switching back to automatic uses detection', async ({ page }) => {
  await fixture(page, 'success', 'Asia/Seoul');
  await setDeviceZone(page, 'America/Los_Angeles');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await applyZone(page, 'auto');
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
});

test('zone changes update current and previous announcements without changing refresh ownership, source instants or focus', async ({ page }) => {
  await fixture(page, 'retry-failure', 'Asia/Seoul');
  const original = await page.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')));
  const refresh = page.getByRole('button', { name: t.refresh, exact: true });
  await refresh.click();
  const checking = page.getByRole('button', { name: t.refreshing, exact: true });
  await checking.focus();
  await page.keyboard.press('Enter');
  await applyZone(page, 'America/Los_Angeles');
  const apply = page.getByRole('button', { name: t.applyTimeZone, exact: true });
  await expect(apply).toBeFocused();
  await expect(page.locator('.previous-notice')).toContainText('26/10/2026, 20:00');
  await expect(page.locator('.table-footer')).toContainText('3 results');
  await expect(page.locator('.table-footer')).toContainText('26/10/2026, 20:00');
  expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(1);
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: () => void } }).__sourceFixture.release());
  await expect(page.getByRole('heading', { name: t.issues.failure.title, exact: true })).toBeVisible();
  await expect(page.locator('.previous-notice')).toContainText('26/10/2026, 20:00');
  await expect(apply).toBeFocused();
  // Successful and previous notices differ in structure, while source values retain their bytes.
  for (const value of new Set(original)) expect(await page.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')))).toContain(value);
  const table = page.getByRole('table');
  for (const source of sourceSnapshot.sources) await expect(table.getByRole('rowheader', { name: source.name, exact: true })).toBeVisible();
});

for (const locale of ['en', 'ko'] as const) {
  test(`${locale} validates server submissions and preserves an existing manual preference and language`, async ({ page, context }) => {
    const messages = sourceMessages[locale];
    await page.setViewportSize({ width: 320, height: 800 });
    await context.addCookies([
      { name: localeCookie, value: locale, url: productionOrigin },
      { name: timeZoneCookie, value: 'Asia/Seoul', url: productionOrigin },
    ]);
    await page.goto(productionOrigin);
    const select = page.getByRole('combobox', { name: messages.timeZone, exact: true });
    await select.evaluate(element => {
      const option = document.createElement('option');
      option.value = '+09:00';
      option.textContent = '+09:00';
      element.append(option);
    });
    await select.selectOption('+09:00');
    await page.getByRole('button', { name: messages.applyTimeZone, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: messages.invalidTimeZone })).toHaveText(localeExpectations[locale].invalidTimeZone);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('combobox', { name: messages.timeZone, exact: true })).toHaveAttribute('aria-describedby', 'time-zone-error');
    await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
    await expect(page.getByRole('combobox', { name: messages.timeZone, exact: true })).toHaveValue('Asia/Seoul');
    expect((await context.cookies()).find(cookie => cookie.name === timeZoneCookie)?.value).toBe('Asia/Seoul');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  });
}

test('native manual settings work with JavaScript unavailable and stay independent through language switches', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  await page.goto(productionOrigin);
  await expect(page.locator('.effective-time-zone')).toContainText('UTC');
  await applyZone(page, 'Asia/Seoul');
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await page.reload();
  await expect(page.getByRole('combobox', { name: t.timeZone, exact: true })).toHaveValue('Asia/Seoul');
  await page.getByRole('combobox', { name: t.language, exact: true }).selectOption('ko');
  await page.getByRole('button', { name: t.applyLanguage, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page).toHaveTitle('소스 · GBrain Observatory');
  await expect(page.getByRole('combobox', { name: sourceMessages.ko.timeZone, exact: true })).toHaveValue('Asia/Seoul');
  await applyZone(page, 'America/Los_Angeles', 'ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
  const preference = (await context.cookies()).find(cookie => cookie.name === timeZoneCookie);
  expect(preference?.httpOnly).toBe(true);
  expect(decodeURIComponent(preference!.value)).toBe('America/Los_Angeles');
  await context.close();
});

test('SSR validates corrupt, unsupported and offset-only cookie values, while retaining supported aliases', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const value of ['%broken', 'No/Such_Zone', '+09:00', 'UTC+09:00']) {
    await context.clearCookies();
    await context.addCookies([
      { name: timeZoneCookie, value, url: productionOrigin },
      { name: deviceTimeZoneCookie, value, url: productionOrigin },
    ]);
    await page.goto(productionOrigin);
    await expect(page.locator('.effective-time-zone')).toContainText('UTC');
    await expect(page.getByRole('combobox', { name: t.timeZone, exact: true })).toHaveValue('auto');
  }
  await context.addCookies([
    { name: timeZoneCookie, value: 'auto', url: productionOrigin },
    { name: deviceTimeZoneCookie, value: 'Asia/Seoul', url: productionOrigin },
  ]);
  await page.reload();
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  await context.addCookies([{ name: timeZoneCookie, value: 'US/Pacific', url: productionOrigin }]);
  await page.reload();
  await expect(page.getByRole('combobox', { name: t.timeZone, exact: true })).toHaveValue('US/Pacific');
  await expect(page.locator('.effective-time-zone')).toContainText('US/Pacific');
  await context.close();
});

test('blocked browser storage does not prevent automatic rendering or manual controls', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => { throw new Error('Storage unavailable'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixture(page, 'success');
  await setDeviceZone(page, 'America/Los_Angeles');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
  await applyZone(page, 'Asia/Seoul');
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
  expect(errors).toEqual([]);
});

test('unavailable device detection leaves the server fallback usable with JavaScript enabled', async ({ page }) => {
  await page.addInitScript(() => {
    const formatter = Intl.DateTimeFormat;
    Intl.DateTimeFormat = new Proxy(formatter, {
      apply(target, thisArgument, args) {
        if (args.length === 0) throw new Error('Device detection unavailable');
        return Reflect.apply(target, thisArgument, args);
      },
      construct(target, args) { return Reflect.construct(target, args); },
    });
  });
  await page.goto(productionOrigin);
  await expect(page.locator('.effective-time-zone')).toContainText('UTC');
  await applyZone(page, 'Asia/Seoul');
  await expect(page.locator('.effective-time-zone')).toContainText('Asia/Seoul');
});
