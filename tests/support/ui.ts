import { expect, type Page } from '@playwright/test';
import { defaultLocale, sourceMessages, type Locale } from '../../src/i18n/messages';

export const productionOrigin = 'http://127.0.0.1:4173';
export const fixtureOrigin = 'http://127.0.0.1:4174';
export const behaviorLocale = defaultLocale;
export const ui = sourceMessages[behaviorLocale];

export async function openSourceFixture(page: Page, scenario: string, locale: Locale = behaviorLocale) {
  // Existing behavior checks hold the display zone fixed, independent of test machines.
  const query = new URLSearchParams({ scenario, locale, timeZone: 'Asia/Seoul' });
  await page.goto(`${fixtureOrigin}/?${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sourceMessages[locale].sources);
}
