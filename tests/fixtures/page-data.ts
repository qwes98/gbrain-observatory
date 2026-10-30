import type { Page, PageSnapshot } from '../../src/contracts/pages';
import { sourceReference } from '../../src/contracts/sources';
import { sourceSnapshot } from './source-data';

const source = sourceSnapshot.sources[0];
const observation = { startedAt: '2026-10-31T12:00:00Z', completedAt: '2026-10-31T12:00:01Z' };
export const pageRows: Page[] = [
  ['today', '오늘의 원본 / today', '2026-10-31T00:30:00Z'],
  ['yesterday', '어제의 원본 / yesterday', '2026-10-30T23:30:00Z'],
  ['unknown', '날짜 없는 원본 / unknown', null],
].map<Page>(([slug, title, createdAt]) => ({ namespace: source.namespace, sourceId: source.id, slug: slug!, title: title!, kind: 'source', createdAt,
  updatedAt: '2026-10-31T10:00:00Z', creationAvailability: createdAt ? 'available' : 'missing', modificationAvailability: 'available', detailObservation: observation }));
export const pageSnapshot: PageSnapshot = { sourceReference: sourceReference(source), pages: pageRows, offset: 0, nextOffset: 10, range: 'more',
  listObservation: observation, observation, coverage: 'unknown' };
