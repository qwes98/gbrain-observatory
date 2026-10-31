import { expect, test } from '@playwright/test';
import { sourceReference } from '../src/contracts/sources';
import { pageMessages, sourceMessages } from '../src/i18n/messages';
import { sourceSnapshot } from './fixtures/source-data';
import AxeBuilder from '@axe-core/playwright';
import { fixtureOrigin } from './support/ui';

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
    const empty = board.getByText(pageMessages[locale].empty, { exact: true });
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
