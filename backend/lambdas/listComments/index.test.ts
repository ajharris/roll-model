import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = ({ role, userId, entryId, checkoffId }: { role: 'athlete' | 'coach'; userId: string; entryId?: string; checkoffId?: string }):
APIGatewayProxyEvent =>
  ({
    pathParameters: {
      ...(entryId ? { entryId } : {}),
      ...(checkoffId ? { checkoffId } : {}),
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: userId,
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('listComments', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('hides pending comments from athletes', async () => {
    mockGetItem.mockResolvedValueOnce({ Item: { athleteId: 'athlete-1' } } as never);
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'ENTRY#entry-1',
          SK: 'COMMENT#t1#c1',
          entityType: 'COMMENT',
          commentId: 'c1',
          athleteId: 'athlete-1',
          entryId: 'entry-1',
          coachId: 'coach-1',
          createdAt: '2026-03-01T00:00:00.000Z',
          body: 'pending',
          visibility: 'hiddenByAthlete',
        },
        {
          PK: 'ENTRY#entry-1',
          SK: 'COMMENT#t2#c2',
          entityType: 'COMMENT',
          commentId: 'c2',
          athleteId: 'athlete-1',
          entryId: 'entry-1',
          coachId: 'coach-1',
          createdAt: '2026-03-01T00:01:00.000Z',
          body: 'approved',
          visibility: 'visible',
        },
      ],
    } as never);

    const result = (await handler(buildEvent({ role: 'athlete', userId: 'athlete-1', entryId: 'entry-1' }), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { comments: Array<{ commentId: string }> };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].commentId).toBe('c2');
  });

  it('enforces coach link for checkoff comments', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-1' } } as never)
      .mockResolvedValueOnce({} as never);

    const result = (await handler(buildEvent({ role: 'coach', userId: 'coach-1', checkoffId: 'skill::hit-in-live-roll' }), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error.code).toBe('FORBIDDEN');
  });
});
