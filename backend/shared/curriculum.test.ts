import { assertNoInvalidCycles, buildProgressAndRecommendations } from './curriculum';
import { ApiError } from './responses';
import type { Checkoff, CheckoffEvidence, CurriculumRecommendation, Entry, Skill, SkillRelationship } from './types';

const nowIso = '2026-02-27T00:00:00.000Z';

const skills: Skill[] = [
  {
    skillId: 'closed-guard-retention',
    name: 'Closed Guard Retention',
    category: 'guard-retention',
    stageId: 'white-belt',
    prerequisites: [],
    keyConcepts: ['frames'],
    commonFailures: ['flat hips'],
    drills: ['retention rounds'],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    skillId: 'scissor-sweep',
    name: 'Scissor Sweep',
    category: 'sweep',
    stageId: 'blue-belt',
    prerequisites: ['closed-guard-retention'],
    keyConcepts: ['kuzushi'],
    commonFailures: ['no angle'],
    drills: ['kuzushi reps'],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
];

const relationships: SkillRelationship[] = [
  {
    fromSkillId: 'closed-guard-retention',
    toSkillId: 'scissor-sweep',
    relation: 'supports',
    createdAt: nowIso,
    updatedAt: nowIso,
  },
];

const entries: Entry[] = [
  {
    entryId: 'entry-1',
    athleteId: 'athlete-1',
    schemaVersion: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    quickAdd: {
      time: nowIso,
      class: 'Comp class',
      gym: 'HQ',
      partners: ['A'],
      rounds: 6,
      notes: '',
    },
    tags: ['sweep'],
    sections: { private: '', shared: '' },
    sessionMetrics: {
      durationMinutes: 60,
      intensity: 8,
      rounds: 6,
      giOrNoGi: 'gi',
      tags: ['comp'],
    },
    rawTechniqueMentions: [],
    actionPackDraft: {
      wins: ['Closed guard retention held under pressure'],
      leaks: ['Flat hips while trying closed guard retention'],
      oneFocus: 'Better scissor sweep angle',
      drills: ['Scissor sweep reps'],
      positionalRequests: ['Closed guard rounds'],
      fallbackDecisionGuidance: 'Reset to closed guard frames.',
      confidenceFlags: [],
    },
  },
];

describe('curriculum cycle validation', () => {
  it('throws when prerequisite cycle exists', () => {
    expect(() =>
      assertNoInvalidCycles(
        [
          {
            ...skills[0],
            prerequisites: ['scissor-sweep'],
          },
          {
            ...skills[1],
            prerequisites: ['closed-guard-retention'],
          },
        ],
        [],
      ),
    ).toThrow(ApiError);
  });

  it('allows non-prerequisite relationships without cycle failure', () => {
    expect(() => assertNoInvalidCycles(skills, relationships)).not.toThrow();
  });
});

describe('buildProgressAndRecommendations', () => {
  it('builds explainable, minimal recommendations from failures and curriculum dependencies', () => {
    const checkoffs: Checkoff[] = [
      {
        checkoffId: 'closed-guard-retention::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'closed-guard-retention',
        evidenceType: 'hit-in-live-roll',
        status: 'pending',
        minEvidenceRequired: 3,
        confirmedEvidenceCount: 2,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];

    const evidence: CheckoffEvidence[] = [
      {
        evidenceId: 'e1',
        checkoffId: 'closed-guard-retention::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'closed-guard-retention',
        entryId: 'entry-1',
        evidenceType: 'hit-in-live-roll',
        source: 'gpt-structured',
        statement: 'Recovered closed guard and kept posture broken.',
        confidence: 'medium',
        mappingStatus: 'confirmed',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];

    const result = buildProgressAndRecommendations({
      athleteId: 'athlete-1',
      skills,
      relationships,
      checkoffs,
      evidence,
      entries,
      nowIso,
    });

    expect(result.progressions.length).toBe(2);
    expect(result.recommendations.length).toBeGreaterThan(0);
    const topRecommendation = result.recommendations[0];
    expect(topRecommendation.actionType).toBe('drill');
    expect(topRecommendation.rationale).toContain('recurring failure');
    expect(topRecommendation.sourceEvidence.length).toBeGreaterThan(0);
    expect(topRecommendation.whyNow).toContain('Recent entries');
    expect(topRecommendation.expectedImpact).toContain('Low-effort reps');
  });

  it('reuses persisted trend context and preserves active coach-edited recommendation', () => {
    const existingRecommendations: CurriculumRecommendation[] = [
      {
        athleteId: 'athlete-1',
        recommendationId: 'closed-guard-retention:drill:retention-rounds',
        skillId: 'closed-guard-retention',
        sourceSkillId: 'closed-guard-retention',
        actionType: 'drill',
        actionTitle: 'Retain with collar tie start',
        actionDetail: 'Coach-customized drill prescription.',
        status: 'active',
        relevanceScore: 80,
        impactScore: 70,
        effortScore: 20,
        score: 65,
        rationale: 'Coach override rationale.',
        whyNow: 'Historical.',
        expectedImpact: 'High.',
        sourceEvidence: [],
        supportingNextSkillIds: ['scissor-sweep'],
        missingPrerequisiteSkillIds: [],
        generatedAt: nowIso,
        updatedAt: nowIso,
        approvedBy: 'coach-1',
        approvedAt: nowIso,
        coachNote: 'Use this in next two sessions.',
        createdByRole: 'coach',
      },
    ];

    const result = buildProgressAndRecommendations({
      athleteId: 'athlete-1',
      skills,
      relationships,
      checkoffs: [],
      evidence: [],
      entries,
      progressViews: {
        athleteId: 'athlete-1',
        generatedAt: nowIso,
        filters: {
          contextTags: [],
        },
        timeline: { events: [], cumulative: [] },
        positionHeatmap: {
          cells: [
            {
              position: 'closed guard',
              trainedCount: 1,
              lowConfidenceCount: 0,
              neglected: true,
              lastSeenAt: nowIso,
            },
          ],
          maxTrainedCount: 1,
          neglectedThreshold: 1,
        },
        outcomeTrends: {
          points: [
            {
              date: '2026-02-27',
              escapesSuccessRate: 0.35,
              guardRetentionFailureRate: 0.6,
              escapesSuccesses: 1,
              escapeAttempts: 3,
              guardRetentionFailures: 3,
              guardRetentionObservations: 5,
              lowConfidenceCount: 0,
            },
          ],
        },
        lowConfidenceFlags: [],
        coachAnnotations: [],
        sourceSummary: {
          sessionsConsidered: 2,
          structuredSessions: 2,
          checkoffsConsidered: 0,
        },
      },
      existingRecommendations,
      nowIso,
    });

    expect(result.recommendations.some((item) => item.sourceEvidence.some((evidenceItem) => evidenceItem.excerpt.includes('Guard retention failure trend')))).toBe(true);
    const kept = result.recommendations.find((item) => item.recommendationId === 'closed-guard-retention:drill:retention-rounds');
    expect(kept?.actionTitle).toBe('Retain with collar tie start');
    expect(kept?.status).toBe('active');
    expect(kept?.approvedBy).toBe('coach-1');
  });
});
