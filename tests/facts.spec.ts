import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { factMessages, memoryKindLabel, sourceMessages, pageMessages, type Locale } from '../src/i18n/messages';
import { sourceReference, sourceNavigationPath, parseFactNavigation, validatedSourceReturn, navigationQueryLimit } from '../src/contracts/sources';
import { readerMessages } from '../src/i18n/messages';
import { pageRows } from './fixtures/page-data';
import { sourceSnapshot } from './fixtures/source-data';
import { factRows, factClaim, factQuote, factBody } from './fixtures/fact-data';
import { fixtureOrigin } from './support/ui';

async function fixture(page: Page, scenario = 'facts-success', locale: Locale = 'en') {
  await page.clock.setFixedTime(new Date('2026-11-03T01:00:00Z'));
  const query = new URLSearchParams({ scenario, locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.getByRole('heading', { name: factMessages[locale].title, exact: true })).toBeVisible();
}
async function load(page: Page, locale: Locale = 'en') {
  await page.getByRole('link', { name: factMessages[locale].load, exact: true }).click();
  await expect(page.getByRole('region', { name: factMessages[locale].caption, exact: true }).locator('tbody tr')).toHaveCount(2);
}
async function open(page: Page) {
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toBeVisible();
}
async function counts(page: Page) {
  return page.evaluate(() => { const fixture = (window as unknown as { __factFixture: { calls: unknown[]; detailCalls: unknown[] } }).__factFixture; return { list: fixture.calls.length, detail: fixture.detailCalls.length }; });
}
async function releaseDetail(page: Page, kind = 'success', index?: number) {
  await page.evaluate(({ kind, index }) => (window as unknown as { __factFixture: { releaseDetail: (kind: string, index?: number) => void } }).__factFixture.releaseDetail(kind, index), { kind, index });
}

test('bounded Fact navigation preserves validated parent Page and settings return without content', () => {
  const source = sourceReference(sourceSnapshot.sources[0]);
  const expanded = Array.from({ length: 8 }, (_, index) => sourceReference({ namespace: `namespace-${'n'.repeat(60)}-${index}`, id: `source-${index}` }));
  const path = sourceNavigationPath(source, expanded, 'yesterday', { slug: '원본/()!~'.repeat(10), view: 'references', mode: 'full' }, { loaded: true, id: '9'.repeat(128), mode: 'full' });
  const query = new URL(path, 'https://internal.invalid').searchParams;
  expect(query.toString().length).toBeLessThanOrEqual(navigationQueryLimit);
  expect(query.get('fact')).toBe('9'.repeat(128)); expect(query.get('factReading')).toBe('full');
  expect(query.get('page')).toBe('원본/()!~'.repeat(10)); expect(query.get('view')).toBe('references'); expect(query.get('added')).toBe('yesterday');
  expect(validatedSourceReturn(path)).toBe(path);
  for (const input of ['fact=17&fact=18', 'fact=017', 'fact=17&factReading=bad', 'fact=17&factReading=full&factReading=panel', 'fact=' + '1'.repeat(129)]) expect(parseFactNavigation(new URLSearchParams(input)).id).toBeNull();
  expect(validatedSourceReturn('https://attacker.invalid/?fact=17')).toBe('/');
});

test('memory translations have independent fixed English and Korean examples', () => {
  expect(Object.keys(factMessages.ko).sort()).toEqual(Object.keys(factMessages.en).sort());
  expect(factMessages.en).toMatchObject({ title: 'Source memories', load: 'Load memories', pageQuote: 'Page-level source quote', sourceAttribution: 'Source attribution', source: 'Source' });
  expect(factMessages.ko).toMatchObject({ title: '소스의 기억', load: '기억 불러오기', pageQuote: '페이지 수준 출처 인용', sourceAttribution: '출처', source: '소스' });
  for (const locale of ['en', 'ko'] as const) expect(factMessages[locale].sourceAttribution).not.toBe(factMessages[locale].source);
  expect(memoryKindLabel('en', 'belief')).toBe('Belief'); expect(memoryKindLabel('ko', 'belief')).toBe('믿음');
  for (const [key, value] of Object.entries(factMessages.ko)) expect(value.trim(), key).not.toBe('');
});

test('Source memories load only on explicit intent and expose bounded coverage and separate semantic columns', async ({ page }) => {
  await fixture(page);
  expect(await counts(page)).toEqual({ list: 0, detail: 0 });
  await expect(page.getByText(factMessages.en.pending, { exact: true })).toBeVisible();
  await load(page);
  const table = page.getByRole('region', { name: factMessages.en.caption, exact: true });
  await expect(table.getByRole('columnheader')).toHaveText([factMessages.en.content, factMessages.en.kind, factMessages.en.sourceAttribution, factMessages.en.recordedAt]);
  await expect(table).toContainText(factClaim); await expect(table).toContainText('Record');
  await expect(page.getByText(factMessages.en.coverage, { exact: false })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('facts')).toBe('1');
  expect(await counts(page)).toEqual({ list: 1, detail: 0 });
});

test('exact Fact identity, original content and verified Page quote survive panel/full/Back without another read', async ({ page }) => {
  await fixture(page); await load(page); await open(page);
  const reader = page.locator('.fact-reader'), t = factMessages.en;
  await expect(reader.getByRole('heading', { name: t.heading, exact: true })).toBeFocused();
  await expect(reader).toContainText(factClaim); await expect(reader).toContainText(t.pageQuote); await expect(reader).toContainText(factQuote);
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
  await reader.getByRole('link', { name: t.fullReading, exact: true }).click();
  await expect(reader).toHaveClass(/page-reader-full/); await expect(reader).toContainText(factClaim);
  expect(await counts(page)).toEqual({ list: 1, detail: 1 });
  expect(JSON.stringify(await page.evaluate(() => history.state))).not.toContain(factClaim);
  expect(page.url()).not.toContain(factQuote);
  await page.goBack(); await expect(reader).toHaveClass(/page-reader-panel/);
  await reader.getByRole('link', { name: t.close, exact: true }).click();
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toBeFocused();
  await page.goBack(); await expect(reader).toContainText(factClaim);
  expect(await counts(page)).toEqual({ list: 1, detail: 1 });
});

test('closing a Fact restores its permitted parent Page view with no simultaneous readers or duplicate acquisition', async ({ page }) => {
  await fixture(page); await load(page);
  await page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true }).click();
  const parent = page.locator('.page-reader:not(.fact-reader)');
  await expect(parent).toBeVisible();
  await parent.locator('.reader-labels').getByText(readerMessages.en.body, { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 600 });
  await parent.getByRole('radio', { name: readerMessages.en.body, exact: true }).focus();
  await parent.locator('.page-reader-scroll').evaluate(element => { element.scrollTop = 200; });
  expect(await parent.locator('.page-reader-scroll').evaluate(element => element.scrollTop)).toBe(200);
  await open(page);
  await expect(parent).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('page')).toBe(pageRows[0].slug);
  expect(new URL(page.url()).searchParams.get('view')).toBe('body');
  await page.locator('.fact-reader').getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await expect(parent).toBeVisible();
  await expect(parent.getByRole('radio', { name: readerMessages.en.body, exact: true })).toBeChecked();
  await expect(parent.getByRole('radio', { name: readerMessages.en.body, exact: true })).toBeFocused();
  expect(await parent.locator('.page-reader-scroll').evaluate(element => element.scrollTop)).toBe(200);
  const acquisitions = await page.evaluate(() => (window as unknown as { __detailFixture: { calls: unknown[] } }).__detailFixture.calls.length);
  expect(acquisitions).toBe(1); expect(await counts(page)).toEqual({ list: 1, detail: 1 });
});

