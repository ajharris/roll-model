import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockPutItem = jest.mocked(putItem);

const buildEvent = (body?: Record<string, unknown>, claims?: Record<string, string>): APIGatewayProxyEvent =>
import { putItem, queryItems } from '../../shared/db';

import { buildLabels, handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/openai', () => ({
  getOpenAIApiKey: jest.fn().mockResolvedValue('openai-token')
}));

const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (
  body?: Record<string, unknown>,
  claims?: Record<string, string>,
  headers?: Record<string, string>
): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : null,
    headers,
    requestContext: {
      authorizer: claims
        ? {
            claims
          }
        : undefined,
      stage: 'prod',
      requestId: 'req-1'
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
    process.env.FEEDBACK_ACTOR_HASH_SALT = 'salt-123';
    process.env.FEEDBACK_REVIEW_REQUIRED_ENVS = '';
    process.env.FEEDBACK_NORMALIZE_MODE = 'off';
    process.env.FEEDBACK_RATE_LIMIT_PER_HOUR = '6';
    process.env.FEEDBACK_RATE_LIMIT_PER_DAY = '20';
    process.env.FEEDBACK_COOLDOWN_SECONDS = '20';
    process.env.FEEDBACK_DUPLICATE_WINDOW_HOURS = '24';
    process.env.FEEDBACK_DUPLICATE_LIMIT = '2';

    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockQueryItems.mockResolvedValue({ Items: [] } as unknown as QueryCommandOutput);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ number: 42, html_url: 'https://github.com/owner/repo/issues/42' })
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('maps labels for bug/feature/ui/other', () => {
    expect(buildLabels('bug')).toEqual(['bug', 'triage', 'user-feedback']);
    expect(buildLabels('feature')).toEqual(['enhancement', 'triage', 'user-feedback']);
    expect(buildLabels('ui')).toEqual(['ui-ux', 'triage', 'user-feedback']);
    expect(buildLabels('other')).toEqual(['feedback', 'triage', 'user-feedback']);
  });

  it('creates a GitHub issue with metadata and persists artifacts', async () => {
    const result = (await handler(
      buildEvent(
        validPayload,
        { sub: 'user-1', 'custom:role': 'athlete', email: 'user@example.com' }
        {
          type: 'bug',
          title: 'Login fails',
          details: 'Details here',
          steps: 'Step 1',
          expected: 'Works',
          actual: 'Fails',
          appVersion: '1.2.3',
          environment: 'prod'
        },
        { sub: 'user-1', 'custom:role': 'athlete' },
        { 'x-app-version': '1.2.3' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { issueNumber: number; status: string; submissionId: string };
    expect(body.issueNumber).toBe(42);
    expect(body.status).toBe('submitted');
    expect(body.submissionId).toBeTruthy();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Actor hash:')
      })
    );

    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'FEEDBACK_SUBMISSION',
          status: 'submitted',
          appVersion: '1.2.3',
          environment: 'prod',
          labels: ['bug', 'triage', 'user-feedback']
        })
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

  it('returns pending_review and skips GitHub when environment is gated', async () => {
    process.env.FEEDBACK_REVIEW_REQUIRED_ENVS = 'prod';

    const result = (await handler(
      buildEvent(
        { ...validPayload, type: 'unknown' },
        { type: 'feature', title: 'Need dashboard filters', details: 'Would help triage entries faster.' },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { status: string; issueUrl: string | null };
    expect(body.status).toBe('pending_review');
    expect(body.issueUrl).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          status: 'pending_review',
          issueState: 'pending_review'
        })
      })
    );
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
  it('blocks submissions when rate-limited and records blocked artifact', async () => {
    process.env.FEEDBACK_RATE_LIMIT_PER_HOUR = '1';

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          entityType: 'FEEDBACK_SUBMISSION',
          submittedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          fingerprint: 'abc123'
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(
      buildEvent(
        { type: 'bug', title: 'Rate limit test', details: 'Details here' },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');

    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          status: 'blocked',
          throttled: true
        })
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads', async () => {
    const result = (await handler(
      buildEvent(
        {
          ...validPayload,
          type: 'feature',
          reviewerWorkflow: { requiresReview: false },
          screenshots: []
        },
        { type: 'unknown', title: 'Bad', details: 'Nope' },
        { sub: 'user-1', 'custom:role': 'athlete' }
      ),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
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
