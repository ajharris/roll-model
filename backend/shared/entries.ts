import type { Entry, MediaAttachment, MediaClipNote } from './types';

export const CURRENT_ENTRY_SCHEMA_VERSION = 3;

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

type EntryV2 = Omit<Entry, 'rawTechniqueMentions' | 'quickAdd' | 'structured' | 'tags'> & {
  schemaVersion: 2;
  quickAdd?: unknown;
  structured?: unknown;
  tags?: unknown;
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
};

type VersionedEntryInput = Omit<Entry, 'rawTechniqueMentions'> & {
  schemaVersion: number;
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
};

type NormalizableEntryInput = LegacyEntryV0 | EntryV2 | VersionedEntryInput;

const sanitizeRawTechniqueMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((mention): mention is string => typeof mention === 'string');
};

const DEFAULT_QUICK_ADD: Entry['quickAdd'] = {
  time: '',
  class: '',
  gym: '',
  partners: [],
  rounds: 0,
  notes: ''
};

const ENTRY_TAG_VALUES = new Set([
  'guard-type',
  'top',
  'bottom',
  'submission',
  'sweep',
  'pass',
  'escape',
  'takedown'
]);

const sanitizeQuickAdd = (value: unknown, fallback?: Record<string, unknown>): Entry['quickAdd'] => {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

  const fallbackRecord = fallback ?? {};
  const fallbackSessionMetrics =
    typeof fallbackRecord.sessionMetrics === 'object' && fallbackRecord.sessionMetrics !== null
      ? (fallbackRecord.sessionMetrics as Record<string, unknown>)
      : null;
  const fallbackSections =
    typeof fallbackRecord.sections === 'object' && fallbackRecord.sections !== null
      ? (fallbackRecord.sections as Record<string, unknown>)
      : null;

  return {
    time: typeof record.time === 'string' ? record.time : DEFAULT_QUICK_ADD.time,
    class: typeof record.class === 'string' ? record.class : DEFAULT_QUICK_ADD.class,
    gym: typeof record.gym === 'string' ? record.gym : DEFAULT_QUICK_ADD.gym,
    partners: Array.isArray(record.partners)
      ? record.partners.filter((partner): partner is string => typeof partner === 'string')
      : DEFAULT_QUICK_ADD.partners,
    rounds:
      typeof record.rounds === 'number'
        ? record.rounds
        : typeof fallbackSessionMetrics?.rounds === 'number'
          ? fallbackSessionMetrics.rounds
          : DEFAULT_QUICK_ADD.rounds,
    notes:
      typeof record.notes === 'string'
        ? record.notes
        : typeof fallbackSections?.shared === 'string'
          ? fallbackSections.shared
          : DEFAULT_QUICK_ADD.notes
  };
};

const sanitizeStructuredFields = (value: unknown): Entry['structured'] => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const structured = {
    ...(typeof record.position === 'string' ? { position: record.position } : {}),
    ...(typeof record.technique === 'string' ? { technique: record.technique } : {}),
    ...(typeof record.outcome === 'string' ? { outcome: record.outcome } : {}),
    ...(typeof record.problem === 'string' ? { problem: record.problem } : {}),
    ...(typeof record.cue === 'string' ? { cue: record.cue } : {}),
    ...(typeof record.constraint === 'string' ? { constraint: record.constraint } : {})
  };

  return Object.keys(structured).length > 0 ? structured : undefined;
};

const sanitizeEntryTags = (value: unknown, fallbackSessionMetricsTags?: unknown): Entry['tags'] => {
  const source = Array.isArray(value) ? value : Array.isArray(fallbackSessionMetricsTags) ? fallbackSessionMetricsTags : [];
  return source.filter(
    (tag): tag is Entry['tags'][number] => typeof tag === 'string' && ENTRY_TAG_VALUES.has(tag)
  );
};

const sanitizeClipNotes = (value: unknown): MediaClipNote[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((clip): clip is Record<string, unknown> => typeof clip === 'object' && clip !== null)
    .map((clip) => ({
      clipId: typeof clip.clipId === 'string' && clip.clipId.trim() ? clip.clipId : '',
      label: typeof clip.label === 'string' ? clip.label : '',
      note: typeof clip.note === 'string' ? clip.note : '',
      ...(typeof clip.startSeconds === 'number' ? { startSeconds: clip.startSeconds } : {}),
      ...(typeof clip.endSeconds === 'number' ? { endSeconds: clip.endSeconds } : {})
    }))
    .filter((clip) => clip.clipId && clip.label && clip.note);
};

export const sanitizeMediaAttachments = (value: unknown): MediaAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((attachment): attachment is Record<string, unknown> => typeof attachment === 'object' && attachment !== null)
    .map((attachment) => ({
      mediaId:
        typeof attachment.mediaId === 'string' && attachment.mediaId.trim() ? attachment.mediaId : '',
      title: typeof attachment.title === 'string' ? attachment.title : '',
      url: typeof attachment.url === 'string' ? attachment.url : '',
      ...(typeof attachment.notes === 'string' && attachment.notes
        ? { notes: attachment.notes }
        : {}),
      clipNotes: sanitizeClipNotes(attachment.clipNotes)
    }))
    .filter((attachment) => attachment.mediaId && attachment.title && attachment.url);
};

const migrateLegacyEntryV0 = (legacy: LegacyEntryV0): Entry => ({
  ...legacy,
  schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
  quickAdd: sanitizeQuickAdd((legacy as Record<string, unknown>).quickAdd, legacy as unknown as Record<string, unknown>),
  structured: sanitizeStructuredFields((legacy as Record<string, unknown>).structured),
  tags: sanitizeEntryTags((legacy as Record<string, unknown>).tags, legacy.sessionMetrics?.tags),
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

  if (schemaVersion !== 2 && schemaVersion !== CURRENT_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported entry schema version: ${String(schemaVersion)}`);
  }

  return {
    ...entry,
    schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
    quickAdd: sanitizeQuickAdd((entry as Record<string, unknown>).quickAdd, entry as unknown as Record<string, unknown>),
    structured: sanitizeStructuredFields((entry as Record<string, unknown>).structured),
    tags: sanitizeEntryTags((entry as Record<string, unknown>).tags, entry.sessionMetrics?.tags),
    rawTechniqueMentions: sanitizeRawTechniqueMentions(entry.rawTechniqueMentions),
    mediaAttachments: sanitizeMediaAttachments(entry.mediaAttachments)
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
