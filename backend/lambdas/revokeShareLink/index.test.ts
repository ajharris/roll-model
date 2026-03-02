import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (shareId = 'share-1'): APIGatewayProxyEvent =>
  ({
    pathParameters: { shareId },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('revokeShareLink handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('revokes active links and writes token/audit updates', async () => {
    mockGetItem.mockResolvedValue({
      Item: {
        PK: 'USER#athlete-1',
        SK: 'SHARE_LINK#share-1',
        entityType: 'SHARE_LINK',
        shareId: 'share-1',
        athleteId: 'athlete-1',
        status: 'active',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        payloadVersion: 1,
        policy: {
          visibility: 'private',
          includeFields: ['structured'],
          excludeFields: [],
          includePartnerData: false,
          requireCoachReview: false,
        },
        coachReview: {
          required: false,
          approved: true,
        },
        tokenHash: 'hash-1',
        summary: {
          summaryId: 'share-1',
          athleteId: 'athlete-1',
          generatedAt: '2026-03-01T10:00:00.000Z',
          payloadVersion: 1,
          sourceEntryIds: ['entry-1'],
          scope: {
            visibility: 'private',
            includeFields: ['structured'],
            excludeFields: [],
            includePartnerData: false,
            readOnly: true,
          },
          aggregate: {
            topConcepts: [],
            recurringFailures: [],
            conditioningIssues: [],
          },
          highlights: [],
        },
      },
    } as never);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { revoked: boolean; status: string };
    expect(body.revoked).toBe(true);
    expect(body.status).toBe('revoked');

    expect(mockPutItem).toHaveBeenCalledTimes(3);
    const putCalls = mockPutItem.mock.calls.map((call) => call[0]);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_LINK' && call.Item?.status === 'revoked')).toBe(true);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_TOKEN_MAP' && call.Item?.status === 'revoked')).toBe(true);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_AUDIT_EVENT' && call.Item?.eventType === 'revoked')).toBe(
      true
    );
  });
});