test('one activation reveals exact UTF-16 quote and keeps HTML, remote media and unsafe links inert', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (/attacker\.invalid|example\.invalid\/read/.test(request.url())) requests.push(request.url()); });
  await fixture(page); await load(page); await open(page);
  const reader = page.locator('.fact-reader');
  await reader.getByRole('button', { name: factMessages.en.showInBody, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(reader.locator('.reader-passage')).toHaveText(factQuote); await expect(reader.locator('.reader-passage')).toBeFocused();
  await expect(reader).toContainText(factBody);
  await expect(reader.locator('img,iframe,video,script')).toHaveCount(0);
  await expect(reader.locator('a[href^="javascript:"],a[href^="file:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { factAttack?: boolean }).factAttack)).toBeUndefined();
  expect(requests).toEqual([]);
});

for (const kind of ['mismatch', 'protected', 'missing'] as const) test(`${kind} evidence preserves its limitation without a false highlight`, async ({ page }) => {
  await fixture(page, `facts-${kind}`); await load(page); await open(page);
  const reader = page.locator('.fact-reader');
  await expect(reader.getByRole('button', { name: factMessages.en.showInBody, exact: true })).toHaveCount(0);
  await expect(reader.locator('mark')).toHaveCount(0);
  await expect(reader).toContainText(factMessages.en[kind]);
  await expect(reader).toContainText(factClaim);
});

for (const kind of ['empty', 'cap', 'partial'] as const) test(`${kind} list state does not claim complete Source coverage`, async ({ page }) => {
  await fixture(page, `facts-${kind}`);
  await page.getByRole('link', { name: factMessages.en.load, exact: true }).click();
  await expect(page.getByText(factMessages.en[kind], { exact: false })).toBeVisible();
  await expect(page.getByText(factMessages.en.coverage, { exact: false })).toBeVisible();
});

test('detail deadline discards later response and only explicit reopening starts another acquisition', async ({ page }) => {
  await fixture(page, 'facts-detail-pending'); await load(page); await open(page);
  await page.clock.runFor(60_001);
  await expect(page.locator('.fact-reader')).toContainText(factMessages.en.failure);
  await releaseDetail(page);
  await expect(page.locator('.fact-reader')).not.toContainText(factClaim);
  expect(await counts(page)).toEqual({ list: 1, detail: 1 });
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await releaseDetail(page, 'success', 1);
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  expect(await counts(page)).toEqual({ list: 1, detail: 2 });
});

test('slower previous Fact cannot replace the current public ID', async ({ page }) => {
  await fixture(page, 'facts-detail-pending'); await load(page); await open(page);
  await page.getByRole('link', { name: factRows[1].content, exact: true }).click();
  await releaseDetail(page, 'success', 1); await expect(page.locator('.fact-reader')).toContainText(factRows[1].content);
  await releaseDetail(page, 'success', 0); await expect(page.locator('.fact-reader')).toContainText(factRows[1].content);
  await expect(page.locator('.fact-reader')).not.toContainText(factClaim);
});

for (const flow of ['open', 'closed', 'late'] as const) test(`Source authority removal purges ${flow} Fact and prevents stale Back restoration`, async ({ page }) => {
  await fixture(page, flow === 'late' ? 'facts-detail-pending' : 'facts-success'); await load(page); await open(page);
  if (flow === 'closed') await page.locator('.fact-reader').getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).focus(); await page.keyboard.press('Enter');
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('without-alpha'));
  if (flow === 'late') await releaseDetail(page);
  if (flow === 'closed') await page.goBack();
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
});

