import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readerMessages, pageMessages, sourceMessages, type Locale } from '../src/i18n/messages';
import { sourceReference, boundedPageSlug, boundedSourceReference, sourceNavigationPath, validatedSourceReturn, navigationQueryLimit } from '../src/contracts/sources';
import { sourceSnapshot } from './fixtures/source-data';
import { pageRows } from './fixtures/page-data';
import { originalBody, originalClaim, publicWindowExcerpt, emptyMemoryTable } from './fixtures/page-detail-data';
import { fixtureOrigin } from './support/ui';

async function fixture(page: Page, scenario = 'reader-success', locale: Locale = 'en', added?: 'today' | 'yesterday') {
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  const query = new URLSearchParams({ scenario, locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) });
  if (added) query.set('added', added);
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.page-list tbody tr')).toHaveCount(added ? 1 : 3);
}
async function open(page: Page, index = 0) {
  await page.locator('.page-list').getByRole('link', { name: pageRows[index].title, exact: true }).click();
  await expect(page.locator('.page-reader')).toBeVisible();
}
async function release(page: Page, kind = 'success', index?: number) {
  await page.evaluate(({ kind, index }) => (window as unknown as { __detailFixture: { release: (kind: string, index?: number) => void } }).__detailFixture.release(kind, index), { kind, index });
}
async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { __detailFixture: { calls: unknown[] } }).__detailFixture.calls);
}

test('reader translation catalogs have independent English and Korean acceptance examples', () => {
  expect(Object.keys(readerMessages.ko).sort()).toEqual(Object.keys(readerMessages.en).sort());
  expect(readerMessages.en).toMatchObject({ memories: 'Memories', body: 'Body', references: 'References' });
  expect(readerMessages.ko).toMatchObject({ memories: '기억', body: '본문', references: '참조' });
  for (const [key, value] of Object.entries(readerMessages.ko)) expect(value.trim(), key).not.toBe('');
});

test('Page title opens a memory first panel with exact identity and same-result full reading', async ({ page }) => {
  await fixture(page); await open(page);
  const t = readerMessages.en;
  const reader = page.locator('.page-reader');
  await expect(reader.getByRole('heading', { name: pageRows[0].title, exact: true })).toBeFocused();
  await expect(reader.getByRole('radio', { name: t.memories, exact: true })).toBeChecked();
  await expect(reader).toContainText(originalClaim);
  expect(await calls(page)).toEqual([{ source: sourceReference(sourceSnapshot.sources[0]), slug: pageRows[0].slug }]);
  await reader.getByRole('link', { name: t.fullReading, exact: true }).click();
  await expect(reader).toHaveClass(/page-reader-full/);
  await expect(reader).toContainText(originalClaim);
  expect(await calls(page)).toHaveLength(1);
  expect(JSON.stringify(await page.evaluate(() => history.state))).not.toContain(originalClaim);
  expect(page.url()).not.toContain(originalClaim);
  await page.goBack();
  await expect(reader).toHaveClass(/page-reader-panel/);
  await expect(reader.getByRole('radio', { name: t.memories, exact: true })).toBeChecked();
  expect(await calls(page)).toHaveLength(1);
});

test('native radios switch views and only a verified original location highlights the current body', async ({ page }) => {
  await fixture(page); await open(page);
  const reader = page.locator('.page-reader'); const t = readerMessages.en;
  await reader.getByRole('button', { name: t.showInBody, exact: true }).click();
  await expect(reader.getByRole('radio', { name: t.body, exact: true })).toBeChecked();
  await expect(reader.locator('mark')).toHaveText(originalClaim);
  await reader.locator('.reader-labels').getByText(t.memories, { exact: true }).click();
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader.locator('mark')).toHaveCount(0);
  await reader.getByRole('radio', { name: t.body, exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(reader.getByRole('radio', { name: t.references, exact: true })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(reader.getByRole('radio', { name: t.body, exact: true })).toBeChecked();
  await expect(reader).toContainText(originalBody);
  expect(await calls(page)).toHaveLength(1);
});

test('source HTML, image, script and local path stay inert and safe outbound links suppress referrers', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => { if (/attacker\.invalid|file:/.test(request.url())) outbound.push(request.url()); });
  await fixture(page); await open(page);
  const reader = page.locator('.page-reader');
  await reader.locator('.reader-labels').getByText(readerMessages.en.body, { exact: true }).click();
  await expect(reader).toContainText('<script>globalThis.readerAttack=true</script>');
  await expect(reader).toContainText('![tracking](https://attacker.invalid/pixel)');
  expect(await page.evaluate(() => (globalThis as unknown as { readerAttack?: boolean }).readerAttack)).toBeUndefined();
  expect(outbound).toEqual([]);
  expect(await reader.locator('img,script,iframe').count()).toBe(0);
  expect(await reader.locator('a[href^="javascript:"],a[href^="file:"]').count()).toBe(0);
  for (const link of await reader.locator('a[href^="https:"]').all()) {
    expect(await link.getAttribute('rel')).toContain('noreferrer');
    expect(await link.getAttribute('referrerpolicy')).toBe('no-referrer');
  }
});

