import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('syncIntegrationSignals handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPutItem.mockResolvedValue();
  });

  it('imports normalized signals, skips duplicates, and reports partial failures', async () => {
    mockGetItem.mockImplementation(async (input) => {
      const sk = String(input.Key?.SK ?? '');
      if (sk === 'INTEGRATION_SETTINGS') {
        return {
          Item: {
            PK: 'USER#athlete-1',
            SK: 'INTEGRATION_SETTINGS',
            entityType: 'INTEGRATION_SETTINGS',
            athleteId: 'athlete-1',
            calendar: { enabled: true, connected: true },
            wearable: { enabled: true, connected: true },
            updatedAt: '2026-03-01T00:00:00.000Z',
            updatedBy: 'athlete-1'
          }
        } as never;
      }
      if (sk.includes('INTEGRATION_SIGNAL#calendar#cal-duplicate')) {
        return { Item: { entityType: 'INTEGRATION_SIGNAL' } } as never;
      }
      return {} as never;
    });

    const result = (await handler(
      buildEvent({
        signals: [
          {
            provider: 'calendar',
            externalId: 'cal-1',
            occurredAt: '2026-03-01T18:00:00.000Z',
            title: 'No-Gi Fundamentals',
            tags: ['Evening']
          },
          {
            provider: 'calendar',
            externalId: 'cal-duplicate',
            occurredAt: '2026-03-01T20:00:00.000Z',
            title: 'Open Mat'
          },
          {
            provider: 'wearable',
            occurredAt: 'bad-date',
            trained: true
          }
        ]
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { result: { imported: number; duplicates: number; partialFailure: boolean; failures: unknown[] } };
    expect(body.result.imported).toBe(1);
    expect(body.result.duplicates).toBe(1);
    expect(body.result.partialFailure).toBe(true);
    expect(body.result.failures.length).toBe(1);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'INTEGRATION_SIGNAL',
          provider: 'calendar',
          normalizedTags: expect.arrayContaining(['no-gi', 'fundamentals', 'evening'])
        })
      })
    );
  });
});
