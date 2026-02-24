import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logAuthFailure, logNetworkFailure } from './clientErrorLogging';

describe('clientErrorLogging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs network failures with a consistent payload shape', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logNetworkFailure({
      source: 'apiClient',
      url: 'https://api.example.test/entries',
      path: '/entries',
      method: 'GET',
      status: 502,
      authRequired: true,
      responseMessage: 'Bad gateway',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[client-error]',
      expect.objectContaining({
        category: 'network',
        source: 'apiClient',
        message: 'Bad gateway',
        timestamp: expect.any(String),
        details: expect.objectContaining({
          url: 'https://api.example.test/entries',
          path: '/entries',
          method: 'GET',
          status: 502,
          authRequired: true,
        }),
      }),
    );
  });

  it('logs auth failures with the same top-level shape', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logAuthFailure({
      source: 'HostedUiCallbackPage',
      operation: 'hosted-ui-callback',
      status: 401,
      error: new Error('invalid state'),
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[client-error]',
      expect.objectContaining({
        category: 'auth',
        source: 'HostedUiCallbackPage',
        message: 'invalid state',
        timestamp: expect.any(String),
        details: expect.objectContaining({
          operation: 'hosted-ui-callback',
          status: 401,
          error: expect.objectContaining({
            name: 'Error',
            message: 'invalid state',
          }),
        }),
      }),
    );
  });
});
