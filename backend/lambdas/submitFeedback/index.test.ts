import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockPutItem = jest.mocked(putItem);

const buildEvent = (body?: Record<string, unknown>, claims?: Record<string, string>): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : null,
    requestContext: {
      authorizer: claims
        ? {
            claims
          }
        : undefined
    }
  }) as unknown as APIGatewayProxyEvent;

const validPayload = {
  type: 'bug',
  problem: 'When I submit from mobile, the save button does nothing.',
  proposedChange: 'Disable the button while loading and show an inline error message on failure.',
  contextSteps: 'Open on iPhone Safari, tap Save with weak connection, observe no feedback or retry.',
  severity: 'high',
  screenshots: [{ url: 'https://example.com/screenshot-1.png', caption: 'Button remains active' }],
  reviewerWorkflow: { requiresReview: true, reviewerRole: 'coach', note: 'Please sanity-check priority.' },
  normalization: { usedGpt: true, originalProblem: 'save broke on phone' },
  previewConfirmed: true
} as const;

describe('submitFeedback handler', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'token-123';
    process.env.GITHUB_REPO = 'owner/repo';
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ number: 42, html_url: 'https://github.com/owner/repo/issues/42' })
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('creates a GitHub issue', async () => {
    const result = (await handler(
      buildEvent(
        validPayload,
        { sub: 'user-1', 'custom:role': 'athlete', email: 'user@example.com' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { issueNumber: number };
    expect(body.issueNumber).toBe(42);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues',
      expect.objectContaining({
        method: 'POST'
      })
    );
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'FEEDBACK_SUBMISSION',
          athleteId: 'user-1',
          github: expect.objectContaining({ issueNumber: 42 }),
          status: 'pending_reviewer_validation'
        })
      })
    );
  });

  it('rejects invalid payloads', async () => {
    const result = (await handler(
      buildEvent(
        { ...validPayload, type: 'unknown' },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects submission without preview confirmation', async () => {
    const result = (await handler(
      buildEvent(
        { ...validPayload, previewConfirmed: false },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('Preview confirmation');
  });

  it('requires GitHub configuration', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;

    const result = (await handler(
      buildEvent(validPayload, { sub: 'user-1', 'custom:role': 'athlete' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIGURATION_ERROR');
  });

  it('surfaces GitHub errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Validation Failed' })
    }) as unknown as typeof fetch;

    const result = (await handler(
      buildEvent(
        {
          ...validPayload,
          type: 'feature',
          reviewerWorkflow: { requiresReview: false },
          screenshots: []
        },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(502);
    const body = JSON.parse(result.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('GITHUB_ERROR');
    expect(body.error.message).toBe('Validation Failed');
  });

  it('requires auth claims', async () => {
    const result = (await handler(
      buildEvent({ type: 'bug', title: 'Auth required', details: 'Details here' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects unsupported roles', async () => {
    const result = (await handler(
      buildEvent(validPayload, { sub: 'user-1', 'custom:role': 'unknown-role' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_ROLE');
  });
});
