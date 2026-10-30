import { expect, test } from '@playwright/test';
import { calendarDay, matchesCalendarFilter } from '../src/i18n/time-zone';
import { pageMessages, sourceMessages } from '../src/i18n/messages';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { fixtureOrigin } from './support/ui';
import { sourceSnapshot } from './fixtures/source-data';
import { sourceReference } from '../src/contracts/sources';

async function pageFixture(page: Page, locale = 'en') {
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  const query = new URLSearchParams({ scenario: 'pages-seeded', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.page-list table tbody tr')).toHaveCount(3);
}
async function releasePage(page: Page, kind = 'success') {
  await page.evaluate(value => (window as unknown as { __pageFixture: { release: (value: string) => void } }).__pageFixture.release(value), kind);
}
async function changePageCondition(page: Page, condition: 'filter' | 'zone' | 'day') {
  const pages = page.locator('.page-list');
  if (condition === 'filter') {
    await pages.getByRole('button', { name: pageMessages.en.filter, exact: false }).click();
    await pages.getByRole('option', { name: pageMessages.en.today, exact: true }).click();
  } else if (condition === 'zone') {
    await page.getByRole('combobox', { name: sourceMessages.en.timeZone, exact: true }).selectOption('Asia/Seoul');
    await page.getByRole('button', { name: sourceMessages.en.applyTimeZone, exact: true }).click();
    await expect(page.getByText(`${sourceMessages.en.effectiveTimeZone}: Asia/Seoul`, { exact: true })).toBeVisible();
  } else {
    await page.clock.setFixedTime(new Date('2026-11-01T00:00:01Z'));
    await page.clock.runFor(30_000); // Fire the real calendar subscriber, rather than only changing Date.
  }
}

for (const condition of ['filter', 'zone', 'day'] as const) test(`an initial unseeded Page read survives a local ${condition} change`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  const query = new URLSearchParams({ scenario: 'pages-unseeded', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) });
  if (condition === 'zone') query.set('added', 'today');
  if (condition === 'day') query.set('added', 'yesterday');
  await page.goto(`${fixtureOrigin}/?${query}`);
  const pages = page.locator('.page-list');
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await changePageCondition(page, condition);
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await expect(pages.getByRole('table')).toHaveCount(0);
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(condition === 'zone' ? 3 : 2);
  await expect(pages).not.toContainText(pageMessages.en.pending);
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length)).toBe(1);
});

for (const result of ['denied', 'unavailable']) for (const condition of ['filter', 'zone', 'day'] as const) test(`a same-Source ${result} reply purges after an applied ${condition} change`, async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.more, exact: true }).click();
  await changePageCondition(page, condition);
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await releasePage(page, result);
  await expect(pages).toContainText(pageMessages.en.unavailable);
  await expect(pages.getByRole('table')).toHaveCount(0);
  await changePageCondition(page, condition === 'filter' ? 'zone' : 'filter');
  await expect(pages).toContainText(pageMessages.en.unavailable);
  await expect(pages.getByRole('table')).toHaveCount(0);
});

for (const result of ['failure', 'unknown']) test(`local display changes preserve a real Page ${result} and its prior observation`, async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.more, exact: true }).click();
  await releasePage(page, result);
  const message = result === 'failure' ? pageMessages.en.failure : pageMessages.en.unsupported;
  await expect(pages).toContainText(message);
  await changePageCondition(page, 'filter');
  await changePageCondition(page, 'zone');
  await changePageCondition(page, 'day');
  await expect(pages).toContainText(message);
  await expect(pages).toContainText(pageMessages.en.previous);
  await expect(pages.getByRole('status')).not.toContainText(pageMessages.en.complete);
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length)).toBe(1);
});

