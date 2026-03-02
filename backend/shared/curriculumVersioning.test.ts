import {
  assertCurriculumCompatibility,
  CURRENT_CURRICULUM_VERSION,
  getCurriculumVersionState,
  runCurriculumVersionedMutation
} from './curriculumVersioning';
import { getItem, putItem } from './db';
import { markMigrationRunRetry, markMigrationRunStatus, startMigrationRun } from './migrationStore';
import type { CurriculumRecommendation, Entry, MigrationRunRecord } from './types';

jest.mock('./db');
jest.mock('./migrationStore');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockStartMigrationRun = jest.mocked(startMigrationRun);
const mockMarkMigrationRunStatus = jest.mocked(markMigrationRunStatus);
const mockMarkMigrationRunRetry = jest.mocked(markMigrationRunRetry);

const entry = (overrides?: Partial<Entry>): Entry => ({
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  schemaVersion: 5,
  createdAt: '2026-03-02T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
  quickAdd: {
    time: '2026-03-02T00:00:00.000Z',
    class: 'Class',
    gym: 'Gym',
    partners: [],
    rounds: 5,
    notes: ''
  },
  tags: [],
  sections: { private: '', shared: '' },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 6,
    rounds: 5,
    giOrNoGi: 'gi',
    tags: []
  },
  rawTechniqueMentions: [],
  ...overrides
});

const recommendation = (overrides?: Partial<CurriculumRecommendation>): CurriculumRecommendation => ({
  athleteId: 'athlete-1',
  recommendationId: 'rec-1',
  skillId: 'skill-1',
  sourceSkillId: 'skill-1',
  actionType: 'drill',
  actionTitle: 'Do reps',
  actionDetail: 'Details',
  status: 'draft',
  relevanceScore: 50,
  impactScore: 50,
  effortScore: 30,
  score: 40,
  rationale: 'Rationale',
  whyNow: 'Why now',
  expectedImpact: 'Impact',
  sourceEvidence: [{ entryId: 'entry-1', excerpt: 'evidence', signalType: 'failure-pattern' }],
  supportingNextSkillIds: [],
  missingPrerequisiteSkillIds: [],
  generatedAt: '2026-03-02T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
  ...overrides
});

describe('curriculum compatibility', () => {
  it('accepts compatible entries and recommendations', () => {
    expect(() =>
      assertCurriculumCompatibility({
        curriculumVersion: CURRENT_CURRICULUM_VERSION,
        entries: [entry()],
        recommendations: [recommendation()]
      })
    ).not.toThrow();
  });

  it('rejects incompatible recommendation payloads', () => {
    expect(() =>
      assertCurriculumCompatibility({
        curriculumVersion: CURRENT_CURRICULUM_VERSION,
        entries: [entry()],
        recommendations: [recommendation({ sourceEvidence: [] })]
      })
    ).toThrow('missing sourceEvidence');
  });
});

describe('curriculum rollout state', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockStartMigrationRun.mockReset();
    mockMarkMigrationRunStatus.mockReset();
    mockMarkMigrationRunRetry.mockReset();
  });

  it('returns default active curriculum version state when no row exists', async () => {
    mockGetItem.mockResolvedValue({} as never);
    const state = await getCurriculumVersionState('athlete-1');
    expect(state.version).toBe(CURRENT_CURRICULUM_VERSION);
    expect(state.status).toBe('active');
  });

  it('records failed rollout with retry metadata when mutation keeps failing', async () => {
    const run: MigrationRunRecord = {
      runId: 'run-1',
      athleteId: 'athlete-1',
      scope: 'curriculum-version',
      status: 'running',
      sourceVersion: 1,
      targetVersion: 1,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
      startedBy: 'coach-1',
      retries: 0,
      attempts: [{ attempt: 1, status: 'running', startedAt: '2026-03-02T00:00:00.000Z' }]
    };
    mockStartMigrationRun.mockResolvedValue(run);
    mockMarkMigrationRunStatus.mockImplementation(async ({ record, status, errorMessage }) => ({
      ...record,
      status,
      ...(errorMessage ? { lastErrorMessage: errorMessage } : {})
    }));
    mockMarkMigrationRunRetry.mockImplementation(async ({ record }) => ({
      ...record,
      retries: record.retries + 1
    }));
    mockGetItem.mockResolvedValue({
      Item: {
        entityType: 'CURRICULUM_VERSION',
        athleteId: 'athlete-1',
        version: 1,
        status: 'active',
        activatedAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        updatedBy: 'system'
      }
    } as never);

    await expect(
      runCurriculumVersionedMutation({
        athleteId: 'athlete-1',
        startedBy: 'coach-1',
        sourceVersion: 1,
        execute: async () => {
          throw new Error('boom');
        }
      })
    ).rejects.toThrow('boom');

    expect(mockStartMigrationRun).toHaveBeenCalledTimes(1);
    expect(mockMarkMigrationRunRetry).toHaveBeenCalledTimes(1);
    expect(mockMarkMigrationRunStatus).toHaveBeenCalledTimes(2);
    expect(mockPutItem).toHaveBeenCalled();
  });
});
