import { ApiError } from './responses';
import type {
  Checkoff,
  CheckoffEvidence,
  ConfidenceLevel,
  Entry,
  ProgressAnnotationScope,
  ProgressCoachAnnotation,
  ProgressLowConfidenceFlag,
  ProgressViewsFilters,
  ProgressViewsReport,
  SkillTimelinePoint,
  SkillTimelineSeriesPoint
} from './types';

export const PROGRESS_VIEWS_LATEST_SK = 'PROGRESS_VIEWS#LATEST';
export const PROGRESS_ANNOTATION_SK_PREFIX = 'PROGRESS_ANNOTATION#';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const normalizeTag = (value: string): string => value.trim().toLowerCase();

const normalizeDate = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    invalid(`Invalid ISO datetime "${value}".`);
  }
  return new Date(parsed).toISOString();
};

const parseIsoDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return normalizeDate(trimmed);
};

export const parseProgressViewsFilters = (
  query: Record<string, string | undefined> | null | undefined
): ProgressViewsFilters => {
  const dateFrom = parseIsoDate(query?.dateFrom);
  const dateTo = parseIsoDate(query?.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    invalid('dateFrom must be on or before dateTo.');
  }

  const giOrNoGi = query?.giOrNoGi?.trim();
  if (giOrNoGi && giOrNoGi !== 'gi' && giOrNoGi !== 'no-gi') {
    invalid('giOrNoGi must be "gi" or "no-gi".');
  }

  const contextTags = (query?.contextTags ?? '')
    .split(',')
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  return {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    contextTags,
    ...(giOrNoGi ? { giOrNoGi: giOrNoGi as 'gi' | 'no-gi' } : {})
  };
};

const confidenceRank = (value: ConfidenceLevel): number => {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
};

const outcomeTextIncludes = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));

const ESCAPE_PATTERNS = [/\bescape\b/i, /\bescaped\b/i, /\bget out\b/i, /\brecover(ed)?\b/i];
const GUARD_PATTERNS = [/\bguard\b/i, /\bretention\b/i, /\bretain\b/i];
const FAILURE_PATTERNS = [/\bpass(ed)?\b/i, /\blost\b/i, /\bfail(ed|ure)?\b/i, /\bbroke(n)?\b/i];

const toDay = (value: string): string => value.slice(0, 10);

const withinDateRange = (valueIso: string, filters: ProgressViewsFilters): boolean => {
  if (filters.dateFrom && valueIso < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo && valueIso > filters.dateTo) {
    return false;
  }
  return true;
};

const entryMatchesFilters = (entry: Entry, filters: ProgressViewsFilters): boolean => {
  if (!withinDateRange(entry.createdAt, filters)) {
    return false;
  }

  if (filters.giOrNoGi && entry.sessionMetrics.giOrNoGi !== filters.giOrNoGi) {
    return false;
  }

  if (filters.contextTags.length === 0) {
    return true;
  }

  const tags = new Set<string>([
    ...entry.tags.map((tag) => normalizeTag(tag)),
    ...entry.sessionMetrics.tags.map((tag) => normalizeTag(tag))
  ]);
  return filters.contextTags.every((tag) => tags.has(tag));
};

const entryActionPack = (entry: Entry) => entry.actionPackFinal?.actionPack ?? entry.actionPackDraft;
const entrySessionReview = (entry: Entry) => entry.sessionReviewFinal?.review ?? entry.sessionReviewDraft;

const isStructuredSession = (entry: Entry): boolean => Boolean(entryActionPack(entry) || entrySessionReview(entry));

const extractLowConfidenceFlags = (entry: Entry): ProgressLowConfidenceFlag[] => {
  const flags: ProgressLowConfidenceFlag[] = [];
  const actionPack = entryActionPack(entry);
  const sessionReview = entrySessionReview(entry);

  for (const flag of actionPack?.confidenceFlags ?? []) {
    if (flag.confidence !== 'low') continue;
    const metric =
      flag.field === 'positionalRequests'
        ? 'position-heatmap'
        : flag.field === 'wins' || flag.field === 'leaks' || flag.field === 'oneFocus'
          ? 'outcome-trend'
          : 'timeline';
    flags.push({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      source: 'action-pack',
      field: flag.field,
      confidence: 'low',
      note: flag.note,
      metric
    });
  }

  for (const flag of sessionReview?.confidenceFlags ?? []) {
    if (flag.confidence !== 'low') continue;
    const metric = flag.field === 'whatFailed' || flag.field === 'whatWorked' ? 'outcome-trend' : 'timeline';
    flags.push({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      source: 'session-review',
      field: flag.field,
      confidence: 'low',
      note: flag.note,
      metric
    });
  }

  return flags;
};

