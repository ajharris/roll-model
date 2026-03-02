export type UserRole = 'athlete' | 'coach' | 'admin' | 'unknown';

export interface EntrySections {
  private?: string;
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

export interface SessionMetrics {
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: 'gi' | 'no-gi';
  tags: string[];
}

export interface SessionContext {
  ruleset?: string;
  fatigueLevel?: number;
  injuryNotes: string[];
  tags: string[];
}

export interface PartnerGuidance {
  draft?: string;
  final?: string;
  coachReview?: CoachReviewState;
}

export type PartnerProfileVisibility = 'private' | 'shared-with-coach';

export interface PartnerOutcomeNote {
  partnerId: string;
  partnerDisplayName?: string;
  styleTags: string[];
  whatWorked: string[];
  whatFailed: string[];
  guidance?: PartnerGuidance;
}

export interface PartnerProfile {
  partnerId: string;
  athleteId: string;
  displayName: string;
  styleTags: string[];
  notes?: string;
  visibility: PartnerProfileVisibility;
  guidance?: PartnerGuidance;
  createdAt: string;
  updatedAt: string;
}

export interface EntryQuickAdd {
  time: string;
  class: string;
  gym: string;
  partners: string[];
  rounds: number;
  notes: string;
}

export interface Entry {
  entryId: string;
  athleteId: string;
  createdAt: string;
  updatedAt?: string;
  schemaVersion?: number;
  quickAdd?: EntryQuickAdd;
  structured?: EntryStructuredFields;
  structuredExtraction?: EntryStructuredExtraction;
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  sessionContext?: SessionContext;
  partnerOutcomes?: PartnerOutcomeNote[];
  rawTechniqueMentions: string[];
  mediaAttachments?: MediaAttachment[];
  templateId?: EntryTemplateId;
  actionPackDraft?: ActionPack;
  actionPackFinal?: FinalizedActionPack;
  sessionReviewDraft?: SessionReviewArtifact;
  sessionReviewFinal?: FinalizedSessionReview;
}

export type EntryStructuredFieldKey = 'position' | 'technique' | 'outcome' | 'problem' | 'cue';
export type EntryStructuredSuggestionStatus = 'suggested' | 'confirmed' | 'corrected' | 'rejected';

export interface EntryStructuredFields {
  position?: string;
  technique?: string;
  outcome?: string;
  problem?: string;
  cue?: string;
  constraint?: string;
}

export interface EntryStructuredSuggestion {
  field: EntryStructuredFieldKey;
  value: string;
  confidence: ConfidenceLevel;
  status: EntryStructuredSuggestionStatus;
  confirmationPrompt?: string;
  correctionValue?: string;
  note?: string;
  sourceExcerpt?: string;
  updatedAt: string;
  updatedByRole?: 'athlete' | 'coach';
}

export interface EntryStructuredExtraction {
  generatedAt: string;
  suggestions: EntryStructuredSuggestion[];
  concepts: string[];
  failures: string[];
  conditioningIssues: string[];
  confidenceFlags: Array<{
    field: EntryStructuredFieldKey;
    confidence: ConfidenceLevel;
    note?: string;
  }>;
}

export interface EntryStructuredMetadataConfirmation {
  field: EntryStructuredFieldKey;
  status: 'confirmed' | 'corrected' | 'rejected';
  correctionValue?: string;
  note?: string;
}

export interface CommentPayload {
  entryId: string;
  body: string;
}

export interface EntryCreatePayload {
  sections: EntrySections;
  sessionMetrics: SessionMetrics;
  structured?: EntryStructuredFields;
  structuredMetadataConfirmations?: EntryStructuredMetadataConfirmation[];
  sessionContext?: SessionContext;
  partnerOutcomes?: PartnerOutcomeNote[];
  rawTechniqueMentions: string[];
  mediaAttachments?: MediaAttachment[];
  templateId?: EntryTemplateId;
  actionPackDraft?: ActionPack;
  actionPackFinal?: FinalizedActionPack;
  sessionReviewDraft?: SessionReviewArtifact;
  sessionReviewFinal?: FinalizedSessionReview;
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

export type SessionReviewFieldKey =
  | 'whatWorked'
  | 'whatFailed'
  | 'whatToAskCoach'
  | 'whatToDrillSolo'
  | 'oneThing';

export interface SessionReviewConfidenceFlag {
  field: SessionReviewFieldKey;
  confidence: ConfidenceLevel;
  note?: string;
}

export interface SessionReviewPromptSet {
  whatWorked: string[];
  whatFailed: string[];
  whatToAskCoach: string[];
  whatToDrillSolo: string[];
}

export interface SessionReviewArtifact {
  promptSet: SessionReviewPromptSet;
  oneThing: string;
  confidenceFlags: SessionReviewConfidenceFlag[];
}

export interface FinalizedSessionReview {
  review: SessionReviewArtifact;
  coachReview?: CoachReviewState;
  finalizedAt: string;
}

export type CheckoffStatus = 'pending' | 'earned' | 'superseded' | 'revalidated';
export type CheckoffEvidenceType =
  | 'hit-in-live-roll'
  | 'hit-on-equal-or-better-partner'
  | 'demonstrate-clean-reps'
  | 'explain-counters-and-recounters';
export type CheckoffEvidenceMappingStatus = 'pending_confirmation' | 'confirmed' | 'rejected';
export type EvidenceQuality = 'insufficient' | 'adequate' | 'strong';

export interface CheckoffEvidence {
  evidenceId: string;
  checkoffId: string;
  athleteId: string;
  skillId: string;
  entryId: string;
  evidenceType: CheckoffEvidenceType;
  source: 'gpt-structured' | 'manual' | 'coach-review';
  statement: string;
  confidence: ConfidenceLevel;
  mappingStatus: CheckoffEvidenceMappingStatus;
  sourceOutcomeField?: ActionPackFieldKey;
  quality?: EvidenceQuality;
  coachNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checkoff {
  checkoffId: string;
  athleteId: string;
  skillId: string;
  evidenceType: CheckoffEvidenceType;
  status: CheckoffStatus;
  minEvidenceRequired: number;
  confirmedEvidenceCount: number;
  createdAt: string;
  updatedAt: string;
  earnedAt?: string;
  supersededAt?: string;
  revalidatedAt?: string;
  coachReviewedAt?: string;
  coachReviewedBy?: string;
  evidence?: CheckoffEvidence[];
}

export interface AIExtractedUpdates {
  summary: string;
  actionPack: ActionPack;
  sessionReview?: SessionReviewArtifact;
  coachReview?: CoachReviewState;
  suggestedFollowUpQuestions: string[];
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
  contextTag?: string;
  ruleset?: string;
  minFatigue?: string;
  maxFatigue?: string;
  partnerId?: string;
  partnerStyleTag?: string;
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

export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface FeedbackScreenshotAttachment {
  url: string;
  caption?: string;
}

export interface FeedbackReviewerWorkflow {
  requiresReview: boolean;
  reviewerRole?: 'coach' | 'admin';
  note?: string;
}

export interface FeedbackNormalizationState {
  usedGpt: boolean;
  originalProblem?: string;
  originalProposedChange?: string;
}
export type FeedbackType = 'bug' | 'feature' | 'ui' | 'other';

export interface FeedbackPayload {
  type: FeedbackType;
  problem: string;
  proposedChange: string;
  contextSteps: string;
  severity: FeedbackSeverity;
  screenshots: FeedbackScreenshotAttachment[];
  reviewerWorkflow?: FeedbackReviewerWorkflow;
  normalization?: FeedbackNormalizationState;
  previewConfirmed: boolean;
}

export interface FeedbackSubmissionResult {
  feedbackId: string;
  issueNumber: number;
  issueUrl: string;
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
    partnerProfiles: number;
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

export interface UpsertPartnerProfilePayload {
  displayName: string;
  styleTags: string[];
  notes?: string;
  visibility?: PartnerProfileVisibility;
  guidance?: PartnerGuidance;
}

export type GapInsightType = 'not_training' | 'stale_skill' | 'repeated_failure';
export type GapPriorityStatus = 'accepted' | 'watch' | 'dismissed';

export interface GapInsightSourceLink {
  entryId: string;
  createdAt: string;
  evidenceId?: string;
  checkoffId?: string;
  skillId?: string;
  position?: string;
  excerpt?: string;
}

export interface GapPriorityOverride {
  gapId: string;
  status: GapPriorityStatus;
  manualPriority?: number;
  note?: string;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: 'athlete' | 'coach';
}

export interface GapInsightItem {
  gapId: string;
  type: GapInsightType;
  title: string;
  summary: string;
  score: number;
  impact: 'high' | 'medium' | 'low';
  reasons: string[];
  nextSteps: string[];
  sourceLinks: GapInsightSourceLink[];
  skillId?: string;
  position?: string;
  daysSinceLastSeen?: number;
  repeatCount?: number;
  failureExamples?: string[];
  priority?: GapPriorityOverride;
}

export interface GapInsightsThresholds {
  staleDays: number;
  lookbackDays: number;
  repeatFailureWindowDays: number;
  repeatFailureMinCount: number;
  topN: number;
}

export interface GapInsightsSummary {
  totalGaps: number;
  staleSkillCount: number;
  repeatedFailureCount: number;
  notTrainingCount: number;
}

export interface WeeklyFocusItem {
  gapId: string;
  title: string;
  reason: string;
  nextStep: string;
}

export interface GapInsightsReport {
  athleteId: string;
  generatedAt: string;
  thresholds: GapInsightsThresholds;
  summary: GapInsightsSummary;
  sections: {
    notTraining: GapInsightItem[];
    staleSkills: GapInsightItem[];
    repeatedFailures: GapInsightItem[];
  };
  ranked: GapInsightItem[];
  weeklyFocus: {
    headline: string;
    items: WeeklyFocusItem[];
  };
}

export interface UpsertGapPriorityInput {
  gapId: string;
  status: GapPriorityStatus;
  manualPriority?: number;
  note?: string;
}

export type CoachQuestionSignalType = 'unresolved_blocker' | 'repeated_failure' | 'decision_point';
export type CoachQuestionGenerationReason = 'initial' | 'regenerate' | 'low-confidence-refresh';

export interface CoachQuestionEvidence {
  entryId: string;
  createdAt: string;
  signalType: CoachQuestionSignalType;
  excerpt: string;
}

export interface CoachQuestionRubricScore {
  specific: number;
  testable: number;
  coachActionable: number;
  evidenceBacked: number;
  nonDuplicative: number;
  total: number;
  needsRevision: boolean;
  notes: string[];
}

export interface CoachQuestion {
  questionId: string;
  text: string;
  priority: 1 | 2 | 3;
  signalType: CoachQuestionSignalType;
  issueKey: string;
  confidence: ConfidenceLevel;
  evidence: CoachQuestionEvidence[];
  rubric: CoachQuestionRubricScore;
  coachEditedText?: string;
  athleteResponse?: string;
}

export interface CoachQuestionSet {
  questionSetId: string;
  athleteId: string;
  generatedAt: string;
  updatedAt: string;
  sourceEntryIds: string[];
  generationReason: CoachQuestionGenerationReason;
  generatedBy: string;
  generatedByRole: 'athlete' | 'coach';
  model: string;
  promptVersion: number;
  qualitySummary: {
    averageScore: number;
    minScore: number;
    hasDuplicates: boolean;
    lowConfidenceCount: number;
  };
  questions: CoachQuestion[];
  coachNote?: string;
  coachEditedAt?: string;
  coachEditedBy?: string;
}

export interface ProgressViewsFilters {
  dateFrom?: string;
  dateTo?: string;
  contextTags: string[];
  giOrNoGi?: '' | 'gi' | 'no-gi';
}

export interface ProgressLowConfidenceFlag {
  entryId: string;
  createdAt: string;
  source: 'action-pack' | 'session-review' | 'outcome-extraction';
  field: string;
  confidence: ConfidenceLevel;
  note?: string;
  metric: 'timeline' | 'position-heatmap' | 'outcome-trend';
}

export interface SkillTimelinePoint {
  date: string;
  skillId: string;
  status: 'earned' | 'revalidated';
  evidenceCount: number;
  confidence: ConfidenceLevel;
  lowConfidence: boolean;
}

export interface SkillTimelineSeriesPoint {
  date: string;
  cumulativeSkills: number;
}

export interface SkillTimelineDataset {
  events: SkillTimelinePoint[];
  cumulative: SkillTimelineSeriesPoint[];
}

export interface PositionHeatmapCell {
  position: string;
  trainedCount: number;
  lowConfidenceCount: number;
  neglected: boolean;
  lastSeenAt?: string;
}

export interface PositionHeatmapDataset {
  cells: PositionHeatmapCell[];
  maxTrainedCount: number;
  neglectedThreshold: number;
}

export interface OutcomeTrendPoint {
  date: string;
  escapesSuccessRate: number | null;
  guardRetentionFailureRate: number | null;
  escapesSuccesses: number;
  escapeAttempts: number;
  guardRetentionFailures: number;
  guardRetentionObservations: number;
  lowConfidenceCount: number;
}

export interface OutcomeTrendsDataset {
  points: OutcomeTrendPoint[];
}

export type ProgressAnnotationScope = 'general' | 'timeline' | 'position-heatmap' | 'outcome-trend';

export interface ProgressCoachAnnotation {
  annotationId: string;
  athleteId: string;
  scope: ProgressAnnotationScope;
  targetKey?: string;
  note: string;
  correction?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface ProgressViewsReport {
  athleteId: string;
  generatedAt: string;
  filters: ProgressViewsFilters;
  timeline: SkillTimelineDataset;
  positionHeatmap: PositionHeatmapDataset;
  outcomeTrends: OutcomeTrendsDataset;
  lowConfidenceFlags: ProgressLowConfidenceFlag[];
  coachAnnotations: ProgressCoachAnnotation[];
  sourceSummary: {
    sessionsConsidered: number;
    structuredSessions: number;
    checkoffsConsidered: number;
  };
}

export type ShareVisibility = 'private';
export type ShareLinkStatus = 'active' | 'revoked';
export type ShareFieldKey =
  | 'quickAdd'
  | 'sections.shared'
  | 'sessionMetrics'
  | 'sessionContext'
  | 'structured'
  | 'structuredExtraction'
  | 'actionPack'
  | 'sessionReview'
  | 'rawTechniqueMentions'
  | 'mediaAttachments'
  | 'partnerOutcomes';

export interface ShareCoachReviewState {
  required: boolean;
  approved: boolean;
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
}

export interface SharePolicy {
  visibility: ShareVisibility;
  includeFields: ShareFieldKey[];
  excludeFields: ShareFieldKey[];
  includePartnerData: boolean;
  entryIds?: string[];
  requireCoachReview: boolean;
}

export interface SharedSessionHighlight {
  entryId: string;
  createdAt: string;
  quickAdd?: EntryQuickAdd;
  sharedSection?: string;
  sessionMetrics?: SessionMetrics;
  sessionContext?: SessionContext;
  structured?: EntryStructuredFields;
  structuredExtraction?: EntryStructuredExtraction;
  actionPack?: ActionPack;
  sessionReview?: SessionReviewArtifact;
  rawTechniqueMentions?: string[];
  mediaAttachments?: MediaAttachment[];
  partnerOutcomes?: PartnerOutcomeNote[];
}

export interface SharedSessionSummary {
  summaryId: string;
  athleteId: string;
  generatedAt: string;
  payloadVersion: number;
  sourceEntryIds: string[];
  scope: {
    visibility: ShareVisibility;
    includeFields: ShareFieldKey[];
    excludeFields: ShareFieldKey[];
    includePartnerData: boolean;
    readOnly: true;
  };
  aggregate: {
    topConcepts: string[];
    recurringFailures: string[];
    conditioningIssues: string[];
  };
  highlights: SharedSessionHighlight[];
}

export interface ShareLink {
  shareId: string;
  athleteId: string;
  status: ShareLinkStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt?: string;
  payloadVersion: number;
  policy: SharePolicy;
  coachReview: ShareCoachReviewState;
}

export interface CreateShareLinkPayload {
  visibility?: ShareVisibility;
  includeFields?: ShareFieldKey[];
  excludeFields?: ShareFieldKey[];
  includePartnerData?: boolean;
  entryIds?: string[];
  requireCoachReview?: boolean;
  coachReview?: ShareCoachReviewState;
  expiresInHours?: number;
}
