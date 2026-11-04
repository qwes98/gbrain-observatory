import { expect, test, type Page } from '@playwright/test';
import { factMessages, type Locale } from '../src/i18n/messages';
import { sourceReference } from '../src/contracts/sources';
import { sourceSnapshot } from './fixtures/source-data';
import { factClaim, factQuote, factSnapshot, factRows } from './fixtures/fact-data';
import { fixtureOrigin } from './support/ui';

async function fixture(page: Page, scenario = 'facts-success', locale: Locale = 'en', direct = false) {
  const query = new URLSearchParams({ scenario, locale, timeZone: 'Asia/Seoul', source: sourceReference(sourceSnapshot.sources[0]) });
  if (direct) { query.set('facts', '1'); query.set('fact', '17'); }
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.getByRole('heading', { name: factMessages[locale].title, exact: true })).toBeVisible();
}
async function loadedReader(page: Page) {
  await fixture(page);
  await page.getByRole('link', { name: factMessages.en.load, exact: true }).click();
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toContainText(factQuote);
}
async function releaseList(page: Page, kind: string) {
  await page.evaluate(kind => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release(kind), kind);
}

test('each Find activation focuses and scrolls the exact current quote', async ({ page }) => {
  await loadedReader(page);
  const reader = page.locator('.fact-reader'), mark = reader.locator('.reader-passage');
  const find = reader.getByRole('button', { name: factMessages.en.showInBody, exact: true });
  await find.click();
  await expect(mark).toHaveText(factQuote); await expect(mark).toBeFocused();
  await reader.locator('.page-reader-scroll').evaluate(element => { element.scrollTop = 0; });
  await find.focus(); await page.keyboard.press('Enter');
  await expect(mark).toBeFocused();
  const placement = await mark.evaluate(element => { const bounds = element.getBoundingClientRect(), region = element.closest('.page-reader-scroll')!.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom, regionTop: region.top, regionBottom: region.bottom }; });
  expect(placement.top).toBeGreaterThanOrEqual(placement.regionTop);
  expect(placement.bottom).toBeLessThanOrEqual(placement.regionBottom);
});

test('passive Back restores Fact body presentation, verified focus and scroll without another detail read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await loadedReader(page);
  const reader = page.locator('.fact-reader');
  await reader.getByRole('button', { name: factMessages.en.showInBody, exact: true }).click();
  const mark = reader.locator('.reader-passage');
  await expect(mark).toBeFocused();
  const savedTop = await reader.locator('.page-reader-scroll').evaluate(element => element.scrollTop);
  expect(savedTop).toBeGreaterThan(0);
  const calls = await page.evaluate(() => (window as unknown as { __factFixture: { detailCalls: unknown[] } }).__factFixture.detailCalls.length);
  await reader.getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await expect(reader).toHaveCount(0);
  await page.goBack();
  await expect(reader.locator('#fact-source-body')).toHaveAttribute('open', '');
  await expect(reader.locator('.reader-passage')).toHaveText(factQuote);
  await expect(reader.locator('.reader-passage')).toBeFocused();
  await expect.poll(() => reader.locator('.page-reader-scroll').evaluate(element => element.scrollTop)).toBeCloseTo(savedTop, 0);
  expect(await page.evaluate(() => (window as unknown as { __factFixture: { detailCalls: unknown[] } }).__factFixture.detailCalls.length)).toBe(calls);
  const stored = JSON.stringify(await page.evaluate(() => history.state));
  expect(stored).not.toContain(factClaim); expect(stored).not.toContain(factQuote);
  expect(stored).not.toContain('compiled-truth');
});

