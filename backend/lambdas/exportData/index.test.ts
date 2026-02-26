import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const buildEventWithMode = (mode: string): APIGatewayProxyEvent =>
  ({
    queryStringParameters: { mode },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const buildEventWithFormat = (format: string): APIGatewayProxyEvent =>
  ({
    queryStringParameters: { format },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('exportData handler', () => {
  beforeEach(() => {
    mockQueryItems.mockReset();
  });

  it('allows athlete export with entries and comments', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
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
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'ENTRY#entry-1',
            SK: 'COMMENT#2024-01-02#comment-1',
            entityType: 'COMMENT',
            commentId: 'comment-1',
            entryId: 'entry-1',
            coachId: 'coach-1',
            createdAt: '2024-01-02T00:00:00.000Z',
            body: 'Nice work',
            visibility: 'visible'
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      schemaVersion: string;
      generatedAt: string;
      full: {
        athleteId: string;
        entries: Array<{ entryId: string }>;
        comments: Array<{ commentId: string }>;
      };
      tidy: { entries: Array<{ entryId: string }>; comments: Array<{ commentId: string }> };
    };
    expect(body.schemaVersion).toBe('2026-02-19');
    expect(body.generatedAt).toBeDefined();
    expect(body.full.athleteId).toBe('athlete-1');
    expect(body.full.entries[0].entryId).toBe('entry-1');
    expect(body.full.comments[0].commentId).toBe('comment-1');
    expect(body.tidy.entries).toHaveLength(1);
    expect(body.tidy.comments).toHaveLength(1);
  });

  it('returns tidy only when mode=tidy', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput);

    const result = (await handler(buildEventWithMode('tidy'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { schemaVersion: string; generatedAt: string; tidy?: unknown; full?: unknown };
    expect(body.schemaVersion).toBe('2026-02-19');
    expect(body.generatedAt).toBeDefined();
    expect(body.tidy).toBeDefined();
    expect(body.full).toBeUndefined();
  });

  it('exports entries as csv when format=csv', async () => {
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
          },
          rawTechniqueMentions: ['knee cut']
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEventWithFormat('csv'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toContain('text/csv');
    expect(result.body).toContain('entryId,athleteId,schemaVersion');
    expect(result.body).toContain('entry-1');
    expect(mockQueryItems).toHaveBeenCalledTimes(1);
  });
});
