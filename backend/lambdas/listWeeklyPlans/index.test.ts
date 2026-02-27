import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'coach' ? 'coach-1' : 'athlete-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('listWeeklyPlans handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('returns weekly plans for athlete', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          entityType: 'WEEKLY_PLAN',
          planId: 'plan-1',
          athleteId: 'athlete-1',
          weekOf: '2026-02-24',
          generatedAt: '2026-02-24T00:00:00.000Z',
          updatedAt: '2026-02-24T00:00:00.000Z',
          status: 'active',
          primarySkills: ['knee cut'],
          supportingConcept: 'head first',
          conditioningConstraint: 'frames first',
          drills: [{ id: 'drill-1', label: 'x', status: 'pending' }],
          positionalRounds: [],
          constraints: [],
          explainability: []
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { plans: Array<{ planId: string }> };
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].planId).toBe('plan-1');
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
  });
});
