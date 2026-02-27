import { assertNoInvalidCycles, buildProgressAndRecommendations } from './curriculum';
import { ApiError } from './responses';
import type { Checkoff, CheckoffEvidence, Entry, Skill, SkillRelationship } from './types';

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
    updatedAt: nowIso
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
    updatedAt: nowIso
  }
];

const relationships: SkillRelationship[] = [
  {
    fromSkillId: 'closed-guard-retention',
    toSkillId: 'scissor-sweep',
    relation: 'supports',
    createdAt: nowIso,
    updatedAt: nowIso
  }
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
      notes: ''
    },
    tags: ['sweep'],
    sections: { private: '', shared: '' },
    sessionMetrics: {
      durationMinutes: 60,
      intensity: 8,
      rounds: 6,
      giOrNoGi: 'gi',
      tags: ['comp']
    },
    rawTechniqueMentions: [],
    actionPackDraft: {
      wins: ['Closed guard retention held under pressure'],
      leaks: ['Scissor sweep failed due to weak kuzushi'],
      oneFocus: 'Better scissor sweep angle',
      drills: ['Scissor sweep reps'],
      positionalRequests: ['Closed guard rounds'],
      fallbackDecisionGuidance: 'Reset to closed guard frames.',
      confidenceFlags: []
    }
  }
];

describe('curriculum cycle validation', () => {
  it('throws when prerequisite cycle exists', () => {
    expect(() =>
      assertNoInvalidCycles(
        [
          {
            ...skills[0],
            prerequisites: ['scissor-sweep']
          },
          {
            ...skills[1],
            prerequisites: ['closed-guard-retention']
          }
        ],
        []
      )
    ).toThrow(ApiError);
  });

  it('allows non-prerequisite relationships without cycle failure', () => {
    expect(() => assertNoInvalidCycles(skills, relationships)).not.toThrow();
  });
});

describe('buildProgressAndRecommendations', () => {
  it('builds progression and recommendation rationale from evidence and entries', () => {
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
        updatedAt: nowIso
      }
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
        updatedAt: nowIso
      }
    ];

    const result = buildProgressAndRecommendations({
      athleteId: 'athlete-1',
      skills,
      relationships,
      checkoffs,
      evidence,
      entries,
      nowIso
    });

    expect(result.progressions.length).toBe(2);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].rationale.join(' ')).toContain('Evidence');
    expect(result.progressions.find((item) => item.skillId === 'closed-guard-retention')?.sourceEntryIds).toEqual([
      'entry-1'
    ]);
  });
});
