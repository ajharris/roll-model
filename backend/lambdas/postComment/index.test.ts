import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('uuid', () => ({ v4: () => 'comment-123' }));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = ({
  role,
  entryIdInBody,
  entryIdInPath,
  checkoffIdInBody,
  checkoffIdInPath,
  body = 'Nice work',
  requiresApproval,
  kind,
}: {
  role: 'athlete' | 'coach';
  entryIdInBody?: string | null;
  entryIdInPath?: string;
  checkoffIdInBody?: string | null;
  checkoffIdInPath?: string;
  body?: string;
  requiresApproval?: boolean;
  kind?: 'coach-note' | 'gpt-feedback';
}): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify({
      ...(entryIdInBody ? { entryId: entryIdInBody } : {}),
      ...(checkoffIdInBody ? { checkoffId: checkoffIdInBody } : {}),
      ...(requiresApproval !== undefined ? { requiresApproval } : {}),
      ...(kind ? { kind } : {}),
      body,
    }),
    pathParameters:
      entryIdInPath || checkoffIdInPath
        ? {
            ...(entryIdInPath ? { entryId: entryIdInPath } : {}),
            ...(checkoffIdInPath ? { checkoffId: checkoffIdInPath } : {}),
          }
        : null,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'coach-42',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('postComment handler auth', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('allows coach tokens for entry comments', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-42', status: 'active' } } as never);

    const result = (await handler(
      buildEvent({ role: 'coach', entryIdInBody: 'entry-1' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { comment: { coachId: string; commentId: string } };
    expect(body.comment.coachId).toBe('coach-42');
    expect(body.comment.commentId).toBe('comment-123');
    expect(mockPutItem).toHaveBeenCalledTimes(2);
  });

  it('supports checkoff-scoped comments', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-42', status: 'active' } } as never);

    const result = (await handler(
      buildEvent({ role: 'coach', checkoffIdInPath: 'knee-cut::hit-in-live-roll' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const payload = JSON.parse(result.body) as { comment: { targetType: string; checkoffId: string } };
    expect(payload.comment.targetType).toBe('checkoff');
    expect(payload.comment.checkoffId).toBe('knee-cut::hit-in-live-roll');
  });

  it('creates hidden comment artifacts for approval workflow', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-42', status: 'active' } } as never);

    const result = (await handler(
      buildEvent({ role: 'coach', entryIdInBody: 'entry-1', requiresApproval: true, kind: 'gpt-feedback' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const payload = JSON.parse(result.body) as { comment: { visibility: string; approval: { status: string } } };
    expect(payload.comment.visibility).toBe('hiddenByAthlete');
    expect(payload.comment.approval.status).toBe('pending');
  });

  it('rejects athlete tokens', async () => {
    const result = (await handler(
      buildEvent({ role: 'athlete', entryIdInBody: 'entry-1' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('requires coach-athlete link', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } } as never)
      .mockResolvedValueOnce({} as never);

    const result = (await handler(
      buildEvent({ role: 'coach', entryIdInBody: 'entry-1' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('accepts entryId from path', async () => {
    mockGetItem
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-9' } } as never)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-42', status: 'active' } } as never);

    const result = (await handler(
      buildEvent({ role: 'coach', entryIdInPath: 'entry-99' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
  });

  it('rejects mismatched entryId between path and body', async () => {
    const result = (await handler(
      buildEvent({ role: 'coach', entryIdInBody: 'entry-1', entryIdInPath: 'entry-2' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});
