import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { getCurriculumVersionState } from '../../shared/curriculumVersioning';
import { listMigrationRuns } from '../../shared/migrationStore';

import { handler } from './index';

jest.mock('../../shared/curriculumStore');
jest.mock('../../shared/curriculumVersioning');
jest.mock('../../shared/migrationStore');

const mockListCurriculumSnapshot = jest.mocked(listCurriculumSnapshot);
const mockResolveCurriculumAccess = jest.mocked(resolveCurriculumAccess);
const mockGetCurriculumVersionState = jest.mocked(getCurriculumVersionState);
const mockListMigrationRuns = jest.mocked(listMigrationRuns);

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('listCurriculum handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    mockResolveCurriculumAccess.mockResolvedValue({ athleteId: 'athlete-1', actingAsCoach: false });
    mockListCurriculumSnapshot.mockResolvedValue({
      stages: [],
      skills: [],
      relationships: [],
      progressions: [],
      recommendations: []
    });
    mockGetCurriculumVersionState.mockResolvedValue({
      athleteId: 'athlete-1',
      version: 1,
      status: 'active',
      activatedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
      updatedBy: 'system'
    });
  });

  it('returns curriculum version state and most recent migration runs', async () => {
    mockListMigrationRuns.mockResolvedValue(
      Array.from({ length: 12 }).map((_, index) => ({
        runId: `run-${index + 1}`,
        athleteId: 'athlete-1',
        scope: 'curriculum-version' as const,
        status: 'succeeded' as const,
        sourceVersion: 1,
        targetVersion: 1,
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        startedBy: 'coach-1',
        retries: 0,
        attempts: []
      }))
    );

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      athleteId: string;
      curriculumVersion: { version: number; status: string };
      migrationRuns: Array<{ runId: string }>;
    };

    expect(body.athleteId).toBe('athlete-1');
    expect(body.curriculumVersion.version).toBe(1);
    expect(body.curriculumVersion.status).toBe('active');
    expect(body.migrationRuns).toHaveLength(10);
    expect(body.migrationRuns[0].runId).toBe('run-1');

    expect(mockListMigrationRuns).toHaveBeenCalledWith('athlete-1', 'curriculum-version');
  });
});
