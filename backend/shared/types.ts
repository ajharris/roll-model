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
}

export interface Comment {
  commentId: string;
  entryId: string;
  coachId: string;
  createdAt: string;
  body: string;
  visibility: 'visible' | 'hiddenByAthlete';
}

export interface CreateEntryRequest {
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
}

export interface PostCommentRequest {
  entryId: string;
  body: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  statusCode: number;
}
