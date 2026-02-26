import { logAuthFailure, logNetworkFailure } from '@/lib/clientErrorLogging';
import { frontendConfig } from '@/lib/config';
import type {
  CommentPayload,
  Entry,
  EntryCreatePayload,
  FeedbackPayload,
  SavedEntrySearch,
  SavedEntrySearchUpsertPayload,
  SignupRequestPayload,
} from '@/types/api';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const baseUrl = frontendConfig.apiBaseUrl;

type TokenGetter = () => string | null;

let getToken: TokenGetter = () => null;

export const configureApiClient = (tokenGetter: TokenGetter) => {
  getToken = tokenGetter;
};

const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const buildAuthHeaders = () => {
  const token = getToken();
  if (!token) return {};

  return {
    Authorization: `Bearer ${token}`,
  };
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  for (const [key, value] of Object.entries(buildAuthHeaders())) {
    headers.set(key, value);
  }

  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const url = joinUrl(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch (error) {
    logNetworkFailure({
      source: 'apiClient',
      url,
      path,
      method,
      authRequired: headers.has('Authorization'),
      error,
    });
    throw error;
  }

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const json = await response.json();
      message = json.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    if (response.status === 401 || response.status === 403) {
      logAuthFailure({
        source: 'apiClient',
        operation: `${method} ${path}`,
        status: response.status,
        message,
        details: {
          url,
          authRequired: headers.has('Authorization'),
        },
      });
    } else {
      logNetworkFailure({
        source: 'apiClient',
        url,
        path,
        method,
        status: response.status,
        authRequired: headers.has('Authorization'),
        responseMessage: message,
      });
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
};

const asEntryArray = (payload: unknown): Entry[] => {
  if (Array.isArray(payload)) {
    return payload as Entry[];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'entries' in payload &&
    Array.isArray((payload as { entries: unknown }).entries)
  ) {
    return (payload as { entries: Entry[] }).entries;
  }

  return [];
};

const asEntryObject = (payload: unknown): Entry => {
  if (payload && typeof payload === 'object' && 'entry' in payload) {
    return (payload as { entry: Entry }).entry;
  }

  return payload as Entry;
};

const asSavedSearchArray = (payload: unknown): SavedEntrySearch[] => {
  if (Array.isArray(payload)) {
    return payload as SavedEntrySearch[];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'savedSearches' in payload &&
    Array.isArray((payload as { savedSearches: unknown }).savedSearches)
  ) {
    return (payload as { savedSearches: SavedEntrySearch[] }).savedSearches;
  }

  return [];
};

const asSavedSearchObject = (payload: unknown): SavedEntrySearch => {
  if (payload && typeof payload === 'object' && 'savedSearch' in payload) {
    return (payload as { savedSearch: SavedEntrySearch }).savedSearch;
  }

  return payload as SavedEntrySearch;
};

export const apiClient = {
  getEntries: async () => {
    const result = await request<unknown>('/entries');
    return asEntryArray(result);
  },
  getEntry: async (entryId: string) => {
    const result = await request<unknown>(`/entries/${entryId}`);
    return asEntryObject(result);
  },
  createEntry: async (payload: EntryCreatePayload) => {
    const result = await request<unknown>('/entries', { method: 'POST', body: JSON.stringify(payload) });
    return asEntryObject(result);
  },
  updateEntry: async (entryId: string, payload: EntryCreatePayload) => {
    const result = await request<unknown>(`/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return asEntryObject(result);
  },
  deleteEntry: (entryId: string) =>
    request(`/entries/${entryId}`, {
      method: 'DELETE',
    }),
  postComment: (payload: CommentPayload) =>
    request('/entries/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exportData: () => request<unknown>('/export'),
  getAthleteEntries: async (athleteId: string) => {
    const result = await request<unknown>(`/athletes/${athleteId}/entries`);
    return asEntryArray(result);
  },
  listSavedSearches: async () => {
    const result = await request<unknown>('/saved-searches');
    return asSavedSearchArray(result);
  },
  createSavedSearch: async (payload: SavedEntrySearchUpsertPayload) => {
    const result = await request<unknown>('/saved-searches', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return asSavedSearchObject(result);
  },
  updateSavedSearch: async (savedSearchId: string, payload: SavedEntrySearchUpsertPayload) => {
    const result = await request<unknown>(`/saved-searches/${savedSearchId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return asSavedSearchObject(result);
  },
  deleteSavedSearch: (savedSearchId: string) =>
    request(`/saved-searches/${savedSearchId}`, {
      method: 'DELETE',
    }),
  linkCoach: (payload: { coachId: string }) =>
    request('/links/coach', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeCoach: (payload: { coachId: string }) =>
    request('/links/coach', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }),
  chat: (payload: { threadId?: string; message: string; context?: string }) =>
    request<{ assistant_text: string; suggested_prompts?: string[] }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  requestSignup: (payload: SignupRequestPayload) =>
    request('/signup-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitFeedback: (payload: FeedbackPayload) =>
    request<{ issueNumber: number; issueUrl: string }>('/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