test('references retain exact verified Page and Source labels and navigate without inferred Fact links', async ({ page }) => {
  await fixture(page); await open(page);
  const reader = page.locator('.page-reader');
  await reader.locator('.reader-labels').getByText(readerMessages.en.references, { exact: true }).click();
  await expect(reader.getByRole('link', { name: '참조 원본 / referring original', exact: false })).toBeVisible();
  await expect(reader).toContainText(sourceSnapshot.sources[0].name);
  expect(await reader.locator('a[href*="fact="]').count()).toBe(0);
  await reader.getByRole('link', { name: '참조 원본 / referring original', exact: false }).click();
  await expect(reader.getByRole('heading', { name: pageRows[1].title, exact: true })).toBeVisible();
  await expect(reader.getByRole('radio', { name: readerMessages.en.memories, exact: true })).toBeChecked();
  expect(await calls(page)).toHaveLength(2);
});

test('Escape closes the top help before the reader and closing returns focus to the permitted Page link', async ({ page }) => {
  await fixture(page); await open(page);
  const reader = page.locator('.page-reader');
  const help = reader.locator('.context-help-trigger').first();
  if (await help.count()) {
    await help.click();
    await expect(reader.locator('.context-help:popover-open')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(reader.locator('.context-help:popover-open')).toHaveCount(0);
    await expect(reader).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await expect(page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true })).toBeFocused();
});

test('row clicks open a Page while internal selection controls and text selection preserve list behavior', async ({ page }) => {
  await fixture(page);
  const row = page.locator('.page-list tbody tr').first();
  await row.locator('td').last().dispatchEvent('click', { button: 0, ctrlKey: true });
  await expect(page.locator('.page-reader')).toHaveCount(0);
  const details = row.locator('summary');
  if (await details.count()) {
    await details.click();
    await expect(page.locator('.page-reader')).toHaveCount(0);
  }
  await row.getByRole('link').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await row.locator('td').last().dispatchEvent('click', { button: 0 });
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await row.locator('td').last().click();
  await expect(page.locator('.page-reader')).toBeVisible();
});

for (const scenario of ['empty', 'partial', 'protected', 'failure', 'unknown', 'denied', 'unavailable'] as const) test(`reader keeps ${scenario} distinct across view and full-mode changes`, async ({ page }) => {
  await fixture(page, `reader-${scenario}`); await open(page);
  const reader = page.locator('.page-reader'); const t = readerMessages.en;
  if (['failure', 'unknown', 'denied', 'unavailable'].includes(scenario)) await expect(reader.locator('.reader-switch')).toHaveCount(0);
  else await expect(reader.locator('.reader-memories')).not.toContainText(originalClaim);
  const issue = scenario === 'empty' ? t.memoryEmpty : scenario === 'partial' || scenario === 'protected' ? t.memoryUnknown : t[scenario];
  await expect(reader).toContainText(issue);
  await reader.getByRole('link', { name: t.fullReading, exact: true }).click();
  await expect(reader).toHaveClass(/page-reader-full/);
  expect(await calls(page)).toHaveLength(1);
  if (scenario === 'protected') {
    await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
    await expect(reader).not.toContainText(originalBody);
  }
});

test('late detail completion after Source navigation cannot restore discarded private content', async ({ page }) => {
  await fixture(page, 'reader-pending'); await open(page);
  await page.locator('.desktop-navigation .source-tree a').filter({ hasText: sourceSnapshot.sources[1].name }).first().click();
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await release(page);
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(originalClaim);
});

