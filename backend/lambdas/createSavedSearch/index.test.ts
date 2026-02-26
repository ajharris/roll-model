import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockPutItem = jest.mocked(putItem);

const buildEvent = (
  role: 'athlete' | 'coach',
  body?: Record<string, unknown>
): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('createSavedSearch handler', () => {
  beforeEach(() => {
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('creates a saved search for athletes', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        name: 'High intensity',
        query: 'guard',
        tag: 'competition',
        giOrNoGi: 'gi',
        minIntensity: '7',
        maxIntensity: '',
        sortBy: 'intensity',
        sortDirection: 'desc',
        isPinned: true
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { savedSearch: { userId: string; id: string; isPinned?: boolean } };
    expect(body.savedSearch.userId).toBe('user-123');
    expect(body.savedSearch.id).toBeTruthy();
    expect(body.savedSearch.isPinned).toBe(true);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'SAVED_SEARCH',
          PK: 'USER#user-123'
        })
      })
    );
  });

  it('rejects invalid payloads', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        name: '',
        query: 'x'
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('rejects coaches', async () => {
    const result = (await handler(
      buildEvent('coach', {
        name: 'Nope',
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

    expect(result.statusCode).toBe(403);
  });
});
