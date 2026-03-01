import { normalizeFinalizedSessionReview, normalizeSessionReviewArtifact } from './sessionReview';
import type {
  Entry,
  EntryQuickAdd,
  EntryStructuredFields,
  EntryTag,
  MediaAttachment,
  MediaClipNote,
  PartnerGuidance,
  PartnerOutcomeNote,
  SessionContext
} from './types';

export const CURRENT_ENTRY_SCHEMA_VERSION = 4;

type EntryRecordEnvelope = {
  PK: string;
  SK: string;
  entityType: string;
};

type LegacyEntryV0 = Omit<Entry, 'schemaVersion' | 'rawTechniqueMentions' | 'quickAdd' | 'structured' | 'tags'> & {
  quickAdd?: unknown;
  structured?: unknown;
  tags?: unknown;
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
  schemaVersion?: undefined;
};

type VersionedEntryInput = Omit<Entry, 'rawTechniqueMentions'> & {
  schemaVersion: number;
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
};

type NormalizableEntryInput = LegacyEntryV0 | VersionedEntryInput;
const CLIP_TIMESTAMP_REGEX = /^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/;
const ENTRY_TAG_VALUES = new Set<EntryTag>([
  'guard-type',
  'top',
  'bottom',
  'submission',
  'sweep',
  'pass',
  'escape',
  'takedown'
]);
const STRUCTURED_FIELDS: Array<keyof EntryStructuredFields> = [
  'position',
  'technique',
  'outcome',
  'problem',
  'cue',
  'constraint'
];

const sanitizeRawTechniqueMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((mention): mention is string => typeof mention === 'string');
};

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed) {
      deduped.add(trimmed);
    }
  }
  return [...deduped];
};

const sanitizeTagArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = item.trim().toLowerCase();
    if (normalized) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
};

const sanitizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const sanitizeQuickAdd = (value: unknown, fallbackEntry: Record<string, unknown>): EntryQuickAdd => {
  const quickAdd = asRecord(value);
  const fallbackSessionMetrics = asRecord(fallbackEntry.sessionMetrics);
  const fallbackSections = asRecord(fallbackEntry.sections);

  const time = sanitizeString(quickAdd?.time) || sanitizeString(fallbackEntry.createdAt);
  const className = sanitizeString(quickAdd?.class);
  const gym = sanitizeString(quickAdd?.gym);
  const partners = Array.isArray(quickAdd?.partners)
    ? quickAdd.partners.filter((partner): partner is string => typeof partner === 'string').map((partner) => partner.trim())
    : [];
  const rounds =
    typeof quickAdd?.rounds === 'number' && Number.isFinite(quickAdd.rounds)
      ? quickAdd.rounds
      : typeof fallbackSessionMetrics?.rounds === 'number' && Number.isFinite(fallbackSessionMetrics.rounds)
        ? fallbackSessionMetrics.rounds
        : 0;
  const notes = sanitizeString(quickAdd?.notes) || sanitizeString(fallbackSections?.shared);

  return {
    time,
    class: className,
    gym,
    partners,
    rounds,
    notes
  };
};