for (const result of ['failure', 'unknown']) test(`an outdated successful Page refresh preserves the preceding ${result} status`, async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await releasePage(page, result);
  const message = result === 'failure' ? pageMessages.en.failure : pageMessages.en.unsupported;
  await expect(pages).toContainText(message);
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await changePageCondition(page, 'filter');
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  await releasePage(page);
  await expect(pages).toContainText(message);
  await expect(pages).toContainText(pageMessages.en.previous);
  await expect(pages.locator('tbody tr')).toHaveCount(1);
  await expect(pages).not.toContainText('추가 원본 / additional');
});

test('Page messages include complete Korean translations and independent acceptance examples', () => {
  expect(Object.keys(pageMessages.ko).sort()).toEqual(Object.keys(pageMessages.en).sort());
  for (const key of Object.keys(pageMessages.en) as (keyof typeof pageMessages.en)[]) {
    expect(pageMessages.ko[key].trim(), key).not.toBe('');
    expect(pageMessages.ko[key], key).not.toBe(pageMessages.en[key]);
  }
  expect(pageMessages.en).toMatchObject({ title: 'Pages', filter: 'Added', today: 'Today', yesterday: 'Yesterday', added: 'Added to Brain' });
  expect(pageMessages.ko).toMatchObject({ title: '페이지', filter: '추가 시점', today: '오늘', yesterday: '어제', added: 'Brain에 추가됨' });
});

test('Page day filters use local calendar dates across spring and fall DST transitions', () => {
  const zone = 'America/Los_Angeles';
  // The spring day has 23 hours. Yesterday begins 23h before today's local midnight.
  const springNow = '2026-03-09T07:30:00Z'; // March 9, 00:30 PDT.
  expect(matchesCalendarFilter('2026-03-08T08:00:00Z', 'yesterday', zone, springNow)).toBe(true);
  expect(matchesCalendarFilter('2026-03-09T06:59:59Z', 'yesterday', zone, springNow)).toBe(true);
  expect(matchesCalendarFilter('2026-03-08T07:59:59Z', 'yesterday', zone, springNow)).toBe(false);
  expect(matchesCalendarFilter('2026-03-09T07:00:00Z', 'today', zone, springNow)).toBe(true);
  // The fall day has 25 hours and contains two distinct 01:30 instants.
  const fallNow = '2026-11-02T08:30:00Z'; // November 2, 00:30 PST.
  for (const instant of ['2026-11-01T07:00:00Z', '2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z', '2026-11-02T07:59:59Z']) {
    expect(matchesCalendarFilter(instant, 'yesterday', zone, fallNow), instant).toBe(true);
  }
  expect(matchesCalendarFilter('2026-11-01T06:59:59Z', 'yesterday', zone, fallNow)).toBe(false);
  expect(matchesCalendarFilter('2026-11-02T08:00:00Z', 'today', zone, fallNow)).toBe(true);
});

test('Page day filters keep zone, year rollover and unknown creation semantics independent', () => {
  const now = '2026-01-01T00:30:00Z';
  expect(calendarDay(now, 'UTC')).toBe('AD-2026-01-01');
  expect(calendarDay(now, 'America/Los_Angeles')).toBe('AD-2025-12-31');
  expect(matchesCalendarFilter('2025-12-31T23:59:59Z', 'yesterday', 'UTC', now)).toBe(true);
  expect(matchesCalendarFilter('2025-12-31T23:59:59Z', 'today', 'America/Los_Angeles', now)).toBe(true);
  expect(matchesCalendarFilter('2026-01-01T00:30:00Z', 'today', 'Asia/Seoul', now)).toBe(true);
  for (const unknown of [null, '', '2026-01-01', '2026-02-30T00:00:00Z', '2026-01-01T00:30:00']) {
    expect(matchesCalendarFilter(unknown, 'today', 'UTC', now)).toBe(false);
    expect(matchesCalendarFilter(unknown, 'yesterday', 'UTC', now)).toBe(false);
    expect(matchesCalendarFilter(unknown, 'all', 'UTC', now)).toBe(true);
  }
});

