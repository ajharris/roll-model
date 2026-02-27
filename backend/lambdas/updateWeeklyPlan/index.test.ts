import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: {
      ...(athleteId ? { athleteId } : {}),
      planId: 'plan-1'
    },
    body: JSON.stringify({
      status: 'completed',
      completionNotes: 'better under pressure',
      coachReviewNote: 'tighten head position',
      drills: [{ id: 'drill-1', status: 'done' }]
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'coach' ? 'coach-1' : 'athlete-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const weeklyPlanRow = {
  entityType: 'WEEKLY_PLAN',
  planId: 'plan-1',
  athleteId: 'athlete-1',
  weekOf: '2026-02-24',
  generatedAt: '2026-02-24T00:00:00.000Z',
  updatedAt: '2026-02-24T00:00:00.000Z',
  status: 'active',
  primarySkills: ['knee cut'],
  supportingConcept: 'x',
  conditioningConstraint: 'y',
  drills: [{ id: 'drill-1', label: 'd', status: 'pending' }],
  positionalRounds: [{ id: 'round-1', label: 'r', status: 'pending' }],
  constraints: [{ id: 'constraint-1', label: 'c', status: 'pending' }],
  explainability: []
};

describe('updateWeeklyPlan handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('allows athlete to update completion and menu statuses', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          entityType: 'WEEKLY_PLAN_META',
          athleteId: 'athlete-1',
          weekOf: '2026-02-24',
          createdAt: '2026-02-24T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({ Item: weeklyPlanRow } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledTimes(2);
    expect(mockPutItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Item: expect.objectContaining({
          status: 'completed',
          completion: expect.objectContaining({
            outcomeNotes: 'better under pressure'
          })
        })
      })
    );
  });

  it('rejects coach update when not linked', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