const sanitizeStructuredFields = (value: unknown): EntryStructuredFields | undefined => {
  const structured = asRecord(value);
  if (!structured) {
    return undefined;
  }

  const sanitized: EntryStructuredFields = {};
  for (const field of STRUCTURED_FIELDS) {
    const fieldValue = sanitizeString(structured[field]);
    if (fieldValue) {
      sanitized[field] = fieldValue;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const sanitizeEntryTags = (value: unknown, fallback: unknown): EntryTag[] => {
  const input = Array.isArray(value)
    ? value
    : Array.isArray(fallback)
      ? fallback
      : [];

  const deduped = new Set<EntryTag>();
  input.forEach((tag) => {
    if (typeof tag !== 'string') {
      return;
    }

    if (ENTRY_TAG_VALUES.has(tag as EntryTag)) {
      deduped.add(tag as EntryTag);
    }
  });

  return [...deduped];
};

const sanitizeCoachReviewState = (value: unknown): PartnerGuidance['coachReview'] => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const coachNotes = sanitizeString(record.coachNotes);
  const reviewedAt = sanitizeString(record.reviewedAt);

  return {
    requiresReview: Boolean(record.requiresReview),
    ...(coachNotes ? { coachNotes } : {}),
    ...(reviewedAt ? { reviewedAt } : {})
  };
};

const sanitizePartnerGuidance = (value: unknown): PartnerGuidance | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const draft = sanitizeString(record.draft);
  const final = sanitizeString(record.final);
  const coachReview = sanitizeCoachReviewState(record.coachReview);

  if (!draft && !final && !coachReview) {
    return undefined;
  }

  return {
    ...(draft ? { draft } : {}),
    ...(final ? { final } : {}),
    ...(coachReview ? { coachReview } : {})
  };
};

const sanitizeSessionContext = (value: unknown): SessionContext | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const ruleset = sanitizeString(record.ruleset);
  const fatigueLevel =
    typeof record.fatigueLevel === 'number' && Number.isFinite(record.fatigueLevel)
      ? Math.min(10, Math.max(1, Math.round(record.fatigueLevel)))
      : undefined;
  const injuryNotes = sanitizeStringArray(record.injuryNotes);
  const tags = sanitizeTagArray(record.tags);

  if (!ruleset && fatigueLevel === undefined && injuryNotes.length === 0 && tags.length === 0) {
    return undefined;
  }

  return {
    ...(ruleset ? { ruleset } : {}),
    ...(fatigueLevel !== undefined ? { fatigueLevel } : {}),
    injuryNotes,
    tags
  };
};

const sanitizePartnerOutcomes = (value: unknown): PartnerOutcomeNote[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const partnerId = sanitizeString(record.partnerId);
      if (!partnerId) {
        return null;
      }

      const partnerDisplayName = sanitizeString(record.partnerDisplayName);
      const styleTags = sanitizeTagArray(record.styleTags);
      const whatWorked = sanitizeStringArray(record.whatWorked);
      const whatFailed = sanitizeStringArray(record.whatFailed);
      const guidance = sanitizePartnerGuidance(record.guidance);

      return {
        partnerId,
        ...(partnerDisplayName ? { partnerDisplayName } : {}),
        styleTags,
        whatWorked,
        whatFailed,
        ...(guidance ? { guidance } : {})
      };
    })
    .filter((item): item is PartnerOutcomeNote => item !== null);
};

export const isValidMediaUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const isValidClipTimestamp = (value: string): boolean => CLIP_TIMESTAMP_REGEX.test(value.trim());

const secondsToTimestamp = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
};

const parseClipNote = (value: unknown): MediaClipNote | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const clip = value as Record<string, unknown>;
  const clipId = sanitizeString(clip.clipId);
  const text = sanitizeString(clip.text) || sanitizeString(clip.note);
  const explicitTimestamp = sanitizeString(clip.timestamp);
  const legacyTimestampFromLabel = sanitizeString(clip.label);
  const timestampFromSeconds =
    typeof clip.startSeconds === 'number' && Number.isFinite(clip.startSeconds) && clip.startSeconds >= 0
      ? secondsToTimestamp(Math.floor(clip.startSeconds))
      : '';

  const timestampCandidate = explicitTimestamp || timestampFromSeconds || legacyTimestampFromLabel;
  if (!clipId || !text || !isValidClipTimestamp(timestampCandidate)) {
    return null;
  }

  return {
    clipId,
    timestamp: timestampCandidate,
    text
  };
};

const sanitizeClipNotes = (value: unknown): MediaClipNote[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(parseClipNote)
    .filter((clip): clip is MediaClipNote => clip !== null);
};

