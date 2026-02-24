'use client';

export type ClientErrorCategory = 'render' | 'network' | 'auth';

export interface ClientErrorLogEvent {
  category: ClientErrorCategory;
  source: string;
  message: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

interface SerializableError {
  name?: string;
  message?: string;
  stack?: string;
}

const toSerializableError = (error: unknown): SerializableError | undefined => {
  if (!(error instanceof Error)) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
};

export const logClientError = (event: ClientErrorLogEvent) => {
  const payload = {
    timestamp: event.timestamp ?? new Date().toISOString(),
    category: event.category,
    source: event.source,
    message: event.message,
    details: event.details ?? {},
  };

  console.error('[client-error]', payload);
};

export const logRenderError = (
  error: Error & { digest?: string },
  options?: { source?: string },
) => {
  logClientError({
    category: 'render',
    source: options?.source ?? 'app-error-boundary',
    message: error.message || 'Unhandled render error',
    details: {
      digest: error.digest,
      error: toSerializableError(error),
    },
  });
};

export const logNetworkFailure = (options: {
  source: string;
  url: string;
  path: string;
  method: string;
  status?: number;
  authRequired: boolean;
  error?: unknown;
  responseMessage?: string;
}) => {
  logClientError({
    category: 'network',
    source: options.source,
    message:
      options.responseMessage ??
      (options.error instanceof Error ? options.error.message : 'Network request failed'),
    details: {
      url: options.url,
      path: options.path,
      method: options.method,
      status: options.status ?? null,
      authRequired: options.authRequired,
      error: toSerializableError(options.error),
    },
  });
};

export const logAuthFailure = (options: {
  source: string;
  operation: string;
  status?: number;
  error?: unknown;
  message?: string;
  details?: Record<string, unknown>;
}) => {
  logClientError({
    category: 'auth',
    source: options.source,
    message: options.message ?? (options.error instanceof Error ? options.error.message : 'Auth failure'),
    details: {
      operation: options.operation,
      status: options.status ?? null,
      error: toSerializableError(options.error),
      ...(options.details ?? {}),
    },
  });
};
