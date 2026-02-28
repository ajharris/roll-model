import type {
  FinalizedSessionReview,
  SessionReviewArtifact,
  SessionReviewConfidenceFlag,
  SessionReviewFieldKey,
  SessionReviewPromptSet,
} from './types';

const MAX_ONE_THING_LENGTH = 140;

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ');

const sanitizePromptItems = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = normalizeWhitespace(item);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
};

const isFieldKey = (value: unknown): value is SessionReviewFieldKey =>
  value === 'whatWorked' ||
  value === 'whatFailed' ||
  value === 'whatToAskCoach' ||
  value === 'whatToDrillSolo' ||
  value === 'oneThing';

const isConfidence = (value: unknown): value is SessionReviewConfidenceFlag['confidence'] =>
  value === 'high' || value === 'medium' || value === 'low';

const sanitizeConfidenceFlags = (value: unknown): SessionReviewConfidenceFlag[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
      if (!record || !isFieldKey(record.field) || !isConfidence(record.confidence)) {
        return null;
      }
      const note = typeof record.note === 'string' ? normalizeWhitespace(record.note) : undefined;
      return {
        field: record.field,
        confidence: record.confidence,
        ...(note ? { note } : {})
      };
    })
    .filter((item): item is SessionReviewConfidenceFlag => item !== null);
};

const clipOneThing = (value: string): string => {
  if (value.length <= MAX_ONE_THING_LENGTH) {
    return value;
  }

  const clipped = value.slice(0, MAX_ONE_THING_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  if (lastSpace <= 0) {
    return clipped;
  }
  return clipped.slice(0, lastSpace).trim();
};

const firstSentence = (value: string): string => {
  const sentence = value
    .split(/\r?\n/)[0]
    .replace(/^[\-\*\d.\)\s]+/, '')
    .split(/[.!?]/)[0];
  return normalizeWhitespace(sentence);
};

export const normalizeOneThingCue = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const sentence = firstSentence(value);
  if (!sentence) {
    return '';
  }

  return clipOneThing(sentence);
};

const ensurePromptSet = (value: unknown): SessionReviewPromptSet => {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    whatWorked: sanitizePromptItems(record.whatWorked),
    whatFailed: sanitizePromptItems(record.whatFailed),
    whatToAskCoach: sanitizePromptItems(record.whatToAskCoach),
    whatToDrillSolo: sanitizePromptItems(record.whatToDrillSolo)
  };
};

const deriveOneThingFromPromptSet = (promptSet: SessionReviewPromptSet): string =>
  normalizeOneThingCue(
    promptSet.whatToDrillSolo[0] ??
      promptSet.whatFailed[0] ??
      promptSet.whatToAskCoach[0] ??
      promptSet.whatWorked[0] ??
      ''
  );

export const normalizeSessionReviewArtifact = (value: unknown): SessionReviewArtifact | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const promptSet = ensurePromptSet(record.promptSet);
  const explicitCue = normalizeOneThingCue(record.oneThing);
  const oneThing = explicitCue || deriveOneThingFromPromptSet(promptSet);
  if (!oneThing) {
    return null;
  }

  return {
    promptSet,
    oneThing,
    confidenceFlags: sanitizeConfidenceFlags(record.confidenceFlags)
  };
};

export const normalizeFinalizedSessionReview = (value: unknown): FinalizedSessionReview | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.finalizedAt !== 'string' || !record.finalizedAt.trim()) {
    return null;
  }
  const review = normalizeSessionReviewArtifact(record.review);
  if (!review) {
    return null;
  }

  const coachReviewRecord =
    typeof record.coachReview === 'object' && record.coachReview !== null
      ? (record.coachReview as Record<string, unknown>)
      : null;

  const coachReview = coachReviewRecord
    ? {
        requiresReview: Boolean(coachReviewRecord.requiresReview),
        ...(typeof coachReviewRecord.coachNotes === 'string' && normalizeWhitespace(coachReviewRecord.coachNotes)
          ? { coachNotes: normalizeWhitespace(coachReviewRecord.coachNotes) }
          : {}),
        ...(typeof coachReviewRecord.reviewedAt === 'string' && coachReviewRecord.reviewedAt.trim()
          ? { reviewedAt: coachReviewRecord.reviewedAt.trim() }
          : {})
      }
    : undefined;

  return {
    review,
    ...(coachReview ? { coachReview } : {}),
    finalizedAt: record.finalizedAt.trim()
  };
};

export interface RecentOneThingCue {
  entryId: string;
  createdAt: string;
  cue: string;
}

export const extractEntryOneThingCue = (
  entry: Pick<{ sessionReviewFinal?: FinalizedSessionReview; sessionReviewDraft?: SessionReviewArtifact }, 'sessionReviewFinal' | 'sessionReviewDraft'>,
): string | null => {
  const fromFinal = normalizeOneThingCue(entry.sessionReviewFinal?.review.oneThing);
  if (fromFinal) return fromFinal;
  const fromDraft = normalizeOneThingCue(entry.sessionReviewDraft?.oneThing);
  return fromDraft || null;
};

export const listRecentOneThingCues = (
  entries: Array<{ entryId: string; createdAt: string; sessionReviewFinal?: FinalizedSessionReview; sessionReviewDraft?: SessionReviewArtifact }>,
  limit = 5
): RecentOneThingCue[] => {
  const max = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 20) : 5;
  const out: RecentOneThingCue[] = [];
  for (const entry of [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const cue = extractEntryOneThingCue(entry);
    if (!cue) {
      continue;
    }
    out.push({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      cue
    });
    if (out.length >= max) {
      break;
    }
  }
  return out;
};

