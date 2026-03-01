import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { batchWriteItems, deleteItem, getItem, putItem } from '../../shared/db';
import { parseEntryRecord, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { extractStructuredMetadata } from '../../shared/structuredExtraction';
import type {
  Entry,
  EntryStructuredFieldKey,
  EntryStructuredFields,
  EntryStructuredMetadataConfirmation,
  StructuredMetadataReviewRequest,
} from '../../shared/types';

const STRUCTURED_FIELDS: Array<keyof EntryStructuredFields> = [
  'position',
  'technique',
  'outcome',
  'problem',
  'cue',
  'constraint',
];
const STRUCTURED_CONFIRM_FIELDS = new Set<EntryStructuredFieldKey>(['position', 'technique', 'outcome', 'problem', 'cue']);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const requireRecord = (value: unknown, message: string): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    invalid(message);
  }
  return record as Record<string, unknown>;
};

const parseRequest = (body: string | null): StructuredMetadataReviewRequest => {
  if (typeof body !== 'string' || !body) {
    invalid('Request body is required.');
  }
  const rawBody = body as string;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = requireRecord(parsed, 'Request body must be an object.');

  const structured = asRecord(payload.structured);
  if (payload.structured !== undefined && !structured) {
    invalid('structured must be an object when provided.');
  }

  if (structured) {
    for (const field of STRUCTURED_FIELDS) {
      if (structured[field] !== undefined && typeof structured[field] !== 'string') {
        invalid(`structured.${field} must be a string.`);
      }
    }
  }

  const confirmationsRaw = payload.confirmations;
  if (confirmationsRaw !== undefined && !Array.isArray(confirmationsRaw)) {
    invalid('confirmations must be an array when provided.');
  }

  const confirmations: EntryStructuredMetadataConfirmation[] = [];
  if (Array.isArray(confirmationsRaw)) {
    confirmationsRaw.forEach((item, index) => {
      const record = requireRecord(item, `confirmations[${index}] must be an object.`);

      const field = typeof record.field === 'string' ? record.field.trim() : '';
      if (!STRUCTURED_CONFIRM_FIELDS.has(field as EntryStructuredFieldKey)) {
        invalid(`confirmations[${index}].field must be one of: position, technique, outcome, problem, cue.`);
      }

      const statusValue = typeof record.status === 'string' ? record.status.trim() : '';
      if (statusValue !== 'confirmed' && statusValue !== 'corrected' && statusValue !== 'rejected') {
        invalid(`confirmations[${index}].status must be confirmed, corrected, or rejected.`);
      }
      const status = statusValue as EntryStructuredMetadataConfirmation['status'];

      const correctionValue = typeof record.correctionValue === 'string' ? record.correctionValue.trim() : undefined;
      if (status === 'corrected' && !correctionValue) {
        invalid(`confirmations[${index}].correctionValue is required when status is corrected.`);
      }

      confirmations.push({
        field: field as EntryStructuredFieldKey,
        status,
        ...(correctionValue ? { correctionValue } : {}),
        ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim() } : {}),
      });
    });
  }

  const structuredOutput: EntryStructuredFields | undefined = structured
    ? STRUCTURED_FIELDS.reduce<EntryStructuredFields>((acc, field) => {
        const value = typeof structured[field] === 'string' ? structured[field].trim() : '';
        if (value) {
          acc[field] = value;
        }
        return acc;
      }, {})
    : undefined;

  return {
    ...(structuredOutput ? { structured: structuredOutput } : {}),
    ...(confirmations.length > 0 ? { confirmations } : {}),
  };
};

const getEntryIdFromPath = (entryId?: string): string => {
  if (!entryId) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry ID is required.',
      statusCode: 400,
    });
  }

  return entryId;
};

const getKeywordTokenGroups = (entry: Entry): { shared: string[]; privateOnly: string[] } => {
  const shared = extractEntryTokens(entry, { includePrivate: false, maxTokens: 30 });
  const all = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });
  const sharedSet = new Set(shared);
  return {
    shared,
    privateOnly: all.filter((token) => !sharedSet.has(token)),
  };
};

const buildKeywordItemKey = (
  athleteId: string,
  token: string,
  createdAt: string,
  entryId: string,
  visibilityScope: 'shared' | 'private'
): { PK: string; SK: string } => ({
  PK: `${visibilityScope === 'private' ? 'USER_PRIVATE' : 'USER'}#${athleteId}`,
  SK: `KW#${token}#TS#${createdAt}#ENTRY#${entryId}`,
});

