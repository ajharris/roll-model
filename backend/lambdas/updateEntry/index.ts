import type { APIGatewayProxyHandler } from 'aws-lambda';

import { buildActionPackDeleteKeys, buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, deleteItem, getItem, putItem } from '../../shared/db';
import { parseEntryRecord, sanitizeMediaAttachments, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { parseEntryPayload } from '../../shared/entryPayload';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { hydratePartnerOutcomes } from '../../shared/partners';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { sanitizeTechniqueMentions, upsertTechniqueCandidates } from '../../shared/techniques';
import type { Entry } from '../../shared/types';

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
    const payload = parseEntryPayload(event);
    const hydratedPartnerOutcomes = await hydratePartnerOutcomes(auth.userId, payload.partnerOutcomes);
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
      quickAdd: payload.quickAdd,
      structured: payload.structured,
      tags: payload.tags,
      sections: payload.sections,
      sessionMetrics: payload.sessionMetrics,
      sessionContext: payload.sessionContext,
      partnerOutcomes: hydratedPartnerOutcomes,
      rawTechniqueMentions: sanitizeTechniqueMentions(payload.rawTechniqueMentions),
      mediaAttachments: sanitizeMediaAttachments(payload.mediaAttachments),
      templateId: payload.templateId,
      actionPackDraft: payload.actionPackDraft,
      actionPackFinal: payload.actionPackFinal,
      sessionReviewDraft: payload.sessionReviewDraft,
      sessionReviewFinal: payload.sessionReviewFinal,
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

    for (const key of buildActionPackDeleteKeys(existingEntry)) {
      await deleteItem({ Key: key });
    }

    const actionPackItems = buildActionPackIndexItems(updatedEntry);
    if (actionPackItems.length > 0) {
      await batchWriteItems(actionPackItems);
    }

    await upsertTechniqueCandidates(updatedEntry.rawTechniqueMentions, updatedEntry.entryId, nowIso);
    await recomputeAndPersistProgressViews(auth.userId);

    return response(200, { entry: updatedEntry });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateEntry', baseHandler);
