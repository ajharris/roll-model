import { buildGapInsightsReport, parseGapInsightsThresholds } from './gapInsights';
import type { Checkoff, CheckoffEvidence, GapPriorityOverride } from './types';

describe('gapInsights', () => {
  it('parses default thresholds when query params are absent', () => {
    const parsed = parseGapInsightsThresholds(undefined);
    expect(parsed).toEqual({
      staleDays: 30,
      lookbackDays: 30,
      repeatFailureWindowDays: 30,
      repeatFailureMinCount: 2,
      topN: 10,
    });
  });

  it('builds stale-skill and repeated-failure insights from structured records', () => {
    const entries: Array<Record<string, unknown>> = [
      {
        entityType: 'ENTRY',
        entryId: 'entry-1',
        createdAt: '2026-02-20T10:00:00.000Z',
        structured: { position: 'half guard bottom' },
        actionPackFinal: {
          actionPack: {
            leaks: ['getting flattened'],
          },
        },
      },
      {
        entityType: 'ENTRY',
        entryId: 'entry-2',
        createdAt: '2026-02-22T10:00:00.000Z',
        structured: { position: 'half guard bottom' },
        actionPackFinal: {
          actionPack: {
            leaks: ['getting flattened'],
          },
        },
      },
    ];

    const checkoffs: Checkoff[] = [
      {
        checkoffId: 'knee-cut::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'knee-cut',
        evidenceType: 'hit-in-live-roll',
        status: 'pending',
        minEvidenceRequired: 3,
        confirmedEvidenceCount: 1,
        createdAt: '2025-12-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ];

    const evidence: CheckoffEvidence[] = [
      {
        evidenceId: 'ev-1',
        checkoffId: 'knee-cut::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'knee-cut',
        entryId: 'entry-legacy',
        evidenceType: 'hit-in-live-roll',
        source: 'gpt-structured',
        statement: 'Hit knee cut in rounds.',
        confidence: 'medium',
        mappingStatus: 'confirmed',
        createdAt: '2025-12-20T10:00:00.000Z',
        updatedAt: '2025-12-20T10:00:00.000Z',
      },
    ];

    const priorities: GapPriorityOverride[] = [
      {
        gapId: 'repeated-failure:half-guard-bottom::getting-flattened',
        status: 'accepted',
        manualPriority: 1,
        updatedAt: '2026-02-26T10:00:00.000Z',
        updatedBy: 'coach-1',
        updatedByRole: 'coach',
      },
    ];

    const report = buildGapInsightsReport({
      athleteId: 'athlete-1',
      entries,
      checkoffs,
      evidence,
      priorities,
      thresholds: {
        staleDays: 30,
        lookbackDays: 30,
        repeatFailureWindowDays: 30,
        repeatFailureMinCount: 2,
        topN: 10,
      },
      nowIso: '2026-02-27T00:00:00.000Z',
    });

    expect(report.sections.staleSkills.some((item) => item.skillId === 'knee-cut')).toBe(true);
    expect(report.sections.notTraining.some((item) => item.skillId === 'knee-cut')).toBe(true);
    expect(report.sections.repeatedFailures).toHaveLength(1);
    expect(report.sections.repeatedFailures[0].repeatCount).toBe(2);
    expect(report.weeklyFocus.items[0].gapId).toBe('repeated-failure:half-guard-bottom::getting-flattened');
  });
});
