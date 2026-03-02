import {
  buildWeeklyDigestHeuristic,
  evaluateAutomationDue,
  getZonedNow,
  isWithinQuietHours,
  type ZonedNow
} from './automation';
import type { Checkoff, Entry, WeeklyPlan } from './types';

const buildSettings = (overrides?: Partial<Parameters<typeof evaluateAutomationDue>[0]>) => ({
  athleteId: 'athlete-1',
  timezone: 'America/New_York',
  afterClassReminder: {
    enabled: true,
    daysOfWeek: [7],
    localTime: '18:30',
    remindAfterMinutes: 60
  },
  weeklyDigest: {
    enabled: true,
    dayOfWeek: 7,
    localTime: '19:00'
  },
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '07:00'
  },
  updatedAt: '2026-03-01T00:00:00.000Z',
  updatedBy: 'athlete-1',
  ...overrides
});

const buildEntry = (overrides?: Partial<Entry>): Entry => ({
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  schemaVersion: 5,
  createdAt: '2026-03-01T22:30:00.000Z',
  updatedAt: '2026-03-01T22:30:00.000Z',
  quickAdd: {
    time: '2026-03-01T22:30:00.000Z',
    class: 'No-gi',
    gym: 'North',
    partners: ['A'],
    rounds: 5,
    notes: 'notes'
  },
  structured: {
    technique: 'knee cut pass',
    position: 'half guard top'
  },
  tags: ['top'],
  sections: {
    private: '',
    shared: 'shared'
  },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 7,
    rounds: 5,
    giOrNoGi: 'no-gi',
    tags: ['passing']
  },
  rawTechniqueMentions: [],
  actionPackDraft: {
    wins: ['knee cut timing'],
    leaks: ['late underhook'],
    oneFocus: 'head first on entry',
    drills: ['knee cut reps'],
    positionalRequests: ['half guard top'],
    fallbackDecisionGuidance: 'reset frames',
    confidenceFlags: []
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
  createdAt: '2026-02-20T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides
});

const buildPlan = (overrides?: Partial<WeeklyPlan>): WeeklyPlan => ({
  planId: 'plan-1',
  athleteId: 'athlete-1',
  weekOf: '2026-02-23',
  generatedAt: '2026-02-23T00:00:00.000Z',
  updatedAt: '2026-02-23T00:00:00.000Z',
  status: 'active',
  primarySkills: ['knee cut pass'],
  supportingConcept: 'inside control first',
  conditioningConstraint: 'frames before speed',
  drills: [{ id: 'd1', label: 'knee cut reps', status: 'pending' }],
  positionalRounds: [{ id: 'r1', label: 'half guard top', status: 'pending' }],
  constraints: [{ id: 'c1', label: 'nasal breathing', status: 'done' }],
  positionalFocus: {
    cards: [
      {
        id: 'focus-1',
        title: 'Fix: underhook control',
        focusType: 'remediate-weakness',
        priority: 1,
        position: 'half guard top',
        context: 'live rounds',
        successCriteria: ['hit 3 reps'],
        rationale: 'recurring leak',
        linkedOneThingCues: ['head first on entry'],
        recurringFailures: ['late underhook'],
        references: [],
        status: 'pending'
      }
    ],
    locked: false,
    updatedAt: '2026-02-23T00:00:00.000Z'
  },
  explainability: [],
  ...overrides
});

describe('automation scheduling', () => {
  it('computes after-class and weekly digest due state from timezone local time', () => {
    const settings = buildSettings();
    const due = evaluateAutomationDue(settings, '2026-03-02T00:45:00.000Z');

    expect(due.afterClassDue).toBe(true);
    expect(due.weeklyDigestDue).toBe(true);
    expect(due.digestWeekOf).toBe('2026-02-23');
  });

  it('suppresses due signals during quiet hours that span midnight', () => {
    const settings = buildSettings();
    const due = evaluateAutomationDue(settings, '2026-03-02T04:30:00.000Z');

    expect(due.afterClassDue).toBe(false);
    expect(due.weeklyDigestDue).toBe(false);
  });
});

describe('timezone helpers', () => {
  it('resolves local date/time/day-of-week by timezone', () => {
    const zoned = getZonedNow('2026-03-02T01:30:00.000Z', 'America/Los_Angeles');

    expect(zoned.localDate).toBe('2026-03-01');
    expect(zoned.localTime).toBe('17:30');
    expect(zoned.dayOfWeek).toBe(7);
  });

  it('checks quiet hour windows that cross midnight', () => {
    const settings = buildSettings({
      quietHours: {
        enabled: true,
        start: '23:00',
        end: '06:30'
      }
    });

    const zoned: ZonedNow = {
      timezone: 'America/New_York',
      localDate: '2026-03-02',
      localTime: '05:45',
      minuteOfDay: 5 * 60 + 45,
      dayOfWeek: 1
    };

    expect(isWithinQuietHours(zoned, settings)).toBe(true);
  });
});

describe('digest completeness', () => {
  it('produces trained/not-trained/focus outputs from structured records', () => {
    const digest = buildWeeklyDigestHeuristic({
      athleteId: 'athlete-1',
      weekOf: '2026-03-01',
      timezone: 'America/New_York',
      nowIso: '2026-03-02T00:15:00.000Z',
      entries: [buildEntry()],
      checkoffs: [buildCheckoff()],
      weeklyPlans: [buildPlan()]
    });

    expect(digest.trained.length).toBeGreaterThan(0);
    expect(digest.notTrained.length).toBeGreaterThan(0);
    expect(digest.recommendedFocus.length).toBeGreaterThan(0);
    expect(typeof digest.summary).toBe('string');
    expect(digest.generatedBy).toBe('heuristic');
  });
});
