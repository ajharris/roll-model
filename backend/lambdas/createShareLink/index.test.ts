import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);
const mockGetItem = jest.mocked(getItem);

const buildEvent = (body?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : JSON.stringify({}),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('createShareLink handler', () => {
  beforeEach(() => {
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockGetItem.mockReset();
    mockPutItem.mockResolvedValue();

    mockQueryItems.mockResolvedValue({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-03-01T10:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          schemaVersion: 5,
          createdAt: '2026-03-01T10:00:00.000Z',
          updatedAt: '2026-03-01T10:00:00.000Z',
          quickAdd: {
            time: '2026-03-01T10:00:00.000Z',
            class: 'Open mat',
            gym: 'North',
            partners: ['Alex'],
            rounds: 5,
            notes: 'Half guard rounds',
          },
          structured: {
            position: 'half guard top',
            technique: 'knee cut pass',
          },
          structuredExtraction: {
            generatedAt: '2026-03-01T10:01:00.000Z',
            suggestions: [
              {
                field: 'position',
                value: 'half guard top',
                confidence: 'high',
                status: 'confirmed',
                updatedAt: '2026-03-01T10:02:00.000Z',
              },
            ],
            concepts: ['timing'],
            failures: ['late underhook'],
            conditioningIssues: [],
            confidenceFlags: [],
          },
          tags: ['top'],
          sections: {
            private: 'private detail',
            shared: 'shared detail',
          },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: ['guard'],
          },
          partnerOutcomes: [
            {
              partnerId: 'partner-1',
              partnerDisplayName: 'Alex',
              styleTags: ['pressure'],
              whatWorked: ['frames'],
              whatFailed: ['late underhook'],
            },
          ],
          rawTechniqueMentions: ['knee cut'],
          actionPackDraft: {
            wins: ['crossface'],
            leaks: ['inside elbow'],
            oneFocus: 'head first',
            drills: ['knee cut entries'],
            positionalRequests: ['half guard top'],
            fallbackDecisionGuidance: 'reset frames',
            confidenceFlags: [],
          },
        },
      ],
    } as never);
  });

  it('creates private-by-default share links with redaction defaults and audit records', async () => {
    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as {
      share: { payloadVersion: number; policy: { visibility: string; includePartnerData: boolean } };
      token: string;
      shareUrl: string;
    };
    expect(body.share.payloadVersion).toBe(1);
    expect(body.share.policy.visibility).toBe('private');
    expect(body.share.policy.includePartnerData).toBe(false);
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.shareUrl).toContain('/shared/');

    expect(mockPutItem).toHaveBeenCalledTimes(3);
    const putCalls = mockPutItem.mock.calls.map((call) => call[0]);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_LINK')).toBe(true);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_TOKEN_MAP')).toBe(true);
    expect(putCalls.some((call) => call.Item?.entityType === 'SHARE_AUDIT_EVENT')).toBe(true);

    const sharePut = putCalls.find((call) => call.Item?.entityType === 'SHARE_LINK');
    expect(sharePut?.Item?.summary?.highlights?.[0]?.partnerOutcomes).toBeUndefined();
  });

  it('rejects coach-linked sharing when coach link is missing', async () => {
    mockGetItem.mockResolvedValueOnce({} as never);

    const result = (await handler(
      buildEvent({ coachId: 'coach-x' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error.code).toBe('FORBIDDEN');
  });
});