test('a revoked Source authority discards the pending reader and ignores its late body', async ({ page }) => {
  await fixture(page, 'reader-pending'); await open(page);
  await page.evaluate(() => (window as unknown as { __sourceFixture: { setSeed: (value: string) => void } }).__sourceFixture.setSeed('denied'));
  await expect(page.locator('.reader-memory')).toHaveCount(0);
  await release(page);
  await expect(page.locator('.reader-memory')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(originalClaim);
});

test('a new date condition discards a Page excluded from the current loaded range', async ({ page }) => {
  await fixture(page); await open(page);
  const t = pageMessages.en, pages = page.locator('.page-list');
  await pages.locator('.page-filter').getByRole('button', { name: t.filter, exact: false }).click();
  await pages.getByRole('option', { name: t.yesterday, exact: true }).click();
  await expect(page.locator('.reader-memory')).toHaveCount(0);
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toBeVisible();
  await expect(pages.locator('.page-filter-trigger')).toBeFocused();
  expect(await calls(page)).toHaveLength(1);
});

test('Back from an excluding date filter freshly reads the exact Page under All', async ({ page }) => {
  await fixture(page); await open(page);
  const t = pageMessages.en;
  await page.getByRole('button', { name: `${t.filter}: ${t.all}`, exact: true }).click();
  await page.getByRole('option', { name: t.yesterday, exact: true }).click();
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toBeVisible();
  expect(await calls(page)).toHaveLength(1);

  await page.goBack();
  const reader = page.locator('.page-reader');
  await expect(reader.getByRole('heading', { name: pageRows[0].title, exact: true })).toBeVisible();
  await expect(reader).toContainText(originalClaim);
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toHaveCount(0);
  expect(await calls(page)).toEqual(Array.from({ length: 2 }, () => ({ source: sourceReference(sourceSnapshot.sources[0]), slug: pageRows[0].slug })));
  expect(new URL(page.url()).searchParams.get('page')).toBe(pageRows[0].slug);
  expect(new URL(page.url()).searchParams.has('added')).toBe(false);
});

test('restoring All after date exclusion clears its notice without reopening a Page', async ({ page }) => {
  await fixture(page); await open(page);
  const t = pageMessages.en;
  await page.getByRole('button', { name: `${t.filter}: ${t.all}`, exact: true }).click();
  await page.getByRole('option', { name: t.yesterday, exact: true }).click();
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `${t.filter}: ${t.yesterday}`, exact: true }).click();
  await page.getByRole('option', { name: t.all, exact: true }).click();
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toHaveCount(0);
  await expect(page.locator('.page-reader')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(await calls(page)).toHaveLength(1);
});

for (const condition of ['zone', 'midnight'] as const) test(`a ${condition} change closes an excluded Page and restores a safe list focus`, async ({ page }) => {
  await fixture(page, 'reader-success', 'en', 'today'); await open(page);
  if (condition === 'zone') {
    await page.getByRole('combobox', { name: sourceMessages.en.timeZone, exact: true }).selectOption('America/Los_Angeles');
    await page.getByRole('button', { name: sourceMessages.en.applyTimeZone, exact: true }).focus();
    await page.keyboard.press('Enter');
  } else {
    await page.clock.setFixedTime(new Date('2026-11-01T00:00:01Z'));
    await page.clock.runFor(30_000);
  }
  await expect(page.locator('.page-reader')).toHaveCount(0);
  await expect(page.getByText(readerMessages.en.outside, { exact: true })).toBeVisible();
  await expect(page.locator('.page-filter-trigger')).toBeFocused();
  await expect(page.locator('.page-list')).not.toContainText(pageRows[0].title);
  expect(await calls(page)).toHaveLength(1);
});

test('client deadline reports failure and ignores a success arriving after sixty seconds', async ({ page }) => {
  await fixture(page, 'reader-pending'); await open(page);
  await page.clock.runFor(60_001);
  await expect(page.locator('.page-reader')).toContainText(readerMessages.en.failure);
  await release(page);
  await expect(page.locator('.page-reader')).toContainText(readerMessages.en.failure);
  await expect(page.locator('.reader-memory')).toHaveCount(0);
  expect(await calls(page)).toHaveLength(1);
});

test('a slower previous Page cannot replace the currently selected Page', async ({ page }) => {
  await fixture(page, 'reader-race'); await open(page);
  await page.locator('.page-list').getByRole('link', { name: pageRows[1].title, exact: true }).click();
  await release(page, 'success', 1);
  await expect(page.locator('.page-reader').getByRole('heading', { name: pageRows[1].title, exact: true })).toBeVisible();
  await release(page, 'success', 0);
  await expect(page.locator('.page-reader').getByRole('heading', { name: pageRows[1].title, exact: true })).toBeVisible();
});

