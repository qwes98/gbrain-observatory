import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatResultCount } from '../src/i18n/messages';
import { sourceSnapshot, timestampSnapshot } from './fixtures/source-data';
import { behaviorLocale, openSourceFixture as fixture, ui as t } from './support/ui';

const [alphaSource, betaSource, gammaSource] = sourceSnapshot.sources;
const sourceName = alphaSource.name;
const oldCheckedAt = sourceSnapshot.checkedAt;

async function release(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __sourceFixture: { release: () => void } }).__sourceFixture.release();
  });
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('first query announces loading without inventing a result count', async ({ page }) => {
  await fixture(page, 'loading');
  await expect(page.locator('.state-announcement').getByText(t.loading, { exact: true })).toBeVisible();
  await expect(page.locator('.table-footer')).toHaveText(t.listPending);
  await expect(page.getByText(sourceName)).toHaveCount(0);
  const retry = page.getByRole('button', { name: t.refreshing, exact: true });
  await expect(retry).toBeDisabled();
  // aria-disabled keeps the control focusable; the loading guard must reject activation.
  await retry.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(0);
  await expect(page.locator('.table-footer')).toHaveText(t.listPending);
});

test('success renders exactly supplied rows with five semantic headers and independent times', async ({ page }) => {
  await fixture(page, 'success');
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveCount(5);
  for (const name of [t.source, t.connection, t.syncResult, t.lastSyncedAt, t.checkedAt]) {
    await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const alpha = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: sourceName, exact: true }) });
  const beta = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: betaSource.name, exact: true }) });
  const gamma = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: gammaSource.name, exact: true }) });
  await expect(alpha.getByRole('cell').nth(0)).toContainText(alphaSource.connection.folder!);
  await expect(alpha.getByRole('cell').nth(1)).toHaveText(alphaSource.sync.label);
  await expect(beta.getByRole('cell').nth(1)).toHaveText(betaSource.sync.label);
  await expect(gamma.getByRole('cell').nth(1)).toHaveText(gammaSource.sync.label);
  await expect(alpha.getByRole('cell').nth(2).locator('time')).toHaveAttribute('datetime', '2026-10-26T23:30:00.000Z');
  await expect(alpha.getByRole('cell').nth(3).locator('time')).toHaveAttribute('datetime', '2026-10-27T02:59:00.000Z');
  await expect(beta.getByRole('cell').nth(2)).toHaveText(t.notProvided);
  await expect(beta.getByRole('cell').nth(3)).toHaveText(t.notProvided);
  await expect(gamma.getByRole('cell').nth(2)).toHaveText(t.notProvided);
  await expect(gamma.getByRole('cell').nth(3).locator('time')).toHaveAttribute('datetime', '2026-10-27T02:58:00.000Z');
  await expect(page.locator('.table-footer').getByText(formatResultCount(behaviorLocale, 3), { exact: true })).toBeVisible();
  await expect(page.locator('a[href="#"], a[href="javascript:void(0)"]')).toHaveCount(0);
});

