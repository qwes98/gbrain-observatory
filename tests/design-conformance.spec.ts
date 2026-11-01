import { expect, test } from '@playwright/test';
import { sourceReference } from '../src/contracts/sources';
import { pageMessages, sourceMessages } from '../src/i18n/messages';
import { sourceSnapshot } from './fixtures/source-data';
import AxeBuilder from '@axe-core/playwright';
import { fixtureOrigin } from './support/ui';

test('source group disclosure preserves selection and independent source expansion', async ({ page }) => {
  const t = sourceMessages.en;
  await page.goto(`${fixtureOrigin}/?scenario=success&locale=en`);
  const nav = page.locator('.desktop-navigation');
  const source = sourceSnapshot.sources[0];
  const link = nav.getByRole('link', { name: source.name, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
  const expand = nav.getByRole('button', { name: `${t.expandSource}: ${source.name} · ${source.id}`, exact: true });
  await expand.click();
  const expandedUrl = page.url();
  const group = nav.getByRole('button', { name: t.toggleSources, exact: true });
  const desktopTreeId = await group.getAttribute('aria-controls');
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(link).toBeHidden();
  expect(page.url()).toBe(expandedUrl);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: t.returnToList, exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 900 });
  const mobile = page.locator('.mobile-navigation');
  await mobile.locator('summary').click();
  const mobileGroup = mobile.getByRole('button', { name: t.toggleSources, exact: true });
  await expect(mobileGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(mobile.getByRole('link', { name: source.name, exact: true })).toBeHidden();
  const controlledId = await mobileGroup.getAttribute('aria-controls');
  expect(controlledId).toBeTruthy();
  expect(controlledId).not.toBe(desktopTreeId);
  expect(await mobile.locator('.source-tree').getAttribute('id')).toBe(controlledId);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.focus();
  await page.keyboard.press('Space');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: `${t.basicInformation} · ${source.id}`, exact: true })).toBeVisible();
  expect(page.url()).toBe(expandedUrl);
  await nav.getByRole('link', { name: t.sources, exact: true }).click();
  await expect(page.getByRole('heading', { name: t.sources, exact: true })).toBeVisible();
  const current = nav.getByRole('link', { name: t.sources, exact: true });
  await current.hover();
  await expect(current).toHaveCSS('background-color', 'rgb(236, 239, 253)');
});

