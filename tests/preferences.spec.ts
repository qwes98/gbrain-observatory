import { expect, test } from '@playwright/test';
import { localeCookie } from '../src/i18n/messages';
import { timeZoneCookie } from '../src/i18n/time-zone';
import { productionOrigin, ui } from './support/ui';

const settings = [
  { name: 'language', label: ui.language, apply: ui.applyLanguage, cookie: localeCookie, value: 'ko' },
  { name: 'time zone', label: ui.timeZone, apply: ui.applyTimeZone, cookie: timeZoneCookie, value: 'Asia/Seoul' },
] as const;

for (const javaScriptEnabled of [true, false]) {
  for (const setting of settings) {
    test(`${setting.name} form preserves its cookie policy with JavaScript ${javaScriptEnabled}`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled, timezoneId: 'UTC' });
      try {
        await context.addCookies([{ name: localeCookie, value: 'en', url: productionOrigin }]);
        const page = await context.newPage();
        await page.goto(productionOrigin);
        await page.getByRole('combobox', { name: setting.label, exact: true }).selectOption(setting.value);
        const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).origin === productionOrigin);
        await page.getByRole('button', { name: setting.apply, exact: true }).click();
        const response = await submitted;
        const cookieHeaders = (await response.headerValues('set-cookie')).filter(value => value.startsWith(`${setting.cookie}=`));
        expect(cookieHeaders).toHaveLength(1);
        // Attribute names and SameSite values are case-insensitive; expiry dates may contain commas.
        const attributes = cookieHeaders[0].split(';').slice(1).map(value => value.trim().toLowerCase());
        expect(attributes).toEqual(expect.arrayContaining([
          'max-age=31536000', 'path=/', 'samesite=lax', 'secure', 'httponly',
        ]));
        if (setting.name === 'language') {
          await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
        } else {
          await expect(page.getByRole('status').filter({ hasText: ui.effectiveTimeZone })).toHaveText(`${ui.effectiveTimeZone}: Asia/Seoul`);
        }
        const preference = (await context.cookies(productionOrigin)).find(cookie => cookie.name === setting.cookie);
        expect(preference).toMatchObject({
          secure: true, httpOnly: true, path: '/', sameSite: 'Lax',
        });
        expect(decodeURIComponent(preference!.value)).toBe(setting.value);
      } finally { await context.close(); }
    });
  }
}