const parseOutcomeSignals = (entry: Entry): {
  escapesSuccesses: number;
  escapeAttempts: number;
  guardRetentionFailures: number;
  guardRetentionObservations: number;
} => {
  const actionPack = entryActionPack(entry);
  const outcomeText = entry.structured?.outcome?.trim() ?? '';

  const winTexts = actionPack?.wins ?? [];
  const leakTexts = actionPack?.leaks ?? [];
  const focusTexts = [actionPack?.oneFocus ?? '', outcomeText].filter(Boolean);

  const escapeSuccesses = winTexts.filter((text) => outcomeTextIncludes(text, ESCAPE_PATTERNS)).length;
  const escapeMentions = [...winTexts, ...leakTexts, ...focusTexts].filter((text) => outcomeTextIncludes(text, ESCAPE_PATTERNS))
    .length;

  const guardFailures = leakTexts.filter(
    (text) => outcomeTextIncludes(text, GUARD_PATTERNS) && outcomeTextIncludes(text, FAILURE_PATTERNS)
  ).length;
  const guardMentions = [...winTexts, ...leakTexts, ...focusTexts].filter((text) => outcomeTextIncludes(text, GUARD_PATTERNS))
    .length;

  return {
    escapesSuccesses: escapeSuccesses,
    escapeAttempts: Math.max(escapeSuccesses, escapeMentions),
    guardRetentionFailures: guardFailures,
    guardRetentionObservations: Math.max(guardFailures, guardMentions)
  };
};

type BuildProgressViewsReportInput = {
  athleteId: string;
  entries: Entry[];
  checkoffs: Checkoff[];
  evidence: CheckoffEvidence[];
  annotations: ProgressCoachAnnotation[];
  filters: ProgressViewsFilters;
  generatedAt?: string;
};