const sanitizeCoachResponse = (
  entry: Entry
): Omit<Entry, 'sections' | 'sessionContext' | 'partnerOutcomes'> & { sections: { shared: string } } => {
  const { sessionContext: _sessionContext, partnerOutcomes: _partnerOutcomes, ...rest } = entry;
  void _sessionContext;
  void _partnerOutcomes;
  return {
    ...rest,
    ...(entry.structuredExtraction
      ? {
          structuredExtraction: {
            ...entry.structuredExtraction,
            suggestions: entry.structuredExtraction.suggestions.map((suggestion) => ({
              field: suggestion.field,
              value: suggestion.value,
              confidence: suggestion.confidence,
              status: suggestion.status,
              ...(suggestion.confirmationPrompt ? { confirmationPrompt: suggestion.confirmationPrompt } : {}),
              ...(suggestion.correctionValue ? { correctionValue: suggestion.correctionValue } : {}),
              ...(suggestion.updatedByRole ? { updatedByRole: suggestion.updatedByRole } : {}),
              updatedAt: suggestion.updatedAt,
            })),
            concepts: [],
            failures: [],
            conditioningIssues: [],
          },
        }
      : {}),
    sections: {
      shared: entry.sections.shared,
    },
  };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const entryId = getEntryIdFromPath(event.pathParameters?.entryId);
    const payload = parseRequest(event.body);
    const nowIso = new Date().toISOString();

    const metaResult = await getItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META',
      },
    });

    if (!metaResult.Item || typeof metaResult.Item.athleteId !== 'string' || typeof metaResult.Item.createdAt !== 'string') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404,
      });
    }

    const ownerAthleteId = metaResult.Item.athleteId;
    const isOwner = ownerAthleteId === auth.userId;
    const actingAsCoach = !isOwner;

    if (actingAsCoach) {
      if (!hasRole(auth, 'coach')) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'User does not have permission for this entry.',
          statusCode: 403,
        });
      }

      const link = await getItem({
        Key: {
          PK: `USER#${ownerAthleteId}`,
          SK: `COACH#${auth.userId}`,
        },
      });

      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403,
        });
      }
    }

    const entryKey = {
      PK: `USER#${ownerAthleteId}`,
      SK: `ENTRY#${metaResult.Item.createdAt}#${entryId}`,
    };

    const existingEntryResult = await getItem({ Key: entryKey });
    if (!existingEntryResult.Item || existingEntryResult.Item.entityType !== 'ENTRY') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404,
      });
    }

    const existingEntry = parseEntryRecord(existingEntryResult.Item as Record<string, unknown>);
    const mergedStructured = {
      ...(existingEntry.structured ?? {}),
      ...(payload.structured ?? {}),
    };

    const structuredExtraction = extractStructuredMetadata(
      {
        quickAdd: existingEntry.quickAdd,
        sections: existingEntry.sections,
        rawTechniqueMentions: existingEntry.rawTechniqueMentions,
        structured: mergedStructured,
        structuredMetadataConfirmations: payload.confirmations,
      },
      {
        nowIso,
        actorRole: actingAsCoach ? 'coach' : 'athlete',
      }
    );

    const updatedEntry: Entry = withCurrentEntrySchemaVersion({
      ...existingEntry,
      structured: structuredExtraction.structured,
      structuredExtraction: structuredExtraction.extraction,
      updatedAt: nowIso,
    });

    await putItem({
      Item: {
        ...entryKey,
        entityType: 'ENTRY',
        ...updatedEntry,
      },
    });

    const oldTokens = getKeywordTokenGroups(existingEntry);
    const newTokens = getKeywordTokenGroups(updatedEntry);
    const oldShared = new Set(oldTokens.shared);
    const newShared = new Set(newTokens.shared);
    const oldPrivate = new Set(oldTokens.privateOnly);
    const newPrivate = new Set(newTokens.privateOnly);

    for (const token of oldShared) {
      if (!newShared.has(token)) {
        await deleteItem({
          Key: buildKeywordItemKey(ownerAthleteId, token, updatedEntry.createdAt, updatedEntry.entryId, 'shared'),
        });
      }
    }

    for (const token of oldPrivate) {
      if (!newPrivate.has(token)) {
        await deleteItem({
          Key: buildKeywordItemKey(ownerAthleteId, token, updatedEntry.createdAt, updatedEntry.entryId, 'private'),
        });
      }
    }

    const newKeywordItems = [
      ...buildKeywordIndexItems(
        ownerAthleteId,
        updatedEntry.entryId,
        updatedEntry.createdAt,
        [...newShared].filter((token) => !oldShared.has(token)),
        { visibilityScope: 'shared' }
      ),
      ...buildKeywordIndexItems(
        ownerAthleteId,
        updatedEntry.entryId,
        updatedEntry.createdAt,
        [...newPrivate].filter((token) => !oldPrivate.has(token)),
        { visibilityScope: 'private' }
      ),
    ];

    if (newKeywordItems.length > 0) {
      await batchWriteItems(newKeywordItems);
    }

    await recomputeAndPersistProgressViews(ownerAthleteId);

    return response(200, {
      entry: actingAsCoach ? sanitizeCoachResponse(updatedEntry) : updatedEntry,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('reviewStructuredMetadata', baseHandler);