test('empty success is distinct from inability to query', async ({ page }) => {
  await fixture(page, 'empty');
  await expect(page.getByText(t.emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.table-footer').getByText(formatResultCount(behaviorLocale, 0), { exact: true })).toBeVisible();
});

test('unconfigured reason provides guidance without a nonfunctional retry', async ({ page }) => {
  await fixture(page, 'unconfigured');
  await expect(page.getByRole('heading', { name: t.issues.unconfigured.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: t.refresh, exact: true })).toHaveCount(0);
  await expect(page.locator('.table-footer')).toHaveText(t.listPending);
  const trigger = page.getByRole('button', { name: t.guide, exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(t.checkServer);
  const details = dialog.locator('details');
  await expect(details).toHaveCount(1);
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: t.close, exact: true }).click();
  await expect(trigger).toBeFocused();
});

test('failure and unconfirmed cause have different honest guidance and hide raw errors', async ({ page }) => {
  await fixture(page, 'failure');
  const failureText = await page.getByRole('main').innerText();
  await expect(page.getByRole('heading', { name: t.issues.failure.title, exact: true })).toBeVisible();
  await fixture(page, 'unknown');
  await expect(page.getByRole('heading', { name: t.issues.unknown.title, exact: true })).toBeVisible();
  expect(await page.getByRole('main').innerText()).not.toBe(failureText);
  await expect(page.getByRole('main')).not.toContainText(/RAW_FIXTURE_ERROR|private-token/);
});

for (const initial of ['failure', 'unknown'] as const) {
  test(`refresh from ${initial} without an observation stays pending until success`, async ({ page }) => {
    await fixture(page, initial);
    await page.getByRole('button', { name: t.refresh, exact: true }).click();
    await expect(page.locator('.state-announcement').getByText(t.loading, { exact: true })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('.table-footer')).toHaveText(t.listPending);
    await expect(page.getByText(t.previous, { exact: false })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(1);
    await release(page);
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('.table-footer').locator('time')).toHaveAttribute('datetime', '2026-10-27T04:00:00.000Z');
    await expect(page.locator('.state-announcement')).toContainText(formatResultCount(behaviorLocale, 3));
    await expect(page.getByRole('heading', { name: t.issues[initial].title, exact: true })).toHaveCount(0);
    await expect(page.getByText(t.previous, { exact: false })).toHaveCount(0);
  });
}

test('refresh returning unconfigured drops the previous observation and retry control', async ({ page }) => {
  await fixture(page, 'retry-unconfigured');
  await page.getByRole('button', { name: t.refresh, exact: true }).click();
  await expect(page.getByRole('table').getByText(sourceName)).toBeVisible();
  await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
  await release(page);
  await expect(page.getByRole('heading', { name: t.issues.unconfigured.title, exact: true })).toBeVisible();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.table-footer')).toHaveText(t.listPending);
  await expect(page.getByText(t.previous, { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.refresh, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.refreshing, exact: true })).toHaveCount(0);
});

for (const outcome of ['success', 'failure', 'unknown', 'reject']) {
  test(`refresh ${outcome} prevents duplicate requests and preserves existing observation`, async ({ page }) => {
    await fixture(page, `retry-${outcome}`);
    const retry = page.getByRole('button', { name: t.refresh, exact: true }).or(page.getByRole('button', { name: t.refreshing, exact: true }));
    // Both activations happen before React commits loading state.
    // This exercises the synchronous in-flight guard as well as the state guard.
    await retry.evaluate(button => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('.state-announcement').getByText(t.loading, { exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByText(sourceName)).toBeVisible();
    await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
    await expect(page.locator('.table-footer').locator(`time[datetime="${oldCheckedAt}"]`)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(1);
    await release(page);
    if (outcome === 'success') {
      await expect(page.locator('.table-footer').locator('time[datetime="2026-10-27T04:00:00.000Z"]')).toBeVisible();
      await expect(page.locator('.state-announcement')).toContainText(formatResultCount(behaviorLocale, 3));
      await expect(page.locator('.state-announcement').locator('time')).toHaveAttribute('datetime', '2026-10-27T04:00:00.000Z');
      await expect(page.getByText(t.previous, { exact: false })).toHaveCount(0);
    } else {
      const issue = outcome === 'unknown' ? t.issues.unknown : t.issues.failure;
      await expect(page.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
      await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
      await expect(page.locator('.table-footer').locator(`time[datetime="${oldCheckedAt}"]`)).toBeVisible();
      await expect(page.getByRole('table').getByText(sourceName)).toBeVisible();
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.locator('.state-announcement').getByText(t.loading, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(2);
      await expect(page.getByRole('table').getByText(sourceName)).toBeVisible();
      await expect(page.locator('.table-footer').locator(`time[datetime="${oldCheckedAt}"]`)).toBeVisible();
      await release(page);
      await expect(page.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
      await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
      await expect(page.locator('.table-footer').locator(`time[datetime="${oldCheckedAt}"]`)).toBeVisible();
      await expect(retry).toBeEnabled();
    }
    await expect(page.getByRole('main')).not.toContainText(/RAW_FIXTURE_ERROR|private-token-must-never-render/);
  });
}

for (const outcome of ['success', 'failure', 'unknown', 'reject']) {
  test(`keyboard refresh ${outcome} retains focus and suppresses repeated activation`, async ({ page }) => {
    await fixture(page, `retry-${outcome}`);
    const retry = page.getByRole('button', { name: t.refresh, exact: true }).or(page.getByRole('button', { name: t.refreshing, exact: true }));
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toBeDisabled();
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => (window as unknown as { __sourceFixture: { calls: number } }).__sourceFixture.calls)).toBe(1);
    await release(page);
    await expect(retry).toBeEnabled();
    await expect(retry).toBeFocused();
    await expect(page.getByRole('table').getByText(sourceName)).toBeVisible();
  });
}

test('refresh completion does not steal focus after the user moves to another control', async ({ page }) => {
  await fixture(page, 'retry-success');
  const retry = page.getByRole('button', { name: t.refresh, exact: true }).or(page.getByRole('button', { name: t.refreshing, exact: true }));
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Tab');
  const help = page.getByRole('button', { name: t.guide, exact: true });
  await expect(help).toBeFocused();
  await release(page);
  await expect(retry).toBeEnabled();
  await expect(help).toBeFocused();
});

test('keyboard skip reaches main and desktop controls meet the 24px target', async ({ page }) => {
  await fixture(page, 'unconfigured');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: t.skipToMain, exact: true });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: t.guide, exact: true })).toBeFocused();
  const target = await page.getByRole('button', { name: t.guide, exact: true }).boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(24);
  expect(target?.width).toBeGreaterThanOrEqual(24);
});

test('320px and 200% text keep the page reflowing while only a named table region scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await fixture(page, 'success');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await assertNoPageOverflow(page);
  const region = page.getByRole('region', { name: t.sourceList, exact: true });
  await expect(region).toHaveCount(1);
  expect(await region.getAttribute('aria-label') || await region.getAttribute('aria-labelledby')).toBeTruthy();
  await expect(region).toHaveAttribute('tabindex', '0');
  expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await region.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  // Return to the top for a stable full-page capture of fixed shell elements.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/sources-320-text200.png', fullPage: true });
});