test('exact Fact denial discards Source memory rows and cached Back cannot restore public content', async ({ page }) => {
  await fixture(page, 'facts-detail-denied'); await load(page);
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
});

test('closing a directly opened Fact enables explicit unseeded Page refresh without an automatic Page read', async ({ page }) => {
  const source = sourceReference(sourceSnapshot.sources[0]);
  const query = new URLSearchParams({ scenario: 'facts-unseeded', locale: 'en', timeZone: 'UTC', source, facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  const reader = page.locator('.fact-reader');
  await expect(reader).toContainText(factClaim);
  const pages = page.locator('.page-list');
  const refresh = pages.getByRole('button', { name: pageMessages.en.refresh, exact: true });
  await expect(refresh).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls)).toEqual([]);
  await reader.getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(refresh).toBeEnabled();
  await expect(page.locator('.fact-list tbody tr')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls)).toEqual([]);
  await refresh.click();
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls)).toEqual([{ source, offset: 0 }]);
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(pages).toHaveAttribute('aria-busy', 'false');
  await expect(pages.getByRole('link', { name: pageRows[0].title, exact: true })).toBeVisible();
});

test('discarded server Fact seed cannot revive after denial when a permitted Page is opened', async ({ page }) => {
  const query = new URLSearchParams({ scenario: 'facts-seeded-denied', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), facts: '1' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
  await page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true }).click();
  await expect(page.locator('.page-reader:not(.fact-reader)')).toBeVisible();
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
  await page.locator('.page-reader:not(.fact-reader)').getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toHaveCount(0);
  const refresh = page.locator('.fact-list').getByRole('button', { name: factMessages.en.refresh, exact: true });
  await expect(refresh).toBeDisabled();
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(page.locator('.fact-list')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release('empty'));
  await expect(page.getByText(factMessages.en.empty, { exact: true })).toBeVisible();
});