test('enhanced Page filter supports keyboard selection, same-option clearing and focus return', async ({ page }) => {
  await pageFixture(page);
  const t = pageMessages.en;
  const pages = page.locator('.page-list');
  const filter = pages.getByRole('button', { name: t.filter, exact: false });
  await filter.focus(); await page.keyboard.press('ArrowDown');
  await expect(pages.getByRole('option', { name: t.all, exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(pages.getByRole('option', { name: t.yesterday, exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(filter).toBeFocused();
  await expect(pages.locator('tbody tr')).toHaveCount(1);
  await expect(pages.locator('tbody tr')).toContainText('오늘의 원본 / today');
  expect(new URL(page.url()).searchParams.get('added')).toBe('today');
  await filter.click(); await pages.getByRole('option', { name: t.today, exact: true }).click();
  await expect(pages.locator('tbody tr')).toHaveCount(3);
  expect(new URL(page.url()).searchParams.get('added')).toBeNull();
  await filter.click(); await page.keyboard.press('Escape');
  await expect(filter).toBeFocused();
  await expect(pages.getByRole('listbox')).toHaveCount(0);
  await filter.click(); await pages.getByRole('heading').click();
  await expect(pages.getByRole('listbox')).toHaveCount(0);
  await filter.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  await expect(pages.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length)).toBe(0);
});

test('Page append deduplicates identities and retains prior rows, observation and focus on failure', async ({ page }) => {
  await pageFixture(page);
  const t = pageMessages.en;
  const pages = page.locator('.page-list');
  const more = pages.getByRole('button', { name: t.more, exact: true });
  const original = await pages.locator('.scope-note time').first().getAttribute('datetime');
  await more.focus(); await page.keyboard.press('Enter');
  await expect(pages).toContainText(t.loading);
  await releasePage(page, 'failure');
  await expect(pages).toContainText(t.failure);
  await expect(pages.locator('tbody tr')).toHaveCount(3);
  await expect(pages.locator('.scope-note time').first()).toHaveAttribute('datetime', original!);
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter'); await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(4);
  await expect(pages).toContainText('추가 원본 / additional');
  await expect(pages).toContainText(t.end);
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: { offset: number }[] } }).__pageFixture.calls.map(call => call.offset))).toEqual([10, 10]);
});

test('condition changes suppress late Page replies without mixing loaded ranges', async ({ page }) => {
  await pageFixture(page);
  const t = pageMessages.en;
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: t.more, exact: true }).click();
  await pages.getByRole('button', { name: t.filter, exact: false }).click();
  await pages.getByRole('option', { name: t.today, exact: true }).click();
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(1);
  await expect(pages).not.toContainText('추가 원본 / additional');
  await pages.getByRole('button', { name: t.filter, exact: false }).click();
  await pages.getByRole('option', { name: t.all, exact: true }).click();
  await expect(pages.locator('tbody tr')).toHaveCount(3);
});

test('authoritative source omission purges Pages and suppresses an old response', async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.more, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { setSeed: (value: string) => void } }).__sourceFixture.setSeed('empty'));
  await expect(pages).toHaveCount(0);
  await releasePage(page);
  await expect(page.locator('main')).not.toContainText('추가 원본 / additional');
  await expect(page.locator('main')).not.toContainText('오늘의 원본 / today');
});

test('a Source reintroduced at the same URL cannot restore its purged original Page seed', async ({ page }) => {
  await pageFixture(page);
  const selected = new URL(page.url()).searchParams.get('source');
  const pages = page.locator('.page-list');
  await page.evaluate(() => (window as unknown as { __sourceFixture: { setSeed: (value: string) => void } }).__sourceFixture.setSeed('empty'));
  await expect(pages).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __sourceFixture: { setSeed: (value: string) => void } }).__sourceFixture.setSeed('success'));
  expect(new URL(page.url()).searchParams.get('source')).toBe(selected);
  await expect(pages).toContainText(pageMessages.en.loading);
  await expect(pages.getByRole('table')).toHaveCount(0);
  await expect(pages).not.toContainText('오늘의 원본 / today');
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(4);
});

