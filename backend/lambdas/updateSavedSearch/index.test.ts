import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (body?: Record<string, unknown>, savedSearchId = 's1'): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: { savedSearchId },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('updateSavedSearch handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('updates an existing saved search', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'USER#user-123',
        SK: 'SAVED_SEARCH#s1',
        entityType: 'SAVED_SEARCH',
        id: 's1',
        userId: 'user-123',
        name: 'Old',
        query: '',
        tag: '',
        giOrNoGi: '',
        minIntensity: '',
        maxIntensity: '',
        sortBy: 'createdAt',
        sortDirection: 'desc',
        createdAt: '2026-02-20T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z'
      }
    } as unknown as GetCommandOutput);

    const result = (await handler(
      buildEvent({
        name: 'Updated dashboard',
        query: 'guard',
        tag: 'open-mat',
        giOrNoGi: 'no-gi',
        minIntensity: '5',
        maxIntensity: '8',
        sortBy: 'intensity',
        sortDirection: 'asc',
        isFavorite: true
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { savedSearch: { id: string; name: string; isFavorite?: boolean } };
    expect(body.savedSearch).toEqual(expect.objectContaining({ id: 's1', name: 'Updated dashboard', isFavorite: true }));
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          PK: 'USER#user-123',
          SK: 'SAVED_SEARCH#s1',
          entityType: 'SAVED_SEARCH'
        })
      })
    );
  });

  it('returns 404 when the saved search does not exist', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(
      buildEvent({
        name: 'Updated dashboard',
        query: '',
        tag: '',
        giOrNoGi: '',
        minIntensity: '',
        maxIntensity: '',
        sortBy: 'createdAt',
        sortDirection: 'desc'
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
