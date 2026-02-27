export type UserRole = 'athlete' | 'coach' | 'admin';

export interface SessionMetrics {
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: string;
  tags: string[];
}

export interface EntryQuickAdd {
  time: string;
  class: string;
  gym: string;
  partners: string[];
  rounds: number;
  notes: string;
}

export interface EntryStructuredFields {
  position?: string;
  technique?: string;
  outcome?: string;
  problem?: string;
  cue?: string;
  constraint?: string;
}

export type EntryTag =
  | 'guard-type'
  | 'top'
  | 'bottom'
  | 'submission'
  | 'sweep'
  | 'pass'
  | 'escape'
  | 'takedown';

export interface EntrySections {
  private: string;
  shared: string;
}

export interface MediaClipNote {
  clipId: string;
  timestamp: string;
  text: string;
}

export interface MediaAttachment {
  mediaId: string;
  title: string;
  url: string;
  notes?: string;
  clipNotes: MediaClipNote[];
}

export interface Entry {
  entryId: string;
  athleteId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  quickAdd: EntryQuickAdd;
  structured?: EntryStructuredFields;
  tags: EntryTag[];
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions: string[];
  mediaAttachments?: MediaAttachment[];
  templateId?: EntryTemplateId;
  actionPackDraft?: ActionPack;
  actionPackFinal?: FinalizedActionPack;
}

export interface Comment {
  commentId: string;
  entryId: string;
  coachId: string;
  createdAt: string;
  body: string;
  visibility: 'visible' | 'hiddenByAthlete';
}

export type CoachLinkStatus = 'pending' | 'active' | 'revoked';

export interface CoachLink {
  athleteId: string;
  coachId: string;
  status: CoachLinkStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateEntryRequest {
  quickAdd: EntryQuickAdd;
  structured?: EntryStructuredFields;
  tags: EntryTag[];
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions?: string[];
  mediaAttachments?: MediaAttachment[];
  templateId?: EntryTemplateId;
  actionPackDraft?: ActionPack;
  actionPackFinal?: FinalizedActionPack;
}

export type UpdateEntryRequest = CreateEntryRequest;

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
  actionPackField?: ActionPackFieldKey;
  actionPackToken?: string;
  actionPackMinConfidence?: ConfidenceLevel;
}

export interface EntrySearchMeta {
  queryApplied: boolean;
  scannedCount: number;
  matchedCount: number;
  latencyMs: number;
  latencyTargetMs: number;
}

export interface TechniqueCandidate {
  phrase: string;
  normalizedPhrase: string;
  count: number;
  lastSeenAt: string;
  exampleEntryIds: string[];
  status: string;
}

export interface PostCommentRequest {
  entryId?: string;
  body: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  statusCode: number;
}

export interface AIThread {
  threadId: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
}

export type AIMessageRole = 'user' | 'assistant';
export type AIVisibilityScope = 'private' | 'shared';

export interface AIMessage {
  messageId: string;
  threadId: string;
  role: AIMessageRole;
  content: string;
  visibilityScope: AIVisibilityScope;
  createdAt: string;
}

export interface AIChatContext {
  athleteId?: string;
  entryIds?: string[];
  dateRange?: {
    from?: string;
    to?: string;
  };
  includePrivate?: boolean;
  keywords?: string[];
}

export interface AIChatRequest {
  threadId?: string;
  message: string;
  context?: AIChatContext;
}

export type EntryTemplateId = 'class-notes' | 'open-mat-rounds' | 'drill-session';

export type ActionPackFieldKey =
  | 'wins'
  | 'leaks'
  | 'oneFocus'
  | 'drills'
  | 'positionalRequests'
  | 'fallbackDecisionGuidance';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ActionPackConfidenceFlag {
  field: ActionPackFieldKey;
  confidence: ConfidenceLevel;
  note?: string;
}

export interface ActionPack {
  wins: string[];
  leaks: string[];
  oneFocus: string;
  drills: string[];
  positionalRequests: string[];
  fallbackDecisionGuidance: string;
  confidenceFlags: ActionPackConfidenceFlag[];
}

export interface CoachReviewState {
  requiresReview: boolean;
  coachNotes?: string;
  reviewedAt?: string;
}

export interface FinalizedActionPack {
  actionPack: ActionPack;
  coachReview?: CoachReviewState;
  finalizedAt: string;
}

export interface AIExtractedUpdates {
  summary: string;
  actionPack: ActionPack;
  coachReview?: CoachReviewState;
  suggestedFollowUpQuestions: string[];
}

export type SavedEntrySearchSortBy = 'createdAt' | 'intensity';
export type SavedEntrySearchSortDirection = 'asc' | 'desc';
export type GiOrNoGiFilter = '' | 'gi' | 'no-gi';

export interface SavedEntrySearch {
  id: string;
  userId: string;
  name: string;
  query: string;
  tag: string;
  giOrNoGi: GiOrNoGiFilter;
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
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSavedEntrySearchRequest {
  name: string;
  query: string;
  tag: string;
  giOrNoGi: GiOrNoGiFilter;
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
