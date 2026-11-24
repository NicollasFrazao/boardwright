import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  formatMarker,
  parseMarker,
  readMarkers,
  type RunMarker,
} from '../src/index.ts';

const marker: RunMarker = {
  stage: 'implement',
  runId: 'run-1',
  attempt: 2,
  event: 'started',
};

describe('run markers', () => {
  it('writes the version 1 format, which is a public contract', () => {
    expect(formatMarker(marker)).toBe('<!-- boardwright:run v=1 stage=implement run=run-1 attempt=2 event=started -->');
  });

  it('reads back what it writes, with text around it', () => {
    expect(parseMarker(`${formatMarker(marker)}\n**boardwright** · Started.`)).toEqual(marker);
  });

  it('ignores comments without a marker, an unknown version or an unknown event', () => {
    expect(parseMarker('Looks good to me')).toBeUndefined();
    expect(parseMarker('<!-- boardwright:run v=2 stage=implement run=r attempt=1 event=started -->')).toBeUndefined();
    expect(parseMarker('<!-- boardwright:run v=1 stage=implement run=r attempt=1 event=exploded -->')).toBeUndefined();
  });

  it('keeps only the asked stage, oldest first, breaking ties by comment id', () => {
    const at = new Date('2026-11-24T12:00:00Z');
    const later = new Date('2026-11-24T12:05:00Z');

    const markers = readMarkers(
      [
        {
          id: 'c0003',
          body: formatMarker({
            ...marker,
            event: 'failed',
          }),
          createdAt: later,
        },
        {
          id: 'c0002',
          body: formatMarker({
            ...marker,
            runId: 'run-2',
          }),
          createdAt: at,
        },
        {
          id: 'c0001',
          body: formatMarker(marker),
          createdAt: at,
        },
        {
          id: 'c0004',
          body: formatMarker({
            ...marker,
            stage: 'review',
          }),
          createdAt: at,
        },
        {
          id: 'c0005',
          body: 'A person comments',
          createdAt: at,
        },
      ],
      'implement',
    );

    expect(markers.map((entry) => entry.commentId)).toEqual([
      'c0001',
      'c0002',
      'c0003',
    ]);
  });
});
