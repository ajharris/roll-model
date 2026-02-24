import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

type LogLevel = 'INFO' | 'ERROR';

interface RequestIdentity {
  userId?: string;
  userRole?: string;
  userRoles?: string[];
}

interface RequestLogBase extends RequestIdentity {
  handler: string;
  route: string;
  path: string;
  method: string;
  stage?: string;
  requestId?: string;
  extendedRequestId?: string;
  lambdaRequestId?: string;
  correlationId?: string;
  traceId?: string;
}

const parseStringArrayClaim = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      // Fall back to comma-separated parsing.
    }
  }

  return trimmed
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const getHeader = (
  headers: APIGatewayProxyEvent['headers'] | undefined,
  name: string,
): string | undefined => {
  if (!headers) return undefined;
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
};

const getRequestIdentity = (event: APIGatewayProxyEvent): RequestIdentity => {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string | undefined> | undefined;
  if (!claims) return {};

  const userRoles = parseStringArrayClaim(claims['cognito:groups'])
    .map((group) => group.toLowerCase())
    .filter(Boolean);

  return {
    userId: claims.sub,
    userRole: claims['custom:role'],
    userRoles: userRoles.length ? [...new Set(userRoles)] : undefined,
  };
};

const getTraceId = (): string | undefined => {
  const rawTraceId = process.env._X_AMZN_TRACE_ID;
  if (!rawTraceId) return undefined;
  const rootMatch = rawTraceId.match(/Root=([^;]+)/);
  return rootMatch?.[1] ?? rawTraceId;
};

const buildRequestLogBase = (
  handler: string,
  event: APIGatewayProxyEvent,
  context: Context,
): RequestLogBase => {
  const requestContext = event.requestContext;
  const route = requestContext?.resourcePath ?? event.resource ?? event.path ?? 'unknown';
  const path = event.path ?? route;
  const method = requestContext?.httpMethod ?? event.httpMethod ?? 'UNKNOWN';
  const requestId = requestContext?.requestId;
  const extendedRequestId =
    (
      requestContext as (APIGatewayProxyEvent['requestContext'] & { extendedRequestId?: string }) | undefined
    )?.extendedRequestId;
  const headerCorrelationId =
    getHeader(event.headers, 'x-correlation-id') ?? getHeader(event.headers, 'x-request-id');

  return {
    handler,
    route,
    path,
    method,
    stage: requestContext?.stage,
    requestId,
    extendedRequestId,
    lambdaRequestId: context.awsRequestId,
    correlationId: headerCorrelationId ?? requestId ?? context.awsRequestId,
    traceId: getTraceId(),
    ...getRequestIdentity(event),
  };
};

const log = (level: LogLevel, payload: Record<string, unknown>): void => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...payload,
  };

  const line = JSON.stringify(entry);
  if (level === 'ERROR') {
    console.error(line);
    return;
  }

  console.info(line);
};

const getErrorDetailsFromResponse = (result: APIGatewayProxyResult): Record<string, unknown> => {
  if (!result.body) return {};

  try {
    const parsed = JSON.parse(result.body) as { error?: { code?: string; message?: string } };
    if (!parsed || typeof parsed !== 'object' || !parsed.error) return {};
    return {
      errorCode: parsed.error.code,
      errorMessage: parsed.error.message,
    };
  } catch {
    return {};
  }
};

export const withRequestLogging = (
  handlerName: string,
  innerHandler: APIGatewayProxyHandler,
): APIGatewayProxyHandler => {
  const wrappedHandler: APIGatewayProxyHandler = async (event, context, callback) => {
    const startedAt = Date.now();
    const base = buildRequestLogBase(handlerName, event, context);

    log('INFO', {
      event: 'request.start',
      outcome: 'start',
      ...base,
    });

    try {
      const result = await innerHandler(event, context, callback);
      if (!result) {
        throw new Error(`Handler ${handlerName} returned no response.`);
      }
      const statusCode = result.statusCode ?? 200;
      const latencyMs = Date.now() - startedAt;
      const isError = statusCode >= 400;

      log(isError ? 'ERROR' : 'INFO', {
        event: isError ? 'request.error' : 'request.success',
        outcome: isError ? 'error' : 'success',
        statusCode,
        latencyMs,
        ...base,
        ...(isError ? getErrorDetailsFromResponse(result) : {}),
      });

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorDetails =
        error instanceof Error
          ? {
              errorName: error.name,
              errorMessage: error.message,
            }
          : {
              errorName: 'UnknownError',
              errorMessage: String(error),
            };

      log('ERROR', {
        event: 'request.error',
        outcome: 'exception',
        latencyMs,
        ...base,
        ...errorDetails,
      });

      throw error;
    }
  };

  return wrappedHandler;
};
