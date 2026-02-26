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

const sanitizeRawTechniqueMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((mention): mention is string => typeof mention === 'string');
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
