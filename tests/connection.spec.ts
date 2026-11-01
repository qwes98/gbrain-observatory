import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localeCookie, sourceMessages, pageMessages, type Locale } from '../src/i18n/messages';
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
    const checkDetails = page.locator('.connection-panel details');
    await expect(page.getByText(messages.scope, { exact: true })).toBeHidden();
    await checkDetails.locator('summary').click();
    await expect(page.getByText(messages.scope, { exact: true })).toBeVisible();
    await checkDetails.locator('summary').click();
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
    const sourceDetails = page.locator('.source-reading-details');
    await expect(page.getByText(t.scopeNote, { exact: true }).filter({ visible: true })).toHaveCount(0);
    await sourceDetails.locator('summary').click();
    await expect(sourceDetails.getByText(t.scopeNote, { exact: true })).toBeVisible();
    await sourceDetails.locator('summary').click();
    const sourceLink = page.locator('.desktop-navigation .source-tree a').first();
    const sourceHref = await sourceLink.getAttribute('href');
    await page.goto(new URL(sourceHref!, origin).href);
    await page.locator('.source-help summary').click();
    await expect(page.locator('.source-help').getByText(t.scopeNote, { exact: true })).toBeVisible();
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
    await expect(page.getByText(t.coverageUnknown, { exact: true })).toBeVisible();
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
    await expect(pages.getByRole('link')).toHaveCount(0);
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
    } finally { await context.close(); }
  });
});
