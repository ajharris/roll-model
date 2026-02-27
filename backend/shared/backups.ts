import { isValidMediaAttachmentsInput, normalizeEntry } from './entries';
import { buildKeywordIndexItems, extractEntryTokens } from './keywords';
import type { AIMessage, AIThread, CoachLink, Comment, Entry } from './types';

export const CURRENT_BACKUP_SCHEMA_VERSION = '2026-02-19';

export interface BackupDataset {
  athleteId: string;
  entries: Entry[];
  comments: Comment[];
  links: CoachLink[];
  aiThreads: AIThread[];
  aiMessages: AIMessage[];
}

export interface FullBackupEnvelope {
  schemaVersion: string;
  generatedAt: string;
  full: BackupDataset;
  tidy?: unknown;
}

type ParsedBackupEnvelope = {
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
};

export class BackupValidationError extends Error {
  public readonly reason: 'format' | 'schema_version';

  public constructor(reason: 'format' | 'schema_version', message: string) {
    super(message);
    this.reason = reason;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackupValidationError('format', `Backup field "${field}" must be a non-empty string.`);
  }
  return value;
};

const requireArray = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new BackupValidationError('format', `Backup field "${field}" must be an array.`);
  }
  return value;
};

const parseComment = (value: unknown): Comment => {
  if (!isRecord(value)) {
    throw new BackupValidationError('format', 'Backup comment items must be objects.');
  }

  const visibility = value.visibility;
  if (visibility !== 'visible' && visibility !== 'hiddenByAthlete') {
    throw new BackupValidationError('format', 'Backup comment visibility is invalid.');
  }

  return {
    commentId: requireString(value.commentId, 'comments[].commentId'),
    entryId: requireString(value.entryId, 'comments[].entryId'),
    coachId: requireString(value.coachId, 'comments[].coachId'),
    createdAt: requireString(value.createdAt, 'comments[].createdAt'),
    body: requireString(value.body, 'comments[].body'),
    visibility
  };
};

const parseCoachLink = (value: unknown): CoachLink => {
  if (!isRecord(value)) {
    throw new BackupValidationError('format', 'Backup coach link items must be objects.');
  }

  const status = value.status;
  if (status !== 'pending' && status !== 'active' && status !== 'revoked') {
    throw new BackupValidationError('format', 'Backup coach link status is invalid.');
  }

  return {
    athleteId: requireString(value.athleteId, 'links[].athleteId'),
    coachId: requireString(value.coachId, 'links[].coachId'),
    status,
    createdAt: requireString(value.createdAt, 'links[].createdAt'),
    updatedAt: requireString(value.updatedAt, 'links[].updatedAt'),
    createdBy: requireString(value.createdBy, 'links[].createdBy')
  };
};

const parseAIThread = (value: unknown): AIThread => {
  if (!isRecord(value)) {
    throw new BackupValidationError('format', 'Backup AI thread items must be objects.');
  }

  return {
    threadId: requireString(value.threadId, 'aiThreads[].threadId'),
    title: requireString(value.title, 'aiThreads[].title'),
    createdAt: requireString(value.createdAt, 'aiThreads[].createdAt'),
    lastActiveAt: requireString(value.lastActiveAt, 'aiThreads[].lastActiveAt')
  };
};

const parseAIMessage = (value: unknown): AIMessage => {
  if (!isRecord(value)) {
    throw new BackupValidationError('format', 'Backup AI message items must be objects.');
  }

  const role = value.role;
  if (role !== 'user' && role !== 'assistant') {
    throw new BackupValidationError('format', 'Backup AI message role is invalid.');
  }

  const visibilityScope = value.visibilityScope;
  if (visibilityScope !== 'private' && visibilityScope !== 'shared') {
    throw new BackupValidationError('format', 'Backup AI message visibilityScope is invalid.');
  }

  return {
    messageId: requireString(value.messageId, 'aiMessages[].messageId'),
    threadId: requireString(value.threadId, 'aiMessages[].threadId'),
    role,
    content: requireString(value.content, 'aiMessages[].content'),
    visibilityScope,
    createdAt: requireString(value.createdAt, 'aiMessages[].createdAt')
  };
};