test('blocked Fact refresh uses the actual HTML disabled property', async ({ page }) => {
  await fixture(page, 'facts-success', 'en', true);
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  const refresh = page.locator('.fact-list').getByRole('button', { name: factMessages.en.refresh, exact: true });
  expect(await refresh.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
});

for (const locale of ['en', 'ko'] as const) {
  for (const scenario of ['missing', 'context-unknown', 'context-protected'] as const) test(`${locale} ${scenario} without a source Page offers no source-body disclosure`, async ({ page }) => {
    const t = factMessages[locale];
    await fixture(page, `facts-${scenario}`, locale, true);
    const reader = page.locator('.fact-reader');
    await expect(reader).toContainText(factClaim);
    await expect(reader.locator('#fact-source-body')).toHaveCount(0);
    await expect(reader.locator('.fact-source-body > summary')).toHaveCount(0);
    await expect(reader).not.toContainText(t.bodyUnknown);
    await expect(reader).toContainText(scenario === 'missing' ? `${t.pageQuote}: ${t.missing}` : scenario === 'context-protected' ? t.protected : t.fieldUnknown);
    await reader.locator('.reader-original > summary').click();
    const context = reader.locator('.reader-original dl > div').filter({ has: page.getByText(t.originalContext, { exact: true }) });
    await expect(context.locator('dd')).toHaveText(factRows[0].context!);
  });

  test(`${locale} a verified source Page retains its protected-body disclosure`, async ({ page }) => {
    const t = factMessages[locale];
    await fixture(page, 'facts-protected', locale, true);
    const reader = page.locator('.fact-reader');
    await expect(reader.locator('#fact-source-body')).toHaveCount(1);
    await reader.locator('#fact-source-body > summary').click();
    await expect(reader.locator('#fact-source-body .reader-issue')).toHaveText(t.protected);
    await expect(reader).not.toContainText(t.bodyUnknown);
  });

  test(`${locale} original fields preserve the complete annotated public context`, async ({ page }) => {
    const t = factMessages[locale];
    expect(t.originalContext).toBe(locale === 'en' ? 'Original context' : '원래 맥락');
    await fixture(page, 'facts-success', locale, true);
    const reader = page.locator('.fact-reader');
    await reader.locator('.reader-original > summary').click();
    const context = reader.locator('.reader-original dl > div').filter({ has: page.getByText(t.originalContext, { exact: true }) });
    expect(factRows[0].context).toContain(' — ');
    await expect(context.locator('dd')).toHaveText(factRows[0].context!);
    await expect(reader.locator('.reader-original')).toContainText(factRows[0].sourceDescription!);
    await expect(reader.getByRole('button', { name: t.showInBody, exact: true })).toBeVisible();
  });

  test(`${locale} unconfirmed producer retains raw context without attributing a Page or quote`, async ({ page }) => {
    const t = factMessages[locale];
    await fixture(page, 'facts-context-unknown', locale, true);
    const reader = page.locator('.fact-reader');
    await expect(reader.locator('.reader-metadata')).toContainText(t.fieldUnknown);
    await expect(reader.locator('.reader-metadata a')).toHaveCount(1);
    await expect(reader.locator('.fact-evidence, .fact-original-page')).toHaveCount(0);
    await expect(reader.getByRole('button', { name: t.showInBody, exact: true })).toHaveCount(0);
    await reader.locator('.reader-original > summary').click();
    const context = reader.locator('.reader-original dl > div').filter({ has: page.getByText(t.originalContext, { exact: true }) });
    await expect(context.locator('dd')).toHaveText(factRows[0].context!);
    await expect(reader).toContainText(factClaim);
  });

  test(`${locale} missing provenance identifies the absent quote without changing metadata values`, async ({ page }) => {
    const t = factMessages[locale];
    await fixture(page, 'facts-missing', locale, true);
    await expect(page.locator('.fact-provenance-status')).toHaveText(locale === 'en' ? 'Page-level source quote: Not provided' : '페이지 수준 출처 인용: 정보 미제공');
    await expect(page.locator('.fact-reader .reader-metadata dd').filter({ hasText: t.missing }).first()).toHaveText(t.missing);
  });
  test(`${locale} partial provenance and partial body retain distinct meanings`, async ({ page }) => {
    const t = factMessages[locale];
    expect(t.partialProvenance).toBe(locale === 'en' ? 'Only part of this Page-level provenance is available.' : '페이지 수준 출처 정보의 일부만 제공됐어요.');
    expect(t.partialBody).toBe(locale === 'en' ? 'Only part of the public source body is available.' : '공개 출처 본문의 일부만 제공됐어요.');
    await fixture(page, 'facts-partial-provenance', locale, true);
    await expect(page.locator('.fact-reader .fact-provenance-status')).toHaveText(t.partialProvenance);
    await expect(page.locator('.fact-reader')).not.toContainText(t.partial);
    await fixture(page, 'facts-partial-body', locale, true);
    await expect(page.locator('.fact-reader .fact-provenance-status')).toHaveText(t.partialProvenance);
    await page.locator('#fact-source-body > summary').click();
    await expect(page.locator('#fact-source-body .reader-issue')).toHaveText(t.partialBody);
    await expect(page.locator('.fact-reader')).not.toContainText(t.partial);
  });

  test(`${locale} observation interval keeps the original snapshot during refresh and failure`, async ({ page }) => {
    const t = factMessages[locale];
    await fixture(page, 'facts-list-pending', locale);
    const list = page.locator('.fact-list');
    await expect(list.getByRole('button', { name: t.rangeHelp, exact: true })).toHaveCount(1);
    await expect(list.locator('.pages-toolbar').getByRole('button', { name: t.rangeHelp, exact: true })).toHaveCount(1);
    await page.getByRole('link', { name: t.load, exact: true }).click();
    await releaseList(page, 'success');
    await expect(page.locator('.fact-list tbody tr')).toHaveCount(2);
    const help = page.getByRole('dialog', { name: t.rangeTitle, exact: true });
    async function observation() {
      await expect(list.getByRole('button', { name: t.rangeHelp, exact: true })).toHaveCount(1);
      await expect(list.locator('.pages-toolbar').getByRole('button', { name: t.rangeHelp, exact: true })).toHaveCount(0);
      await expect(list.locator('.table-footer .context-value').getByRole('button', { name: t.rangeHelp, exact: true })).toHaveCount(1);
      if (!await help.isVisible()) await page.getByRole('button', { name: t.rangeHelp, exact: true }).click();
      await expect(help).toContainText(locale === 'en' ? 'Observation interval' : '관찰 구간');
      const times = help.locator('time');
      await expect(times).toHaveCount(2);
      await expect(times.nth(0)).toHaveAttribute('datetime', factSnapshot.observation.startedAt);
      await expect(times.nth(1)).toHaveAttribute('datetime', factSnapshot.observation.completedAt);
      await expect(times.nth(0)).toContainText(locale === 'en' ? '03/11/2026, 10:00' : '2026. 11. 03. 10:00');
      await expect(times.nth(0)).toContainText('UTC+09:00');
    }
    await observation();
    await page.keyboard.press('Escape');
    await page.locator('.fact-list').getByRole('button', { name: t.refresh, exact: true }).click();
    await expect(page.locator('.fact-list')).toHaveAttribute('aria-busy', 'true');
    await observation();
    await releaseList(page, 'failure');
    await expect(page.locator('.fact-list')).toContainText(t.failure);
    await observation();
  });
}
