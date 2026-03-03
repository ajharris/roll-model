import {
  inferIntegrationContextForEntry,
  mergeConfirmedIntegrationTags,
  normalizeIntegrationSignalImport
} from './integrations';

describe('integrations', () => {
  it('normalizes calendar imports into deterministic tags', () => {
    const normalized = normalizeIntegrationSignalImport(
      'athlete-1',
      {
        provider: 'calendar',
        title: 'No-Gi Fundamentals',
        occurredAt: '2026-03-01T18:00:00.000Z',
        tags: ['Evening Class', 'Fundamentals']
      },
      '2026-03-01T20:00:00.000Z'
    );

    expect(normalized.record?.provider).toBe('calendar');
    expect(normalized.record?.normalizedTags).toEqual(
      expect.arrayContaining(['no-gi', 'fundamentals', 'evening-class'])
    );
  });

  it('merges confirmed integration tags into session metrics/context', () => {
    const merged = mergeConfirmedIntegrationTags({
      quickAdd: {
        time: '2026-03-01T18:00:00.000Z',
        class: 'Class',
        gym: 'Gym',
        partners: [],
        rounds: 5,
        notes: 'notes'
      },
      tags: ['top' as const],
      sections: { private: '', shared: '' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 6,
        rounds: 5,
        giOrNoGi: 'gi',
        tags: ['class']
      },
      sessionContext: {
        injuryNotes: [],
        tags: ['ibjjf']
      },
      integrationContext: {
        inferredTags: [],
        confirmedTags: ['fundamentals', 'trained-today'],
        sourceSignalIds: [],
        updatedAt: '2026-03-01T19:00:00.000Z'
      }
    });

    expect(merged.sessionMetrics.tags).toEqual(expect.arrayContaining(['class', 'fundamentals', 'trained-today']));
    expect(merged.sessionContext?.tags).toEqual(expect.arrayContaining(['ibjjf', 'fundamentals', 'trained-today']));
  });

  it('builds inferred context and preserves prior overrides', () => {
    const inferred = inferIntegrationContextForEntry(
      {
        quickAdd: {
          time: '2026-03-01T18:30:00.000Z'
        },
        integrationContext: {
          inferredTags: [
            {
              inferenceId: 'calendar:event-1:fundamentals',
              provider: 'calendar',
              tag: 'fundamentals',
              confidence: 'high',
              status: 'overridden',
              overriddenTag: 'competition-class',
              inferredFromSignalId: 'calendar:event-1',
              inferredAt: '2026-03-01T18:40:00.000Z'
            }
          ],
          confirmedTags: ['competition-class'],
          sourceSignalIds: ['calendar:event-1'],
          updatedAt: '2026-03-01T18:40:00.000Z'
        }
      },
      [
        {
          signalId: 'calendar:event-1',
          athleteId: 'athlete-1',
          provider: 'calendar',
          externalId: 'event-1',
          occurredAt: '2026-03-01T18:00:00.000Z',
          capturedAt: '2026-03-01T17:50:00.000Z',
          normalizedTags: ['fundamentals'],
          title: 'Fundamentals'
        }
      ],
      '2026-03-01T19:00:00.000Z'
    );

    expect(inferred?.confirmedTags).toContain('competition-class');
    expect(inferred?.inferredTags[0]?.status).toBe('overridden');
  });
});
