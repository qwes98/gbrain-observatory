import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pageMessages, sourceMessages, type Locale } from '../src/i18n/messages';
import { sourceReference } from '../src/contracts/sources';
import { sourceSnapshot } from './fixtures/source-data';
import { fixtureOrigin } from './support/ui';

async function openPages(page: Page, locale: Locale = 'en') {
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-seeded', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  await expect(page.locator('.page-list tbody tr')).toHaveCount(3);
}
async function inViewport(page: Page, panel: Locator) {
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(11);
  expect(box.y).toBeGreaterThanOrEqual(11);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 11);
}

test('context help keeps native keyboard dismissal, focus and data acquisition independent', async ({ page }) => {
  const t = sourceMessages.en;
  const p = pageMessages.en;
  await openPages(page);
  const sync = page.locator('.source-sync').getByRole('button', { name: t.syncHelp, exact: true });
  await sync.focus(); await page.keyboard.press('Space');
  const syncHelp = page.getByRole('dialog', { name: t.sourceSync, exact: true });
  await expect(syncHelp).toBeVisible();
  await expect(syncHelp).toContainText(t.scopeNote);
  await inViewport(page, syncHelp);
  await page.keyboard.press('Tab');
  await expect(syncHelp.getByRole('button', { name: t.close, exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sync).toBeFocused();
  await expect(syncHelp).toBeHidden();
  const range = page.getByRole('button', { name: p.rangeHelp, exact: true });
  await range.click();
  const rangeHelp = page.getByRole('dialog', { name: p.rangeTitle, exact: true });
  await expect(rangeHelp).toContainText(p.coverage);
  await expect(rangeHelp).toContainText(p.offsets);
  const date = page.getByRole('button', { name: p.dateHelp, exact: true });
  await date.focus();
  await page.keyboard.press('Enter');
  await expect(rangeHelp).toBeHidden();
  const dateHelp = page.getByRole('dialog', { name: p.added, exact: true });
  await expect(dateHelp).toContainText(p.meaning);
  await dateHelp.getByRole('button', { name: t.close, exact: true }).click();
  await expect(dateHelp).toBeHidden();
  await expect(date).toBeFocused();
  await sync.click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(syncHelp).toBeHidden();
  expect(await page.evaluate(() => ({
    pages: (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length,
    sources: (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls,
  }))).toEqual({ pages: 0, sources: 0 });
});

test('resizing open help avoids resize-observer feedback and keeps controls reachable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPages(page);
  const t = sourceMessages.en;
  const trigger = page.locator('.source-sync').getByRole('button', { name: t.syncHelp, exact: true });
  const help = page.getByRole('dialog', { name: t.sourceSync, exact: true });
  await trigger.click();
  await expect(help).toBeVisible();
  for (const width of [1440, 1024, 320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(help).toBeVisible();
    await inViewport(page, help);
  }
  await help.getByRole('button', { name: t.close, exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('pinch zoom keeps help and its close control within the visual viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openPages(page);
  const t = sourceMessages.en;
  const trigger = page.getByRole('button', { name: t.syncHelp, exact: true });
  // Keep the real component's anchor visible while isolating the viewport-width change.
  await trigger.evaluate(button => {
    document.body.append(button);
    Object.assign(button.style, { position: 'fixed', left: '40px', top: '80px' });
  });
  await trigger.click();
  const help = page.getByRole('dialog', { name: t.sourceSync, exact: true });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('data-positioned', 'true');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport!.width)).toBeCloseTo(160, 0);
    await expect(help).toBeVisible();
    await expect.poll(() => help.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return bounds.left >= viewport.offsetLeft + 11 && bounds.right <= viewport.offsetLeft + viewport.width - 11
        && bounds.top >= viewport.offsetTop + 11 && bounds.bottom <= viewport.offsetTop + viewport.height - 11;
    })).toBe(true);
    const close = help.getByRole('button', { name: t.close, exact: true });
    expect(await close.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return bounds.left >= viewport.offsetLeft && bounds.right <= viewport.offsetLeft + viewport.width
        && bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height;
    })).toBe(true);
    await close.click();
    await expect(help).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await session.detach();
  }
});

