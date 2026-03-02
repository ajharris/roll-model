import { ApiError } from './responses';
import { buildSharedSessionSummary, parseCreateShareLinkRequest, SHARE_PAYLOAD_VERSION } from './sharing';
import type { Entry } from './types';

const entryFixture: Entry = {
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  schemaVersion: 5,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  quickAdd: {
    time: '2026-03-01T10:00:00.000Z',
    class: 'Open mat',
    gym: 'North',
    partners: ['Alex'],
    rounds: 6,
    notes: 'Knee cut rounds',
  },
  structured: {
    position: 'half guard top',
    technique: 'knee cut pass',
    outcome: 'guard pass success',
    cue: 'head first',
  },
  structuredExtraction: {
    generatedAt: '2026-03-01T10:01:00.000Z',
    suggestions: [
      {
        field: 'position',
        value: 'half guard top',
        confidence: 'high',
        status: 'confirmed',
        updatedAt: '2026-03-01T10:02:00.000Z',
      },
    ],
    concepts: ['frames', 'timing'],
    failures: ['kept getting swept when hips were high'],
    conditioningIssues: ['cardio fatigue'],
    confidenceFlags: [],
  },
  tags: ['top'],
  sections: {
    private: 'private detail',
    shared: 'shared detail',
  },
  sessionMetrics: {
    durationMinutes: 75,
    intensity: 8,
    rounds: 6,
    giOrNoGi: 'gi',
    tags: ['competition'],
  },
  sessionContext: {
    ruleset: 'ibjjf',
    fatigueLevel: 7,
    injuryNotes: ['knee sore'],
    tags: ['camp'],
  },
  partnerOutcomes: [
    {
      partnerId: 'partner-1',
      partnerDisplayName: 'Alex',
      styleTags: ['pressure-passer'],
      whatWorked: ['inside position'],
      whatFailed: ['late underhook'],
    },
  ],
  rawTechniqueMentions: ['knee cut'],
  actionPackDraft: {
    wins: ['crossface timing'],
    leaks: ['inside elbow'],
    oneFocus: 'head first',
    drills: ['knee cut reps'],
    positionalRequests: ['half guard top'],
    fallbackDecisionGuidance: 'reset frames',
    confidenceFlags: [],
  },
  sessionReviewDraft: {
    promptSet: {
      whatWorked: ['crossface timing'],
      whatFailed: ['late underhook'],
      whatToAskCoach: ['how to pin near hip?'],
      whatToDrillSolo: ['knee cut entries'],
    },
    oneThing: 'head first',
    confidenceFlags: [],
  },
};

describe('sharing helpers', () => {
  it('excludes partner outcomes by default', () => {
    const parsed = parseCreateShareLinkRequest(JSON.stringify({}), '2026-03-01T12:00:00.000Z');
    const summary = buildSharedSessionSummary({
      shareId: 'share-1',
      athleteId: 'athlete-1',
      generatedAt: '2026-03-01T12:00:00.000Z',
      policy: parsed.policy,
      entries: [entryFixture],
    });

    expect(summary.payloadVersion).toBe(SHARE_PAYLOAD_VERSION);
    expect(summary.scope.visibility).toBe('private');
    expect(summary.scope.includePartnerData).toBe(false);
    expect(summary.highlights[0].partnerOutcomes).toBeUndefined();
  });

  it('includes partner outcomes only when explicitly allowed', () => {
    const parsed = parseCreateShareLinkRequest(
      JSON.stringify({
        includePartnerData: true,
        includeFields: ['partnerOutcomes'],
      }),
      '2026-03-01T12:00:00.000Z'
    );

    const summary = buildSharedSessionSummary({
      shareId: 'share-1',
      athleteId: 'athlete-1',
      generatedAt: '2026-03-01T12:00:00.000Z',
      policy: parsed.policy,
      entries: [entryFixture],
    });

    expect(summary.scope.includePartnerData).toBe(true);
    expect(summary.scope.includeFields).toContain('partnerOutcomes');
    expect(summary.highlights[0].partnerOutcomes).toBeDefined();
  });

  it('enforces coach approval when review is required', () => {
    expect(() =>
      parseCreateShareLinkRequest(
        JSON.stringify({
          requireCoachReview: true,
          coachReview: {
            required: true,
            approved: false,
          },
        }),
        '2026-03-01T12:00:00.000Z'
      )
    ).toThrow(ApiError);
  });

  it('supports scoped summary by date range and skill id', () => {
    const parsed = parseCreateShareLinkRequest(
      JSON.stringify({
        dateFrom: '2026-03-01T00:00:00.000Z',
        dateTo: '2026-03-01T23:59:59.999Z',
        skillId: 'knee cut',
      }),
      '2026-03-01T12:00:00.000Z'
    );

    const summary = buildSharedSessionSummary({
      shareId: 'share-1',
      athleteId: 'athlete-1',
      generatedAt: '2026-03-01T12:00:00.000Z',
      policy: parsed.policy,
      entries: [entryFixture],
    });

    expect(summary.sourceEntryIds).toEqual(['entry-1']);
    expect(summary.scope.dateFrom).toBe('2026-03-01T00:00:00.000Z');
    expect(summary.scope.dateTo).toBe('2026-03-01T23:59:59.999Z');
    expect(summary.scope.skillId).toBe('knee cut');
  });

  it('rejects inverted date range', () => {
    expect(() =>
      parseCreateShareLinkRequest(
        JSON.stringify({
          dateFrom: '2026-03-02T00:00:00.000Z',
          dateTo: '2026-03-01T00:00:00.000Z',
        }),
        '2026-03-01T12:00:00.000Z'
      )
    ).toThrow(ApiError);
  });
});