const parseMediaAttachment = (value: unknown): MediaAttachment | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const attachment = value as Record<string, unknown>;
  const mediaId = sanitizeString(attachment.mediaId);
  const title = sanitizeString(attachment.title);
  const url = sanitizeString(attachment.url);
  const notes = sanitizeString(attachment.notes);

  if (!mediaId || !title || !isValidMediaUrl(url)) {
    return null;
  }

  return {
    mediaId,
    title,
    url,
    ...(notes ? { notes } : {}),
    clipNotes: sanitizeClipNotes(attachment.clipNotes)
  };
};

export const isValidMediaAttachmentsInput = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((attachment) => {
    const parsedAttachment = parseMediaAttachment(attachment);
    if (!parsedAttachment) {
      return false;
    }

    const original = attachment as Record<string, unknown>;
    if (!Array.isArray(original.clipNotes)) {
      return false;
    }

    return original.clipNotes.every((clip) => parseClipNote(clip) !== null);
  });
};

export const sanitizeMediaAttachments = (value: unknown): MediaAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(parseMediaAttachment)
    .filter((attachment): attachment is MediaAttachment => attachment !== null);
};

const migrateLegacyEntryV0 = (legacy: LegacyEntryV0): Entry => ({
  ...legacy,
  schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
  quickAdd: sanitizeQuickAdd((legacy as Record<string, unknown>).quickAdd, legacy as unknown as Record<string, unknown>),
  structured: sanitizeStructuredFields((legacy as Record<string, unknown>).structured),
  tags: sanitizeEntryTags((legacy as Record<string, unknown>).tags, legacy.sessionMetrics?.tags),
  sessionContext: sanitizeSessionContext((legacy as Record<string, unknown>).sessionContext),
  partnerOutcomes: sanitizePartnerOutcomes((legacy as Record<string, unknown>).partnerOutcomes),
  rawTechniqueMentions: sanitizeRawTechniqueMentions(legacy.rawTechniqueMentions),
  mediaAttachments: sanitizeMediaAttachments(legacy.mediaAttachments)
});

export const withCurrentEntrySchemaVersion = (
  entry: Omit<Entry, 'schemaVersion'> & Partial<Pick<Entry, 'schemaVersion'>>
): Entry => ({
  ...entry,
  schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION
});

export const normalizeEntry = (entry: NormalizableEntryInput): Entry => {
  const schemaVersion = (entry as { schemaVersion?: number }).schemaVersion;

  if (schemaVersion === undefined) {
    return migrateLegacyEntryV0(entry as LegacyEntryV0);
  }

  if (schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== CURRENT_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported entry schema version: ${String(schemaVersion)}`);
  }

  const sessionReviewDraft = normalizeSessionReviewArtifact((entry as Record<string, unknown>).sessionReviewDraft);
  const sessionReviewFinal = normalizeFinalizedSessionReview((entry as Record<string, unknown>).sessionReviewFinal);

  return {
    ...entry,
    schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
    quickAdd: sanitizeQuickAdd((entry as Record<string, unknown>).quickAdd, entry as unknown as Record<string, unknown>),
    structured: sanitizeStructuredFields((entry as Record<string, unknown>).structured),
    tags: sanitizeEntryTags((entry as Record<string, unknown>).tags, entry.sessionMetrics?.tags),
    sessionContext: sanitizeSessionContext((entry as Record<string, unknown>).sessionContext),
    partnerOutcomes: sanitizePartnerOutcomes((entry as Record<string, unknown>).partnerOutcomes),
    rawTechniqueMentions: sanitizeRawTechniqueMentions(entry.rawTechniqueMentions),
    mediaAttachments: sanitizeMediaAttachments(entry.mediaAttachments),
    ...(sessionReviewDraft ? { sessionReviewDraft } : {}),
    ...(sessionReviewFinal ? { sessionReviewFinal } : {})
  };
};

export const parseEntryRecord = (item: Record<string, unknown>): Entry => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = item as EntryRecordEnvelope &
    Record<string, unknown>;
  void _pk;
  void _sk;
  void _entityType;

  return normalizeEntry(entry as NormalizableEntryInput);
};
