import { buildEntry } from './index';

describe('buildEntry', () => {
  it('builds an entry with expected shape', () => {
    const entry = buildEntry(
      'athlete-1',
      {
        sections: {
          private: 'private reflection',
          shared: 'shareable notes'
        },
        sessionMetrics: {
          durationMinutes: 75,
          intensity: 8,
          rounds: 6,
          giOrNoGi: 'gi',
          tags: ['guard', 'sweeps']
        }
      },
      '2026-01-01T00:00:00.000Z',
      'entry-123'
    );

    expect(entry).toEqual({
      entryId: 'entry-123',
      athleteId: 'athlete-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sections: {
        private: 'private reflection',
        shared: 'shareable notes'
      },
      sessionMetrics: {
        durationMinutes: 75,
        intensity: 8,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard', 'sweeps']
      }
    });
  });
});
