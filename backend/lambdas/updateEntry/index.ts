import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';


import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, deleteItem, getItem, putItem } from '../../shared/db';
import { parseEntryRecord, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { sanitizeTechniqueMentions, upsertTechniqueCandidates } from '../../shared/techniques';
import type { CreateEntryRequest, Entry } from '../../shared/types';

const parseBody = (event: APIGatewayProxyEvent): CreateEntryRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<CreateEntryRequest>;

  if (
    !parsed.sections ||
    typeof parsed.sections.private !== 'string' ||
    typeof parsed.sections.shared !== 'string' ||
    !parsed.sessionMetrics ||
    typeof parsed.sessionMetrics.durationMinutes !== 'number' ||
    typeof parsed.sessionMetrics.intensity !== 'number' ||
    typeof parsed.sessionMetrics.rounds !== 'number' ||
    typeof parsed.sessionMetrics.giOrNoGi !== 'string' ||
    !Array.isArray(parsed.sessionMetrics.tags) ||
    (parsed.rawTechniqueMentions !== undefined &&
      (!Array.isArray(parsed.rawTechniqueMentions) ||
        parsed.rawTechniqueMentions.some((mention) => typeof mention !== 'string')))
  ) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry payload is invalid.',
      statusCode: 400
    });
  }

  return parsed as CreateEntryRequest;
};

const getEntryIdFromPath = (entryId?: string): string => {
  if (!entryId) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry ID is required.',
      statusCode: 400
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
    privateOnly: all.filter((token) => !sharedSet.has(token))
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
  SK: `KW#${token}#TS#${createdAt}#ENTRY#${entryId}`
});

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const entryId = getEntryIdFromPath(event.pathParameters?.entryId);
    const payload = parseBody(event);
    const nowIso = new Date().toISOString();

    const metaResult = await getItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META'
      }
    });

    if (
      !metaResult.Item ||
      typeof metaResult.Item.athleteId !== 'string' ||
      typeof metaResult.Item.createdAt !== 'string'
    ) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    if (metaResult.Item.athleteId !== auth.userId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'User does not have permission for this entry.',
        statusCode: 403
      });
    }

    const entryKey = {
      PK: `USER#${auth.userId}`,
      SK: `ENTRY#${metaResult.Item.createdAt}#${entryId}`
    };

    const existingEntryResult = await getItem({ Key: entryKey });
    if (!existingEntryResult.Item || existingEntryResult.Item.entityType !== 'ENTRY') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    const existingEntry = parseEntryRecord(existingEntryResult.Item as Record<string, unknown>);
    const updatedEntry: Entry = withCurrentEntrySchemaVersion({
      ...existingEntry,
      sections: payload.sections,
      sessionMetrics: payload.sessionMetrics,
      rawTechniqueMentions: sanitizeTechniqueMentions(payload.rawTechniqueMentions),
      updatedAt: nowIso
    });

    await putItem({
      Item: {
        ...entryKey,
        entityType: 'ENTRY',
        ...updatedEntry
      }
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
          Key: buildKeywordItemKey(auth.userId, token, updatedEntry.createdAt, updatedEntry.entryId, 'shared')
        });
      }
    }

    for (const token of oldPrivate) {
      if (!newPrivate.has(token)) {
        await deleteItem({
          Key: buildKeywordItemKey(auth.userId, token, updatedEntry.createdAt, updatedEntry.entryId, 'private')
        });
      }
    }

    const newKeywordItems = [
      ...buildKeywordIndexItems(
        auth.userId,
        updatedEntry.entryId,
        updatedEntry.createdAt,
        [...newShared].filter((token) => !oldShared.has(token)),
        { visibilityScope: 'shared' }
      ),
      ...buildKeywordIndexItems(
        auth.userId,
        updatedEntry.entryId,
        updatedEntry.createdAt,
        [...newPrivate].filter((token) => !oldPrivate.has(token)),
        { visibilityScope: 'private' }
      )
    ];

    if (newKeywordItems.length > 0) {
      await batchWriteItems(newKeywordItems);
    }

    await upsertTechniqueCandidates(updatedEntry.rawTechniqueMentions, updatedEntry.entryId, nowIso);

    return response(200, { entry: updatedEntry });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateEntry', baseHandler);
