import { buildProgressViewsReport, parseProgressViewsFilters } from './progressViews';
import type { Checkoff, CheckoffEvidence, Entry, ProgressCoachAnnotation } from './types';

const buildEntry = (
  entryId: string,
  createdAt: string,
  overrides: Partial<Entry> = {}
): Entry => ({
  entryId,
  athleteId: 'athlete-1',
  schemaVersion: 3,
  createdAt,
  updatedAt: createdAt,
  quickAdd: {
    time: createdAt,
    class: 'Comp',
    gym: 'HQ',
    partners: ['P1'],
    rounds: 5,
    notes: ''
  },
  structured: {
    position: 'closed guard',
    outcome: 'escape worked'
  },
  tags: ['guard-type'],
  sections: { private: '', shared: '' },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 7,
    rounds: 5,
    giOrNoGi: 'gi',
    tags: ['competition']
  },
  rawTechniqueMentions: [],
  ...overrides
});

describe('progressViews', () => {
  it('parses filters with context tags', () => {
    expect(
      parseProgressViewsFilters({
        dateFrom: '2026-02-01T00:00:00.000Z',
        dateTo: '2026-02-28T00:00:00.000Z',
        contextTags: 'competition, guard-type',
        giOrNoGi: 'gi'
      })
    ).toEqual({
      dateFrom: '2026-02-01T00:00:00.000Z',
      dateTo: '2026-02-28T00:00:00.000Z',
      contextTags: ['competition', 'guard-type'],
      giOrNoGi: 'gi'
    });
  });

  it('builds timeline, heatmap, and outcome trends from structured records with low-confidence flags', () => {
    const entries: Entry[] = [
      buildEntry('entry-1', '2026-02-20T10:00:00.000Z', {
        structured: { position: 'closed guard', outcome: 'escape success from bottom' },
        actionPackFinal: {
          finalizedAt: '2026-02-20T10:30:00.000Z',
          actionPack: {
            wins: ['Escape from closed guard to top'],
            leaks: ['Guard got passed late'],
            oneFocus: 'Guard retention timing',
            drills: [],
            positionalRequests: ['Closed guard rounds'],
            fallbackDecisionGuidance: 'Recover guard then stand.',
            confidenceFlags: [
              { field: 'leaks', confidence: 'low', note: 'unsure if pass sequence happened twice' },
              { field: 'wins', confidence: 'high' }
            ]
          }
        }
      }),
      buildEntry('entry-2', '2026-02-22T10:00:00.000Z', {
        structured: { position: 'half guard', outcome: 'escape failed under pressure' },
        actionPackDraft: {
          wins: [],
          leaks: ['Failed to retain half guard and got passed'],
          oneFocus: 'Escape under crossface',
          drills: [],
          positionalRequests: ['Half guard rounds'],
          fallbackDecisionGuidance: 'Frame and hip escape.',
          confidenceFlags: [{ field: 'wins', confidence: 'low', note: 'small sample' }]
        }
      })
    ];

    const checkoffs: Checkoff[] = [
      {
        checkoffId: 'closed-guard-retention::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'closed-guard-retention',
        evidenceType: 'hit-in-live-roll',
        status: 'earned',
        minEvidenceRequired: 3,
        confirmedEvidenceCount: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-22T00:00:00.000Z',
        earnedAt: '2026-02-22T00:00:00.000Z'
      }
    ];

    const evidence: CheckoffEvidence[] = [
      {
        evidenceId: 'ev-1',
        checkoffId: 'closed-guard-retention::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'closed-guard-retention',
        entryId: 'entry-1',
        evidenceType: 'hit-in-live-roll',
        source: 'gpt-structured',
        statement: 'Recovered and retained guard.',
        confidence: 'low',
        mappingStatus: 'pending_confirmation',
        createdAt: '2026-02-21T00:00:00.000Z',
        updatedAt: '2026-02-21T00:00:00.000Z'
      }
    ];

    const annotations: ProgressCoachAnnotation[] = [
      {
        annotationId: 'ann-1',
        athleteId: 'athlete-1',
        scope: 'outcome-trend',
        note: 'Retention metric includes situational rounds only.',
        correction: 'Exclude drill-only rounds next pass.',
        createdAt: '2026-02-23T00:00:00.000Z',
        updatedAt: '2026-02-23T00:00:00.000Z',
        createdBy: 'coach-1',
        updatedBy: 'coach-1'
      }
    ];

    const report = buildProgressViewsReport({
      athleteId: 'athlete-1',
      entries,
      checkoffs,
      evidence,
      annotations,
      filters: {
        contextTags: ['competition'],
        giOrNoGi: 'gi'
      },
      generatedAt: '2026-02-24T00:00:00.000Z'
    });

    expect(report.timeline.events).toHaveLength(1);
    expect(report.timeline.events[0].skillId).toBe('closed-guard-retention');
    expect(report.timeline.events[0].lowConfidence).toBe(true);
    expect(report.positionHeatmap.cells.some((cell) => cell.position === 'closed guard')).toBe(true);
    expect(report.positionHeatmap.cells.some((cell) => cell.neglected)).toBe(true);
    expect(report.outcomeTrends.points).toHaveLength(2);
    expect(report.outcomeTrends.points[0].escapesSuccessRate).toBeGreaterThan(0);
    expect(report.outcomeTrends.points[1].guardRetentionFailureRate).toBeGreaterThan(0);
    expect(report.lowConfidenceFlags.length).toBeGreaterThan(0);
    expect(report.coachAnnotations).toHaveLength(1);
    expect(report.sourceSummary.structuredSessions).toBe(2);
  });
});
