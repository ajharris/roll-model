export type UserRole = 'athlete' | 'coach' | 'admin' | 'unknown';

export interface EntrySections {
  private?: string;
  shared: string;
}

export interface MediaClipNote {
  clipId: string;
  label: string;
  note: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface MediaAttachment {
  mediaId: string;
  title: string;
  url: string;
  notes?: string;
  clipNotes: MediaClipNote[];
}

export interface SessionMetrics {
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: 'gi' | 'no-gi';
  tags: string[];
}

export interface Entry {
  entryId: string;
  athleteId: string;
  createdAt: string;
  updatedAt?: string;
  schemaVersion?: number;
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions: string[];
  mediaAttachments?: MediaAttachment[];
}

export interface CommentPayload {
  entryId: string;
  body: string;
}

export interface EntryCreatePayload {
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions: string[];
  mediaAttachments?: MediaAttachment[];
}

export type EntrySearchSortBy = 'createdAt' | 'intensity';
export type EntrySearchSortDirection = 'asc' | 'desc';

export interface EntrySearchRequest {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  position?: string;
  partner?: string;
  technique?: string;
  outcome?: string;
  classType?: string;
  tag?: string;
  giOrNoGi?: '' | 'gi' | 'no-gi';
  minIntensity?: string;
  maxIntensity?: string;
  sortBy?: EntrySearchSortBy;
  sortDirection?: EntrySearchSortDirection;
  limit?: string;
}

export interface EntrySearchMeta {
  queryApplied: boolean;
  scannedCount: number;
  matchedCount: number;
  latencyMs: number;
  latencyTargetMs: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export type FeedbackType = 'bug' | 'feature' | 'other';

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
}

export interface SignupRequestPayload {
  email: string;
  name?: string;
  notes?: string;
  intendedRole?: string;
}

export interface RestoreDataPayload {
  schemaVersion: string;
  generatedAt: string;
  full: {
    athleteId: string;
    entries: unknown[];
    comments: unknown[];
    links: unknown[];
    aiThreads: unknown[];
    aiMessages: unknown[];
  };
}

export interface RestoreDataResult {
  restored: boolean;
  athleteId: string;
  counts: {
    entries: number;
    comments: number;
    links: number;
    aiThreads: number;
    aiMessages: number;
    itemsWritten: number;
  };
}

export type SavedEntrySearchSortBy = EntrySearchSortBy;
export type SavedEntrySearchSortDirection = EntrySearchSortDirection;

export interface SavedEntrySearch {
  id: string;
  userId?: string;
  name: string;
  query: string;
  tag: string;
  giOrNoGi: '' | 'gi' | 'no-gi';
  minIntensity: string;
  maxIntensity: string;
  dateFrom?: string;
  dateTo?: string;
  position?: string;
  partner?: string;
  technique?: string;
  outcome?: string;
  classType?: string;
  sortBy: SavedEntrySearchSortBy;
  sortDirection: SavedEntrySearchSortDirection;
  isPinned?: boolean;
  isFavorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SavedEntrySearchUpsertPayload {
  name: string;
  query: string;
  tag: string;
  giOrNoGi: '' | 'gi' | 'no-gi';
  minIntensity: string;
  maxIntensity: string;
  dateFrom?: string;
  dateTo?: string;
  position?: string;
  partner?: string;
  technique?: string;
  outcome?: string;
  classType?: string;
  sortBy: SavedEntrySearchSortBy;
  sortDirection: SavedEntrySearchSortDirection;
  isPinned?: boolean;
  isFavorite?: boolean;
}
