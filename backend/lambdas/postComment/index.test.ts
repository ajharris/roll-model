import type { APIGatewayProxyEvent } from 'aws-lambda';

import { handler } from './index';
import { getItem, putItem } from '../../shared/db';

jest.mock('../../shared/db');
jest.mock('uuid', () => ({ v4: () => 'comment-123' }));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (role: 'athlete' | 'coach'): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify({
      entryId: 'entry-1',
      body: 'Nice work'
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'coach-42',
          'custom:role': role
        }
      }
    }
  }) as APIGatewayProxyEvent;

describe('postComment handler auth', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('allows coach tokens', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } })
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-42' } });

    const result = await handler(buildEvent('coach'), {} as never, () => undefined);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { comment: { coachId: string; commentId: string } };
    expect(body.comment.coachId).toBe('coach-42');
    expect(body.comment.commentId).toBe('comment-123');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  it('rejects athlete tokens', async () => {
    const result = await handler(buildEvent('athlete'), {} as never, () => undefined);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
