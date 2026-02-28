import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    body: JSON.stringify({ weekOf: '2026-02-24' }),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'coach' ? 'coach-1' : 'athlete-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('buildWeeklyPlan handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('builds and stores a weekly plan for athlete', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [
          {
            entityType: 'ENTRY',
            entryId: 'entry-1',
            athleteId: 'athlete-1',
            schemaVersion: 3,
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-20T00:00:00.000Z',
            quickAdd: { time: '', class: '', gym: '', partners: [], rounds: 0, notes: '' },
            tags: [],
            sections: { private: '', shared: '' },
            sessionMetrics: { durationMinutes: 60, intensity: 7, rounds: 5, giOrNoGi: 'no-gi', tags: [] },
            rawTechniqueMentions: [],
            actionPackDraft: {
              wins: ['hit knee cut'],
              leaks: ['lost underhook on knee cut'],
              oneFocus: 'head first',
              drills: ['knee cut reps'],
              positionalRequests: ['half guard top'],
              fallbackDecisionGuidance: 'recover guard',
              confidenceFlags: []
            }
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({ Items: [] } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({ Items: [] } as unknown as QueryCommandOutput);

    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    expect(mockPutItem).toHaveBeenCalledTimes(2);
    expect(mockPutItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'WEEKLY_PLAN',
          athleteId: 'athlete-1',
          positionalFocus: expect.objectContaining({
            cards: expect.any(Array),
            locked: false
          })
        })
      })
    );
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockQueryItems).not.toHaveBeenCalled();
  });
});