test('touch controls preserve 44px targets at a desktop viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, hasTouch: true });
  const page = await context.newPage();
  await fixture(page, 'unconfigured');
  expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
  const trigger = page.getByRole('button', { name: t.guide, exact: true });
  const target = await trigger.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);
  await trigger.tap();
  const close = page.getByRole('dialog').getByRole('button', { name: t.close, exact: true });
  expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await close.tap();
  await context.close();
});

test('source states and expanded guidance pass automated WCAG A/AA checks', async ({ page }) => {
  for (const state of ['success', 'empty', 'loading', 'failure', 'unknown', 'unconfigured']) {
    await fixture(page, state);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  await page.getByRole('button', { name: t.guide, exact: true }).click();
  await page.getByRole('dialog').locator('summary').click();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
});

for (const timezoneId of ['UTC', 'Asia/Seoul']) {
  test(`timestamp validity and explicit offsets remain honest in ${timezoneId}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await fixture(page, 'timestamps');
    const table = page.getByRole('table');
    for (const name of timestampSnapshot.sources.filter(source => ['invalid-time', 'ambiguous-time', 'range-time'].includes(source.id)).map(source => source.name)) {
      const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
      await expect(row.getByRole('cell').nth(2)).toHaveText(t.invalidTime);
      await expect(row.getByRole('cell').nth(3)).toHaveText(t.invalidTime);
      await expect(row.locator('time')).toHaveCount(0);
    }
    const missing = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: timestampSnapshot.sources.find(source => source.id === 'missing-time')!.name, exact: true }) });
    await expect(missing.getByRole('cell').nth(2)).toHaveText(t.notProvided);
    await expect(missing.getByRole('cell').nth(3)).toHaveText(t.notProvided);
    const explicit = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: timestampSnapshot.sources.find(source => source.id === 'offset-time')!.name, exact: true }) });
    await expect(explicit.getByRole('cell').nth(2).locator('time')).toHaveAttribute('datetime', '2026-10-27T12:00:00+09:00');
    await expect(explicit.getByRole('cell').nth(2)).toHaveText('27/10/2026, 12:00 · UTC+09:00');
    await expect(explicit.getByRole('cell').nth(3).locator('time')).toHaveAttribute('datetime', '2026-10-27T04:15:00.123Z');
    await expect(explicit.getByRole('cell').nth(3)).toHaveText('27/10/2026, 13:15 · UTC+09:00');
    await context.close();
  });
}

test('desktop sidebar preserves every item within a scrollable 500px viewport at 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  await fixture(page, 'unconfigured');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const sidebar = page.getByRole('complementary', { name: t.appNavigation });
  expect(await sidebar.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await sidebar.evaluate(el => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);
  for (const name of [t.sources, t.recentInput, t.search, t.exploreMemory, t.memories, t.entities, t.relations, t.openLoops, t.brainSummary, t.comingSoon, t.myBrain]) {
    const item = name === t.myBrain
      ? sidebar.locator('.sidebar-footer')
      : name === t.exploreMemory || name === t.comingSoon
        ? sidebar.locator('.desktop-navigation').getByText(name, { exact: true })
        : sidebar.locator('.desktop-navigation .nav-item').filter({ hasText: name });
    await item.scrollIntoViewIfNeeded();
    const bounds = await item.boundingBox();
    expect(bounds, name).not.toBeNull();
    expect(bounds!.y, name).toBeGreaterThanOrEqual(0);
    // Scroll offsets round to CSS pixels while line boxes retain fractional pixels.
    expect(bounds!.y + bounds!.height, name).toBeLessThanOrEqual(501);
  }
  await sidebar.evaluate(el => { el.scrollTop = 0; });
  await expect(sidebar.getByRole('link', { name: t.sources, exact: true })).toBeInViewport();
  const brandText = await sidebar.locator('.brand strong').boundingBox();
  expect(brandText).not.toBeNull();
  expect(brandText!.y).toBeGreaterThanOrEqual(0);
  expect(brandText!.y + brandText!.height).toBeLessThanOrEqual(500);
});

for (const scenario of ['unconfigured', 'failure', 'unknown']) {
  test(`320px 200% ${scenario} keeps expanded navigation and guidance keyboard reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await fixture(page, scenario);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const menu = page.getByText(t.navigationMenu, { exact: true });
    const trigger = page.getByRole('button', { name: t.guide, exact: true });
    async function tabTo(target: typeof trigger) {
      for (let step = 0; step < 20; step += 1) {
        if (await target.evaluate(el => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      await expect(target).toBeFocused();
    }
    await tabTo(menu);
    await page.keyboard.press('Enter');
    await expect(page.locator('.mobile-navigation')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(page.locator('.mobile-navigation').getByRole('link', { name: t.sources, exact: true })).toBeFocused();
    await assertNoPageOverflow(page);
    await tabTo(trigger);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const details = dialog.locator('details');
    await tabTo(details.locator('summary'));
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await assertNoPageOverflow(page);
    await dialog.locator('li').last().scrollIntoViewIfNeeded();
    await expect(dialog.locator('li').last()).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: t.close, exact: true });
    await tabTo(close);
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await assertNoPageOverflow(page);
  });
}
