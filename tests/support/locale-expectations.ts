import type { Locale } from '../../src/i18n/messages';

interface LocaleExpectation {
  heading: string;
  language: string;
  applyLanguage: string;
  guide: string;
  notProvided: string;
  checkedTime: string;
  timeZone: string;
  largeCount: string;
  counts: readonly [string, string, string];
}

// Independent acceptance examples: never derive these from the production catalog or formatter.
export const localeExpectations = {
  en: {
    heading: 'Sources',
    language: 'Language',
    applyLanguage: 'Apply language',
    guide: 'Connection help',
    notProvided: 'Not provided',
    checkedTime: '27/10/2026, 12:00',
    timeZone: 'Korea time (UTC+09:00)',
    largeCount: '1,000 results',
    counts: ['0 results', '1 result', '3 results'],
  },
  ko: {
    heading: '소스',
    language: '언어',
    applyLanguage: '언어 적용',
    guide: '연결 안내',
    notProvided: '제공되지 않음',
    checkedTime: '2026. 10. 27. 12:00',
    timeZone: '한국 시간(UTC+09:00)',
    largeCount: '결과 1,000개',
    counts: ['결과 0개', '결과 1개', '결과 3개'],
  },
} satisfies Record<Locale, LocaleExpectation>;

// Add a key only for intentionally identical text, such as a product name.
export const sharedMessageAllowlist: Record<Exclude<Locale, 'en'>, readonly string[]> = {
  ko: [],
};