test('authoritative Page denial clears previously loaded private rows', async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await releasePage(page, 'denied');
  await expect(pages).toContainText(pageMessages.en.unavailable);
  await expect(pages.getByRole('table')).toHaveCount(0);
  await expect(pages).not.toContainText('오늘의 원본 / today');
});

for (const result of ['denied', 'unavailable']) test(`a current ${result} Page reply purges rows across midnight before the calendar tick`, async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await expect(pages).toContainText(pageMessages.en.loading);
  // Change Date without firing interval/focus handlers: the request's stored condition is still October31.
  await page.clock.setFixedTime(new Date('2026-11-01T00:00:01Z'));
  await releasePage(page, result);
  await expect(pages).toContainText(pageMessages.en.unavailable);
  await expect(pages.getByRole('table')).toHaveCount(0);
  await expect(pages).not.toContainText('오늘의 원본 / today');
});

test('a successful old-day Page reply is ignored across midnight before the calendar tick', async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.more, exact: true }).click();
  await page.clock.setFixedTime(new Date('2026-11-01T00:00:01Z'));
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(3);
  await expect(pages).not.toContainText('추가 원본 / additional');
});

test('returning to a denied Source cannot reuse its original server Page seed', async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await releasePage(page, 'denied');
  await expect(pages).toContainText(pageMessages.en.unavailable);
  await page.getByRole('link', { name: sourceMessages.en.returnToList, exact: true }).click();
  await page.locator('.table-board table').getByRole('link', { name: sourceSnapshot.sources[0].name, exact: true }).click();
  await expect(pages).toContainText(pageMessages.en.loading);
  await expect(pages).not.toContainText('오늘의 원본 / today');
  await expect(pages.getByRole('table')).toHaveCount(0);
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(4);
});

test('returning after a successful Page refresh does not replay the original server seed', async ({ page }) => {
  await pageFixture(page);
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('link', { name: sourceMessages.en.returnToList, exact: true }).click();
  await page.locator('.table-board table').getByRole('link', { name: sourceSnapshot.sources[0].name, exact: true }).click();
  await expect(pages).toContainText(pageMessages.en.loading);
  await expect(pages.getByRole('table')).toHaveCount(0);
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(4);
});

test('effective-zone changes recompute the loaded calendar range and discard an older continuation', async ({ page }) => {
  await pageFixture(page);
  const t = pageMessages.en;
  const pages = page.locator('.page-list');
  await pages.getByRole('button', { name: t.filter, exact: false }).click();
  await pages.getByRole('option', { name: t.today, exact: true }).click();
  await expect(pages.locator('tbody tr')).toHaveCount(1);
  await pages.getByRole('button', { name: t.more, exact: true }).click();
  await page.getByRole('combobox', { name: sourceMessages.en.timeZone, exact: true }).selectOption('Asia/Seoul');
  await page.getByRole('button', { name: sourceMessages.en.applyTimeZone, exact: true }).click();
  await expect(pages.locator('.table-footer')).toContainText('Asia/Seoul');
  await expect(pages.locator('tbody tr')).toHaveCount(2);
  await releasePage(page);
  await expect(pages.locator('tbody tr')).toHaveCount(2);
  await expect(pages).not.toContainText('추가 원본 / additional');
  await expect(pages.locator('.table-footer')).toContainText('Asia/Seoul');
});

for (const locale of ['en', 'ko'] as const) test(`${locale} Page table and filter remain accessible at 320px and 200% text`, async ({ page }) => {
  await pageFixture(page, locale);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const pages = page.locator('.page-list');
  await expect(pages.getByRole('heading', { name: locale === 'en' ? 'Pages' : '페이지', exact: true })).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/pages-${locale}-320-text200.png`, fullPage: true });
});
