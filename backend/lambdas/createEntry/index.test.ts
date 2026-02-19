import type { APIGatewayProxyEvent } from 'aws-lambda';

import { handler } from './index';
import { batchWriteItems, putItem } from '../../shared/db';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';

jest.mock('../../shared/db');
jest.mock('../../shared/keywords');

const mockPutItem = jest.mocked(putItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildKeywordIndexItems = jest.mocked(buildKeywordIndexItems);

const buildEvent = (role: 'athlete' | 'coach'): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify({
      sections: { private: 'private notes', shared: 'shared notes' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      }
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': role
        }
      }
    }
  }) as APIGatewayProxyEvent;

describe('createEntry handler auth', () => {
  beforeEach(() => {
    mockPutItem.mockResolvedValue();
    mockBatchWriteItems.mockResolvedValue();
    mockExtractEntryTokens.mockReturnValue([]);
    mockBuildKeywordIndexItems.mockReturnValue([]);
  });

  it('allows athlete tokens', async () => {
    const result = await handler(buildEvent('athlete'), {} as never, () => undefined);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { entry: { athleteId: string } };
    expect(body.entry.athleteId).toBe('user-123');
    expect(mockPutItem).toHaveBeenCalledTimes(2);
  });

  it('rejects coach tokens', async () => {
    const result = await handler(buildEvent('coach'), {} as never, () => undefined);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