for (const locale of ['en', 'ko'] as const) test(`narrow enlarged ${locale} memory reader has accessible controls and no covered background`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await fixture(page, 'facts-success', locale); await load(page, locale); await open(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const reader = page.locator('.fact-reader'), t = factMessages[locale];
  await expect(reader).toContainText(factClaim); await expect(reader).toContainText(locale === 'en' ? 'Page-level source quote' : '페이지 수준 출처 인용');
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0);
  for (const control of await reader.getByRole('button').all()) { const box = await control.boundingBox(); if (box) expect(box.height).toBeGreaterThanOrEqual(44); }
  const results = await new AxeBuilder({ page }).include('.fact-reader').analyze(); expect(results.violations).toEqual([]);
  await reader.getByRole('link', { name: t.close, exact: true }).click();
  await expect(page.getByRole('link', { name: factClaim, exact: true })).toBeFocused();
});


test('server-seeded Fact survives Close and Back without duplicate reads, explicit reopen reads afresh', async ({ page }) => {
  const query = new URLSearchParams({ scenario: 'facts-seeded-detail', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  expect((await counts(page)).detail).toBe(0);
  await page.locator('.fact-reader').getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await page.goBack();
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  expect((await counts(page)).detail).toBe(0);
  await page.locator('.fact-reader').getByRole('link', { name: factMessages.en.close, exact: true }).click();
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  expect((await counts(page)).detail).toBe(1);
});

for (const pending of [false, true]) test(`same-Source Page links preserve ${pending ? 'pending' : 'loaded'} memory intent`, async ({ page }) => {
  await fixture(page, pending ? 'facts-list-pending' : 'facts-success');
  await page.getByRole('link', { name: factMessages.en.load, exact: true }).click();
  if (!pending) await expect(page.locator('.fact-list tbody tr')).toHaveCount(2);
  const pageLink = page.locator('.page-list').getByRole('link', { name: pageRows[0].title, exact: true });
  expect(new URL((await pageLink.getAttribute('href'))!, fixtureOrigin).searchParams.get('facts')).toBe('1');
  await pageLink.click();
  expect(new URL(page.url()).searchParams.get('facts')).toBe('1');
  await page.locator('.page-reader:not(.fact-reader) .reader-labels').getByText(readerMessages.en.body, { exact: true }).click();
  expect(new URL(page.url()).searchParams.get('facts')).toBe('1');
  if (pending) await page.evaluate(() => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release('success'));
  await page.locator('.page-reader:not(.fact-reader)').getByRole('link', { name: readerMessages.en.close, exact: true }).click();
  await expect(page.locator('.fact-list tbody tr')).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get('facts')).toBe('1');
  expect((await counts(page)).list).toBe(1);
});

for (const destination of ['notes/fact-context', 'notes/fact-original']) test(`verified older ${destination} opens outside Today while Back restores Source conditions`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T01:00:00Z'));
  const query = new URLSearchParams({ scenario: 'facts-success', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), added: 'today', facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  const link = page.locator('.fact-reader').locator(`a[href*="${new URLSearchParams({ page: destination }).toString()}"]`).first();
  expect(new URL((await link.getAttribute('href'))!, fixtureOrigin).searchParams.has('added')).toBe(false);
  await link.click();
  await expect(page.locator('.page-reader:not(.fact-reader)')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe(destination);
  await page.goBack();
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  expect(new URL(page.url()).searchParams.get('added')).toBe('today');
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
});

for (const locale of ['en', 'ko'] as const) for (const issue of ['denied', 'source-unavailable'] as const) test(`${locale} ${issue} remains explicit until fresh Source success enables a new memory read`, async ({ page }) => {
  await fixture(page, 'facts-list-pending', locale);
  await page.getByRole('link', { name: factMessages[locale].load, exact: true }).click();
  await page.evaluate(kind => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release(kind), issue);
  const list = page.locator('.fact-list'), refresh = list.getByRole('button', { name: factMessages[locale].refresh, exact: true });
  await expect(list).toContainText(issue === 'denied' ? factMessages[locale].denied : factMessages[locale].sourceUnavailable);
  expect(await refresh.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await expect(list.getByText(factMessages[locale].pending, { exact: true })).toHaveCount(0);
  await expect(list.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: sourceMessages[locale].refresh, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(refresh).toBeEnabled();
  expect((await counts(page)).list).toBe(1);
  await expect(list.locator('tbody tr')).toHaveCount(0);
  await refresh.click();
  await page.evaluate(() => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release('success'));
  await expect(list.locator('tbody tr')).toHaveCount(2);
  expect((await counts(page)).list).toBe(2);
});


test('Source revocation consumes the SSR parent body seed before permission recovery and Back', async ({ page }) => {
  const query = new URLSearchParams({ scenario: 'facts-seeded-parent-denied', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), page: pageRows[0].slug, view: 'body', facts: '1' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.page-reader:not(.fact-reader)')).toContainText('DISCARDED_SSR_PARENT_ONLY');
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(page.locator('.fact-list').getByRole('button', { name: factMessages.en.refresh, exact: true })).toBeEnabled();
  await page.goBack();
  await expect(page.locator('.page-reader:not(.fact-reader)')).toContainText(readerMessages.en.loading);
  await expect(page.locator('.page-reader:not(.fact-reader)')).not.toContainText('DISCARDED_SSR_PARENT_ONLY');
  expect(await page.evaluate(() => (window as unknown as { __detailFixture: { calls: unknown[] } }).__detailFixture.calls.length)).toBe(1);
  await page.evaluate(() => (window as unknown as { __detailFixture: { release: (kind: string) => void } }).__detailFixture.release('success'));
  await expect(page.locator('.page-reader:not(.fact-reader)')).toContainText('원본 본문 / original body');
});


for (const issue of ['unavailable', 'unconfigured'] as const) test(`Page ${issue} preserves its actual cause and fresh Source validation enables first memory Load`, async ({ page }) => {
  await fixture(page);
  await page.locator('.page-list').getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
  await page.evaluate(kind => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release(kind), issue);
  const list = page.locator('.fact-list');
  await expect(list).toContainText(issue === 'unavailable' ? factMessages.en.sourceUnavailable : factMessages.en.unconfigured);
  await expect(list.getByText(factMessages.en.denied, { exact: true })).toHaveCount(0);
  expect(await list.getByRole('button', { name: factMessages.en.load, exact: true }).evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await list.getByRole('link', { name: factMessages.en.load, exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(2);
  expect((await counts(page)).list).toBe(1);
});


for (const locale of ['en', 'ko'] as const) for (const cause of ['failure', 'busy', 'unknown', 'unsupported'] as const) test(`${locale} cold Source ${cause} retains a pending exact Fact URL until manual Source recovery`, async ({ page }) => {
  const source = sourceReference(sourceSnapshot.sources[0]);
  const query = new URLSearchParams({ scenario: `facts-cold-${cause}`, locale, timeZone: 'UTC', source, facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  const reader = page.locator('.fact-reader');
  const t = sourceMessages[locale];
  const message = cause === 'failure' ? t.issues.failure.reason : cause === 'busy' ? t.busySources : cause === 'unsupported' ? t.unsupported : t.issues.unknown.reason;
  await expect(reader).toContainText(message);
  await expect(reader).not.toContainText(factMessages[locale].unavailable);
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
  expect(await counts(page)).toEqual({ list: 0, detail: 0 });
  await page.getByRole('button', { name: t.refresh, exact: true }).click();
  await expect(reader).toContainText(t.loading);
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(reader).toContainText(factClaim);
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
  expect(await counts(page)).toEqual({ list: 0, detail: 1 });
});

for (const cause of ['unconfigured', 'loading'] as const) test(`cold Source ${cause} preserves bounded direct identity without claiming revocation`, async ({ page }) => {
  const source = sourceReference(sourceSnapshot.sources[0]);
  const query = new URLSearchParams({ scenario: `facts-cold-${cause}`, locale: 'en', source, facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.fact-reader')).toContainText(cause === 'loading' ? sourceMessages.en.loading : sourceMessages.en.issues.unconfigured.reason);
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
  expect(await counts(page)).toEqual({ list: 0, detail: 0 });
});

for (const cause of ['denied', 'absent'] as const) test(`known cold Source ${cause} purges direct Fact navigation`, async ({ page }) => {
  const query = new URLSearchParams({ scenario: `facts-cold-${cause}`, locale: 'en', source: sourceReference(sourceSnapshot.sources[0]), facts: '1', fact: '17' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.locator('.fact-reader')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('fact')).toBe(false);
  expect(new URL(page.url()).searchParams.has('source')).toBe(false);
  expect(await counts(page)).toEqual({ list: 0, detail: 0 });
});

test('cold Source recovery reads the exact Fact freshly instead of reviving an unvalidated seed', async ({ page }) => {
  const source = sourceReference(sourceSnapshot.sources[0]);
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'facts-cold-seed', locale: 'en', source, facts: '1', fact: '17' })}`);
  await expect(page.locator('.fact-reader')).not.toContainText('UNVALIDATED_COLD_SEED');
  await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(page.locator('.fact-reader')).toContainText(factClaim);
  await expect(page.locator('.fact-reader')).not.toContainText('UNVALIDATED_COLD_SEED');
  expect(await counts(page)).toEqual({ list: 0, detail: 1 });
});


for (const locale of ['en', 'ko'] as const) for (const layout of ['mobile-panel', 'full'] as const) for (const cause of ['failure', 'unknown'] as const) test(`${locale} ${layout} pending Source ${cause} has an accessible bounded manual recovery action`, async ({ page }) => {
  await page.setViewportSize(layout === 'mobile-panel' ? { width: 320, height: 900 } : { width: 1440, height: 960 });
  const source = sourceReference(sourceSnapshot.sources[0]);
  const query = new URLSearchParams({ scenario: `facts-cold-${cause}`, locale, timeZone: 'UTC', source, expanded: source, facts: '1', fact: '17', page: pageRows[0].slug, view: 'references', reading: 'full', added: 'yesterday' });
  if (layout === 'full') query.set('factReading', 'full');
  await page.goto(`${fixtureOrigin}/?${query}`);
  const reader = page.locator('.fact-reader'), t = sourceMessages[locale];
  const action = reader.getByRole('button', { name: t.refresh, exact: true });
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  expect(await action.evaluate(button => button.closest('[inert],[hidden]') === null)).toBe(true);
  await expect(page.getByRole('button', { name: t.refresh, exact: true })).toHaveCount(1);
  const parameters = await reader.locator('form input[type="hidden"]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])));
  expect(parameters).toMatchObject({ source, expanded: source, facts: '1', fact: '17', page: pageRows[0].slug, view: 'references', reading: 'full', added: 'yesterday', ...(layout === 'full' ? { factReading: 'full' } : {}) });
  expect(await counts(page)).toEqual({ list: 0, detail: 0 });
  await action.focus(); await page.keyboard.press('Enter');
  const loading = reader.getByRole('button', { name: t.refreshing, exact: true });
  expect(await loading.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await expect(reader.getByRole('status').filter({ hasText: t.loading })).toHaveText(t.loading);
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(reader).toContainText(factClaim);
  await expect(reader.getByRole('heading', { name: factMessages[locale].heading, exact: true })).toBeFocused();
  const current = new URL(page.url()).searchParams;
  for (const key of ['source', 'facts', 'fact', 'page', 'view', 'reading', 'added', 'factReading']) expect(current.get(key)).toBe(query.get(key));
  expect(await counts(page)).toEqual({ list: 0, detail: 1 });
});


for (const locale of ['en', 'ko'] as const) for (const operation of ['close', 'escape'] as const) test(`${locale} ${operation} pending Fact restores toolbar Source recovery without reviving the detail`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const source = sourceReference(sourceSnapshot.sources[0]);
  const query = new URLSearchParams({ scenario: operation === 'close' ? 'facts-cold-failure' : 'facts-cold-unknown', locale, source, facts: '1', fact: '17', factReading: 'full' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  const reader = page.locator('.fact-reader'), t = sourceMessages[locale];
  await expect(reader.getByRole('button', { name: t.refresh, exact: true })).toBeVisible();
  if (operation === 'close') await reader.getByRole('link', { name: factMessages[locale].returnToList, exact: true }).click();
  else { await reader.getByRole('heading', { name: factMessages[locale].heading, exact: true }).focus(); await page.keyboard.press('Escape'); }
  await expect(reader).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  expect(new URL(page.url()).searchParams.has('fact')).toBe(false);
  const recover = page.getByRole('button', { name: t.refresh, exact: true });
  await expect(recover).toHaveCount(1);
  await expect(recover).toBeVisible(); await expect(recover).toBeEnabled();
  expect(await recover.evaluate(button => button.closest('[inert],[hidden]') === null)).toBe(true);
  await recover.focus(); await page.keyboard.press('Enter');
  await page.evaluate(() => (window as unknown as { __sourceFixture: { release: (kind: string) => void } }).__sourceFixture.release('success'));
  await expect(page.locator('.fact-list tbody tr')).toHaveCount(2);
  expect(await counts(page)).toEqual({ list: 1, detail: 0 });
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
});


for (const locale of ['en', 'ko'] as const) for (const boundary of ['back', 'source-link'] as const) test(`${locale} ${boundary} presents memories as unloaded while retaining a permitted internal snapshot`, async ({ page }) => {
  await fixture(page, 'facts-list-pending', locale);
  const t = factMessages[locale], list = page.locator('.fact-list');
  await list.getByRole('link', { name: t.load, exact: true }).click();
  await page.evaluate(() => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release('success'));
  await expect(list.locator('tbody tr')).toHaveCount(2);
  if (boundary === 'back') await page.goBack();
  else {
    await page.getByRole('link', { name: factClaim, exact: true }).click();
    await expect(page.locator('.fact-reader')).toContainText(factClaim);
    const source = page.locator('.fact-reader .reader-metadata > div').filter({ has: page.getByText(t.source, { exact: true }) });
    await source.getByRole('link').click();
    await expect(page.locator('.fact-reader')).toHaveCount(0);
  }
  expect(new URL(page.url()).searchParams.has('facts')).toBe(false);
  await expect(list.getByRole('link', { name: t.load, exact: true })).toBeVisible();
  await expect(list.getByText(t.pending, { exact: true })).toBeVisible();
  await expect(list.locator('tbody tr,.table-footer')).toHaveCount(0);
  await expect(list.getByText(t.complete, { exact: false })).toHaveCount(0);
  await list.getByRole('link', { name: t.load, exact: true }).click();
  await expect(list).toHaveAttribute('aria-busy', 'true');
  await expect(list.locator('tbody tr')).toHaveCount(2);
  await expect(list.getByText(t.previous, { exact: true })).toBeVisible();
  expect((await counts(page)).list).toBe(2);
  await page.evaluate(() => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release('empty'));
  await expect(list.getByText(t.empty, { exact: true })).toBeVisible();
});

for (const locale of ['en', 'ko'] as const) for (const outcome of ['denied', 'source-unavailable', 'unconfigured'] as const) test(`${locale} hidden pending memory read still reports late ${outcome}`, async ({ page }) => {
  await fixture(page, 'facts-list-pending', locale);
  const t = factMessages[locale], list = page.locator('.fact-list');
  await list.getByRole('link', { name: t.load, exact: true }).click();
  await expect(list).toHaveAttribute('aria-busy', 'true');
  await page.goBack();
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await expect(list.getByText(t.pending, { exact: true })).toBeVisible();
  await expect(list.getByText(t.loading, { exact: true })).toHaveCount(0);
  await page.evaluate(kind => (window as unknown as { __factFixture: { release: (kind: string) => void } }).__factFixture.release(kind), outcome);
  await expect(list).toContainText(outcome === 'denied' ? t.denied : outcome === 'source-unavailable' ? t.sourceUnavailable : t.unconfigured);
  await expect(list.locator('tbody tr,.table-footer')).toHaveCount(0);
  if (outcome !== 'unconfigured') expect(await list.getByRole('button', { name: t.load, exact: true }).evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect((await counts(page)).list).toBe(1);
});


for (const locale of ['en', 'ko'] as const) test(`${locale} attribution column uses a distinct fixed label from registered Source metadata`, async ({ page }) => {
  await fixture(page, 'facts-success', locale); await load(page, locale);
  const t = factMessages[locale], table = page.locator('.fact-list table');
  await expect(table.getByRole('columnheader').nth(2)).toHaveText(locale === 'en' ? 'Source attribution' : '출처');
  await expect(table.getByRole('columnheader', { name: t.source, exact: true })).toHaveCount(0);
  await expect(table.locator('tbody tr').first().locator('td').nth(1)).toHaveText('mcp:put_page');
  await page.getByRole('link', { name: factClaim, exact: true }).click();
  await expect(page.locator('.fact-reader .reader-metadata dt').first()).toHaveText(locale === 'en' ? 'Source' : '소스');
});


for (const locale of ['en', 'ko'] as const) test(`${locale} narrow enlarged Fact header text stays within its own fixed column`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await fixture(page, 'facts-success', locale); await load(page, locale);
  await page.evaluate(async () => { await document.fonts.load('400 26px "Pretendard Variable"'); await document.fonts.ready; document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.fonts.check('400 26px "Pretendard Variable"'))).toBe(true);
  await page.locator('.fact-list .table-scroll').evaluate(element => { element.scrollLeft = 420; });
  const cells = await page.locator('.fact-list thead th').evaluateAll(headers => headers.map(header => {
    const bounds = header.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(header);
    return { width: bounds.width, fontSize: getComputedStyle(header).fontSize,
      lines: [...range.getClientRects()].map(line => ({ left: line.left - bounds.left, right: line.right - bounds.left, top: line.top, bottom: line.bottom })) };
  }));
  expect(cells.map(cell => cell.width)).toEqual([336, 96, 160, 208]);
  for (const cell of cells) {
    expect(cell.fontSize).toBe('26px');
    for (const line of cell.lines) { expect(line.left).toBeGreaterThanOrEqual(0); expect(line.right).toBeLessThanOrEqual(cell.width); }
  }
  await expect(page.locator('.fact-list thead th').nth(2)).toHaveText(locale === 'en' ? 'Source attribution' : '출처');
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  const desktop = await page.locator('.fact-list').evaluate(root => ({
    rowHeight: root.querySelector('tbody tr')!.getBoundingClientRect().height,
    headers: [...root.querySelectorAll('thead th')].map(header => ({ width: header.getBoundingClientRect().width, fontSize: getComputedStyle(header).fontSize })),
  }));
  expect(desktop.rowHeight).toBe(36);
  const tableWidth = desktop.headers.reduce((sum, header) => sum + header.width, 0);
  for (const [index, ratio] of [0.42, 0.12, 0.2, 0.26].entries()) {
    expect(desktop.headers[index].fontSize).toBe('13px');
    expect(desktop.headers[index].width).toBeCloseTo(tableWidth * ratio, 1);
  }
});
