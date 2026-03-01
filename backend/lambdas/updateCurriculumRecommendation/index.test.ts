import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { resolveCurriculumAccess } from '../../shared/curriculumStore';
import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/curriculumStore');
jest.mock('../../shared/db');

const mockResolveCurriculumAccess = jest.mocked(resolveCurriculumAccess);
const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (body: unknown): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    pathParameters: {
      recommendationId: 'closed-guard:drill:wall-walks',
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'coach-1',
          'custom:role': 'coach',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('updateCurriculumRecommendation handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockResolveCurriculumAccess.mockResolvedValue({ athleteId: 'athlete-1', actingAsCoach: true });
    mockGetItem.mockResolvedValue({
      Item: {
        entityType: 'CURRICULUM_RECOMMENDATION',
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
    } as never);
  });

  it('marks recommendation active and stores approval metadata', async () => {
    const result = (await handler(
      buildEvent({ recommendation: { status: 'active', coachNote: 'Start this next class.' } }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      recommendation: { status: string; approvedBy: string; coachNote: string };
    };
    expect(body.recommendation.status).toBe('active');
    expect(body.recommendation.approvedBy).toBe('coach-1');
    expect(body.recommendation.coachNote).toBe('Start this next class.');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  it('returns not found when recommendation record does not exist', async () => {
    mockGetItem.mockResolvedValueOnce({} as never);

    const result = (await handler(
      buildEvent({ recommendation: { status: 'dismissed' } }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
  });
});
