import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach'): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId: 'entry-1' },
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('getEntryCheckoffEvidence handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('returns entry-linked evidence for athlete', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: { PK: 'ENTRY#entry-1', SK: 'META', athleteId: 'athlete-1' },
    } as unknown as GetCommandOutput);
    mockQueryItems.mockResolvedValueOnce({
      Items: [{ entityType: 'ENTRY_CHECKOFF_EVIDENCE', evidenceId: 'e-1' }],
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { evidence: unknown[] };
    expect(body.evidence).toHaveLength(1);
  });

  it('rejects coach tokens', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
