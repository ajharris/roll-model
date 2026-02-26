import type { Entry, MediaAttachment, MediaClipNote } from './types';

export const CURRENT_ENTRY_SCHEMA_VERSION = 2;

type EntryRecordEnvelope = {
  PK: string;
  SK: string;
  entityType: string;
};

type LegacyEntryV0 = Omit<Entry, 'schemaVersion' | 'rawTechniqueMentions'> & {
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
  schemaVersion?: undefined;
};

type VersionedEntryInput = Omit<Entry, 'rawTechniqueMentions'> & {
  rawTechniqueMentions?: unknown;
  mediaAttachments?: unknown;
};

type NormalizableEntryInput = LegacyEntryV0 | VersionedEntryInput;
const CLIP_TIMESTAMP_REGEX = /^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/;

const sanitizeRawTechniqueMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((mention): mention is string => typeof mention === 'string');
};

const sanitizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
  if (entry.schemaVersion === undefined) {
    return migrateLegacyEntryV0(entry as LegacyEntryV0);
  }

  if (entry.schemaVersion !== CURRENT_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported entry schema version: ${String(entry.schemaVersion)}`);
  }

  return {
    ...entry,
    schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
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
