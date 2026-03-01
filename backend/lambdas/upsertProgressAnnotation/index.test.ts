import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';
import { recomputeAndPersistProgressViews, resolveProgressAccess } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/progressStore');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockResolveProgressAccess = jest.mocked(resolveProgressAccess);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (annotationId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: annotationId ? { annotationId } : undefined,
    body: JSON.stringify({
      scope: 'outcome-trend',
      targetKey: '2026-02-22',
      note: 'Guard retention trend overweights open mat rounds',
      correction: 'Weight only comp rounds'
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'coach-1',
          'custom:role': 'coach'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('upsertProgressAnnotation handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockResolveProgressAccess.mockReset();
    mockRecomputeAndPersistProgressViews.mockReset();
  });

  it('creates annotation and triggers progress recompute', async () => {
    mockResolveProgressAccess.mockResolvedValueOnce({ athleteId: 'athlete-1', actingAsCoach: true });
    mockGetItem.mockResolvedValueOnce({} as GetCommandOutput);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(201);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockRecomputeAndPersistProgressViews).toHaveBeenCalledWith('athlete-1');
  });

  it('updates annotation when annotationId is provided', async () => {
    mockResolveProgressAccess.mockResolvedValueOnce({ athleteId: 'athlete-1', actingAsCoach: true });
    mockGetItem.mockResolvedValueOnce({
      Item: {
        entityType: 'PROGRESS_ANNOTATION',
        annotationId: 'ann-1',
        athleteId: 'athlete-1',
        scope: 'outcome-trend',
        note: 'Old note',
        createdAt: '2026-02-20T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
        createdBy: 'coach-1',
        updatedBy: 'coach-1'
      }
    } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('ann-1'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { annotation: { annotationId: string } };
    expect(body.annotation.annotationId).toBe('ann-1');
  });
});
