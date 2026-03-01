export type UserRole = 'athlete' | 'coach' | 'admin';

export interface SessionMetrics {
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: string;
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

export interface PartnerOutcomeNote {
  partnerId: string;
  partnerDisplayName?: string;
  styleTags: string[];
  whatWorked: string[];
  whatFailed: string[];
  guidance?: PartnerGuidance;
}

export type PartnerProfileVisibility = 'private' | 'shared-with-coach';

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

export interface UpsertPartnerProfileRequest {
  displayName: string;
  styleTags: string[];
  notes?: string;
  visibility?: PartnerProfileVisibility;
  guidance?: PartnerGuidance;
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
  sessionContext?: SessionContext;
  partnerOutcomes?: PartnerOutcomeNote[];
  rawTechniqueMentions?: string[];
  mediaAttachments?: MediaAttachment[];
  templateId?: EntryTemplateId;
  actionPackDraft?: ActionPack;
  actionPackFinal?: FinalizedActionPack;
  sessionReviewDraft?: SessionReviewArtifact;
  sessionReviewFinal?: FinalizedSessionReview;
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
export type CheckoffEvidenceSource = 'gpt-structured' | 'manual' | 'coach-review';
export type CheckoffEvidenceMappingStatus = 'pending_confirmation' | 'confirmed' | 'rejected';
export type EvidenceQuality = 'insufficient' | 'adequate' | 'strong';

export interface CheckoffEvidence {
  evidenceId: string;
  checkoffId: string;
  athleteId: string;
  skillId: string;
  entryId: string;
  evidenceType: CheckoffEvidenceType;
  source: CheckoffEvidenceSource;
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
}

export type GapInsightType = 'stale_skill' | 'not_training' | 'repeated_failure';
export type GapInsightImpact = 'high' | 'medium' | 'low';
export type GapPriorityStatus = 'accepted' | 'watch' | 'dismissed';

export interface GapPriorityOverride {
  gapId: string;
  status: GapPriorityStatus;
  manualPriority?: number;
  note?: string;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: 'athlete' | 'coach';
}

export interface UpsertGapPriorityInput {
  gapId: string;
  status: GapPriorityStatus;
  manualPriority?: number;
  note?: string;
}

export interface UpsertGapPrioritiesRequest {
  priorities: UpsertGapPriorityInput[];
}

export interface GapInsightSourceLink {
  entryId: string;
  createdAt: string;
  evidenceId?: string;
  checkoffId?: string;
  skillId?: string;
  position?: string;
  excerpt?: string;
}

export interface GapInsightItem {
  gapId: string;
  type: GapInsightType;
  title: string;
  summary: string;
  score: number;
  impact: GapInsightImpact;
  reasons: string[];
  nextSteps: string[];
  sourceLinks: GapInsightSourceLink[];
  skillId?: string;
  daysSinceLastSeen?: number;
  position?: string;
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

export interface GapInsightsReport {
  athleteId: string;
  generatedAt: string;
  thresholds: GapInsightsThresholds;
  summary: {
    totalGaps: number;
    staleSkillCount: number;
    repeatedFailureCount: number;
    notTrainingCount: number;
  };
  sections: {
    notTraining: GapInsightItem[];
    staleSkills: GapInsightItem[];
    repeatedFailures: GapInsightItem[];
  };
  ranked: GapInsightItem[];
  weeklyFocus: {
    headline: string;
    items: Array<{
      gapId: string;
      title: string;
      reason: string;
      nextStep: string;
    }>;
  };
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

export interface CoachQuestionSetQualitySummary {
  averageScore: number;
  minScore: number;
  hasDuplicates: boolean;
  lowConfidenceCount: number;
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
  qualitySummary: CoachQuestionSetQualitySummary;
  questions: CoachQuestion[];
  coachNote?: string;
  coachEditedAt?: string;
  coachEditedBy?: string;
}

export interface CoachQuestionSetUpdateRequest {
  questionEdits?: Array<{
    questionId: string;
    text: string;
  }>;
  responses?: Array<{
    questionId: string;
    response: string;
  }>;
  coachNote?: string;
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
  status: Extract<CheckoffStatus, 'earned' | 'revalidated'>;
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

export interface AIExtractedUpdates {
  summary: string;
  actionPack: ActionPack;
  sessionReview?: SessionReviewArtifact;
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

export type WeeklyPlanStatus = 'draft' | 'active' | 'completed';
export type WeeklyPlanItemStatus = 'pending' | 'done' | 'skipped';
export type WeeklyPlanSourceType = 'entry-action-pack' | 'checkoff' | 'curriculum-graph' | 'weekly-plan';
export type WeeklyPlanSelectionType =
  | 'primary-skill'
  | 'supporting-concept'
  | 'conditioning-constraint'
  | 'drill'
  | 'positional-round'
  | 'training-constraint';

export interface WeeklyPlanReference {
  sourceType: WeeklyPlanSourceType;
  sourceId: string;
  createdAt?: string;
  summary: string;
}

export interface WeeklyPlanExplainabilityItem {
  selectionType: WeeklyPlanSelectionType;
  selectedValue: string;
  reason: string;
  references: WeeklyPlanReference[];
}

export interface WeeklyPlanMenuItem {
  id: string;
  label: string;
  status: WeeklyPlanItemStatus;
  completedAt?: string;
  coachNote?: string;
}

export interface WeeklyPlanCompletion {
  completedAt?: string;
  outcomeNotes?: string;
}

export interface WeeklyPlanCoachReview {
  reviewedBy: string;
  reviewedAt: string;
  notes?: string;
}

export type WeeklyPositionalFocusType = 'remediate-weakness' | 'reinforce-strength' | 'carry-over';

export interface WeeklyPositionalFocusCard {
  id: string;
  title: string;
  focusType: WeeklyPositionalFocusType;
  priority: number;
  position: string;
  context: string;
  successCriteria: string[];
  rationale: string;
  linkedOneThingCues: string[];
  recurringFailures: string[];
  references: WeeklyPlanReference[];
  status: WeeklyPlanItemStatus;
  coachNote?: string;
}

export interface WeeklyPositionalFocus {
  cards: WeeklyPositionalFocusCard[];
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
  updatedAt: string;
}

export interface WeeklyPlan {
  planId: string;
  athleteId: string;
  weekOf: string;
  generatedAt: string;
  updatedAt: string;
  status: WeeklyPlanStatus;
  primarySkills: string[];
  supportingConcept: string;
  conditioningConstraint: string;
  drills: WeeklyPlanMenuItem[];
  positionalRounds: WeeklyPlanMenuItem[];
  constraints: WeeklyPlanMenuItem[];
  positionalFocus: WeeklyPositionalFocus;
  explainability: WeeklyPlanExplainabilityItem[];
  coachReview?: WeeklyPlanCoachReview;
  completion?: WeeklyPlanCompletion;
}

export type SkillCategory =
  | 'escape'
  | 'pass'
  | 'guard-retention'
  | 'sweep'
  | 'submission'
  | 'takedown'
  | 'control'
  | 'transition'
  | 'concept'
  | 'other';

export interface CurriculumStage {
  stageId: string;
  name: string;
  order: number;
  milestoneSkills: string[];
  notes?: string;
  updatedAt: string;
}

export interface Skill {
  skillId: string;
  name: string;
  category: SkillCategory;
  stageId: string;
  prerequisites: string[];
  keyConcepts: string[];
  commonFailures: string[];
  drills: string[];
  createdAt: string;
  updatedAt: string;
}

export type SkillRelationshipType = 'prerequisite' | 'supports' | 'counter' | 'transition';

export interface SkillRelationship {
  fromSkillId: string;
  toSkillId: string;
  relation: SkillRelationshipType;
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

export type SkillProgressState =
  | 'not_started'
  | 'working'
  | 'evidence_present'
  | 'ready_for_review'
  | 'complete'
  | 'blocked';

export interface SkillProgress {
  athleteId: string;
  skillId: string;
  state: SkillProgressState;
  evidenceCount: number;
  confidence: ConfidenceLevel;
  rationale: string[];
  sourceEntryIds: string[];
  sourceEvidenceIds: string[];
  suggestedNextSkillIds: string[];
  lastEvaluatedAt: string;
  manualOverrideState?: SkillProgressState;
  manualOverrideReason?: string;
  coachReviewedBy?: string;
  coachReviewedAt?: string;
}

export interface CurriculumRecommendation {
  athleteId: string;
  recommendationId: string;
  skillId: string;
  sourceSkillId: string;
  actionType: 'drill' | 'concept' | 'skill';
  actionTitle: string;
  actionDetail: string;
  status: 'draft' | 'active' | 'dismissed';
  relevanceScore: number;
  impactScore: number;
  effortScore: number;
  score: number;
  rationale: string;
  whyNow: string;
  expectedImpact: string;
  sourceEvidence: Array<{
    entryId: string;
    createdAt?: string;
    evidenceId?: string;
    excerpt: string;
    signalType: 'failure-pattern' | 'checkoff-evidence' | 'curriculum-dependency' | 'progress-trend';
  }>;
  supportingNextSkillIds: string[];
  missingPrerequisiteSkillIds: string[];
  generatedAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  coachNote?: string;
  createdByRole?: 'system' | 'coach' | 'athlete';
}

export interface UpsertCurriculumRecommendationInput {
  recommendationId: string;
  status?: CurriculumRecommendation['status'];
  actionType?: CurriculumRecommendation['actionType'];
  actionTitle?: string;
  actionDetail?: string;
  rationale?: string;
  coachNote?: string;
}

export interface UpsertCurriculumRecommendationRequest {
  recommendation: UpsertCurriculumRecommendationInput;
}

export interface CurriculumGraphNode {
  skillId: string;
  label: string;
  priority: number;
  supportingConcepts?: string[];
  conditioningConstraints?: string[];
}

export interface CurriculumGraphEdge {
  fromSkillId: string;
  toSkillId: string;
  relation: 'supports' | 'prerequisite' | 'counter' | 'transition';
  weight?: number;
}

export interface CurriculumGraph {
  athleteId: string;
  graphId: string;
  version: number;
  updatedAt: string;
  nodes: CurriculumGraphNode[];
  edges: CurriculumGraphEdge[];
}
