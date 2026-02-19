export type UserRole = 'athlete' | 'coach';

export interface SessionMetrics {
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: string;
  tags: string[];
}

export interface EntrySections {
  private: string;
  shared: string;
}

export interface Entry {
  entryId: string;
  athleteId: string;
  createdAt: string;
  updatedAt: string;
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions: string[];
}

export interface Comment {
  commentId: string;
  entryId: string;
  coachId: string;
  createdAt: string;
  body: string;
  visibility: 'visible' | 'hiddenByAthlete';
}

export interface CoachLink {
  athleteId: string;
  coachId: string;
  createdAt: string;
}

export interface CreateEntryRequest {
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  rawTechniqueMentions?: string[];
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

export interface AIExtractedUpdates {
  summary: string;
  detectedTopics: string[];
  recommendedIntensity?: number;
  followUpActions: string[];
}
