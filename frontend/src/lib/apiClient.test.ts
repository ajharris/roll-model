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
    expect(headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(headers.get('Authorization-Bearer')).toBeNull();
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
  it('unwraps getEntries payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            entryId: 'entry-1',
            athleteId: 'athlete-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            sections: { shared: 'shared', private: 'private' },
            sessionMetrics: {
              durationMinutes: 60,
              intensity: 7,
              rounds: 6,
              giOrNoGi: 'gi',
              tags: ['guard'],
            },
            rawTechniqueMentions: [],
          },
        ],
      }),
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
    const entries = await apiClient.getEntries();

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entryId).toBe('entry-1');
  });

  it('unwraps createEntry payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        entry: {
          entryId: 'entry-2',
          athleteId: 'athlete-1',
          createdAt: '2026-01-02T00:00:00.000Z',
          sections: { shared: 'shared', private: 'private' },
          sessionMetrics: {
            durationMinutes: 45,
            intensity: 6,
            rounds: 5,
            giOrNoGi: 'no-gi',
            tags: ['passing'],
          },
          rawTechniqueMentions: ['knee slice'],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entry = await apiClient.createEntry({
      sections: { shared: 'shared', private: 'private' },
      sessionMetrics: {
        durationMinutes: 45,
        intensity: 6,
        rounds: 5,
        giOrNoGi: 'no-gi',
        tags: ['passing'],
      },
      rawTechniqueMentions: ['knee slice'],
    });

    expect(entry.entryId).toBe('entry-2');
  });

  it('unwraps getAthleteEntries payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            entryId: 'entry-3',
            athleteId: 'athlete-2',
            createdAt: '2026-01-03T00:00:00.000Z',
            sections: { shared: 'shared-only' },
            sessionMetrics: {
              durationMinutes: 30,
              intensity: 5,
              rounds: 4,
              giOrNoGi: 'gi',
              tags: ['sweeps'],
            },
            rawTechniqueMentions: [],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entries = await apiClient.getAthleteEntries('athlete-2');

    expect(Array.isArray(entries)).toBe(true);
    expect(entries[0]?.entryId).toBe('entry-3');
  });

  it('accepts legacy raw array payload for getEntries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          entryId: 'entry-legacy',
          athleteId: 'athlete-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          sections: { shared: 'shared' },
          sessionMetrics: {
            durationMinutes: 30,
            intensity: 5,
            rounds: 3,
            giOrNoGi: 'gi',
            tags: [],
          },
          rawTechniqueMentions: [],
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entries = await apiClient.getEntries();
    expect(entries[0]?.entryId).toBe('entry-legacy');
  });

  it('returns empty array for malformed entries payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: { bad: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entries = await apiClient.getEntries();
    expect(entries).toEqual([]);
  });
});
