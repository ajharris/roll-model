import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { handler } from './index';

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

describe('submitFeedback handler', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'token-123';
    process.env.GITHUB_REPO = 'owner/repo';
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
        { type: 'bug', title: 'Login fails', details: 'Details here', steps: 'Step 1', expected: 'Works', actual: 'Fails' },
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
  });

  it('rejects invalid payloads', async () => {
    const result = (await handler(
      buildEvent(
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

  it('requires GitHub configuration', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;

    const result = (await handler(
      buildEvent({ type: 'bug', title: 'Missing token', details: 'Details here' }, { sub: 'user-1', 'custom:role': 'athlete' }),
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
      buildEvent({ type: 'feature', title: 'New idea', details: 'Details here' }, { sub: 'user-1', 'custom:role': 'athlete' }),
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
});
