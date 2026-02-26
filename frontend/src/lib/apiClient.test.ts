import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAuthFailureMock = vi.fn();
const logNetworkFailureMock = vi.fn();

vi.mock('@/lib/clientErrorLogging', () => ({
  logAuthFailure: (...args: unknown[]) => logAuthFailureMock(...args),
  logNetworkFailure: (...args: unknown[]) => logNetworkFailureMock(...args),
}));

describe('apiClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    logAuthFailureMock.mockReset();
    logNetworkFailureMock.mockReset();
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

    expect(logNetworkFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'apiClient',
        path: '/ai/chat',
        method: 'POST',
        status: 502,
      }),
    );
  });

  it('reads nested backend error.message payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: {
          code: 'INVALID_BACKUP_FORMAT',
          message: 'Backup field "full.entries" must be an array.',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');

    await expect(apiClient.restoreData({ bad: true })).rejects.toMatchObject({
      status: 400,
      message: 'Backup field "full.entries" must be an array.',
    });
  });

  it('logs auth failures with a consistent auth category for 401/403 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient, configureApiClient } = await import('./apiClient');
    configureApiClient(() => 'jwt-token');

    await expect(apiClient.getEntries()).rejects.toMatchObject({
      message: 'Unauthorized',
      status: 401,
    });

    expect(logAuthFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'apiClient',
        operation: 'GET /entries',
        status: 401,
        message: 'Unauthorized',
      }),
    );
  });

  it('logs fetch rejections as network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');

    await expect(apiClient.getEntries()).rejects.toThrow('Failed to fetch');

    expect(logNetworkFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'apiClient',
        path: '/entries',
        method: 'GET',
        authRequired: false,
        error: expect.any(TypeError),
      }),
    );
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

  it('downloads CSV export as text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'entryId,athleteId\nentry-1,athlete-1',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient, configureApiClient } = await import('./apiClient');
    configureApiClient(() => 'jwt-token');

    const csv = await apiClient.exportEntriesCsv();

    expect(csv).toContain('entryId,athleteId');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/export?format=csv',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('posts restore payload to /restore', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        restored: true,
        athleteId: 'athlete-1',
        counts: {
          entries: 1,
          comments: 0,
          links: 0,
          aiThreads: 0,
          aiMessages: 0,
          itemsWritten: 2,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const result = await apiClient.restoreData({
      schemaVersion: '2026-02-19',
      generatedAt: '2026-02-26T00:00:00.000Z',
      full: {
        athleteId: 'athlete-1',
        entries: [],
        comments: [],
        links: [],
        aiThreads: [],
        aiMessages: [],
      },
    });

    expect(result.restored).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/restore',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

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
    const entries = await apiClient.getEntries();

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entryId).toBe('entry-1');
  });

  it('unwraps listSavedSearches payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        savedSearches: [
          {
            id: 'search-1',
            userId: 'athlete-1',
            name: 'Open mat guard',
            query: 'guard',
            tag: 'open-mat',
            giOrNoGi: 'no-gi',
            minIntensity: '',
            maxIntensity: '',
            sortBy: 'createdAt',
            sortDirection: 'desc',
            createdAt: '2026-02-26T00:00:00.000Z',
            updatedAt: '2026-02-26T00:00:00.000Z',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const searches = await apiClient.listSavedSearches();

    expect(searches).toHaveLength(1);
    expect(searches[0]?.id).toBe('search-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/saved-searches',
      expect.objectContaining({ cache: 'no-store' }),
    );
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

  it('unwraps getEntry payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entry: {
          entryId: 'entry-9',
          athleteId: 'athlete-1',
          createdAt: '2026-01-09T00:00:00.000Z',
          sections: { shared: 'shared', private: 'private' },
          sessionMetrics: {
            durationMinutes: 50,
            intensity: 8,
            rounds: 7,
            giOrNoGi: 'gi',
            tags: ['back'],
          },
          rawTechniqueMentions: ['arm drag'],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entry = await apiClient.getEntry('entry-9');

    expect(entry.entryId).toBe('entry-9');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/entries/entry-9',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });

  it('unwraps updateEntry payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entry: {
          entryId: 'entry-10',
          athleteId: 'athlete-1',
          createdAt: '2026-01-10T00:00:00.000Z',
          sections: { shared: 'updated', private: 'updated private' },
          sessionMetrics: {
            durationMinutes: 40,
            intensity: 5,
            rounds: 4,
            giOrNoGi: 'no-gi',
            tags: ['passing'],
          },
          rawTechniqueMentions: [],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const entry = await apiClient.updateEntry('entry-10', {
      sections: { shared: 'updated', private: 'updated private' },
      sessionMetrics: {
        durationMinutes: 40,
        intensity: 5,
        rounds: 4,
        giOrNoGi: 'no-gi',
        tags: ['passing'],
      },
      rawTechniqueMentions: [],
    });

    expect(entry.entryId).toBe('entry-10');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/entries/entry-10',
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });

  it('unwraps createSavedSearch payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        savedSearch: {
          id: 'search-2',
          userId: 'athlete-1',
          name: 'Comp prep',
          query: '',
          tag: 'competition',
          giOrNoGi: 'gi',
          minIntensity: '7',
          maxIntensity: '',
          sortBy: 'intensity',
          sortDirection: 'desc',
          isPinned: true,
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const savedSearch = await apiClient.createSavedSearch({
      name: 'Comp prep',
      query: '',
      tag: 'competition',
      giOrNoGi: 'gi',
      minIntensity: '7',
      maxIntensity: '',
      sortBy: 'intensity',
      sortDirection: 'desc',
      isPinned: true,
    });

    expect(savedSearch.id).toBe('search-2');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/saved-searches',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('unwraps updateSavedSearch payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        savedSearch: {
          id: 'search-3',
          userId: 'athlete-1',
          name: 'Updated',
          query: 'guard',
          tag: '',
          giOrNoGi: '',
          minIntensity: '',
          maxIntensity: '',
          sortBy: 'createdAt',
          sortDirection: 'asc',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T01:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    const savedSearch = await apiClient.updateSavedSearch('search-3', {
      name: 'Updated',
      query: 'guard',
      tag: '',
      giOrNoGi: '',
      minIntensity: '',
      maxIntensity: '',
      sortBy: 'createdAt',
      sortDirection: 'asc',
    });

    expect(savedSearch.id).toBe('search-3');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/saved-searches/search-3',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('calls deleteEntry with DELETE and accepts 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    await apiClient.deleteEntry('entry-11');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/entries/entry-11',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('calls deleteSavedSearch with DELETE and accepts 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    await apiClient.deleteSavedSearch('search-4');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/saved-searches/search-4',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
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

  it('serializes combined entry search query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./apiClient');
    await apiClient.getEntries({
      query: 'knee shield guard',
      dateFrom: '2026-02-01',
      dateTo: '2026-02-29',
      position: 'half guard',
      partner: 'Alex',
      technique: 'knee shield',
      outcome: 'win by sweep',
      classType: 'open mat',
      tag: 'open-mat',
      giOrNoGi: 'no-gi',
      minIntensity: '6',
      maxIntensity: '8',
      sortBy: 'createdAt',
      sortDirection: 'desc',
      limit: '25',
    });

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(calledUrl);

    expect(url.pathname).toBe('/entries');
    expect(url.searchParams.get('q')).toBe('knee shield guard');
    expect(url.searchParams.get('dateFrom')).toBe('2026-02-01');
    expect(url.searchParams.get('dateTo')).toBe('2026-02-29');
    expect(url.searchParams.get('position')).toBe('half guard');
    expect(url.searchParams.get('partner')).toBe('Alex');
    expect(url.searchParams.get('technique')).toBe('knee shield');
    expect(url.searchParams.get('outcome')).toBe('win by sweep');
    expect(url.searchParams.get('classType')).toBe('open mat');
    expect(url.searchParams.get('tag')).toBe('open-mat');
    expect(url.searchParams.get('giOrNoGi')).toBe('no-gi');
    expect(url.searchParams.get('minIntensity')).toBe('6');
    expect(url.searchParams.get('maxIntensity')).toBe('8');
    expect(url.searchParams.get('sortBy')).toBe('createdAt');
    expect(url.searchParams.get('sortDirection')).toBe('desc');
    expect(url.searchParams.get('limit')).toBe('25');
  });
});
