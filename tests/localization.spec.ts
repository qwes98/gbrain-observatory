import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatResultCount, localeCookie, sourceMessages, type Locale } from '../src/i18n/messages';
import { sourceSnapshot } from './fixtures/source-data';
import { localeExpectations, sharedMessageAllowlist } from './support/locale-expectations';
import { openSourceFixture, productionOrigin } from './support/ui';

const locales = Object.keys(localeExpectations) as Locale[];

async function expectDocumentLocale(page: Page, locale: Locale) {
  const expected = localeExpectations[locale];
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page).toHaveTitle(`${expected.heading} · GBrain Observatory`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(expected.heading);
  await expect(page.getByRole('combobox', { name: expected.language, exact: true })).toHaveValue(locale);
  await expect(page.getByRole('button', { name: expected.applyLanguage, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: expected.guide, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: expected.timeZoneLabel, exact: true }).getByRole('option', { name: expected.autoTimeZone, exact: true })).toHaveAttribute('value', 'auto');
  await expect(page.locator('.effective-time-zone')).toContainText(`${expected.effectiveTimeZone}:`);
}

function flattenMessages(value: object, prefix = ''): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [key, message] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof message === 'string') flattened[path] = message;
    else if (message && typeof message === 'object') Object.assign(flattened, flattenMessages(message, path));
    else throw new Error(`Translation ${path} is not a string or message group`);
  }
  return flattened;
}

test('translation catalogs have matching keys, nonempty values and independent acceptance examples', () => {
  expect(Object.keys(sourceMessages).sort()).toEqual([...locales].sort());
  const defaultKeys = Object.keys(flattenMessages(sourceMessages.en)).sort();
  for (const locale of locales) {
    const catalog = flattenMessages(sourceMessages[locale]);
    expect(Object.keys(catalog).sort()).toEqual(defaultKeys);
    for (const [key, value] of Object.entries(catalog)) expect(value.trim(), `${locale}.${key}`).not.toBe('');
    // These fixed examples catch a wrong catalog or English fallback shared by the UI and its locators.
    const expected = localeExpectations[locale];
    expect(sourceMessages[locale].sources).toBe(expected.heading);
    expect(sourceMessages[locale].guide).toBe(expected.guide);
    expect(sourceMessages[locale].language).toBe(expected.language);
    expect(sourceMessages[locale].applyLanguage).toBe(expected.applyLanguage);
    expect(sourceMessages[locale].notProvided).toBe(expected.notProvided);
    expect(sourceMessages[locale].timeZone).toBe(expected.timeZoneLabel);
    expect(sourceMessages[locale].applyTimeZone).toBe(expected.applyTimeZone);
    expect(sourceMessages[locale].autoTimeZone).toBe(expected.autoTimeZone);
    expect(sourceMessages[locale].effectiveTimeZone).toBe(expected.effectiveTimeZone);
    expect(sourceMessages[locale].invalidTimeZone).toBe(expected.invalidTimeZone);
    expect(formatResultCount(locale, 1000)).toBe(expected.largeCount);
    for (const [index, count] of [0, 1, 3].entries()) {
      expect(formatResultCount(locale, count)).toBe(expected.counts[index]);
    }
  }
});

test('non-English catalogs reject unexpected English fallback outside the explicit allowlist', () => {
  const baseline = flattenMessages(sourceMessages.en);
  for (const locale of locales) {
    if (locale === 'en') continue;
    const catalog = flattenMessages(sourceMessages[locale]);
    const allowed = new Set(sharedMessageAllowlist[locale]);
    for (const key of allowed) {
      expect(Object.keys(baseline), `${locale}.${key} must name an existing message`).toContain(key);
      expect(catalog[key].trim(), `${locale}.${key} no longer needs an exception`).toBe(baseline[key].trim());
    }
    for (const [key, value] of Object.entries(catalog)) {
      if (!allowed.has(key)) expect(value.trim(), `${locale}.${key} unexpectedly matches English`).not.toBe(baseline[key].trim());
    }
  }
});

test('English is the default even in a Korean browser', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto(productionOrigin);
  await expectDocumentLocale(page, 'en');
  await expect(page.getByRole('heading', { name: sourceMessages.en.issues.unconfigured.title, exact: true })).toBeVisible();
  await context.close();
});

test('language switching persists and keeps server-rendered language and metadata aligned', async ({ page, context }) => {
  await page.goto(productionOrigin);
  let currentLocale: Locale = 'en';
  for (const locale of ['ko', 'en'] as const) {
    const current = sourceMessages[currentLocale];
    await page.getByRole('combobox', { name: current.language, exact: true }).selectOption(locale);
    await page.getByRole('button', { name: current.applyLanguage, exact: true }).click();
    await expectDocumentLocale(page, locale);
    expect((await context.cookies(productionOrigin)).find(cookie => cookie.name === localeCookie)).toMatchObject({
      value: locale, httpOnly: true, secure: true,
    });
    await page.reload();
    await expectDocumentLocale(page, locale);
    const html = await (await context.request.get(productionOrigin)).text();
    expect(html).toContain(`<html lang="${locale}">`);
    expect(html).toContain(`${localeExpectations[locale].heading} · GBrain Observatory`);
    expect(html).toContain(sourceMessages[locale].description);
    currentLocale = locale;
  }
});

