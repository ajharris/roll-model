import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

import { withRequestLogging } from './logger';

const buildEvent = (
  overrides: Partial<APIGatewayProxyEvent> = {},
  claims?: Record<string, string | undefined>,
): APIGatewayProxyEvent =>
  ({
    httpMethod: 'GET',
    path: '/entries',
    resource: '/entries',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-1',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/prod/entries',
      stage: 'prod',
      requestId: 'req-123',
      resourceId: 'res-1',
      resourcePath: '/entries',
      requestTimeEpoch: Date.now(),
      identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
      authorizer: claims ? ({ claims } as APIGatewayProxyEvent['requestContext']['authorizer']) : undefined,
    },
    ...overrides,
  }) as APIGatewayProxyEvent;

const buildContext = (): Context =>
  ({
    awsRequestId: 'lambda-123',
  }) as Context;

describe('withRequestLogging', () => {
  const originalTraceId = process.env._X_AMZN_TRACE_ID;

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env._X_AMZN_TRACE_ID = 'Root=1-67891233-abcdef012345678912345678;Parent=abc;Sampled=1';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalTraceId === undefined) {
      delete process.env._X_AMZN_TRACE_ID;
    } else {
      process.env._X_AMZN_TRACE_ID = originalTraceId;
    }
  });

  it('emits start and success logs with correlation and identity fields', async () => {
    const handler = withRequestLogging('getEntries', async () => ({
      statusCode: 200,
      body: JSON.stringify({ entries: [] }),
    }));

    await handler(
      buildEvent(
        {
          headers: {
            'x-correlation-id': 'corr-123',
          },
        },
        {
          sub: 'user-1',
          'custom:role': 'coach',
          'cognito:groups': 'coach,admin',
        },
      ),
      buildContext(),
      () => undefined,
    );

    expect(console.info).toHaveBeenCalledTimes(2);

    const startLog = JSON.parse((console.info as jest.Mock).mock.calls[0][0] as string);
    const successLog = JSON.parse((console.info as jest.Mock).mock.calls[1][0] as string);

    expect(startLog.event).toBe('request.start');
    expect(startLog.requestId).toBe('req-123');
    expect(startLog.correlationId).toBe('corr-123');
    expect(startLog.route).toBe('/entries');
    expect(startLog.method).toBe('GET');
    expect(startLog.userId).toBe('user-1');
    expect(startLog.userRole).toBe('coach');
    expect(startLog.userRoles).toEqual(expect.arrayContaining(['coach', 'admin']));
    expect(startLog.traceId).toBe('1-67891233-abcdef012345678912345678');

    expect(successLog.event).toBe('request.success');
    expect(successLog.outcome).toBe('success');
    expect(successLog.statusCode).toBe(200);
    expect(typeof successLog.latencyMs).toBe('number');
  });

  it('emits error logs for error responses and extracts API error codes', async () => {
    const handler = withRequestLogging('createEntry', async () => ({
      statusCode: 400,
      body: JSON.stringify({
        error: {
          code: 'INVALID_REQUEST',
          message: 'bad payload',
        },
      }),
    }));

    await handler(buildEvent(), buildContext(), () => undefined);

    expect(console.error).toHaveBeenCalledTimes(1);
    const errorLog = JSON.parse((console.error as jest.Mock).mock.calls[0][0] as string);

    expect(errorLog.event).toBe('request.error');
    expect(errorLog.outcome).toBe('error');
    expect(errorLog.statusCode).toBe(400);
    expect(errorLog.errorCode).toBe('INVALID_REQUEST');
    expect(errorLog.errorMessage).toBe('bad payload');
  });
});