for (const locale of ['en', 'ko'] as const) test(`narrow enlarged ${locale} reader excludes covered background and retains readable controls`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await fixture(page, 'reader-success', locale); await open(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const reader = page.locator('.page-reader'); const t = readerMessages[locale];
  await expect(reader.getByRole('radio', { name: locale === 'en' ? 'Memories' : '기억', exact: true })).toBeChecked();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0);
  for (const radio of await reader.getByRole('radio').all()) {
    const id = await radio.getAttribute('id');
    const box = await reader.locator(`label[for="${id}"]`).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(reader).toContainText(originalClaim);
  const results = await new AxeBuilder({ page }).include('.page-reader').analyze();
  expect(results.violations).toEqual([]);
  await reader.getByRole('link', { name: t.close, exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true })).toBeFocused();
});

for (const result of ['success', 'failure'] as const) test(`close then browser Back preserves the same ${result} without another detail acquisition`, async ({ page }) => {
  await fixture(page, `reader-${result}`); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages.en;
  if (result === 'success') {
    await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
    await reader.locator('.page-reader-scroll').evaluate(element => { element.scrollTop = 140; });
  }
  const top = await reader.locator('.page-reader-scroll').evaluate(element => element.scrollTop);
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await page.goBack();
  await expect(reader).toBeVisible();
  expect(await calls(page)).toHaveLength(1);
  if (result === 'success') {
    await expect(reader.getByRole('radio', { name: t.body, exact: true })).toBeChecked();
    await expect(reader).toContainText(originalBody);
    await expect.poll(() => reader.locator('.page-reader-scroll').evaluate(element => element.scrollTop)).toBe(top);
  } else {
    await expect(reader).toContainText(t.failure);
    await expect(reader.locator('.reader-memory')).toHaveCount(0);
  }
});

test('full reading browser Back restores the same window position without refetching content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await fixture(page); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages.en;
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await reader.getByRole('link', { name: t.fullReading, exact: true }).click();
  await expect(reader).toHaveClass(/page-reader-full/);
  await reader.getByRole('heading', { name: pageRows[0].title, exact: true }).focus();
  await page.evaluate(() => window.scrollTo(0, 320));
  const expected = await page.evaluate(() => window.scrollY);
  expect(expected).toBeGreaterThan(100);
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await page.goBack();
  await expect(reader).toHaveClass(/page-reader-full/);
  await expect(reader.getByRole('radio', { name: t.body, exact: true })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(expected);
  expect(await calls(page)).toHaveLength(1);
});

test('exact Page denial removes its row title and link while preserving other permitted Pages and safe close focus', async ({ page }) => {
  await fixture(page, 'reader-denied'); await open(page);
  const reader = page.locator('.page-reader'), pages = page.locator('.page-list');
  await expect(reader).toContainText(readerMessages.en.denied);
  await expect(pages.getByRole('link', { name: pageRows[0].title, exact: true })).toHaveCount(0);
  await expect(pages).not.toContainText(pageRows[0].title);
  await expect(pages.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: sourceSnapshot.sources[0].name, exact: true })).toBeVisible();
  await reader.getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(pages.locator('.page-filter-trigger')).toBeFocused();
  await expect(pages.getByRole('link', { name: pageRows[1].title, exact: true })).toBeVisible();
  await page.goBack();
  await expect(reader).toContainText(readerMessages.en.denied);
  await expect(pages).not.toContainText(pageRows[0].title);
  expect(await calls(page)).toHaveLength(1);
});


test('generated bounded reader navigation roundtrips settings return paths with long expanded Sources and encoded punctuation', () => {
  const expanded = Array.from({ length: 6 }, (_, index) => sourceReference({ namespace: `namespace-${'n'.repeat(80)}-${index}`, id: `source-${'s'.repeat(18)}-${index}` }));
  expect(expanded.every(boundedSourceReference)).toBe(true);
  for (const slug of ['a'.repeat(512), "'".repeat(256), '()!~'.repeat(40), '한글/ページ-원문']) {
    expect(boundedPageSlug(slug)).toBe(true);
    const path = sourceNavigationPath(expanded[0], expanded, 'yesterday', { slug, view: 'references', mode: 'full' });
    const query = new URL(path, 'https://internal.invalid').searchParams;
    expect(query.toString().length).toBeLessThanOrEqual(navigationQueryLimit);
    expect(query.get('page')).toBe(slug); expect(query.get('view')).toBe('references'); expect(query.get('reading')).toBe('full');
    expect(query.getAll('expanded').length).toBeGreaterThan(0);
    expect(validatedSourceReturn(path)).toBe(path);
  }
  expect(boundedPageSlug("'".repeat(512))).toBe(false);
  expect(boundedPageSlug('bad\ud800')).toBe(false);
});

