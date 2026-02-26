import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem } from '../../shared/db';
import { CURRENT_ENTRY_SCHEMA_VERSION } from '../../shared/entries';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);

const buildEvent = (role: 'athlete' | 'coach', entryId = 'entry-1'): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId },
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('getEntry handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
  });

  it('returns an athlete entry', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Alex'],
            rounds: 5,
            notes: 'shared'
          },
          tags: ['guard-type'],
          sections: { shared: 'shared', private: 'private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 6,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: ['guard']
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { entry: { entryId: string; tags: string[] } };
    expect(body.entry.entryId).toBe('entry-1');
    expect(body.entry.tags).toEqual(['guard-type']);
  });

  it('migrates legacy entries without schemaVersion on read', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          sections: { shared: 'shared', private: 'private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 6,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: ['guard']
          }
        }
      } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { entry: { schemaVersion: number; rawTechniqueMentions: string[] } };
    expect(body.entry.schemaVersion).toBe(CURRENT_ENTRY_SCHEMA_VERSION);
    expect(body.entry.rawTechniqueMentions).toEqual([]);
  });

  it('rejects coach access', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('rejects missing entry id', async () => {
    const event = buildEvent('athlete');
    event.pathParameters = null;

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('returns not found when meta row is missing', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
  });

  it('forbids access to another athlete entry', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'ENTRY#entry-1',
        SK: 'META',
        athleteId: 'athlete-2',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
  });

  it('returns not found when entry row is missing', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
  });
});
