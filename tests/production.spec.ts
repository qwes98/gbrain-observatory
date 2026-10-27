import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceSnapshot } from './fixtures/source-data';
import { productionOrigin, ui as t } from './support/ui';

test('production remains unconfigured under fixture queries and runtime environment values; requests stay local', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  for (const query of ['', '?fixture=success', '?scenario=success', '?state=success&sourceFixture=success']) {
    await page.goto(`${productionOrigin}/${query}`);
    await expect(page.getByRole('heading', { name: t.sources, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t.guide, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t.refresh, exact: true })).toHaveCount(0);
    await expect(page.getByText(/fixture-only-alpha|__sourceFixture|private-token-must-never-render/)).toHaveCount(0);
    for (const source of sourceSnapshot.sources) await expect(page.getByText(source.name, { exact: true })).toHaveCount(0);
    await expect(page.locator('.table-footer')).toHaveText(t.listPending);
  }
  await page.evaluate(() => document.fonts.ready);
  expect(requests.some(url => url.endsWith('/fonts/PretendardVariable.woff2'))).toBe(true);
  expect(requests.every(url => new URL(url).origin === productionOrigin)).toBe(true);
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toContain('Pretendard');
  expect(await page.evaluate(() => document.fonts.check('15px "Pretendard Variable"'))).toBe(true);
  await page.screenshot({ path: 'test-results/production-sources-desktop.png', fullPage: true });
});

test('production exposes no fixture routes', async ({ request }) => {
  for (const path of ['/fixtures', '/fixtures/success', '/tests/fixtures', '/tests/fixtures/main.tsx', '/__fixtures/sources']) {
    expect((await request.get(`${productionOrigin}${path}`)).status()).toBe(404);
  }
});

test('production build contains no synthetic source list or test fixture loader', async () => {
  async function inspect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (/\.(js|html|rsc|json)$/.test(entry.name)) {
        const content = await readFile(path, 'utf8');
        expect(content, path).not.toMatch(/fixture-only-alpha|__sourceFixture|private-token-must-never-render/);
        for (const source of sourceSnapshot.sources) expect(content, path).not.toContain(source.name);
      }
    }
  }
  await inspect('.next/server/app');
  await inspect('.next/static');
});