for (const locale of ['en', 'ko'] as const) {
  test(`${locale} sidebar preserves its design and reflows an enlarged mobile tree`, async ({ page }) => {
    const t = sourceMessages[locale];
    await page.goto(`${fixtureOrigin}/?scenario=success&locale=${locale}`);
    const sidebar = page.getByRole('complementary', { name: t.appNavigation });
    const nav = sidebar.locator('.desktop-navigation');
    expect((await sidebar.boundingBox())!.width).toBe(184);
    expect((await sidebar.locator('.brand').boundingBox())!.height).toBe(52);
    expect((await sidebar.locator('.brand-mark').boundingBox())!.width).toBe(18);
    const group = nav.getByRole('button', { name: locale === 'en' ? 'Expand or collapse source names' : '소스 이름 펼치기 또는 접기', exact: true });
    expect((await group.boundingBox())!.height).toBe(32);
    await expect(nav.getByRole('group', { name: t.exploreMemory })).toBeVisible();
    const icons = nav.locator('.nav-item > svg');
    await expect(icons).toHaveCount(8);
    for (const icon of await icons.all()) expect((await icon.boundingBox())!.width).toBe(16);
    const summary = nav.locator('.summary-item');
    const memory = nav.locator('.memory-navigation');
    expect((await summary.boundingBox())!.y - ((await memory.boundingBox())!.y + (await memory.boundingBox())!.height)).toBe(8);

    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const mobile = sidebar.locator('.mobile-navigation');
    await mobile.locator('summary').click();
    const toggle = mobile.getByRole('button', { name: t.toggleSources, exact: true });
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const source = sourceSnapshot.sources[0];
    await mobile.getByRole('button', { name: `${t.expandSource}: ${source.name} · ${source.id}`, exact: true }).click();
    const information = mobile.getByRole('link', { name: `${t.basicInformation} · ${source.id}`, exact: true });
    await expect(information).toBeVisible();
    await information.focus();
    await expect(information).toBeFocused();
    for (const button of await mobile.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (const link of await mobile.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await toggle.click();
    await expect(mobile.getByRole('link', { name: sourceSnapshot.sources[0].name, exact: true })).toBeHidden();
    await toggle.click();
    await expect(mobile.getByRole('link', { name: sourceSnapshot.sources[0].name, exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

for (const locale of ['en', 'ko'] as const) {
  test(`${locale} selected Source preserves readable metadata and the Page board hierarchy`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
    const t = sourceMessages[locale];
    await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-seeded', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(sourceSnapshot.sources[0].name);
    await expect(page.getByRole('heading', { name: t.ingestionService, exact: true })).toBeVisible();
    await expect(page.getByText(locale === 'en' ? 'Connection information not provided' : '연결 정보 미제공', { exact: true })).toBeVisible();
    await page.locator('.source-metadata').getByText(t.basicInformation, { exact: true }).click();
    await expect(page.locator('.source-metadata')).toContainText(sourceSnapshot.sources[0].id);
    await expect(page.locator('.source-metadata')).toContainText(sourceSnapshot.sources[0].namespace);
    await expect(page.locator('.source-metadata dd').getByText(sourceSnapshot.sources[0].namespace, { exact: true })).toBeVisible();
    await expect(page.locator('.source-metadata code').first()).toBeVisible();
    const information = page.locator('.page-observation').first();
    await information.locator('summary').click();
    await expect(information.locator('.page-slug')).toHaveText('today');
    await expect(information.locator('.page-slug')).toBeVisible();
    await expect(information.locator('time').first()).toBeVisible();
    await information.locator('summary').click();
    const cards = await page.locator('.source-card').all();
    const boxes = await Promise.all(cards.map(card => card.boundingBox()));
    expect(boxes.every(box => box && box.y === boxes[0]!.y)).toBe(true);
    const board = page.locator('.page-board');
    await expect(board.getByRole('heading', { name: pageMessages[locale].title })).toBeVisible();
    await expect(board.getByRole('table')).toBeVisible();
    await expect(board.getByRole('button', { name: pageMessages[locale].refresh, exact: true })).toBeVisible();

    await page.setViewportSize({ width: 958, height: 1000 });
    const [sync, folder, service] = await Promise.all(cards.map(card => card.boundingBox()));
    expect(sync!.y).toBeLessThan(folder!.y);
    expect(folder!.y).toBe(service!.y);
    expect((await page.locator('.page-board').boundingBox())!.y - (service!.y + service!.height)).toBe(28);
    expect(sync!.width).toBeGreaterThan(folder!.width * 1.9);

    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const narrow = await Promise.all(cards.map(card => card.boundingBox()));
    expect(narrow[0]!.y).toBeLessThan(narrow[1]!.y);
    expect(narrow[1]!.y).toBeLessThan(narrow[2]!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    // Enlarged timestamps must remain in their own cells while the named table region scrolls.
    expect(await board.locator('tbody tr').first().locator('td').evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
    const filter = board.getByRole('button', { name: `${pageMessages[locale].filter}: ${pageMessages[locale].all}`, exact: true });
    await filter.click();
    const options = page.getByRole('listbox', { name: pageMessages[locale].filterOptions });
    const popup = (await options.boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(8);
    expect(popup.x + popup.width).toBeLessThanOrEqual(312);
    expect(popup.width).toBe(288);
    for (const option of await options.getByRole('option').all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(filter).toBeFocused();
    await expect(options).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
    await page.clock.runFor(30_000);
    await filter.click();
    await page.getByRole('option', { name: pageMessages[locale].today, exact: true }).click();
    const empty = board.locator('.page-empty').getByText(pageMessages[locale].empty, { exact: true });
    await expect(empty).toBeVisible();
    expect(await empty.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width <= 288)).toBe(true);
    await board.getByRole('button', { name: `${pageMessages[locale].filter}: ${pageMessages[locale].today}`, exact: true }).click();
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await expect(options).toHaveCount(0);
  });
}

for (const locale of ['en', 'ko'] as const) test(`${locale} unbroken Source names reflow in selected headings and breadcrumbs`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'long-names', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Source'.repeat(20));
  await expect(page.locator('.context-bar [aria-current="page"]')).toHaveText('Source'.repeat(20));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('link', { name: sourceMessages[locale].returnToList, exact: true }).click();
  await expect(page.locator('.source-disambiguation').first()).toBeVisible();
});

test('desktop coarse-pointer filter keeps touch targets, active styling and an accessible open popup', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-seeded', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
    const sidebar = page.locator('.desktop-navigation');
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.mobile-navigation')).toBeHidden();
    const sourcesToggle = sidebar.getByRole('button', { name: sourceMessages.en.toggleSources, exact: true });
    expect((await sourcesToggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const trigger = page.getByRole('button', { name: `${pageMessages.en.filter}: ${pageMessages.en.all}`, exact: true });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3);
    for (const option of await page.getByRole('listbox').getByRole('option').all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('option', { name: pageMessages.en.today, exact: true }).click();
    const active = page.getByRole('button', { name: `${pageMessages.en.filter}: ${pageMessages.en.today}`, exact: true });
    await expect(active).toHaveCSS('background-color', 'rgb(236, 239, 253)');
    await active.press('ArrowDown');
    await expect(page.getByRole('option', { name: pageMessages.en.today, exact: true })).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally { await context.close(); }
});

for (const locale of ['en', 'ko'] as const) test(`${locale} essential copy keeps scope visible and reading details available on demand`, async ({ page }) => {
  const t = sourceMessages[locale];
  const p = pageMessages[locale];
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-seeded', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  await expect(page.locator('.page-heading > p')).toHaveCount(0);
  await expect(page.locator('.source-card').last()).toHaveText(`${t.ingestionService}${t.serviceNotProvided}`);
  await expect(page.locator('.source-sync')).not.toContainText(t.syncExplanation);
  const pages = page.locator('.page-list');
  const details = pages.locator('.reading-details');
  await expect(details).not.toHaveAttribute('open');
  await expect(pages.getByText(p.meaning, { exact: true })).toBeHidden();
  await expect(pages.getByText(p.coverage, { exact: true })).toBeHidden();
  await expect(pages.getByText(p.range, { exact: true })).toBeVisible();
  await expect(pages.getByText(p.unknownDatesExcluded, { exact: true })).toHaveCount(0);
  // Fixed examples validate the new labels independently of the catalog used by locators.
  await expect(details.locator('summary')).toHaveText(locale === 'en' ? 'Dates and loaded range' : '날짜와 조회 범위');
  await expect(pages.locator('.table-footer')).toHaveText(`${p.loaded}: ${locale === 'en' ? '3 results' : '결과 3개'}UTC`);
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(pages.getByText(p.meaning, { exact: true })).toBeVisible();
  await expect(pages.getByText(p.coverage, { exact: true })).toBeVisible();
  await expect(pages.getByText(p.offsets, { exact: true })).toBeVisible();
  await expect(details.locator('time')).toHaveCount(4);
  await expect(pages.locator('tbody')).toContainText('오늘의 원본 / today');
  await page.keyboard.press('Space');
  await expect(details).not.toHaveAttribute('open');
  await expect(details.locator('summary')).toBeFocused();
  await pages.getByRole('button', { name: `${p.filter}: ${p.all}`, exact: true }).click();
  await pages.getByRole('option', { name: p.today, exact: true }).click();
  await expect(pages.locator('.table-footer')).toHaveText(locale === 'en'
    ? 'Matching: 1 result · Loaded: 3 resultsUTC' : '조건에 맞음: 결과 1개 · 불러옴: 결과 3개UTC');
  await expect(pages.getByRole('status')).toContainText(locale === 'en'
    ? 'Matching: 1 result · Loaded: 3 results' : '조건에 맞음: 결과 1개 · 불러옴: 결과 3개');
  await expect(pages.getByText(p.unknownDatesExcluded, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: t.returnToList, exact: true }).click();
  await expect(page.getByText(t.coverageUnknown, { exact: true })).toHaveText(locale === 'en'
    ? 'Available active sources only; total coverage is unknown.' : '볼 수 있는 활성 소스만 표시해요. 전체 범위는 알 수 없어요.');
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-dated', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]), added: 'today' })}`);
  await expect(pages.locator('tbody tr')).toHaveCount(1);
  await expect(pages.getByText(p.unknownDatesExcluded, { exact: true })).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-empty', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  await expect(pages.locator('tbody tr')).toHaveCount(0);
  await expect(pages.getByRole('status')).toContainText(p.empty);
  await expect(pages.getByRole('status')).not.toContainText(p.matching);
});
