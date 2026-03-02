import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    pathParameters: { commentId: 'comment-1' },
    body: JSON.stringify({
      approvalStatus: 'approved',
      body: 'edited by coach',
      gptFeedback: {
        coachEdited: 'cleaned up version',
      },
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'coach-1',
          'custom:role': 'coach',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('updateComment', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('updates and approves pending gpt feedback comment', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'COMMENT#comment-1',
          SK: 'META',
          entityType: 'COMMENT_META',
          commentId: 'comment-1',
          athleteId: 'athlete-1',
          targetType: 'entry',
          targetId: 'entry-1',
        },
      } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1', status: 'active' } } as never);

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'ENTRY#entry-1',
          SK: 'COMMENT#2026-03-01T00:00:00.000Z#comment-1',
          entityType: 'COMMENT',
          commentId: 'comment-1',
          athleteId: 'athlete-1',
          entryId: 'entry-1',
          coachId: 'coach-1',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          body: 'draft',
          visibility: 'hiddenByAthlete',
          targetType: 'entry',
          targetId: 'entry-1',
          kind: 'gpt-feedback',
          approval: {
            requiresApproval: true,
            status: 'pending',
          },
          gptFeedback: {
            draft: 'raw model output',
          },
        },
      ],
    } as never);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { comment: { visibility: string; approval: { status: string } } };
    expect(body.comment.visibility).toBe('visible');
    expect(body.comment.approval.status).toBe('approved');
    expect(mockPutItem).toHaveBeenCalledTimes(2);
  });

  it('rejects edits from non-author coach', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'COMMENT#comment-1',
          SK: 'META',
          entityType: 'COMMENT_META',
          commentId: 'comment-1',
          athleteId: 'athlete-1',
          targetType: 'entry',
          targetId: 'entry-1',
        },
      } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1', status: 'active' } } as never);

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'ENTRY#entry-1',
          SK: 'COMMENT#2026-03-01T00:00:00.000Z#comment-1',
          entityType: 'COMMENT',
          commentId: 'comment-1',
          athleteId: 'athlete-1',
          entryId: 'entry-1',
          coachId: 'coach-2',
          createdAt: '2026-03-01T00:00:00.000Z',
          body: 'draft',
          visibility: 'hiddenByAthlete',
        },
      ],
    } as never);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error.code).toBe('FORBIDDEN');
  });
});
