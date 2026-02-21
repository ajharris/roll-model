import type {
  CommentPayload,
  Entry,
  EntryCreatePayload,
} from '@/types/api';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!baseUrl) {
  console.warn('NEXT_PUBLIC_API_BASE_URL is not set. API calls will fail.');
}

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

  const url = joinUrl(baseUrl ?? '', path);
  const response = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const json = await response.json();
      message = json.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
};

export const apiClient = {
  getEntries: async () => {
    const result = await request<{ entries: Entry[] }>('/entries');
    return result.entries;
  },
  createEntry: async (payload: EntryCreatePayload) => {
    const result = await request<{ entry: Entry }>('/entries', { method: 'POST', body: JSON.stringify(payload) });
    return result.entry;
  },
  postComment: (payload: CommentPayload) =>
    request('/entries/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exportData: () => request<unknown>('/export'),
  getAthleteEntries: async (athleteId: string) => {
    const result = await request<{ entries: Entry[] }>(`/athletes/${athleteId}/entries`);
    return result.entries;
  },
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
};
