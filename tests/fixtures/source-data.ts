import type { SourceSnapshot } from "../../src/contracts/sources";

// Source content intentionally includes Korean independently of the selected UI language.
export const sourceSnapshot: SourceSnapshot = {
  checkedAt: '2026-10-27T03:00:00.000Z',
  sources: [
    {
      id: 'fixture-only-alpha',
      name: '검증 전용 소스 알파',
      connection: { folder: '/검증/매우-긴-폴더-경로/프로젝트/자료', repository: 'https://example.invalid/fixture/repository' },
      sync: { status: 'success', label: '마지막 동기화 성공' },
      lastSyncedAt: '2026-10-26T23:30:00.000Z',
      checkedAt: '2026-10-27T02:59:00.000Z',
    },
    {
      id: 'fixture-only-beta',
      name: '검증 전용 소스 베타',
      connection: {},
      sync: { status: 'unknown', label: '아직 확인할 수 없어요' },
      lastSyncedAt: null,
      checkedAt: null,
    },
    {
      id: 'fixture-only-gamma',
      name: '검증 전용 소스 감마',
      connection: { repository: 'https://example.invalid/fixture/attention' },
      sync: { status: 'attention', label: '동기화 확인 필요' },
      lastSyncedAt: null,
      checkedAt: '2026-10-27T02:58:00.000Z',
    },
  ],
};

// Inputs are deliberately independent of Date.parse/browser timezone defaults.
export const timestampSnapshot: SourceSnapshot = {
  checkedAt: '2026-10-27T12:00:00+09:00',
  sources: [
    { ...sourceSnapshot.sources[0], id: 'invalid-time', name: '잘못된 시각 검증', lastSyncedAt: 'not-a-date', checkedAt: '2026-02-30T10:00:00Z' },
    { ...sourceSnapshot.sources[0], id: 'ambiguous-time', name: '시간대 없는 시각 검증', lastSyncedAt: '2026-10-27T03:00:00', checkedAt: '2026-10-27' },
    { ...sourceSnapshot.sources[0], id: 'offset-time', name: '명시된 시간대 검증', lastSyncedAt: '2026-10-27T12:00:00+09:00', checkedAt: '2026-10-27T04:15:00.123Z' },
    { ...sourceSnapshot.sources[0], id: 'missing-time', name: '누락된 시각 검증', lastSyncedAt: null, checkedAt: null },
    { ...sourceSnapshot.sources[0], id: 'range-time', name: '범위 밖 시각 검증', lastSyncedAt: '2026-10-27T24:00:00Z', checkedAt: '2026-10-27T03:00:00+99:00' },
  ],
};
