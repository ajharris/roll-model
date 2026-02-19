import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';

import { handler } from './index';
import { getItem, queryItems } from '../../shared/db';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('getEntries handler auth', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('returns shared-only sections for coach', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1' }
    } as unknown as GetCommandOutput);
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          sections: { shared: 'shared notes', private: 'private notes' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          }
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { entries: Array<{ sections: { shared: string } }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].sections).toEqual({ shared: 'shared notes' });
    expect(body.entries[0].sections).not.toHaveProperty('private');
  });

  it('rejects coaches without a link', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
