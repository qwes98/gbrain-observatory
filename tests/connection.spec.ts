import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localeCookie, sourceMessages, type Locale } from '../src/i18n/messages';

const origin = 'http://127.0.0.1:4179';
const messages = sourceMessages.en.connectionCheck;
let directory: string;
async function calls() { return (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
async function scenario(name: string) { await writeFile(join(directory, 'scenario'), name); await writeFile(join(directory, 'calls'), ''); }

test.describe('configured connection boundary', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => { directory = await readFile('.next/connection-test-path', 'utf8'); });

  test('manual check ignores hostile parameters, preserves scope/time, and does not fabricate sources', async ({ page }) => {
    await scenario('slow');
    await page.goto(`${origin}/?command=search&cwd=/private&executable=/bin/sh&scenario=empty`);
    expect(await calls()).toEqual([]);
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
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('.table-footer')).toHaveText(sourceMessages.en.listIntegrationPending);
    await expect(page.getByText(messages.scope, { exact: true })).toBeVisible();
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
    await scenario('empty'); await page.goto(origin);
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    await expect(page.locator('.connection-panel dd').last()).toHaveText('0');
    await expect(page.getByText(sourceMessages.en.emptyTitle, { exact: true })).toHaveCount(0);
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
    await page.goto(origin);
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
    await scenario('slow'); await page.goto(origin);
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
    await scenario('success'); await page.goto(origin);
    await page.context().addCookies([{ name: 'observatory-test-access', value: 'other', url: origin }]);
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByRole('heading', { name: sourceMessages.en.access.denied.title, exact: true })).toBeVisible();
    expect(await calls()).toHaveLength(0);
  });

  test('denied identity and Origin reject the actual connection action before spawning', async ({ page, request }) => {
    await scenario('success'); await page.goto(origin);
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
    const page = await context.newPage(); await page.goto(origin);
    const t = sourceMessages[locale];
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

  test('configured panel passes automated accessibility checks', async ({ page }) => {
    await scenario('success'); await page.goto(origin);
    await page.getByRole('button', { name: messages.check, exact: true }).click();
    await expect(page.getByText(messages.success, { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