export const buildProgressViewsReport = ({
  athleteId,
  entries,
  checkoffs,
  evidence,
  annotations,
  filters,
  generatedAt
}: BuildProgressViewsReportInput): ProgressViewsReport => {
  const nowIso = generatedAt ?? new Date().toISOString();

  const filteredEntries = entries.filter((entry) => entryMatchesFilters(entry, filters));
  const structuredEntries = filteredEntries.filter((entry) => isStructuredSession(entry));

  const lowConfidenceByEntry = new Map<string, number>();
  const lowConfidenceFlags = structuredEntries.flatMap((entry) => extractLowConfidenceFlags(entry));
  for (const flag of lowConfidenceFlags) {
    lowConfidenceByEntry.set(flag.entryId, (lowConfidenceByEntry.get(flag.entryId) ?? 0) + 1);
  }

  const positionCounts = new Map<string, { trainedCount: number; lowConfidenceCount: number; lastSeenAt: string }>();
  const outcomeByDay = new Map<
    string,
    {
      escapesSuccesses: number;
      escapeAttempts: number;
      guardRetentionFailures: number;
      guardRetentionObservations: number;
      lowConfidenceCount: number;
    }
  >();

  for (const entry of structuredEntries) {
    const position = (entry.structured?.position?.trim() || 'unspecified').toLowerCase();
    const positionCurrent = positionCounts.get(position) ?? { trainedCount: 0, lowConfidenceCount: 0, lastSeenAt: entry.createdAt };
    positionCurrent.trainedCount += 1;
    positionCurrent.lowConfidenceCount += lowConfidenceByEntry.get(entry.entryId) ?? 0;
    positionCurrent.lastSeenAt = entry.createdAt > positionCurrent.lastSeenAt ? entry.createdAt : positionCurrent.lastSeenAt;
    positionCounts.set(position, positionCurrent);

    const day = toDay(entry.createdAt);
    const dayCurrent = outcomeByDay.get(day) ?? {
      escapesSuccesses: 0,
      escapeAttempts: 0,
      guardRetentionFailures: 0,
      guardRetentionObservations: 0,
      lowConfidenceCount: 0
    };
    const signal = parseOutcomeSignals(entry);
    dayCurrent.escapesSuccesses += signal.escapesSuccesses;
    dayCurrent.escapeAttempts += signal.escapeAttempts;
    dayCurrent.guardRetentionFailures += signal.guardRetentionFailures;
    dayCurrent.guardRetentionObservations += signal.guardRetentionObservations;
    dayCurrent.lowConfidenceCount += lowConfidenceByEntry.get(entry.entryId) ?? 0;
    outcomeByDay.set(day, dayCurrent);
  }

  const evidenceByCheckoffId = new Map<string, CheckoffEvidence[]>();
  for (const row of evidence) {
    const current = evidenceByCheckoffId.get(row.checkoffId) ?? [];
    current.push(row);
    evidenceByCheckoffId.set(row.checkoffId, current);
  }

  const timelineEvents: SkillTimelinePoint[] = [];
  const filteredCheckoffs = checkoffs.filter((checkoff) => checkoff.status === 'earned' || checkoff.status === 'revalidated');
  for (const checkoff of filteredCheckoffs) {
    const eventAt = checkoff.status === 'revalidated' ? checkoff.revalidatedAt ?? checkoff.updatedAt : checkoff.earnedAt ?? checkoff.updatedAt;
    if (!withinDateRange(eventAt, filters)) {
      continue;
    }
    const relatedEvidence = evidenceByCheckoffId.get(checkoff.checkoffId) ?? [];
    const confidence = relatedEvidence
      .map((item) => item.confidence)
      .sort((a, b) => confidenceRank(b) - confidenceRank(a))[0] ?? 'medium';
    const lowConfidence = relatedEvidence.some(
      (item) => item.confidence === 'low' || item.mappingStatus === 'pending_confirmation'
    );

    timelineEvents.push({
      date: toDay(eventAt),
      skillId: checkoff.skillId,
      status: checkoff.status as 'earned' | 'revalidated',
      evidenceCount: checkoff.confirmedEvidenceCount,
      confidence,
      lowConfidence
    });
  }

  timelineEvents.sort((a, b) => (a.date === b.date ? a.skillId.localeCompare(b.skillId) : a.date.localeCompare(b.date)));

  const cumulative: SkillTimelineSeriesPoint[] = [];
  const seenSkills = new Set<string>();
  for (const event of timelineEvents) {
    seenSkills.add(event.skillId);
    cumulative.push({
      date: event.date,
      cumulativeSkills: seenSkills.size
    });
  }

  const heatmapCells = [...positionCounts.entries()]
    .map(([position, stats]) => ({
      position,
      trainedCount: stats.trainedCount,
      lowConfidenceCount: stats.lowConfidenceCount,
      neglected: false,
      lastSeenAt: stats.lastSeenAt
    }))
    .sort((a, b) => (a.trainedCount === b.trainedCount ? a.position.localeCompare(b.position) : b.trainedCount - a.trainedCount));

  const neglectedThreshold = heatmapCells.length === 0 ? 0 : Math.max(1, Math.floor(structuredEntries.length * 0.1));
  for (const cell of heatmapCells) {
    cell.neglected = cell.trainedCount <= neglectedThreshold;
  }

  const outcomePoints = [...outcomeByDay.entries()]
    .map(([date, stats]) => ({
      date,
      escapesSuccessRate: stats.escapeAttempts > 0 ? Number((stats.escapesSuccesses / stats.escapeAttempts).toFixed(3)) : null,
      guardRetentionFailureRate:
        stats.guardRetentionObservations > 0
          ? Number((stats.guardRetentionFailures / stats.guardRetentionObservations).toFixed(3))
          : null,
      escapesSuccesses: stats.escapesSuccesses,
      escapeAttempts: stats.escapeAttempts,
      guardRetentionFailures: stats.guardRetentionFailures,
      guardRetentionObservations: stats.guardRetentionObservations,
      lowConfidenceCount: stats.lowConfidenceCount
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    athleteId,
    generatedAt: nowIso,
    filters,
    timeline: {
      events: timelineEvents,
      cumulative
    },
    positionHeatmap: {
      cells: heatmapCells,
      maxTrainedCount: heatmapCells.length ? Math.max(...heatmapCells.map((cell) => cell.trainedCount)) : 0,
      neglectedThreshold
    },
    outcomeTrends: {
      points: outcomePoints
    },
    lowConfidenceFlags: lowConfidenceFlags.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
    coachAnnotations: annotations
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50),
    sourceSummary: {
      sessionsConsidered: filteredEntries.length,
      structuredSessions: structuredEntries.length,
      checkoffsConsidered: filteredCheckoffs.length
    }
  };
};

const isScope = (value: unknown): value is ProgressAnnotationScope =>
  value === 'general' || value === 'timeline' || value === 'position-heatmap' || value === 'outcome-trend';

export const parseUpsertProgressAnnotationPayload = (
  body: string | null
): { scope: ProgressAnnotationScope; targetKey?: string; note: string; correction?: string } => {
  if (typeof body !== 'string' || !body.trim()) {
    invalid('Request body is required.');
  }
  const rawBody = body as string;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('Request body must be a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  const scopeRaw = record.scope;
  if (!isScope(scopeRaw)) {
    invalid('scope must be one of: general, timeline, position-heatmap, outcome-trend.');
  }
  const scope = scopeRaw as ProgressAnnotationScope;

  const noteRaw = record.note;
  if (typeof noteRaw !== 'string' || !noteRaw.trim()) {
    invalid('note must be a non-empty string.');
  }
  const note = (noteRaw as string).trim();
  if (record.targetKey !== undefined && (typeof record.targetKey !== 'string' || !record.targetKey.trim())) {
    invalid('targetKey must be a non-empty string when provided.');
  }
  if (record.correction !== undefined && (typeof record.correction !== 'string' || !record.correction.trim())) {
    invalid('correction must be a non-empty string when provided.');
  }

  return {
    scope,
    note,
    ...(typeof record.targetKey === 'string' ? { targetKey: record.targetKey.trim() } : {}),
    ...(typeof record.correction === 'string' ? { correction: record.correction.trim() } : {})
  };
};

export const parseProgressAnnotationRows = (
  rows: Array<Record<string, unknown>>
): ProgressCoachAnnotation[] =>
  rows
    .filter((row) => row.entityType === 'PROGRESS_ANNOTATION')
    .map((row) => {
      if (
        typeof row.annotationId !== 'string' ||
        typeof row.athleteId !== 'string' ||
        !isScope(row.scope) ||
        typeof row.note !== 'string' ||
        typeof row.createdAt !== 'string' ||
        typeof row.updatedAt !== 'string' ||
        typeof row.createdBy !== 'string' ||
        typeof row.updatedBy !== 'string'
      ) {
        return null;
      }
      return {
        annotationId: row.annotationId,
        athleteId: row.athleteId,
        scope: row.scope,
        ...(typeof row.targetKey === 'string' ? { targetKey: row.targetKey } : {}),
        note: row.note,
        ...(typeof row.correction === 'string' ? { correction: row.correction } : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy
      } satisfies ProgressCoachAnnotation;
    })
    .filter((row): row is ProgressCoachAnnotation => row !== null);

export const buildProgressViewsReportRecord = (report: ProgressViewsReport): Record<string, unknown> => ({
  PK: `USER#${report.athleteId}`,
  SK: PROGRESS_VIEWS_LATEST_SK,
  entityType: 'PROGRESS_VIEWS_REPORT',
  ...report
});

export const parseProgressViewsReport = (row: Record<string, unknown> | undefined): ProgressViewsReport | null => {
  if (!row || row.entityType !== 'PROGRESS_VIEWS_REPORT') {
    return null;
  }
  if (
    typeof row.athleteId !== 'string' ||
    typeof row.generatedAt !== 'string' ||
    !row.filters ||
    !row.timeline ||
    !row.positionHeatmap ||
    !row.outcomeTrends ||
    !row.sourceSummary
  ) {
    return null;
  }

  return row as unknown as ProgressViewsReport;
};
