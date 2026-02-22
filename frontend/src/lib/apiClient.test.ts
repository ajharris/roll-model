import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test';
  });

  it('includes auth headers when token is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ assistant_text: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient, configureApiClient } = await import('./apiClient');
    configureApiClient(() => 'jwt-token');

    await apiClient.chat({ threadId: 'thread-1', message: 'hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/ai/chat',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
      }),
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.headers).toBeInstanceOf(Headers);
    const headers = requestInit.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('jwt-token');
    expect(headers.get('X-Authorization-Bearer')).toBe('Bearer jwt-token');
  });

  it('throws ApiError with API response message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({ message: 'AI provider error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');

    await expect(apiClient.chat({ message: 'hello' })).rejects.toMatchObject({
      message: 'AI provider error',
      status: 502,
    });
  });

  it('posts signup requests to the public endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ status: 'queued' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');

    await apiClient.requestSignup({ email: 'new.user@example.com', name: 'New User' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/signup-requests',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('posts feedback to the authenticated endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ issueNumber: 5, issueUrl: 'https://github.com/example/issues/5' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient, configureApiClient } = await import('./apiClient');
    configureApiClient(() => 'jwt-token');

    const response = await apiClient.submitFeedback({ type: 'bug', title: 'Bug', details: 'Details' });

    expect(response.issueNumber).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/feedback',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