const parseEntry = (value: unknown): Entry => {
  if (!isRecord(value)) {
    throw new BackupValidationError('format', 'Backup entry items must be objects.');
  }

  if (
    typeof value.entryId !== 'string' ||
    typeof value.athleteId !== 'string' ||
    !isRecord(value.sections) ||
    typeof value.sections.private !== 'string' ||
    typeof value.sections.shared !== 'string' ||
    !isRecord(value.sessionMetrics) ||
    typeof value.sessionMetrics.durationMinutes !== 'number' ||
    typeof value.sessionMetrics.intensity !== 'number' ||
    typeof value.sessionMetrics.rounds !== 'number' ||
    typeof value.sessionMetrics.giOrNoGi !== 'string' ||
    !Array.isArray(value.sessionMetrics.tags) ||
    value.sessionMetrics.tags.some((tag) => typeof tag !== 'string') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isValidMediaAttachmentsInput(value.mediaAttachments)
  ) {
    throw new BackupValidationError('format', 'Backup entry shape is invalid.');
  }

  try {
    return normalizeEntry(value as unknown as Entry);
  } catch (error) {
    throw new BackupValidationError(
      'format',
      `Backup entry is invalid: ${error instanceof Error ? error.message : 'unknown error'}.`
    );
  }
};

const parseEnvelope = (raw: unknown): ParsedBackupEnvelope => {
  if (!isRecord(raw)) {
    throw new BackupValidationError('format', 'Backup payload must be a JSON object.');
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'string') {
    throw new BackupValidationError('format', 'Backup schemaVersion must be a string.');
  }

  if (schemaVersion !== CURRENT_BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(
      'schema_version',
      `Unsupported backup schema version: ${schemaVersion}. Expected ${CURRENT_BACKUP_SCHEMA_VERSION}.`
    );
  }

  const generatedAt = requireString(raw.generatedAt, 'generatedAt');
  const full = raw.full;
  if (!isRecord(full)) {
    throw new BackupValidationError(
      'format',
      'Restore requires a full backup payload ("full" object) from JSON export.'
    );
  }

  return {
    schemaVersion,
    generatedAt,
    full: {
      athleteId: requireString(full.athleteId, 'full.athleteId'),
      entries: requireArray(full.entries, 'full.entries'),
      comments: requireArray(full.comments, 'full.comments'),
      links: requireArray(full.links, 'full.links'),
      aiThreads: requireArray(full.aiThreads, 'full.aiThreads'),
      aiMessages: requireArray(full.aiMessages, 'full.aiMessages')
    }
  };
};

export const parseAndValidateBackup = (raw: unknown): FullBackupEnvelope => {
  const envelope = parseEnvelope(raw);
  const entries = envelope.full.entries.map(parseEntry);
  const comments = envelope.full.comments.map(parseComment);
  const links = envelope.full.links.map(parseCoachLink);
  const aiThreads = envelope.full.aiThreads.map(parseAIThread);
  const aiMessages = envelope.full.aiMessages.map(parseAIMessage);

  for (const entry of entries) {
    if (entry.athleteId !== envelope.full.athleteId) {
      throw new BackupValidationError(
        'format',
        `Backup entry athleteId mismatch for entry ${entry.entryId}.`
      );
    }
  }

  for (const link of links) {
    if (link.athleteId !== envelope.full.athleteId) {
      throw new BackupValidationError(
        'format',
        `Backup coach link athleteId mismatch for coach ${link.coachId}.`
      );
    }
  }

  const entryIds = new Set(entries.map((entry) => entry.entryId));
  for (const comment of comments) {
    if (!entryIds.has(comment.entryId)) {
      throw new BackupValidationError(
        'format',
        `Backup comment references unknown entryId: ${comment.entryId}.`
      );
    }
  }

  const threadIds = new Set(aiThreads.map((thread) => thread.threadId));
  for (const message of aiMessages) {
    if (!threadIds.has(message.threadId)) {
      throw new BackupValidationError(
        'format',
        `Backup AI message references unknown threadId: ${message.threadId}.`
      );
    }
  }

  return {
    schemaVersion: envelope.schemaVersion,
    generatedAt: envelope.generatedAt,
    full: {
      athleteId: envelope.full.athleteId,
      entries,
      comments,
      links,
      aiThreads,
      aiMessages
    }
  };
};