test('help closes when a scrolling ancestor clips an anchor still inside the window', async ({ page }) => {
  await openPages(page);
  const t = sourceMessages.en;
  const trigger = page.getByRole('button', { name: t.syncHelp, exact: true });
  await trigger.evaluate(button => {
    const clip = document.createElement('div');
    clip.dataset.helpClip = 'true';
    Object.assign(clip.style, { position: 'fixed', left: '100px', top: '100px', width: '100px', height: '60px', overflow: 'auto' });
    const content = document.createElement('div');
    Object.assign(content.style, { width: '300px', height: '60px' });
    document.body.append(clip);
    clip.append(content);
    content.append(button);
    Object.assign(button.style, { marginLeft: '10px', marginTop: '10px' });
  });
  await trigger.click();
  const help = page.getByRole('dialog', { name: t.sourceSync, exact: true });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('data-positioned', 'true');
  await page.locator('[data-help-clip]').evaluate(element => { element.scrollLeft = 70; });
  expect(await trigger.evaluate(button => {
    const anchor = button.getBoundingClientRect();
    const clip = button.closest('[data-help-clip]')!.getBoundingClientRect();
    return anchor.left > 12 && anchor.right < clip.left;
  })).toBe(true);
  await expect(help).toBeHidden();
});

test('Added filter help remains available without a snapshot during loading, failure and unsupported reads', async ({ page }) => {
  const p = pageMessages.en;
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-unseeded', locale: 'en', timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  const pages = page.locator('.page-list');
  for (const [index, message] of [p.loading, p.failure, p.unsupported].entries()) {
    await expect(pages.getByRole('status')).toContainText(message);
    await expect(pages.getByRole('table')).toHaveCount(0);
    await expect(pages.locator('.page-filter').getByRole('button', { name: `${p.filter}: ${p.all}`, exact: true })).toBeVisible();
    const callsBefore = await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length);
    const trigger = pages.getByRole('button', { name: p.dateHelp, exact: true });
    await trigger.click();
    const help = page.getByRole('dialog', { name: p.added, exact: true });
    await expect(help).toContainText(p.meaning);
    await expect(help).toContainText(p.coverage);
    await expect(help).toContainText(p.offsets);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __pageFixture: { calls: unknown[] } }).__pageFixture.calls.length)).toBe(callsBefore);
    if (index === 0) {
      await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('failure'));
    } else if (index === 1) {
      await pages.getByRole('button', { name: p.refresh, exact: true }).click();
      await expect(pages).toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('unknown'));
    }
  }
});


for (const locale of ['en', 'ko'] as const) test(`${locale} open date help survives the first Page response and unavailable data`, async ({ page }) => {
  const p = pageMessages[locale];
  const t = sourceMessages[locale];
  await page.goto(`${fixtureOrigin}/?${new URLSearchParams({ scenario: 'pages-unseeded', locale, timeZone: 'UTC', source: sourceReference(sourceSnapshot.sources[0]) })}`);
  const pages = page.locator('.page-list');
  await expect(pages).toHaveAttribute('aria-busy', 'true');
  const trigger = pages.getByRole('button', { name: p.dateHelp, exact: true });
  await trigger.click();
  const help = page.getByRole('dialog', { name: p.added, exact: true });
  const close = help.getByRole('button', { name: t.close, exact: true });
  await close.focus();
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(pages.locator('tbody tr')).toHaveCount(4);
  await expect(help).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await pages.getByRole('button', { name: p.refresh, exact: true }).click();
  await trigger.click();
  await close.focus();
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('unavailable'));
  await expect(pages.locator('tbody tr')).toHaveCount(0);
  await expect(help).toBeVisible();
  await expect(close).toBeFocused();
  await close.click();
  await expect(trigger).toBeFocused();
});