test('unsupported stored preferences fall back to English', async ({ page, context }) => {
  await context.addCookies([{ name: localeCookie, value: 'invalid', url: productionOrigin }]);
  await page.goto(productionOrigin);
  await expectDocumentLocale(page, 'en');
});

test('both language choices work without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(productionOrigin);
  let currentLocale: Locale = 'en';
  for (const locale of ['ko', 'en'] as const) {
    const current = sourceMessages[currentLocale];
    await page.getByRole('combobox', { name: current.language, exact: true }).selectOption(locale);
    await page.getByRole('button', { name: current.applyLanguage, exact: true }).click();
    await expectDocumentLocale(page, locale);
    expect((await context.cookies(productionOrigin)).find(cookie => cookie.name === localeCookie)).toMatchObject({
      value: locale, httpOnly: true, secure: true,
    });
    await page.reload();
    await expectDocumentLocale(page, locale);
    currentLocale = locale;
  }
  await context.close();
});

for (const locale of locales) {
  const t = sourceMessages[locale];
  const expected = localeExpectations[locale];

  test(`${locale} translates representative states, accessible labels, counts and times without changing source content`, async ({ page }) => {
    const states = [
      ['loading', t.loading],
      ['unconfigured', t.issues.unconfigured.title],
      ['failure', t.issues.failure.title],
      ['unknown', t.issues.unknown.title],
      ['empty', t.emptyTitle],
    ];
    for (const [scenario, text] of states) {
      await openSourceFixture(page, scenario, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(expected.heading);
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      if (scenario === 'empty') await expect(page.locator('.table-footer')).toContainText(expected.counts[0]);
    }
    await openSourceFixture(page, 'success', locale);
    const table = page.getByRole('table');
    for (const label of [t.source, t.connection, t.syncResult, t.lastSyncedAt, t.checkedAt]) {
      await expect(table.getByRole('columnheader', { name: label, exact: true })).toBeVisible();
    }
    for (const source of sourceSnapshot.sources) {
      const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: source.name, exact: true }) });
      await expect(row.getByRole('cell').nth(1)).toHaveText(source.sync.label);
    }
    await expect(page.locator('.table-footer')).toContainText(expected.counts[2]);
    await expect(page.locator('.table-footer')).toContainText(expected.checkedTime);
    await expect(page.locator('.table-footer')).toContainText(expected.timeZone);
    await expect(table.getByText(expected.notProvided, { exact: true })).toHaveCount(3);
    await page.getByRole('button', { name: t.guide, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(expected.guide);
    await expect(page.getByRole('dialog')).toContainText(t.guideHeading);
    await page.getByRole('dialog').locator('summary').click();
    await expect(page.getByRole('dialog')).toContainText(t.checkPermissions);
    await page.getByRole('button', { name: t.close, exact: true }).click();
  });

  test(`${locale} previous observations retain an explicit time zone while checking and after failure`, async ({ page }) => {
    await openSourceFixture(page, 'retry-failure', locale);
    await page.getByRole('button', { name: t.refresh, exact: true }).click();
    const previous = page.getByText(t.previous, { exact: false });
    await expect(previous).toContainText(expected.timeZone);
    await expect(previous.locator('time')).toHaveAttribute('datetime', sourceSnapshot.checkedAt);
    await page.evaluate(() => {
      (window as unknown as { __sourceFixture: { release: () => void } }).__sourceFixture.release();
    });
    await expect(page.getByRole('heading', { name: t.issues.failure.title, exact: true })).toBeVisible();
    await expect(previous).toContainText(expected.timeZone);
    await expect(previous.locator('time')).toHaveAttribute('datetime', sourceSnapshot.checkedAt);
  });

  test(`${locale} production language controls reflow and pass automated accessibility checks`, async ({ page, context }) => {
    await context.addCookies([{ name: localeCookie, value: locale, url: productionOrigin }]);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(productionOrigin);
    await expectDocumentLocale(page, locale);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const select = page.getByRole('combobox', { name: t.language, exact: true });
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await select.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: t.applyLanguage, exact: true })).toBeFocused();
    const zoneSelect = page.getByRole('combobox', { name: t.timeZone, exact: true });
    expect((await zoneSelect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await zoneSelect.focus();
    await page.keyboard.press('Tab');
    const zoneApply = page.getByRole('button', { name: t.applyTimeZone, exact: true });
    await expect(zoneApply).toBeFocused();
    expect((await zoneApply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/production-${locale}-320-text200.png`, fullPage: true });
  });
}
