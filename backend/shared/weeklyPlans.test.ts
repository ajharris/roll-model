import type { Checkoff, CurriculumGraph, Entry, WeeklyPlan } from './types';
import { buildWeeklyPlanFromSignals } from './weeklyPlans';

const buildEntry = (overrides?: Partial<Entry>): Entry => ({
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  schemaVersion: 3,
  createdAt: '2026-02-20T00:00:00.000Z',
  updatedAt: '2026-02-20T00:00:00.000Z',
  quickAdd: {
    time: '2026-02-20T00:00:00.000Z',
    class: 'No-gi',
    gym: 'North',
    partners: ['A'],
    rounds: 5,
    notes: 'notes'
  },
  tags: ['top'],
  sections: {
    private: 'private',
    shared: 'shared'
  },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 7,
    rounds: 5,
    giOrNoGi: 'no-gi',
    tags: ['top']
  },
  rawTechniqueMentions: [],
  actionPackFinal: {
    actionPack: {
      wins: ['knee cut pass timing improved'],
      leaks: ['late underhook in knee cut pass'],
      oneFocus: 'win head position first',
      drills: ['knee cut reps from half guard'],
      positionalRequests: ['half guard top'],
      fallbackDecisionGuidance: 'recover frames and reset',
      confidenceFlags: []
    },
    finalizedAt: '2026-02-20T00:00:00.000Z'
  },
  ...overrides
});

const buildCheckoff = (overrides?: Partial<Checkoff>): Checkoff => ({
  checkoffId: 'knee-cut::hit-in-live-roll',
  athleteId: 'athlete-1',
  skillId: 'knee-cut',
  evidenceType: 'hit-in-live-roll',
  status: 'pending',
  minEvidenceRequired: 3,
  confirmedEvidenceCount: 1,
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-21T00:00:00.000Z',
  ...overrides
});

const buildGraph = (): CurriculumGraph => ({
  athleteId: 'athlete-1',
  graphId: 'active',
  version: 1,
  updatedAt: '2026-02-21T00:00:00.000Z',
  nodes: [
    {
      skillId: 'knee-cut',
      label: 'Knee Cut Pass',
      priority: 3,
      supportingConcepts: ['inside control before hip switch'],
      conditioningConstraints: ['frames first before speed']
    }
  ],
  edges: []
});

describe('buildWeeklyPlanFromSignals', () => {
  it('prioritizes leaks/checkoffs/curriculum and emits explainability', () => {
    const plan = buildWeeklyPlanFromSignals({
      entries: [buildEntry()],
      checkoffs: [buildCheckoff()],
      curriculumGraph: buildGraph(),
      priorPlans: [],
      weekOf: '2026-02-25',
      nowIso: '2026-02-27T00:00:00.000Z'
    });

    expect(plan.primarySkills[0].toLowerCase()).toContain('knee');
    expect(plan.supportingConcept).toContain('inside control');
    expect(plan.conditioningConstraint).toContain('frames first');
    expect(plan.drills.length).toBeGreaterThan(0);
    expect(plan.positionalRounds.length).toBeGreaterThan(0);
    expect(plan.constraints.length).toBeGreaterThan(0);

    const primaryExplain = plan.explainability.find((item) => item.selectionType === 'primary-skill');
    expect(primaryExplain).toBeDefined();
    expect(primaryExplain?.references.length).toBeGreaterThan(0);
  });

  it('reuses prior weekly plan outcomes to keep incomplete skills in focus', () => {
    const priorPlan: WeeklyPlan = {
      planId: 'plan-1',
      athleteId: 'athlete-1',
      weekOf: '2026-02-17',
      generatedAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
      status: 'active',
      primarySkills: ['knee-cut'],
      supportingConcept: 'x',
      conditioningConstraint: 'y',
      drills: [{ id: 'drill-1', label: 'd', status: 'pending' }],
      positionalRounds: [{ id: 'round-1', label: 'r', status: 'done' }],
      constraints: [{ id: 'constraint-1', label: 'c', status: 'done' }],
      explainability: []
    };

    const plan = buildWeeklyPlanFromSignals({
      entries: [buildEntry({ actionPackFinal: undefined, actionPackDraft: undefined })],
      checkoffs: [],
      curriculumGraph: null,
      priorPlans: [priorPlan],
      weekOf: '2026-02-25',
      nowIso: '2026-02-27T00:00:00.000Z'
    });

    expect(plan.primarySkills.join(' ').toLowerCase()).toContain('knee');
    const hasPriorRef = plan.explainability.some((item) =>
      item.references.some((reference) => reference.sourceType === 'weekly-plan' && reference.sourceId === 'plan-1')
    );
    expect(hasPriorRef).toBe(true);
  });
});