for (const opened of [true, false]) test(`revoked snapshot returns focus from ${opened ? 'open help' : 'closed help trigger'} to main content`, async ({ page }) => {
  await openPages(page);
  const p = pageMessages.en;
  await page.locator('.page-list').getByRole('button', { name: p.refresh, exact: true }).click();
  const trigger = page.getByRole('button', { name: p.rangeHelp, exact: true });
  const help = page.getByRole('dialog', { name: p.rangeTitle, exact: true });
  if (opened) {
    await trigger.click();
    await help.getByRole('button', { name: sourceMessages.en.close, exact: true }).focus();
  } else await trigger.focus();
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('unavailable'));
  await expect(page.locator('.page-list tbody tr')).toHaveCount(0);
  await expect(help).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
});

test('open range help follows its anchor when Page data changes the layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2000 });
  await openPages(page);
  const p = pageMessages.en;
  const trigger = page.getByRole('button', { name: p.rangeHelp, exact: true });
  await trigger.click();
  const help = page.getByRole('dialog', { name: p.rangeTitle, exact: true });
  await page.getByRole('button', { name: p.more, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.page-list')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as unknown as { __pageFixture: { release: (kind: string) => void } }).__pageFixture.release('success'));
  await expect(page.locator('.page-list tbody tr')).toHaveCount(4);
  await expect(help).toBeVisible();
  await expect.poll(async () => {
    const anchor = (await trigger.boundingBox())!;
    const box = (await help.boundingBox())!;
    return Math.abs(box.y - (anchor.y + anchor.height + 8));
  }).toBeLessThan(2);
});

test('keyboard Source navigation closes help whose table becomes hidden', async ({ page }) => {
  const t = sourceMessages.en;
  await page.goto(`${fixtureOrigin}/?scenario=success&locale=en&timeZone=UTC`);
  const trigger = page.getByRole('button', { name: t.syncHelp, exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.table-board [popover]:popover-open')).toHaveCount(1);
  await page.locator('.table-board tbody a').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.source-detail')).toBeVisible();
  await expect(page.locator('.table-board [popover]:popover-open')).toHaveCount(0);
  await page.getByRole('link', { name: t.returnToList, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeVisible();
  await expect(page.locator('.table-board [popover]:popover-open')).toHaveCount(0);
});

test('context help stays outside clipped tables and closes when its anchor leaves view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${fixtureOrigin}/?scenario=success&locale=en&timeZone=UTC`);
  const t = sourceMessages.en;
  const sync = page.getByRole('button', { name: t.syncHelp, exact: true });
  await sync.click();
  const help = page.getByRole('dialog', { name: t.sourceSync, exact: true });
  await expect(help).toBeVisible();
  await inViewport(page, help);
  expect(await help.evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + 20, el.getBoundingClientRect().y + 20)?.closest('[popover]') === el)).toBe(true);
  await page.locator('.table-board .table-scroll').evaluate(el => { el.scrollLeft = 0; });
  await expect(help).toBeHidden();
});

for (const locale of ['en', 'ko'] as const) test(`${locale} help stays usable at 320px and enlarged text`, async ({ page }) => {
  const t = sourceMessages[locale];
  const p = pageMessages[locale];
  await page.setViewportSize({ width: 320, height: 900 });
  await openPages(page, locale);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const range = page.getByRole('button', { name: p.rangeHelp, exact: true });
  await expect(range).toHaveAccessibleName(locale === 'en' ? 'Loaded range help' : '조회 범위 도움말');
  const target = (await range.boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await range.click();
  const help = page.getByRole('dialog', { name: p.rangeTitle, exact: true });
  await expect(help).toBeVisible();
  await inViewport(page, help);
  expect(await help.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await help.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(help).toBeVisible();
  await expect(help.getByRole('button', { name: t.close, exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(range).toBeFocused();
  await range.click();
  const close = help.getByRole('button', { name: t.close, exact: true });
  await close.click();
  await expect(range).toBeFocused();
  await expect(help).toBeHidden();
});
