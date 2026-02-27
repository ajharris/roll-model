import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { buildActionPackDeleteKeys } from '../../shared/actionPackIndex';
import { deleteItem, getItem, queryItems } from '../../shared/db';
import { extractEntryTokens } from '../../shared/keywords';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/keywords');
jest.mock('../../shared/actionPackIndex');

const mockDeleteItem = jest.mocked(deleteItem);
const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildActionPackDeleteKeys = jest.mocked(buildActionPackDeleteKeys);

const buildEvent = (role: 'athlete' | 'coach'): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId: 'entry-1' },
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('deleteEntry handler', () => {
  beforeEach(() => {
    mockDeleteItem.mockReset();
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
    mockExtractEntryTokens.mockReset();
    mockBuildActionPackDeleteKeys.mockReset();

    mockDeleteItem.mockResolvedValue();
    mockBuildActionPackDeleteKeys.mockReturnValue([]);
  });

  it('deletes entry, comments, and keyword index rows', async () => {
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
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        { PK: 'ENTRY#entry-1', SK: 'COMMENT#2024#c1' },
        { PK: 'ENTRY#entry-1', SK: 'COMMENT#2024#c2' }
      ]
    } as unknown as QueryCommandOutput);

    mockExtractEntryTokens.mockReturnValueOnce(['guard']).mockReturnValueOnce(['guard', 'secret']);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(204);
    expect(mockDeleteItem).toHaveBeenCalledTimes(6);
  });

  it('deletes action-pack index rows when present', async () => {
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
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);
    mockQueryItems.mockResolvedValueOnce({ Items: [] } as unknown as QueryCommandOutput);
    mockExtractEntryTokens.mockReturnValueOnce([]).mockReturnValueOnce([]);
    mockBuildActionPackDeleteKeys.mockReturnValueOnce([{ PK: 'USER#athlete-1', SK: 'APF#old' }] as never);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(204);
    expect(mockDeleteItem).toHaveBeenCalledWith({ Key: { PK: 'USER#athlete-1', SK: 'APF#old' } });
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

  it('forbids deleting another athlete entry', async () => {
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

  it('skips malformed comment rows when deleting comments', async () => {
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
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    mockQueryItems.mockResolvedValueOnce({
      Items: [{ PK: 'ENTRY#entry-1' }, { PK: 'ENTRY#entry-1', SK: 'COMMENT#ok' }]
    } as unknown as QueryCommandOutput);
    mockExtractEntryTokens.mockReturnValueOnce([]).mockReturnValueOnce([]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(204);
    expect(mockDeleteItem).toHaveBeenCalledTimes(3);
  });

  it('handles missing comment query items array', async () => {
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
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    mockQueryItems.mockResolvedValueOnce({} as unknown as QueryCommandOutput);
    mockExtractEntryTokens.mockReturnValueOnce([]).mockReturnValueOnce([]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(204);
    expect(mockDeleteItem).toHaveBeenCalledTimes(2);
  });
});
