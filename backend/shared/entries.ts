import type { Entry } from './types';

export const CURRENT_ENTRY_SCHEMA_VERSION = 1;

type EntryRecordEnvelope = {
  PK: string;
  SK: string;
  entityType: string;
};

type LegacyEntryV0 = Omit<Entry, 'schemaVersion' | 'rawTechniqueMentions'> & {
  rawTechniqueMentions?: unknown;
  schemaVersion?: undefined;
};

type VersionedEntryInput = Omit<Entry, 'rawTechniqueMentions'> & {
  rawTechniqueMentions?: unknown;
};

type NormalizableEntryInput = LegacyEntryV0 | VersionedEntryInput;

const sanitizeRawTechniqueMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((mention): mention is string => typeof mention === 'string');
};

const migrateLegacyEntryV0 = (legacy: LegacyEntryV0): Entry => ({
  ...legacy,
  schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
  rawTechniqueMentions: sanitizeRawTechniqueMentions(legacy.rawTechniqueMentions)
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
    rawTechniqueMentions: sanitizeRawTechniqueMentions(entry.rawTechniqueMentions)
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