const csvEscape = (value: unknown): string => {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const buildEntriesCsv = (entries: Entry[]): string => {
  const headers = [
    'entryId',
    'athleteId',
    'schemaVersion',
    'createdAt',
    'updatedAt',
    'durationMinutes',
    'intensity',
    'rounds',
    'giOrNoGi',
    'tags',
    'rawTechniqueMentions',
    'sharedNotes',
    'privateNotes',
    'mediaAttachments'
  ];

  const rows = entries.map((entry) => [
    entry.entryId,
    entry.athleteId,
    entry.schemaVersion,
    entry.createdAt,
    entry.updatedAt,
    entry.sessionMetrics.durationMinutes,
    entry.sessionMetrics.intensity,
    entry.sessionMetrics.rounds,
    entry.sessionMetrics.giOrNoGi,
    JSON.stringify(entry.sessionMetrics.tags ?? []),
    JSON.stringify(entry.rawTechniqueMentions ?? []),
    entry.sections.shared,
    entry.sections.private,
    JSON.stringify(entry.mediaAttachments ?? [])
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
};

export const buildRestoreItemsFromBackup = (dataset: BackupDataset): Array<Record<string, unknown>> => {
  const items: Array<Record<string, unknown>> = [];

  for (const entry of dataset.entries) {
    items.push({
      PK: `USER#${dataset.athleteId}`,
      SK: `ENTRY#${entry.createdAt}#${entry.entryId}`,
      entityType: 'ENTRY',
      ...entry
    });

    items.push({
      PK: `ENTRY#${entry.entryId}`,
      SK: 'META',
      entityType: 'ENTRY_META',
      athleteId: dataset.athleteId,
      createdAt: entry.createdAt
    });

    const sharedTokens = extractEntryTokens(entry, { includePrivate: false, maxTokens: 30 });
    const allTokens = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });
    const sharedTokenSet = new Set(sharedTokens);
    const privateOnlyTokens = allTokens.filter((token) => !sharedTokenSet.has(token));

    items.push(
      ...buildKeywordIndexItems(dataset.athleteId, entry.entryId, entry.createdAt, sharedTokens, {
        visibilityScope: 'shared'
      }),
      ...buildKeywordIndexItems(dataset.athleteId, entry.entryId, entry.createdAt, privateOnlyTokens, {
        visibilityScope: 'private'
      })
    );
  }

  for (const comment of dataset.comments) {
    items.push({
      PK: `ENTRY#${comment.entryId}`,
      SK: `COMMENT#${comment.createdAt}#${comment.commentId}`,
      entityType: 'COMMENT',
      ...comment
    });
  }

  for (const link of dataset.links) {
    items.push({
      PK: `USER#${dataset.athleteId}`,
      SK: `COACH#${link.coachId}`,
      entityType: 'COACH_LINK',
      ...link
    });
  }

  for (const thread of dataset.aiThreads) {
    items.push({
      PK: `USER#${dataset.athleteId}`,
      SK: `AI_THREAD#${thread.threadId}`,
      entityType: 'AI_THREAD',
      ...thread
    });
  }

  for (const message of dataset.aiMessages) {
    items.push({
      PK: `AI_THREAD#${message.threadId}`,
      SK: `MSG#${message.createdAt}#${message.messageId}`,
      entityType: 'AI_MESSAGE',
      ...message
    });
  }

  return items;
};