async function refreshSourceScope(page: Page, mode = 'without-beta') {
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(kind => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release(kind), mode);
  await expect(page.getByRole('button', { name: sourceMessages.en.refresh, exact: true })).toBeEnabled();
}

for (const result of ['denied', 'unavailable'] as const) test(`${result} Page remains removed when Load more carries previous rows forward`, async ({ page }) => {
  await fixture(page, `reader-${result}`); await open(page);
  const pages = page.locator('.page-list'), reader = page.locator('.page-reader');
  await expect(pages).not.toContainText(pageRows[0].title);
  await reader.getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await expect(pages.locator('.page-filter-trigger')).toBeFocused();
  await pages.getByRole('button', { name: pageMessages.en.more, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(pages).toContainText('추가 원본 / additional');
  await expect(pages).not.toContainText(pageRows[0].title);
  await expect(pages.getByRole('link', { name: pageRows[0].title, exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(reader).toContainText(readerMessages.en[result]);
  await expect(pages).not.toContainText(pageRows[0].title);
  expect(await calls(page)).toHaveLength(1);
});

test('unavailable exact Page cannot be revived by a superseded late success', async ({ page }) => {
  await fixture(page, 'reader-race'); await open(page);
  await page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true }).click();
  expect(await calls(page)).toHaveLength(2);
  await release(page, 'unavailable', 1);
  await expect(page.locator('.page-reader')).toContainText(readerMessages.en.unavailable);
  await expect(page.locator('.page-list')).not.toContainText(pageRows[0].title);
  await release(page, 'success', 0);
  await expect(page.locator('.page-reader')).toContainText(readerMessages.en.unavailable);
  await expect(page.locator('.reader-memory')).toHaveCount(0);
  await page.locator('.page-reader').getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await expect(page.locator('.page-filter-trigger')).toBeFocused();
  await page.goBack();
  await expect(page.locator('.page-reader')).toContainText(readerMessages.en.unavailable);
  expect(await calls(page)).toHaveLength(2);
});

test('explicitly reopening the already open failed Page retries once while passive Back reuses its error', async ({ page }) => {
  await fixture(page, 'reader-failure'); await open(page);
  const reader = page.locator('.page-reader');
  await expect(reader).toContainText(readerMessages.en.failure);
  await page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await expect(reader).toContainText(readerMessages.en.failure);
  await reader.getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await page.goBack();
  await expect(reader).toContainText(readerMessages.en.failure);
  expect(await calls(page)).toHaveLength(2);
});

for (const flow of ['open', 'cached', 'late'] as const) test(`successful Source refresh removes another Source backlink from a ${flow} reader while preserving current Page body`, async ({ page }) => {
  await fixture(page, flow === 'late' ? 'reader-cross-source-pending' : 'reader-cross-source'); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages.en;
  if (flow !== 'late') {
    await reader.locator('.reader-labels').getByText(t.references, { exact: true }).click();
    await expect(reader.getByRole('link', { name: '다른 소스의 참조 / other Source reference', exact: false })).toBeVisible();
  }
  if (flow === 'cached') await reader.getByRole('link', { name: t.close, exact: true }).click();
  await refreshSourceScope(page);
  if (flow === 'cached') await page.goBack();
  if (flow === 'late') await release(page);
  await expect(reader).not.toContainText('다른 소스의 참조 / other Source reference');
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader).toContainText(originalBody);
  await expect(reader).not.toContainText(t.unavailable);
  expect(await calls(page)).toHaveLength(1);
});

for (const width of [1440, 958]) test(`desktop nonmodal background controls retain visible focus before the fixed reader panel at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await fixture(page); await open(page);
  const panel = (await page.locator('.page-reader-panel').boundingBox())!;
  const controls = [page.getByRole('combobox', { name: sourceMessages.en.timeZone, exact: true }), page.getByRole('button', { name: sourceMessages.en.applyTimeZone, exact: true }), page.getByRole('button', { name: pageMessages.en.refresh, exact: true })];
  for (const control of controls) {
    await control.focus(); await expect(control).toBeFocused();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(panel.x - 8);
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top === element || !!top && element.contains(top);
    })).toBe(true);
  }
});

for (const locale of ['en', 'ko'] as const) test(`zero-row public tables and uppercase original kinds use accurate ${locale} labels`, async ({ page }) => {
  await fixture(page, 'reader-empty-table', locale); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages[locale];
  await expect(reader).toContainText(locale === 'en' ? 'No public memory entries are available in this body.' : '이 본문에 공개된 기억 항목이 없어요.');
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader).toContainText(emptyMemoryTable);
  await fixture(page, 'reader-uppercase-kind', locale); await open(page);
  await expect(reader.locator('.reader-kind')).toHaveText(locale === 'en' ? 'Record' : '기록');
  await reader.locator('.reader-original summary').click();
  await expect(reader.locator('.reader-original')).toContainText('Fact');
  await expect(reader).toContainText(originalClaim);
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader.locator('.reader-prose').first()).toContainText('| Fact |');
});

for (const locale of ['en', 'ko'] as const) test(`verified references disclose the candidate cap and unknown coverage visibly in ${locale}`, async ({ page }) => {
  await fixture(page, 'reader-success', locale); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages[locale];
  await reader.locator('.reader-labels').getByText(t.references, { exact: true }).click();
  await expect(reader.getByText(locale === 'en' ? 'Up to 10 candidates · Total coverage unknown' : '최대 후보 10개 · 전체 범위 미확인', { exact: true })).toBeVisible();
});

test('public window text stays exact and visibly partial while its memory association remains unknown', async ({ page }) => {
  await fixture(page, 'reader-window'); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages.en;
  await expect(reader).toContainText(t.memoryUnknown);
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader.getByText(t.partial, { exact: true })).toBeVisible();
  await expect(reader.locator('.reader-prose')).toHaveText(publicWindowExcerpt);
  await expect(reader).not.toContainText(originalBody);
});

test('failed backlinks disclose their failure and preserve exact Page body instead of implying an empty range', async ({ page }) => {
  await fixture(page, 'reader-backlinks-failed'); await open(page);
  const reader = page.locator('.page-reader'), t = readerMessages.en;
  await reader.locator('.reader-labels').getByText(t.references, { exact: true }).click();
  await expect(reader.getByText(t.referencesFailed, { exact: true })).toBeVisible();
  await expect(reader.getByText(t.referencesEmpty, { exact: true })).toHaveCount(0);
  await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
  await expect(reader.locator('.reader-prose').first()).toHaveText(originalBody);
});

for (const operation of ['refresh', 'more'] as const) test(`a Page-list ${operation} begun before an exact denial cannot reauthorize that Page when its response arrives later`, async ({ page }) => {
  await fixture(page, 'reader-pending');
  const pages = page.locator('.page-list'), t = pageMessages.en;
  await pages.getByRole('button', { name: t[operation], exact: true }).click();
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await open(page);
  await release(page, 'denied');
  const reader = page.locator('.page-reader');
  await expect(reader).toContainText(readerMessages.en.denied);
  await expect(pages).not.toContainText(pageRows[0].title);
  await reader.getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(pages).toHaveAttribute('aria-busy', 'false');
  await expect(pages).toContainText('추가 원본 / additional');
  await expect(pages).not.toContainText(pageRows[0].title);
  await expect(pages.getByRole('link', { name: pageRows[0].title, exact: true })).toHaveCount(0);
  await pages.getByRole('button', { name: t.refresh, exact: true }).click();
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(pages.getByRole('link', { name: pageRows[0].title, exact: true })).toBeVisible();
  expect(await calls(page)).toHaveLength(1);
});


test('explicit retry of an initially server-seeded failed Page performs a real read instead of reusing its error seed', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  const query = new URLSearchParams({ scenario: 'reader-seeded-failure', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), page: pageRows[0].slug });
  await page.goto(`${fixtureOrigin}/?${query}`);
  const reader = page.locator('.page-reader');
  await expect(reader).toContainText(readerMessages.en.failure);
  await expect(reader.locator('.reader-switch')).toHaveCount(0);
  expect(await calls(page)).toHaveLength(0);
  await page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true }).click();
  await expect(reader).toContainText(originalClaim);
  await expect(reader).not.toContainText(readerMessages.en.failure);
  expect(await calls(page)).toEqual([{ source: sourceReference(sourceSnapshot.sources[0]), slug: pageRows[0].slug }]);
});
