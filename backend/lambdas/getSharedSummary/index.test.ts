import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (token = 'token-123'): APIGatewayProxyEvent =>
  ({
    pathParameters: { token },
    requestContext: {
      identity: {
        sourceIp: '127.0.0.1',
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('getSharedSummary handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('rejects revoked links and logs audit event', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'SHARE_TOKEN#hash',
          SK: 'META',
          entityType: 'SHARE_TOKEN_MAP',
          shareId: 'share-1',
          athleteId: 'athlete-1',
          status: 'revoked',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      } as never)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'SHARE_LINK#share-1',
          entityType: 'SHARE_LINK',
          shareId: 'share-1',
          athleteId: 'athlete-1',
          status: 'revoked',
          createdAt: '2026-03-01T10:00:00.000Z',
          updatedAt: '2026-03-01T11:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          payloadVersion: 1,
          policy: {
            visibility: 'private',
            includeFields: ['structured'],
            excludeFields: ['partnerOutcomes'],
            includePartnerData: false,
            requireCoachReview: false,
          },
          coachReview: {
            required: false,
            approved: true,
          },
          tokenHash: 'hash',
          summary: {
            summaryId: 'share-1',
            athleteId: 'athlete-1',
            generatedAt: '2026-03-01T10:00:00.000Z',
            payloadVersion: 1,
            sourceEntryIds: ['entry-1'],
            scope: {
              visibility: 'private',
              includeFields: ['structured'],
              excludeFields: ['partnerOutcomes'],
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

    expect(result.statusCode).toBe(410);
    expect(JSON.parse(result.body).error.code).toBe('SHARE_REVOKED');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem.mock.calls[0][0].Item?.eventType).toBe('access_denied_revoked');
  });

  it('rejects expired links and logs audit event', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'SHARE_TOKEN#hash',
          SK: 'META',
          entityType: 'SHARE_TOKEN_MAP',
          shareId: 'share-1',
          athleteId: 'athlete-1',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
      } as never)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'SHARE_LINK#share-1',
          entityType: 'SHARE_LINK',
          shareId: 'share-1',
          athleteId: 'athlete-1',
          status: 'active',
          createdAt: '2026-03-01T10:00:00.000Z',
          updatedAt: '2026-03-01T11:00:00.000Z',
          expiresAt: '2000-01-01T00:00:00.000Z',
          payloadVersion: 1,
          policy: {
            visibility: 'private',
            includeFields: ['structured'],
            excludeFields: ['partnerOutcomes'],
            includePartnerData: false,
            requireCoachReview: false,
          },
          coachReview: {
            required: false,
            approved: true,
          },
          tokenHash: 'hash',
          summary: {
            summaryId: 'share-1',
            athleteId: 'athlete-1',
            generatedAt: '2026-03-01T10:00:00.000Z',
            payloadVersion: 1,
            sourceEntryIds: ['entry-1'],
            scope: {
              visibility: 'private',
              includeFields: ['structured'],
              excludeFields: ['partnerOutcomes'],
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

    expect(result.statusCode).toBe(410);
    expect(JSON.parse(result.body).error.code).toBe('SHARE_EXPIRED');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem.mock.calls[0][0].Item?.eventType).toBe('access_denied_expired');
  });
});
