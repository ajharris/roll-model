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
      drills: [{ id: 'drill-1', status: 'done' }],
      positionalFocusCards: [{ id: 'focus-1', priority: 1, coachNote: 'stay disciplined' }]
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
  positionalFocus: {
    cards: [
      {
        id: 'focus-1',
        title: 'Fix: lose underhook in half guard top',
        focusType: 'remediate-weakness',
        priority: 1,
        position: 'half guard top',
        context: 'no-gi',
        successCriteria: ['run 4 rounds'],
        rationale: 'recurring failure',
        linkedOneThingCues: ['head first'],
        recurringFailures: ['lose underhook'],
        references: [],
        status: 'pending'
      }
    ],
    locked: false,
    updatedAt: '2026-02-24T00:00:00.000Z'
  },
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

  it('locks positional focus for athlete and blocks later priority edits', async () => {
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

    const lockEvent = {
      ...buildEvent('athlete'),
      body: JSON.stringify({ lockPositionalFocus: true })
    } as APIGatewayProxyEvent;
    const lockResult = (await handler(lockEvent, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(lockResult.statusCode).toBe(200);
    const persistedLocked = (mockPutItem.mock.calls[0]?.[0] as { Item?: Record<string, unknown> })?.Item;
    expect((persistedLocked?.positionalFocus as { locked?: boolean })?.locked).toBe(true);

    mockPutItem.mockClear();
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          entityType: 'WEEKLY_PLAN_META',
          athleteId: 'athlete-1',
          weekOf: '2026-02-24',
          createdAt: '2026-02-24T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          ...weeklyPlanRow,
          positionalFocus: {
            ...weeklyPlanRow.positionalFocus,
            locked: true,
            lockedAt: '2026-02-25T00:00:00.000Z',
            lockedBy: 'athlete-1'
          }
        }
      } as unknown as GetCommandOutput);

    const editAfterLockEvent = {
      ...buildEvent('athlete'),
      body: JSON.stringify({
        positionalFocusCards: [{ id: 'focus-1', priority: 2 }]
      })
    } as APIGatewayProxyEvent;
    const editAfterLockResult = (await handler(editAfterLockEvent, {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(editAfterLockResult.statusCode).toBe(400);
  });
});
