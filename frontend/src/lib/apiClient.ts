import { logAuthFailure, logNetworkFailure } from '@/lib/clientErrorLogging';
import { frontendConfig } from '@/lib/config';
import type {
  AIExtractedUpdates,
  Checkoff,
  CheckoffEvidence,
  CheckoffEvidenceMappingStatus,
  CheckoffEvidenceType,
  CommentPayload,
  Entry,
  EntryCreatePayload,
  EntrySearchRequest,
  FeedbackPayload,
  GapPriorityOverride,
  GapInsightsReport,
  ProgressAnnotationScope,
  ProgressCoachAnnotation,
  ProgressViewsReport,
  PartnerProfile,
  RestoreDataResult,
  SavedEntrySearch,
  SavedEntrySearchUpsertPayload,
  SignupRequestPayload,
  EntryStructuredMetadataConfirmation,
  EntryStructuredFields,
  UpsertGapPriorityInput,
  UpsertPartnerProfilePayload,
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

const withQueryString = (path: string, query?: EntrySearchRequest) => {
  if (!query) return path;

  const params = new URLSearchParams();
  const append = (key: string, value: string | undefined) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    params.set(key, trimmed);
  };

  append('q', query.query);
  append('dateFrom', query.dateFrom);
  append('dateTo', query.dateTo);
  append('position', query.position);
  append('partner', query.partner);
  append('technique', query.technique);
  append('outcome', query.outcome);
  append('classType', query.classType);
  append('tag', query.tag);
  append('contextTag', query.contextTag);
  append('ruleset', query.ruleset);
  append('minFatigue', query.minFatigue);
  append('maxFatigue', query.maxFatigue);
  append('partnerId', query.partnerId);
  append('partnerStyleTag', query.partnerStyleTag);
  append('giOrNoGi', query.giOrNoGi);
  append('minIntensity', query.minIntensity);
  append('maxIntensity', query.maxIntensity);
  append('sortBy', query.sortBy);
  append('sortDirection', query.sortDirection);
  append('limit', query.limit);
  append('actionPackField', query.actionPackField);
  append('actionPackToken', query.actionPackToken);
  append('actionPackMinConfidence', query.actionPackMinConfidence);

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

type GapInsightsQuery = Partial<{
  staleDays: number;
  lookbackDays: number;
  repeatFailureWindowDays: number;
  repeatFailureMinCount: number;
  topN: number;
}>;

type ProgressViewsQuery = Partial<{
  dateFrom: string;
  dateTo: string;
  contextTags: string[];
  giOrNoGi: 'gi' | 'no-gi';
}>;

const withGapInsightsQueryString = (path: string, query?: GapInsightsQuery) => {
  if (!query) return path;
  const params = new URLSearchParams();
  const appendNum = (key: string, value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    params.set(key, String(Math.trunc(value)));
  };

  appendNum('staleDays', query.staleDays);
  appendNum('lookbackDays', query.lookbackDays);
  appendNum('repeatFailureWindowDays', query.repeatFailureWindowDays);
  appendNum('repeatFailureMinCount', query.repeatFailureMinCount);
  appendNum('topN', query.topN);

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

const withProgressViewsQueryString = (path: string, query?: ProgressViewsQuery) => {
  if (!query) return path;
  const params = new URLSearchParams();
  const append = (key: string, value: string | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    params.set(key, trimmed);
  };

  append('dateFrom', query.dateFrom);
  append('dateTo', query.dateTo);
  append('giOrNoGi', query.giOrNoGi);
  if (Array.isArray(query.contextTags) && query.contextTags.length > 0) {
    params.set(
      'contextTags',
      query.contextTags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(','),
    );
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

const buildAuthHeaders = () => {
  const token = getToken();
  if (!token) return {};

  return {
    Authorization: `Bearer ${token}`,
  };
};

const parseApiErrorMessage = async (response: Response): Promise<string> => {
  try {
    const json = (await response.json()) as { message?: string; error?: { message?: string } };
    return json.message ?? json.error?.message ?? 'Request failed';
  } catch {
    return response.statusText || 'Request failed';
  }
};

const sendRequest = async (path: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  if (init?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

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
    const message = await parseApiErrorMessage(response);
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

  return response;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await sendRequest(path, init);

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

const asPartnerArray = (payload: unknown): PartnerProfile[] => {
  if (
    payload &&
    typeof payload === 'object' &&
    'partners' in payload &&
    Array.isArray((payload as { partners: unknown }).partners)
  ) {
    return (payload as { partners: PartnerProfile[] }).partners;
  }

  if (Array.isArray(payload)) {
    return payload as PartnerProfile[];
  }

  return [];
};

const asPartnerObject = (payload: unknown): PartnerProfile => {
  if (payload && typeof payload === 'object' && 'partner' in payload) {
    return (payload as { partner: PartnerProfile }).partner;
  }
  return payload as PartnerProfile;
};

const asCheckoffArray = (payload: unknown): Checkoff[] => {
  if (
    payload &&
    typeof payload === 'object' &&
    'checkoffs' in payload &&
    Array.isArray((payload as { checkoffs: unknown }).checkoffs)
  ) {
    return (payload as { checkoffs: Checkoff[] }).checkoffs;
  }

  if (Array.isArray(payload)) {
    return payload as Checkoff[];
  }

  return [];
};

const asEntryEvidenceArray = (payload: unknown): CheckoffEvidence[] => {
  if (
    payload &&
    typeof payload === 'object' &&
    'evidence' in payload &&
    Array.isArray((payload as { evidence: unknown }).evidence)
  ) {
    return (payload as { evidence: CheckoffEvidence[] }).evidence;
  }
  if (Array.isArray(payload)) {
    return payload as CheckoffEvidence[];
  }
  return [];
};

export const apiClient = {
  getEntries: async (query?: EntrySearchRequest) => {
    const result = await request<unknown>(withQueryString('/entries', query));
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
  reviewEntryStructuredMetadata: async (
    entryId: string,
    payload: {
      structured?: EntryStructuredFields;
      confirmations?: EntryStructuredMetadataConfirmation[];
    }
  ) => {
    const result = await request<unknown>(`/entries/${entryId}/structured-review`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return asEntryObject(result);
  },
  deleteEntry: (entryId: string) =>
    request(`/entries/${entryId}`, {
      method: 'DELETE',
    }),
  listPartners: async () => {
    const result = await request<unknown>('/partners');
    return asPartnerArray(result);
  },
  getPartner: async (partnerId: string) => {
    const result = await request<unknown>(`/partners/${partnerId}`);
    return asPartnerObject(result);
  },
  createPartner: async (payload: UpsertPartnerProfilePayload) => {
    const result = await request<unknown>('/partners', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return asPartnerObject(result);
  },
  updatePartner: async (partnerId: string, payload: UpsertPartnerProfilePayload) => {
    const result = await request<unknown>(`/partners/${partnerId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return asPartnerObject(result);
  },
  deletePartner: (partnerId: string) =>
    request(`/partners/${partnerId}`, {
      method: 'DELETE',
    }),
  listAthletePartners: async (athleteId: string) => {
    const result = await request<unknown>(`/athletes/${athleteId}/partners`);
    return asPartnerArray(result);
  },
  getAthletePartner: async (athleteId: string, partnerId: string) => {
    const result = await request<unknown>(`/athletes/${athleteId}/partners/${partnerId}`);
    return asPartnerObject(result);
  },
  updateAthletePartner: async (athleteId: string, partnerId: string, payload: Partial<UpsertPartnerProfilePayload>) => {
    const result = await request<unknown>(`/athletes/${athleteId}/partners/${partnerId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return asPartnerObject(result);
  },
  postComment: (payload: CommentPayload) =>
    request('/entries/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exportData: () => request<unknown>('/export'),
  exportEntriesCsv: async () => {
    const response = await sendRequest('/export?format=csv');
    return response.text();
  },
  restoreData: (payload: unknown) =>
    request<RestoreDataResult>('/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAthleteEntries: async (athleteId: string, query?: EntrySearchRequest) => {
    const result = await request<unknown>(withQueryString(`/athletes/${athleteId}/entries`, query));
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
  chat: (payload: { threadId?: string; message: string; context?: Record<string, unknown> }) =>
    request<{ assistant_text: string; extracted_updates?: AIExtractedUpdates; suggested_prompts?: string[] }>(
      '/ai/chat',
      {
      method: 'POST',
      body: JSON.stringify(payload),
      },
    ),
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
  upsertEntryCheckoffEvidence: async (
    entryId: string,
    payload: {
      evidence: Array<{
        skillId: string;
        evidenceType: CheckoffEvidenceType;
        statement: string;
        confidence: 'high' | 'medium' | 'low';
        sourceOutcomeField?: string;
        mappingStatus?: CheckoffEvidenceMappingStatus;
      }>;
    },
  ) =>
    request<{
      checkoffs: Checkoff[];
      evidence: CheckoffEvidence[];
      pendingConfirmationCount: number;
    }>(`/entries/${entryId}/checkoff-evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEntryCheckoffEvidence: async (entryId: string) => {
    const result = await request<unknown>(`/entries/${entryId}/checkoff-evidence`);
    return asEntryEvidenceArray(result);
  },
  listCheckoffs: async () => {
    const result = await request<unknown>('/checkoffs');
    return asCheckoffArray(result);
  },
  reviewCheckoff: async (
    checkoffId: string,
    payload: {
      status?: 'pending' | 'earned' | 'superseded' | 'revalidated';
      evidenceReviews: Array<{
        evidenceId: string;
        mappingStatus?: CheckoffEvidenceMappingStatus;
        quality?: 'insufficient' | 'adequate' | 'strong';
        coachNote?: string;
      }>;
    },
  ) =>
    request<{ checkoff: Checkoff; evidence: CheckoffEvidence[] }>(`/checkoffs/${checkoffId}/review`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getGapInsights: async (query?: GapInsightsQuery) => {
    const result = await request<{ report?: GapInsightsReport } | GapInsightsReport>(
      withGapInsightsQueryString('/gap-insights', query),
    );
    return (result as { report?: GapInsightsReport }).report ?? (result as GapInsightsReport);
  },
  getAthleteGapInsights: async (athleteId: string, query?: GapInsightsQuery) => {
    const result = await request<{ report?: GapInsightsReport } | GapInsightsReport>(
      withGapInsightsQueryString(`/athletes/${athleteId}/gap-insights`, query),
    );
    return (result as { report?: GapInsightsReport }).report ?? (result as GapInsightsReport);
  },
  upsertGapPriorities: (payload: { priorities: UpsertGapPriorityInput[] }) =>
    request<{ saved: GapPriorityOverride[] }>('/gap-insights/priorities', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  upsertAthleteGapPriorities: (athleteId: string, payload: { priorities: UpsertGapPriorityInput[] }) =>
    request<{ saved: GapPriorityOverride[] }>(`/athletes/${athleteId}/gap-insights/priorities`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getProgressViews: async (query?: ProgressViewsQuery) => {
    const result = await request<{ report?: ProgressViewsReport } | ProgressViewsReport>(
      withProgressViewsQueryString('/progress-views', query),
    );
    return (result as { report?: ProgressViewsReport }).report ?? (result as ProgressViewsReport);
  },
  getAthleteProgressViews: async (athleteId: string, query?: ProgressViewsQuery) => {
    const result = await request<{ report?: ProgressViewsReport } | ProgressViewsReport>(
      withProgressViewsQueryString(`/athletes/${athleteId}/progress-views`, query),
    );
    return (result as { report?: ProgressViewsReport }).report ?? (result as ProgressViewsReport);
  },
  upsertProgressAnnotation: (
    payload: {
      scope: ProgressAnnotationScope;
      targetKey?: string;
      note: string;
      correction?: string;
    },
    annotationId?: string,
  ) =>
    request<{ annotation: ProgressCoachAnnotation }>(
      annotationId ? `/progress-views/annotations/${annotationId}` : '/progress-views/annotations',
      {
        method: annotationId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    ),
  upsertAthleteProgressAnnotation: (
    athleteId: string,
    payload: {
      scope: ProgressAnnotationScope;
      targetKey?: string;
      note: string;
      correction?: string;
    },
    annotationId?: string,
  ) =>
    request<{ annotation: ProgressCoachAnnotation }>(
      annotationId
        ? `/athletes/${athleteId}/progress-views/annotations/${annotationId}`
        : `/athletes/${athleteId}/progress-views/annotations`,
      {
        method: annotationId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    ),
};
