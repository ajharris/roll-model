import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { buildProgressAndRecommendations } from '../../shared/curriculum';
import { listCurriculumSnapshot, listProgressSignals, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { batchWriteItems } from '../../shared/db';
import { listPersistedProgressViews } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/curriculum');
jest.mock('../../shared/curriculumStore');
jest.mock('../../shared/db');
jest.mock('../../shared/progressStore');

const mockBuildProgressAndRecommendations = jest.mocked(buildProgressAndRecommendations);
const mockListCurriculumSnapshot = jest.mocked(listCurriculumSnapshot);
const mockListProgressSignals = jest.mocked(listProgressSignals);
const mockResolveCurriculumAccess = jest.mocked(resolveCurriculumAccess);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockListPersistedProgressViews = jest.mocked(listPersistedProgressViews);

const buildEvent = (refresh?: string): APIGatewayProxyEvent =>
  ({
    queryStringParameters: refresh ? { refresh } : undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('listCurriculumRecommendations handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    mockResolveCurriculumAccess.mockResolvedValue({ athleteId: 'athlete-1', actingAsCoach: false });
    mockListCurriculumSnapshot.mockResolvedValue({
      stages: [],
      skills: [],
      relationships: [],
      progressions: [],
      recommendations: [
        {
          athleteId: 'athlete-1',
          recommendationId: 'closed-guard:drill:wall-walks',
          skillId: 'closed-guard',
          sourceSkillId: 'closed-guard',
          actionType: 'drill',
          actionTitle: 'Wall walks',
          actionDetail: 'Short drill set',
          status: 'draft',
          relevanceScore: 80,
          impactScore: 75,
          effortScore: 20,
          score: 70,
          rationale: 'Recurring guard collapse.',
          whyNow: 'Recent failures.',
          expectedImpact: 'Reduce failures quickly.',
          sourceEvidence: [],
          supportingNextSkillIds: ['scissor-sweep'],
          missingPrerequisiteSkillIds: [],
          generatedAt: '2026-02-28T00:00:00.000Z',
          updatedAt: '2026-02-28T00:00:00.000Z',
          createdByRole: 'system',
        },
      ],
    });
  });

  it('returns persisted recommendations when refresh=false', async () => {
    const result = (await handler(buildEvent('false'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { recommendations: Array<{ recommendationId: string }> };
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].recommendationId).toBe('closed-guard:drill:wall-walks');
    expect(mockBuildProgressAndRecommendations).not.toHaveBeenCalled();
    expect(mockBatchWriteItems).not.toHaveBeenCalled();
  });

  it('recomputes and persists when refresh is omitted', async () => {
    mockListProgressSignals.mockResolvedValue({ checkoffs: [], evidence: [], entries: [] });
    mockListPersistedProgressViews.mockResolvedValue(null);
    mockBuildProgressAndRecommendations.mockReturnValue({
      progressions: [],
      recommendations: [
        {
          athleteId: 'athlete-1',
          recommendationId: 'half-guard:drill:knee-shield-pummels',
          skillId: 'half-guard',
          sourceSkillId: 'half-guard',
          actionType: 'drill',
          actionTitle: 'Knee shield pummels',
          actionDetail: '2x3 min rounds',
          status: 'draft',
          relevanceScore: 77,
          impactScore: 72,
          effortScore: 24,
          score: 66,
          rationale: 'Recurring underhook loss.',
          whyNow: 'Failure pattern is recent.',
          expectedImpact: 'Stabilize half guard entries.',
          sourceEvidence: [],
          supportingNextSkillIds: ['dogfight-sweep'],
          missingPrerequisiteSkillIds: [],
          generatedAt: '2026-02-28T00:00:00.000Z',
          updatedAt: '2026-02-28T00:00:00.000Z',
          createdByRole: 'system',
        },
      ],
    });

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { recommendations: Array<{ recommendationId: string }> };
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].recommendationId).toBe('half-guard:drill:knee-shield-pummels');
    expect(mockBuildProgressAndRecommendations).toHaveBeenCalledTimes(1);
    expect(mockBatchWriteItems).toHaveBeenCalledTimes(1);
  });
});
