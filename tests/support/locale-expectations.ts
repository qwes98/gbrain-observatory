import type { Locale } from '../../src/i18n/messages';

interface LocaleExpectation {
  heading: string;
  language: string;
  applyLanguage: string;
  guide: string;
  notProvided: string;
  checkedTime: string;
  timeZone: string;
  timeZoneLabel: string;
  applyTimeZone: string;
  autoTimeZone: string;
  effectiveTimeZone: string;
  invalidTimeZone: string;
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
    checkedTime: '27/10/2026, 12:00 · UTC+09:00',
    timeZone: 'Asia/Seoul',
    timeZoneLabel: 'Time zone',
    applyTimeZone: 'Apply time zone',
    autoTimeZone: 'Automatic (device)',
    effectiveTimeZone: 'Effective time zone',
    invalidTimeZone: 'Choose Automatic or a supported named time zone. Your saved setting has been kept.',
    largeCount: '1,000 results',
    counts: ['0 results', '1 result', '3 results'],
  },
  ko: {
    heading: '소스',
    language: '언어',
    applyLanguage: '언어 적용',
    guide: '연결 안내',
    notProvided: '제공되지 않음',
    checkedTime: '2026. 10. 27. 12:00 · UTC+09:00',
    timeZone: 'Asia/Seoul',
    timeZoneLabel: '시간대',
    applyTimeZone: '시간대 적용',
    autoTimeZone: '자동(기기 설정)',
    effectiveTimeZone: '적용 시간대',
    invalidTimeZone: '자동 또는 지원되는 이름의 시간대를 선택해 주세요. 저장된 설정은 유지했어요.',
    largeCount: '결과 1,000개',
    counts: ['결과 0개', '결과 1개', '결과 3개'],
  },
} satisfies Record<Locale, LocaleExpectation>;

// Add a key only for intentionally identical text, such as a product name.
export const sharedMessageAllowlist: Record<Exclude<Locale, 'en'>, readonly string[]> = {
  ko: [],
};
