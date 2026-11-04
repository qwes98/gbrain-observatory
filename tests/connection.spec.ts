import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localeCookie, sourceMessages, pageMessages, readerMessages, factMessages, type Locale } from '../src/i18n/messages';
import { sourceReference } from '../src/contracts/sources';
import { timeZoneCookie } from '../src/i18n/time-zone';

const origin = 'http://127.0.0.1:4179';
const messages = sourceMessages.en.connectionCheck;
let directory: string;
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
async function clearCalls() { await writeFile(join(directory, 'calls'), ''); }
async function scenario(name: string) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }

test.describe('configured connection boundary', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => { directory = await readFile('.next/connection-test-path', 'utf8'); });

  test('manual check ignores hostile parameters, preserves scope/time, and preserves the actual initial list', async ({ page }) => {
    await scenario('slow');
    await page.goto(`${origin}/?command=search&cwd=/private&executable=/bin/sh&scenario=empty`);
    expect(await calls()).toHaveLength(3);
    await clearCalls();
    await page.locator('.connection-panel form').evaluate(form => {
      for (const [name, value] of Object.entries({ executable: '/bin/sh', cwd: '/private', command: 'search', env: 'SECRET=attack' })) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
      }
    });
    const button = page.getByRole('button', { name: messages.check, exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: messages.pending, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: messages.pending, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.connection-panel form')).toHaveAttribute('aria-busy', 'true');
    expect(await page.locator('.connection-panel [role="status"]').evaluate(element => element.closest('[aria-busy="true"]') === null)).toBe(true);
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    expect(await calls()).toHaveLength(3);
    await expect(button).toBeFocused();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('.table-footer')).toContainText('1 result');
    await expect(page.getByText(messages.scope, { exact: true })).toBeHidden();
    await page.locator('.connection-panel').getByRole('button', { name: messages.details, exact: true }).click();
    await expect(page.getByText(messages.scope, { exact: true })).toBeVisible();
    await page.locator('.connection-panel').getByRole('button', { name: messages.details, exact: true }).click();
    await expect(page.getByText('0.60.323.0', { exact: true })).toBeVisible();
    await expect(page.locator('.connection-panel')).not.toContainText(/private|secret-token/);
    const observation = await page.locator('.connection-panel time').getAttribute('datetime');
    expect(Number.isFinite(Date.parse(observation!))).toBe(true);
    await button.click();
    await expect(page.getByText(messages.previous, { exact: true })).toBeVisible();
    await expect(page.locator('.connection-panel time')).toHaveAttribute('datetime', observation!);
    const language = page.getByRole('combobox', { name: sourceMessages.en.language, exact: true });
    await language.focus();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    expect(await calls()).toHaveLength(6);
    await expect(language).toBeFocused();
    expect((await calls()).map(call => call.args)).toEqual([['--version'], ['--tools-json'], ['call', 'sources_list', '{}'], ['--version'], ['--tools-json'], ['call', 'sources_list', '{}']]);
  });

  test('empty probe succeeds; failure and manual retry retain honest classification', async ({ page }) => {
    await scenario('empty'); await page.goto(origin); await clearCalls();
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    await expect(page.locator('.connection-panel dd').last()).toHaveText('0');
    await expect(page.getByText(sourceMessages.en.emptyTitle, { exact: true })).toBeVisible();
    await scenario('nonzero');
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByText(messages.causes.failed.reason, { exact: true })).toBeVisible();
    await expect(page.getByText(messages.success, { exact: true })).toHaveCount(0);
    await expect(page.locator('.connection-panel')).not.toContainText('secret-token');
    expect(await calls()).toHaveLength(1);
    await scenario('slow');
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByRole('button', { name: messages.pending, exact: true })).toBeDisabled();
    await expect(page.getByText(messages.causes.failed.reason, { exact: true })).toHaveCount(0);
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
  });

  test('two real Next clients refuse a concurrent check locally and permit manual retry', async ({ page, browser }) => {
    await scenario('concurrent');
    const context = await browser.newContext();
    await context.addCookies([{ name: localeCookie, value: 'ko', url: origin }]);
    const other = await context.newPage();
    try {
      await Promise.all([page.goto(origin), other.goto(origin)]);
      await clearCalls();
      await page.getByRole('button', { name: messages.check, exact: true }).click();
      await expect.poll(async () => (await calls()).length).toBe(3);
      const ko = sourceMessages.ko.connectionCheck;
      await other.getByRole('button', { name: ko.check, exact: true }).click();
      await expect(other.getByText(ko.causes.busy.reason, { exact: true })).toBeVisible();
      await expect(other.getByText(ko.causes.busy.action, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: messages.pending, exact: true })).toBeDisabled();
      expect(await calls()).toHaveLength(3);
      await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
      await other.getByRole('button', { name: ko.check, exact: true }).click();
      await expect(other.getByText(ko.success, { exact: true })).toBeVisible();
      expect(await calls()).toHaveLength(6);
    } finally { await context.close(); }
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`keyboard ${locale} action failure and retry keep panel focus`, async ({ page }) => {
    await scenario('success');
    await page.context().addCookies([{ name: localeCookie, value: locale, url: origin }]);
    await page.goto(origin); await clearCalls();
    const t = sourceMessages[locale];
    let abortNext = true;
    await page.route('**/*', route => {
      if (abortNext && route.request().method() === 'POST' && route.request().headers()['next-action']) {
        abortNext = false; return route.abort('failed');
      }
      return route.continue();
    });
    const button = page.getByRole('button', { name: t.connectionCheck.check, exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText(t.connectionCheck.causes.failed.reason, { exact: true })).toBeVisible();
    if (locale === 'ko') await expect(page.getByText('연결 확인에 실패했어요. 원인은 아직 확인되지 않았어요.', { exact: true })).toBeVisible();
    await expect(button).toBeFocused();
    await expect(page.getByRole('heading', { name: t.sources, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: t.language, exact: true })).toBeEnabled();
    expect(await calls()).toHaveLength(0);
    await page.keyboard.press('Enter');
    await expect(page.getByText(t.connectionCheck.success, { exact: true })).toBeVisible();
    await expect(button).toBeFocused();
    expect(await calls()).toHaveLength(3);
  });

  test('action failure and retried completion do not reclaim focus moved outside the panel', async ({ page }) => {
    await scenario('slow'); await page.goto(origin); await clearCalls();
    let intercepted!: () => void;
    const requestStarted = new Promise<void>(resolve => { intercepted = resolve; });
    let release!: () => void;
    const requestReleased = new Promise<void>(resolve => { release = resolve; });
    let abortNext = true;
    await page.route('**/*', async route => {
      if (abortNext && route.request().method() === 'POST' && route.request().headers()['next-action']) {
        abortNext = false; intercepted(); await requestReleased; return route.abort('failed');
      }
      return route.continue();
    });
    const button = page.getByRole('button', { name: messages.check, exact: true });
    const language = page.getByRole('combobox', { name: sourceMessages.en.language, exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await requestStarted;
    await language.focus(); release();
    await expect(page.getByText(messages.causes.failed.reason, { exact: true })).toBeVisible();
    await expect(language).toBeFocused();
    expect(await calls()).toHaveLength(0);
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: messages.pending, exact: true })).toBeFocused();
    await language.focus();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    await expect(language).toBeFocused();
    expect(await calls()).toHaveLength(3);
  });

  test('a denied enhanced connection action still follows the Proxy rejection redirect', async ({ page }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    await page.context().addCookies([{ name: 'observatory-test-access', value: 'other', url: origin }]);
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByRole('heading', { name: sourceMessages.en.access.denied.title, exact: true })).toBeVisible();
    expect(await calls()).toHaveLength(0);
  });

  test('denied identity and Origin reject the actual connection action before spawning', async ({ page, request }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    // Use the actual rendered action ID, not a fabricated server-action header.
    const form = page.locator('.connection-panel form');
    const action = await form.locator('input[name^="$ACTION_"]').first().getAttribute('name');
    expect(action).toBeTruthy();
    for (const mode of ['other', 'missing', 'origin', 'host', 'owner']) {
      const response = await request.post(origin, { headers: { 'x-observatory-test-access': mode, ...(mode === 'owner' ? {} : { origin }) }, multipart: { [action!]: '', executable: '/bin/sh', command: 'search' } });
      expect(response.status()).toBe(403);
      expect(response.headers()['set-cookie']).toBeUndefined();
      expect(await response.text()).not.toMatch(/secret-token|connection-private/);
    }
    expect(await calls()).toEqual([]);
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`native ${locale} check, preferences and narrow enlarged accessibility`, async ({ browser }) => {
    await scenario('success');
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    await context.addCookies([{ name: localeCookie, value: locale, url: origin }]);
    const page = await context.newPage(); await page.goto(origin); await clearCalls();
    const t = sourceMessages[locale];
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const sourceDetails = page.locator('.table-board .context-help').filter({ hasText: t.scopeNote });
    await expect(page.getByText(t.scopeNote, { exact: true }).filter({ visible: true })).toHaveCount(0);
    await page.getByRole('button', { name: t.syncHelp, exact: true }).click();
    await expect(sourceDetails.getByText(t.scopeNote, { exact: true })).toBeVisible();
    const listHelpBox = (await sourceDetails.boundingBox())!;
    expect(listHelpBox.x).toBeGreaterThanOrEqual(11);
    expect(listHelpBox.x + listHelpBox.width).toBeLessThanOrEqual(309);
    expect(listHelpBox.y).toBeGreaterThanOrEqual(11);
    expect(listHelpBox.y + listHelpBox.height).toBeLessThanOrEqual(889);
    await page.screenshot({ path: `test-results/help-${locale}-list-native-320-enlarged.png` });
    await page.getByRole('button', { name: t.syncHelp, exact: true }).click();
    const sourceLink = page.locator('.desktop-navigation .source-tree a').first();
    const sourceHref = await sourceLink.getAttribute('href');
    await page.goto(new URL(sourceHref!, origin).href);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.getByRole('button', { name: t.syncHelp, exact: true }).click();
    await expect(page.locator('.source-sync .context-help').getByText(t.scopeNote, { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/help-${locale}-detail-native-320-enlarged.png` });
    await page.goto(origin);
    // Independent examples detect a shared dictionary fallback.
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'GBrain connection' : 'GBrain 연결', exact: true })).toBeVisible();
    await page.getByRole('button', { name: t.connectionCheck.check, exact: true }).click();
    await expect(page.getByText(t.connectionCheck.success, { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('combobox', { name: t.language, exact: true })).toHaveValue(locale);
    await page.getByRole('combobox', { name: t.timeZone, exact: true }).selectOption('Asia/Seoul');
    await page.getByRole('button', { name: t.applyTimeZone, exact: true }).click();
    await expect(page.getByRole('combobox', { name: t.language, exact: true })).toHaveValue(locale);
    await page.getByRole('button', { name: t.connectionCheck.check, exact: true }).click();
    await expect(page.locator('.connection-panel time')).toContainText('UTC+09:00');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/connection-${locale}-320-enlarged-native.png`, fullPage: true });
    await page.getByRole('button', { name: t.connectionCheck.details, exact: true }).click();
    await expect(page.getByRole('dialog', { name: t.connectionCheck.title, exact: true })).toContainText(t.connectionCheck.limitation);
    await page.screenshot({ path: `test-results/help-${locale}-connection-native-320-enlarged.png` });
    await page.keyboard.press('Escape');
    // Simulate an engine without CSS anchoring, keeping native popover and JS disabled.
    const removed = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const rule = sheet.cssRules[index];
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes('position-area')) { sheet.deleteRule(index); count++; }
      }
      return count;
    });
    expect(removed).toBeGreaterThan(0);
    const trigger = page.getByRole('button', { name: t.connectionCheck.details, exact: true });
    await trigger.click();
    const fallback = page.getByRole('dialog', { name: t.connectionCheck.title, exact: true });
    const fallbackBox = (await fallback.boundingBox())!;
    expect(Math.abs(fallbackBox.x + fallbackBox.width / 2 - 160)).toBeLessThan(2);
    expect(fallbackBox.x).toBeGreaterThanOrEqual(11);
    expect(fallbackBox.y).toBeGreaterThanOrEqual(11);
    expect(fallbackBox.x + fallbackBox.width).toBeLessThanOrEqual(309);
    expect(fallbackBox.y + fallbackBox.height).toBeLessThanOrEqual(889);
    await fallback.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const close = fallback.getByRole('button', { name: t.close, exact: true });
    await expect(close).toBeInViewport();
    await page.screenshot({ path: `test-results/help-${locale}-unanchored-native-320-enlarged.png` });
    await close.click();
    await expect(fallback).toBeHidden();
    await expect(trigger).toBeFocused();
    await context.close();
  });

  test('real initial list preserves duplicate names, nullable fields and inert URLs with exact table/sidebar selection', async ({ page, request }) => {
    await scenario('fields');
    const response = await request.get(origin);
    expect(response.headers()['cache-control']).toContain('private, no-store');
    expect(await calls()).toHaveLength(3);
    await page.goto(origin);
    const t = sourceMessages.en;
    const table = page.getByRole('table');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('.table-board .context-value > span')).toContainText('Active sources · total unknown');
    await expect(page.locator('.table-board .context-value > span')).toBeVisible();
    await page.getByRole('button', { name: t.sourceScopeHelp, exact: true }).click();
    await expect(page.getByText(t.coverageUnknown, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(table.getByRole('row').filter({ hasText: 'folder-only' })).toHaveCount(1);
    const sameName = table.getByRole('link', { name: '동일 이름 / duplicate', exact: true });
    await expect(sameName).toHaveCount(2);
    await sameName.nth(1).click();
    await expect(page.locator('.page-list')).toHaveAttribute('aria-busy', 'false');
    await page.locator('.source-metadata summary').click();
    await expect(page.locator('.source-metadata dd').filter({ hasText: 'git-only' })).toBeVisible();
    await expect(page.locator('.source-fields')).toContainText('git-only');
    const pageCount = page.locator('.source-fields dt').filter({ hasText: t.pageCount }).locator('..').locator('dd');
    await expect(pageCount).toHaveText('3');
    await expect(pageCount).toBeVisible();
    await expect(page.locator('.source-fields')).toContainText('javascript:alert(1)');
    await expect(page.locator('.source-fields a')).toHaveCount(0);
    await expect(page.locator('.source-fields')).toContainText(t.syncUnknown);
    await expect(page.locator('.source-fields')).toContainText(t.notProvided);
    await page.locator('.desktop-navigation .source-tree a').first().click();
    await expect(page.locator('.source-fields')).toContainText('folder-only');
    await expect(page.locator('.source-fields code').first()).toHaveText('2026-10-27T03:00:00+09:00');
    await expect(page.locator('.source-fields code').first()).toBeVisible();
    await expect(page.locator('.source-fields')).toContainText('/원본/<script>/긴 경로');
    await expect(page.locator('.page-list')).toHaveAttribute('aria-busy', 'false');
    await page.reload();
    await expect(page.locator('.source-fields')).toContainText('folder-only');
    await clearCalls();
    const refresh = await request.post(`${origin}/api/sources?command=search&cwd=/private`, { headers: { origin }, data: { executable: '/bin/sh', command: 'search', env: 'SECRET=attack' } });
    expect(refresh.status()).toBe(200);
    expect(refresh.headers()['cache-control']).toContain('private, no-store');
    expect((await refresh.json()).snapshot.sources).toHaveLength(3);
    expect((await calls()).map(call => call.args)).toEqual([['--version'], ['--tools-json'], ['call', 'sources_list', '{}']]);
  });

  test('real source refresh is single-flight, retains previous observation on failures and purges actual Proxy denial', async ({ page, request }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    const t = sourceMessages.en;
    await page.locator('.table-board table').getByRole('link').first().click();
    await expect(page.locator('.page-list')).toHaveAttribute('aria-busy', 'false');
    const original = await page.locator('.source-fields time').last().getAttribute('datetime');
    await scenario('slow');
    const refresh = page.getByRole('button', { name: t.refresh, exact: true }).or(page.getByRole('button', { name: t.refreshing, exact: true }));
    await refresh.evaluate(button => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
    await expect(refresh).toBeEnabled();
    expect(await calls()).toHaveLength(3);
    await scenario('partial');
    await refresh.click();
    await expect(page.getByText(t.unsupported, { exact: true })).toBeVisible();
    await expect(page.getByText(t.previous, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'connection-private-source-name', exact: true })).toBeVisible();
    await expect(page.locator('.source-fields')).toContainText('/connection-private/path');
    expect(await page.locator('.source-fields time').last().getAttribute('datetime')).not.toBe(original);
    await scenario('nonzero'); await refresh.click();
    await expect(page.getByRole('heading', { name: t.issues.failure.title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'connection-private-source-name', exact: true })).toBeVisible();
    await expect(page.locator('.source-fields')).toContainText('/connection-private/path');
    await clearCalls();
    for (const mode of ['other', 'missing', 'origin', 'host']) {
      const response = await request.post(`${origin}/api/sources?command=search`, { headers: { 'x-observatory-test-access': mode, origin }, data: { executable: '/bin/sh' } });
      expect(response.status()).toBe(403);
      expect(response.headers()['cache-control']).toContain('private, no-store');
      expect(await response.text()).not.toMatch(/connection-private|secret-token/);
    }
    expect(await calls()).toHaveLength(0);
    await page.context().addCookies([{ name: 'observatory-test-access', value: 'other', url: origin }]);
    await refresh.click();
    await expect(page.getByRole('heading', { name: t.issues.denied.title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: t.selectionUnavailable, exact: true })).toBeVisible();
    await expect(page.locator('.source-fields')).toHaveCount(0);
    await expect(page.locator('.source-tree a')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(/connection-private|secret-token/);
    expect(await calls()).toHaveLength(0);
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`real ${locale} detail remains readable at 320px and enlarged text`, async ({ page }) => {
    await scenario('fields');
    await page.context().addCookies([{ name: localeCookie, value: locale, url: origin }]);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(origin);
    await page.getByRole('table').getByRole('link').first().click();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const t = sourceMessages[locale];
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'Basic information' : '기본 정보', exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('.source-fields')).toContainText(t.syncUnknown);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/source-detail-${locale}-320-text200.png`, fullPage: true });
    await page.getByRole('link', { name: t.returnToList, exact: true }).click();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);
  });

  test('an authoritative server render after preferences removes sources omitted by the new list', async ({ page }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
    await scenario('empty');
    const t = sourceMessages.en;
    await page.getByRole('combobox', { name: t.language, exact: true }).selectOption('ko');
    await page.getByRole('button', { name: t.applyLanguage, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('.source-tree a')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: sourceMessages.ko.emptyTitle, exact: true })).toBeVisible();
    expect(await calls()).toHaveLength(3);
  });

  test('preference overlap preserves selected branches, previous observation and the surviving refresh', async ({ page }) => {
    await scenario('success'); await page.goto(origin);
    const branch = page.locator('.desktop-navigation .source-tree');
    await branch.getByRole('button').first().click();
    await branch.getByRole('link').first().click();
    await expect(page.locator('.page-list')).toHaveAttribute('aria-busy', 'false');
    const selection = new URL(page.url()).searchParams.get('source');
    for (const setting of ['language', 'timeZone']) {
      const t = sourceMessages[setting === 'language' ? 'en' : 'ko'];
      await scenario('concurrent');
      const refresh = page.getByRole('button', { name: t.refresh, exact: true }).or(page.getByRole('button', { name: t.refreshing, exact: true }));
      const observed = await page.locator('.source-fields code').last().textContent();
      await refresh.click();
      await expect.poll(async () => (await calls()).length).toBe(3);
      await page.getByRole('combobox', { name: setting === 'language' ? t.language : t.timeZone, exact: true }).selectOption(setting === 'language' ? 'ko' : 'UTC');
      await page.getByRole('button', { name: setting === 'language' ? t.applyLanguage : t.applyTimeZone, exact: true }).click();
      const current = sourceMessages.ko;
      await expect(page.getByRole('button', { name: current.refreshing, exact: true })).toBeDisabled();
      await expect(page.getByText(current.previous, { exact: false })).toBeVisible();
      await expect(page.locator('.source-fields code').last()).toHaveText(observed!);
      expect(new URL(page.url()).searchParams.get('source')).toBe(selection);
      expect(new URL(page.url()).searchParams.getAll('expanded')).toContain(selection);
      await expect(page.getByRole('button', { name: current.refresh, exact: true })).toBeEnabled();
      await expect(page.locator('.source-fields code').last()).not.toHaveText(observed!);
      expect(await calls()).toHaveLength(3);
    }
  });

  test('native completed sources, preferences and refresh retain exact navigation with one acquisition', async ({ browser, page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await scenario('concurrent');
    await page.goto(origin);
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
    expect(await calls()).toHaveLength(3);
    expect(errors).toEqual([]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const native = await context.newPage();
      await scenario('success'); await native.goto(origin);
      await expect(native.getByRole('table').locator('tbody tr')).toHaveCount(1);
      for (const id of ['main', 'ui-language', 'time-zone', 'source-list-title']) await expect(native.locator(`[id="${id}"]`)).toHaveCount(1);
      await expect(native.getByRole('combobox', { name: sourceMessages.en.language, exact: true })).toBeVisible();
      await expect(native.getByRole('combobox', { name: sourceMessages.en.timeZone, exact: true })).toBeVisible();
      await native.getByRole('link', { name: sourceMessages.en.skipToMain, exact: true }).focus();
      await native.keyboard.press('Enter');
      await expect(native.locator('#main')).toBeFocused();
      const link = native.getByRole('table').getByRole('link').first();
      const sourceUrl = new URL((await link.getAttribute('href'))!, origin);
      const selected = sourceUrl.searchParams.get('source')!;
      sourceUrl.searchParams.append('expanded', selected);
      await native.goto(sourceUrl.toString());
      await expect(native.getByRole('heading', { name: 'connection-private-source-name', exact: true })).toBeVisible();
      await clearCalls();
      await native.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
      await expect(native.getByRole('heading', { name: 'connection-private-source-name', exact: true })).toBeVisible();
      expect(new URL(native.url()).searchParams.get('source')).toBe(selected);
      expect(new URL(native.url()).searchParams.getAll('expanded')).toContain(selected);
      expect(await calls()).toHaveLength(7);
    } finally { await context.close(); }
  });

  test('stalled source transport reaches a finite deadline and permits manual recovery', async ({ page }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    await page.clock.install();
    let started!: () => void;
    const intercepted = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/sources', route => { started(); void route; });
    await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
    await intercepted;
    await page.clock.fastForward(60_001);
    await expect(page.getByRole('heading', { name: sourceMessages.en.issues.failure.title, exact: true })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: sourceMessages.en.refresh, exact: true })).toBeEnabled();
    await page.unroute('**/api/sources');
    await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
    await expect(page.getByRole('button', { name: sourceMessages.en.refresh, exact: true })).toBeEnabled();
    expect(await calls()).toHaveLength(3);
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`${locale} invalid-then-valid timezone correction clears stale errors and preserves source navigation`, async ({ page, context }) => {
    await scenario('success');
    await context.addCookies([{ name: localeCookie, value: locale, url: origin }, { name: timeZoneCookie, value: 'Asia/Seoul', url: origin }]);
    await page.goto(origin);
    await page.locator('.desktop-navigation .source-tree').getByRole('button').first().click();
    await page.getByRole('table').getByRole('link').first().click();
    const selected = new URL(page.url()).searchParams.get('source');
    const t = sourceMessages[locale];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const control = page.getByRole('combobox', { name: t.timeZone, exact: true });
      await control.evaluate(element => {
        const option = document.createElement('option'); option.value = '+09:00'; option.textContent = '+09:00'; element.append(option);
      });
      await control.selectOption('+09:00');
      await page.getByRole('button', { name: t.applyTimeZone, exact: true }).click();
      await expect(page.locator('.time-zone-settings').getByRole('alert')).toHaveText(t.invalidTimeZone);
      await expect(control).toHaveAttribute('aria-invalid', 'true');
      await expect.poll(() => new URL(page.url()).searchParams.get('timeZoneError')).toBe('invalid');
      if (attempt === 0) {
        await page.reload();
        await expect(page.locator('.time-zone-settings').getByRole('alert')).toHaveText(t.invalidTimeZone);
      }
      await control.selectOption('America/Los_Angeles');
      await page.getByRole('button', { name: t.applyTimeZone, exact: true }).click();
      await expect(page.locator('.time-zone-settings').getByRole('alert')).toHaveCount(0);
      await expect(control).not.toHaveAttribute('aria-invalid');
      await expect(control).not.toHaveAttribute('aria-describedby');
      await expect(control).toHaveValue('America/Los_Angeles');
      await expect(page.locator('.effective-time-zone')).toContainText('America/Los_Angeles');
      await expect.poll(() => new URL(page.url()).searchParams.get('timeZoneError')).toBeNull();
      expect(new URL(page.url()).searchParams.get('source')).toBe(selected);
      expect(new URL(page.url()).searchParams.getAll('expanded')).toContain(selected);
      await expect(page.getByRole('heading', { name: 'connection-private-source-name', exact: true })).toBeVisible();
      expect(decodeURIComponent((await context.cookies(origin)).find(cookie => cookie.name === timeZoneCookie)!.value)).toBe('America/Los_Angeles');
    }
  });

  test('configured panel passes automated accessibility checks', async ({ page }) => {
    await scenario('success'); await page.goto(origin); await clearCalls();
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Page API authenticates before reads and validates exact copied source requests', async ({ request }) => {
    await scenario('pages-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    await clearCalls();
    for (const mode of ['other', 'missing', 'origin', 'host']) {
      const denied = await request.post(`${origin}/api/pages`, { headers: { origin, 'x-observatory-test-access': mode }, data: { source, offset: 0 } });
      expect(denied.status()).toBe(403);
      expect(denied.headers()['cache-control']).toContain('private, no-store');
    }
    expect(await calls()).toHaveLength(0);
    for (const data of [{ source, offset: 100 }, { source, offset: -1 }, { source, offset: 0, command: 'search' }, { source: '/bin/sh', offset: 0 }]) {
      expect((await request.post(`${origin}/api/pages`, { headers: { origin }, data })).status()).toBe(400);
    }
    expect(await calls()).toHaveLength(0);
    const response = await request.post(`${origin}/api/pages?command=search`, { headers: { origin }, data: { source, offset: 0 } });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('private, no-store');
    const result = await response.json();
    expect(result.snapshot.pages).toHaveLength(10);
    expect(result.snapshot.pages[0].createdAt).toBe('2026-10-31T00:30:00Z');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PAGE_BODY|PRIVATE_FRONTMATTER|secret-token/);
    expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(1);
    await scenario('pages-omitted');
    const omitted = await request.post(`${origin}/api/pages`, { headers: { origin }, data: { source, offset: 0 } });
    expect((await omitted.json()).kind).toBe('unavailable');
    expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
  });

  test('selected Page reads append in creation order and retain rows after additional-read failure', async ({ page }) => {
    await scenario('pages-success');
    await page.goto(origin);
    expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
    await page.locator('.table-board table').getByRole('link').first().click();
    const pages = page.locator('.page-list');
    const t = pageMessages.en;
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
    await expect(pages.getByRole('row').filter({ hasText: '원본 Page 0' }).getByRole('cell').nth(1).locator('time')).toHaveAttribute('datetime', '2026-10-31T00:30:00Z');
    await expect(pages.getByRole('link')).toHaveCount(10);
    await expect(pages.getByRole('link', { name: '원본 Page 0', exact: true })).toHaveAttribute('href', /page=page-000/);
    await scenario('pages-more-failure');
    await pages.getByRole('button', { name: t.more, exact: true }).click();
    await expect(pages).toContainText(t.failure);
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
    await scenario('pages-success');
    const more = pages.getByRole('button', { name: t.more, exact: true });
    await more.focus(); await page.keyboard.press('Enter');
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(13);
    await expect(pages).toContainText(t.end);
    await expect(pages).toContainText(t.offsets);
    await expect(pages).not.toContainText(/PRIVATE_PAGE_BODY|PRIVATE_FRONTMATTER|secret-token/);
  });

  test('History Source selection without a server Page seed completes a delayed initial read', async ({ page }) => {
    await scenario('pages-success');
    await page.goto(origin);
    await clearCalls();
    let started!: () => void;
    const intercepted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/pages', async route => { started(); await released; await route.continue(); });
    await page.locator('.table-board table').getByRole('link').first().click();
    await intercepted;
    const pages = page.locator('.page-list');
    await expect(pages).toContainText(pageMessages.en.loading);
    await expect(pages.getByRole('table')).toHaveCount(0);
    expect(await calls()).toHaveLength(0);
    release();
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(1);
  });

  test('a stalled Page transport expires after 60 seconds and allows manual recovery', async ({ page }) => {
    await scenario('pages-success');
    await page.goto(origin);
    await page.locator('.table-board table').getByRole('link').first().click();
    const pages = page.locator('.page-list');
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    await clearCalls();
    await page.clock.install();
    let started!: () => void;
    const intercepted = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/pages', route => { started(); void route; });
    await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
    await intercepted;
    await page.clock.fastForward(60_001);
    await expect(pages).toContainText(pageMessages.en.failure);
    await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
    await expect(pages.getByRole('button', { name: pageMessages.en.refresh, exact: true })).toHaveAttribute('aria-disabled', 'false');
    expect(await calls()).toHaveLength(0);
    await page.unroute('**/api/pages');
    await pages.getByRole('button', { name: pageMessages.en.refresh, exact: true }).click();
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    await expect(pages).not.toContainText(pageMessages.en.failure);
    expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(1);
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`native ${locale} Page filters survive preference submissions and narrow enlarged layout`, async ({ browser }) => {
    await scenario('pages-success');
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    try {
      await context.addCookies([{ name: localeCookie, value: locale, url: origin }, { name: timeZoneCookie, value: 'UTC', url: origin }]);
      const native = await context.newPage(); await native.goto(origin);
      await native.locator('.table-board table').getByRole('link').first().click();
      const t = pageMessages[locale];
      const pages = native.locator('.page-list');
      await expect(pages.getByRole('heading', { name: locale === 'en' ? 'Recently added Pages' : '최근 추가된 페이지', exact: true })).toBeVisible();
      await expect(pages.getByRole('table').locator('tbody tr')).toHaveCount(10);
      await pages.getByRole('combobox', { name: t.filter, exact: true }).selectOption('yesterday');
      await pages.getByRole('button', { name: t.apply, exact: true }).click();
      expect(new URL(native.url()).searchParams.get('added')).toBe('yesterday');
      const selected = new URL(native.url()).searchParams.get('source');
      await native.getByRole('combobox', { name: sourceMessages[locale].timeZone, exact: true }).selectOption('Asia/Seoul');
      await native.getByRole('button', { name: sourceMessages[locale].applyTimeZone, exact: true }).click();
      expect(new URL(native.url()).searchParams.get('source')).toBe(selected);
      expect(new URL(native.url()).searchParams.get('added')).toBe('yesterday');
      await native.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      expect(await native.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
      await native.screenshot({ path: `test-results/pages-${locale}-320-text200-native.png`, fullPage: true });
      for (const [label, title, content, kind] of [[t.rangeHelp, t.rangeTitle, t.coverage, 'range'], [t.dateHelp, t.added, t.meaning, 'date']]) {
        await pages.getByRole('button', { name: label, exact: true }).click();
        const help = native.getByRole('dialog', { name: title, exact: true });
        await expect(help).toContainText(content);
        const bounds = (await help.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(11);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(309);
        expect(bounds.y).toBeGreaterThanOrEqual(11);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(889);
        await native.screenshot({ path: `test-results/help-${locale}-page-${kind}-native-320-enlarged.png` });
        if (kind === 'range') {
          await help.evaluate(element => { element.scrollTop = element.scrollHeight; });
          const close = help.getByRole('button', { name: sourceMessages[locale].close, exact: true });
          await expect(close).toBeInViewport();
          await native.screenshot({ path: `test-results/help-${locale}-page-range-scrolled-native-320-enlarged.png` });
          await close.click();
        } else await native.keyboard.press('Escape');
        await expect(pages.getByRole('button', { name: label, exact: true })).toBeFocused();
      }

    } finally { await context.close(); }
  });
  test('Page reader POST rejects copied command, identity, oversized body and hostile Origin before spawning', async ({ request }) => {
    await scenario('detail-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    await clearCalls();
    for (const mode of ['other', 'missing', 'origin', 'host']) {
      const denied = await request.post(`${origin}/api/page-detail`, { headers: { origin, 'x-observatory-test-access': mode }, data: { source, slug: 'page-000' } });
      expect(denied.status()).toBe(403);
      expect(denied.headers()['cache-control']).toContain('private, no-store');
    }
    const noOrigin = await request.post(`${origin}/api/page-detail`, { data: { source, slug: 'page-000' } });
    expect(noOrigin.status()).toBe(403);
    for (const data of [{ source, slug: 'page-000', command: 'recall' }, { source, slug: '' }, { source: '/bin/sh', slug: 'page-000' }, { source, slug: 'x'.repeat(5000) }]) {
      expect((await request.post(`${origin}/api/page-detail`, { headers: { origin }, data })).status()).toBe(400);
    }
    const wrongType = await request.post(`${origin}/api/page-detail`, { headers: { origin, 'content-type': 'text/plain' }, data: JSON.stringify({ source, slug: 'page-000' }) });
    expect(wrongType.status()).toBe(400);
    expect(await calls()).toHaveLength(0);
    const response = await request.post(`${origin}/api/page-detail?command=recall`, { headers: { origin }, data: { source, slug: 'page-000' } });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('private, no-store');
    const result = await response.json();
    expect(result.kind).toBe('success');
    expect(result.snapshot.memories.rows[0].claim).toBe('원본 기억 / original claim');
    expect((await calls()).filter(call => call.args[1] === 'get_backlinks')).toHaveLength(1);
    expect((await calls()).every(call => !['recall', 'get_fact'].includes(call.args[1]))).toBe(true);
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`native ${locale} Page reading survives direct navigation, settings and full view`, async ({ browser }) => {
    await scenario('detail-success');
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: locale, url: origin }, { name: timeZoneCookie, value: 'UTC', url: origin }]);
      const native = await context.newPage(); await native.goto(origin);
      await native.locator('.table-board table').getByRole('link').first().click();
      await native.locator('.page-list tbody tr').first().getByRole('link').click();
      const reader = native.locator('.page-reader'); const t = readerMessages[locale];
      await expect(reader).toContainText('원본 기억 / original claim');
      await expect(reader.getByRole('button', { name: t.showInBody, exact: true })).toHaveCount(0);
      const identity = new URL(native.url()).searchParams.get('page');
      expect(identity).toBe('page-000');
      await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
      await expect(reader).toContainText('원본 본문 / original body');
      await reader.getByRole('button', { name: t.fullReading, exact: false }).click();
      await expect(reader).toHaveClass(/page-reader-full/);
      expect(new URL(native.url()).searchParams.get('page')).toBe(identity);
      expect(new URL(native.url()).searchParams.get('view')).toBe('body');
      await native.getByRole('combobox', { name: sourceMessages[locale].timeZone, exact: true }).selectOption('Asia/Seoul');
      await native.getByRole('button', { name: sourceMessages[locale].applyTimeZone, exact: true }).click();
      expect(new URL(native.url()).searchParams.get('page')).toBe(identity);
      expect(new URL(native.url()).searchParams.get('reading')).toBe('full');
      await expect(reader).toContainText('원본 기억 / original claim');
      const nextLocale = locale === 'en' ? 'ko' : 'en';
      await native.getByRole('combobox', { name: sourceMessages[locale].language, exact: true }).selectOption(nextLocale);
      await native.getByRole('button', { name: sourceMessages[locale].applyLanguage, exact: true }).click();
      await expect(native.locator('html')).toHaveAttribute('lang', nextLocale);
      expect(new URL(native.url()).searchParams.get('page')).toBe(identity);
      await expect(reader).toContainText('원본 기억 / original claim');
    } finally { await context.close(); }
  });

  test('direct full reader SSR defers the hidden Page list until native list return', async ({ browser, request }) => {
    await scenario('detail-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    await clearCalls();
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: 'en', url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/?${new URLSearchParams({ source, page: 'page-000', view: 'body', reading: 'full' })}`);
      const reader = page.locator('.page-reader-full');
      await expect(reader).toContainText('원본 본문 / original body');
      expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
      const details = (await calls()).filter(call => call.args[1] === 'get_page').map(call => JSON.parse(call.args[2]));
      expect(details[0]).toEqual({ source_id: 'example', slug: 'page-000', fuzzy: false });
      expect(details.filter(detail => detail.slug === 'page-000')).toHaveLength(1);
      await reader.getByRole('link', { name: readerMessages.en.returnToList, exact: true }).click();
      await expect(page.locator('.page-list tbody tr')).toHaveCount(10);
      expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(1);
      expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    } finally { await context.close(); }
  });

  test('native Source refresh keeps the exact open Page and selected body view', async ({ browser, request }) => {
    await scenario('detail-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: 'en', url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/?${new URLSearchParams({ source, page: 'page-000', view: 'body' })}`);
      await expect(page.locator('.page-reader')).toContainText('원본 본문 / original body');
      await clearCalls();
      await page.getByRole('button', { name: sourceMessages.en.refresh, exact: true }).click();
      await expect(page.locator('.page-reader')).toContainText('원본 본문 / original body');
      expect(new URL(page.url()).searchParams.get('source')).toBe(source);
      expect(new URL(page.url()).searchParams.get('page')).toBe('page-000');
      expect(new URL(page.url()).searchParams.get('view')).toBe('body');
      expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(1);
    } finally { await context.close(); }
  });

  test('cross-Source reference reads its exact Page before any deferred background list without a busy retry', async ({ page }) => {
    await scenario('detail-cross-source');
    await page.goto(origin);
    await page.locator('.table-board table').getByRole('link', { name: 'connection-private-source-name', exact: true }).click();
    const pages = page.locator('.page-list'), t = readerMessages.en;
    await expect(pages.locator('tbody tr')).toHaveCount(10);
    await pages.locator('tbody tr').first().getByRole('link').click();
    const reader = page.locator('.page-reader');
    await expect(reader).toContainText('원본 기억 / original claim');
    await reader.locator('.reader-labels').getByText(t.references, { exact: true }).click();
    await expect(reader.getByRole('link', { name: 'Cross Source target', exact: false })).toBeVisible();
    await clearCalls();
    const detailResponses: string[] = [];
    page.on('response', async response => {
      if (new URL(response.url()).pathname === '/api/page-detail') detailResponses.push(await response.text());
    });
    await reader.getByRole('link', { name: 'Cross Source target', exact: false }).click();
    await expect(reader.getByRole('heading', { name: 'Cross Source target', exact: true })).toBeVisible();
    await expect(reader).not.toContainText(t.busy);
    expect(JSON.parse(new URL(page.url()).searchParams.get('source')!)[1]).toBe('another');
    expect(new URL(page.url()).searchParams.get('page')).toBe('cross-target');
    await reader.locator('.reader-labels').getByText(t.body, { exact: true }).click();
    await expect(reader).toContainText('Cross Source body another/cross-target');
    const beforeClose = await calls();
    expect(beforeClose.filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
    expect(beforeClose.filter(call => call.args[1] === 'get_page').map(call => JSON.parse(call.args[2]))).toEqual([{ source_id: 'another', slug: 'cross-target', fuzzy: false }]);
    await expect.poll(() => detailResponses.length).toBe(1);
    expect(JSON.parse(detailResponses[0]).kind).toBe('success');
    await reader.getByRole('link', { name: t.close, exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(pages.locator('tbody tr')).toHaveCount(10);
    await expect(page.getByRole('heading', { name: 'Cross Source', exact: true })).toBeVisible();
    const lists = (await calls()).filter(call => call.args[1] === 'list_pages');
    expect(lists).toHaveLength(1);
    expect(JSON.parse(lists[0].args[2])).toEqual({ source_id: 'another', sort: 'created_desc', limit: 10, offset: 0 });
    expect(detailResponses).toHaveLength(1);
  });

  test('Fact POST endpoints validate owner/Origin and exact bounded identity before fixed Source-scoped recall', async ({ request }) => {
    await scenario('facts-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    await clearCalls();
    for (const path of ['facts', 'fact-detail']) {
      const body = path === 'facts' ? { source } : { source, id: '17' };
      const denied = await request.post(`${origin}/api/${path}`, { headers: { origin: 'https://attacker.invalid' }, data: body });
      expect(denied.status()).toBe(403); expect(await denied.text()).not.toContain('original public fact');
      expect(denied.headers()['cache-control']).toContain('no-store');
      const invalid = await request.post(`${origin}/api/${path}`, { headers: { origin }, data: { ...body, executable: '/bin/sh' } });
      expect(invalid.status()).toBe(400);
    }
    expect(await calls()).toHaveLength(0);
    const list = await request.post(`${origin}/api/facts`, { headers: { origin }, data: { source } });
    expect(list.headers()['cache-control']).toContain('private'); expect(list.headers()['cache-control']).toContain('no-store');
    const result = await list.json(); expect(result.kind).toBe('success'); expect(result.snapshot.rows[0].id).toBe('17');
    expect(result.snapshot.coverage).toBe('unknown'); expect(result.snapshot.continuation).toBe('unsupported');
    const detail = await (await request.post(`${origin}/api/fact-detail`, { headers: { origin }, data: { source, id: '17' } })).json();
    expect(detail.kind).toBe('success'); expect(detail.snapshot.fact.id).toBe('17'); expect(detail.snapshot.evidence.availability).toBe('available');
    expect(detail.snapshot.evidence.level).toBe('context-page');
    const recall = (await calls()).filter(call => call.args[3] === 'recall'); expect(recall).toHaveLength(2);
    expect(recall.every(call => call.args[2] === 'example' && JSON.parse(call.args[4]).source_id === 'example')).toBe(true);
  });

  test('hydrated Source memories render exact Fact and provenance from the actual POST transports', async ({ page }) => {
    await scenario('facts-success');
    await page.goto(origin);
    await page.locator('.desktop-navigation .source-navigation-link').first().click();
    await expect(page.locator('.page-list [role="status"]')).toContainText(pageMessages.en.complete);
    const source = new URL(page.url()).searchParams.get('source')!;
    const [namespace, sourceId] = JSON.parse(source) as [string, string];
    await clearCalls();

    const listPending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/facts');
    await page.getByRole('link', { name: factMessages.en.load, exact: true }).click();
    const listResponse = await listPending;
    expect(listResponse.request().method()).toBe('POST');
    expect(listResponse.request().postDataJSON()).toEqual({ source });
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    expect(list.kind).toBe('success');
    expect(list.snapshot.sourceReference).toBe(source);
    expect(list.snapshot.rows).toHaveLength(1);
    const expectedFact = {
      namespace, sourceId, id: '17', content: '원본 기억 🌿 / original public fact', kind: 'belief',
      sourceDescription: 'mcp:put_page', provenance: null, context: 'notes/fact-context — extracted from original', contextAvailability: 'available',
    };
    expect(list.snapshot.rows[0]).toMatchObject(expectedFact);
    const factLink = page.locator('.fact-list tbody').getByRole('link', { name: expectedFact.content, exact: true });
    await expect(factLink).toBeVisible();
    await expect(page.locator('.fact-list tbody')).toContainText(expectedFact.sourceDescription);

    const detailPending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/fact-detail');
    await factLink.click();
    const detailResponse = await detailPending;
    expect(detailResponse.request().method()).toBe('POST');
    expect(detailResponse.request().postDataJSON()).toEqual({ source, id: '17' });
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.kind).toBe('success');
    expect(detail.snapshot.fact).toMatchObject(expectedFact);
    expect(detail.snapshot.contextPage).toMatchObject({ availability: 'available', page: { namespace, sourceId, slug: 'notes/fact-context' } });
    expect(detail.snapshot.storedPage).toMatchObject({ availability: 'available', page: { namespace, sourceId, slug: 'notes/fact-stored' } });
    expect(detail.snapshot.evidence).toMatchObject({
      availability: 'available', level: 'context-page', page: { namespace, sourceId, slug: 'notes/fact-original' },
      quote: '원문 인용 🌿 / exact original quote',
    });
    const reader = page.locator('.fact-reader');
    await expect(reader).toContainText(expectedFact.content);
    await expect(reader).toContainText(factMessages.en.pageQuote);
    await expect(reader).toContainText(detail.snapshot.evidence.quote);
    await expect(reader.getByRole('link', { name: 'Verified notes/fact-context', exact: false })).toBeVisible();
    await expect(reader.getByRole('link', { name: 'Verified notes/fact-original', exact: false })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
    const recall = (await calls()).filter(call => call.args[3] === 'recall');
    expect(recall).toHaveLength(2);
    expect(recall.every(call => call.args[2] === sourceId && JSON.parse(call.args[4]).source_id === sourceId)).toBe(true);
  });

  test('hydrated Fact Find and reload restore History presentation without hydration or page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await scenario('facts-success');
    await page.goto(origin);
    await page.locator('.desktop-navigation .source-navigation-link').first().click();
    await expect(page.locator('.page-list [role="status"]')).toContainText(pageMessages.en.complete);
    await page.getByRole('link', { name: factMessages.en.load, exact: true }).click();
    await page.locator('.fact-list tbody').getByRole('link', { name: '원본 기억 🌿 / original public fact', exact: true }).click();
    const reader = page.locator('.fact-reader');
    const find = reader.getByRole('button', { name: factMessages.en.showInBody, exact: true });
    await find.click();
    await expect(reader.locator('#fact-verified-passage')).toHaveText('원문 인용 🌿 / exact original quote');
    await expect(reader.locator('#fact-verified-passage')).toBeFocused();
    expect(await page.evaluate(() => history.state.factPresentation)).toMatchObject({ bodyOpen: true, highlight: true });
    await page.reload();
    // This enhanced control proves hydration has completed before checking errors.
    await expect(find).toBeVisible();
    await expect(reader).toContainText('원본 기억 🌿 / original public fact');
    await expect(reader.locator('#fact-source-body')).toHaveAttribute('open', '');
    await expect(reader.locator('#fact-verified-passage')).toHaveText('원문 인용 🌿 / exact original quote');
    await find.click();
    await expect(reader.locator('#fact-verified-passage')).toBeFocused();
    expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
    expect(errors).toEqual([]);
  });

  for (const locale of ['en', 'ko'] as const) for (const mode of ['panel', 'full'] as const) test(`native ${locale} mobile ${mode} Source recovery GET retains the exact pending Fact and parent`, async ({ browser, request }) => {
    await scenario('facts-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    await scenario('nonzero');
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    try {
      await context.addCookies([{ name: localeCookie, value: locale, url: origin }]);
      const native = await context.newPage();
      const query = new URLSearchParams({ source, expanded: source, facts: '1', fact: '17', page: 'parent-page', view: 'references', reading: 'full', added: 'yesterday' });
      if (mode === 'full') query.set('factReading', 'full');
      await native.goto(`${origin}/?${query}`);
      const reader = native.locator('.fact-reader');
      await expect(reader).toContainText(sourceMessages[locale].issues.failure.reason);
      const recover = reader.getByRole('button', { name: sourceMessages[locale].refresh, exact: true });
      await expect(recover).toBeVisible();
      expect(await recover.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(false);
      expect(await recover.evaluate(button => button.closest('form')?.method)).toBe('get');
      const hidden = await reader.locator('form input[type="hidden"]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])));
      for (const [key, value] of query) expect(hidden[key]).toBe(value);
      await scenario('facts-success');
      await recover.click();
      await expect(reader).toContainText('원본 기억 🌿 / original public fact');
      for (const [key, value] of query) expect(new URL(native.url()).searchParams.get(key)).toBe(value);
      expect((await calls()).filter(call => call.args[3] === 'recall')).toHaveLength(1);
      expect((await calls()).filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
    } finally { await context.close(); }
  });

  test('direct native Fact detail suppresses parent Page and list acquisitions until the reader returns', async ({ browser, request }) => {
    await scenario('facts-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]); await clearCalls();
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: 'en', url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/?${new URLSearchParams({ source, page: 'parent-page', view: 'body', facts: '1', fact: '17', factReading: 'full' })}`);
      await expect(page.locator('.fact-reader')).toContainText('원본 기억 🌿 / original public fact');
      await expect(page.locator('.page-reader:not(.fact-reader)')).toHaveCount(0);
      const invoked = await calls();
      expect(invoked.filter(call => call.args[1] === 'list_pages')).toHaveLength(0);
      expect(invoked.filter(call => call.args[3] === 'recall')).toHaveLength(1);
      expect(invoked.filter(call => call.args[1] === 'get_page').some(call => JSON.parse(call.args[2]).slug === 'parent-page')).toBe(false);
      await page.locator('.fact-reader').getByRole('link', { name: factMessages.en.returnToList, exact: true }).click();
      expect(new URL(page.url()).searchParams.get('page')).toBe('parent-page');
      expect(new URL(page.url()).searchParams.has('fact')).toBe(false);
      await expect(page.locator('.page-reader:not(.fact-reader)')).toBeVisible();
    } finally { await context.close(); }
  });

  test('native unseeded Page refresh is disabled while a Fact owns the read and preserves bounded parent fields', async ({ browser, request }) => {
    await scenario('facts-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: 'en', url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/?${new URLSearchParams({ source, page: 'parent-page', view: 'body', facts: '1', fact: '17' })}`);
      await expect(page.locator('.fact-reader')).toContainText('원본 기억 🌿 / original public fact');
      await clearCalls();
      const form = page.locator('.page-list .page-refresh');
      await expect(form.getByRole('button', { name: pageMessages.en.refresh, exact: true })).toBeDisabled();
      expect(await page.locator('.fact-list .page-refresh button').evaluate(button => (button as HTMLButtonElement).disabled)).toBe(true);
      const fields = await form.locator('input[type="hidden"]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])));
      expect(fields).toMatchObject({ source, page: 'parent-page', view: 'body', facts: '1', fact: '17' });
      const query = new URL(page.url()).searchParams;
      expect(query.toString().length).toBeLessThanOrEqual(2048);
      expect(query.get('source')).toBe(source); expect(query.get('fact')).toBe('17'); expect(query.get('facts')).toBe('1');
      expect(query.get('page')).toBe('parent-page'); expect(query.get('view')).toBe('body');
      expect(await calls()).toHaveLength(0);
    } finally { await context.close(); }
  });

  for (const locale of ['en', 'ko'] as Locale[]) test(`native ${locale} Fact detail retains exact identity across full reading and language settings`, async ({ browser, request }) => {
    await scenario('facts-success');
    const sources = await (await request.post(`${origin}/api/sources`, { headers: { origin } })).json();
    const source = sourceReference(sources.snapshot.sources[0]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: localeCookie, value: locale, url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/?${new URLSearchParams({ source })}`);
      const t = factMessages[locale];
      await expect(page.getByText(t.pending, { exact: true })).toBeVisible();
      await page.getByRole('link', { name: t.load, exact: true }).click();
      await page.locator('.fact-list tbody').getByRole('link').first().click();
      const reader = page.locator('.fact-reader');
      await expect(reader).toContainText('원본 기억 🌿 / original public fact');
      await expect(reader).toContainText(t.pageQuote);
      expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
      await reader.getByRole('link', { name: t.fullReading, exact: true }).click();
      await expect(reader).toHaveClass(/page-reader-full/);
      expect(new URL(page.url()).searchParams.get('factReading')).toBe('full');
      const nextLocale = locale === 'en' ? 'ko' : 'en';
      await page.getByRole('combobox', { name: sourceMessages[locale].language, exact: true }).selectOption(nextLocale);
      await page.getByRole('button', { name: sourceMessages[locale].applyLanguage, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', nextLocale);
      expect(new URL(page.url()).searchParams.get('fact')).toBe('17');
      expect(new URL(page.url()).searchParams.get('factReading')).toBe('full');
      await expect(reader).toContainText('원본 기억 🌿 / original public fact');
    } finally { await context.close(); }
  });

});
