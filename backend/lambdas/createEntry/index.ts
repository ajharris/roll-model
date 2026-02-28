import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, putItem } from '../../shared/db';
import { sanitizeMediaAttachments, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { parseEntryPayload } from '../../shared/entryPayload';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';
import { sanitizeTechniqueMentions, upsertTechniqueCandidates } from '../../shared/techniques';
import type { CreateEntryRequest, Entry } from '../../shared/types';



export const buildEntry = (
  athleteId: string,
  input: CreateEntryRequest,
  nowIso: string,
  entryId = uuidv4()
): Entry =>
  withCurrentEntrySchemaVersion({
    entryId,
    athleteId,
    createdAt: nowIso,
    updatedAt: nowIso,
    quickAdd: input.quickAdd,
    structured: input.structured,
    tags: input.tags,
    sections: input.sections,
    sessionMetrics: input.sessionMetrics,
    rawTechniqueMentions: sanitizeTechniqueMentions(input.rawTechniqueMentions),
    mediaAttachments: sanitizeMediaAttachments(input.mediaAttachments),
    templateId: input.templateId,
    actionPackDraft: input.actionPackDraft,
    actionPackFinal: input.actionPackFinal,
    sessionReviewDraft: input.sessionReviewDraft,
    sessionReviewFinal: input.sessionReviewFinal
  });

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseEntryPayload(event);
    const nowIso = new Date().toISOString();
    const entry = buildEntry(auth.userId, payload, nowIso);

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `ENTRY#${entry.createdAt}#${entry.entryId}`,
        entityType: 'ENTRY',
        ...entry
      }
    });

    const sharedTokens = extractEntryTokens(entry, { includePrivate: false, maxTokens: 30 });
    const allTokens = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });
    const sharedTokenSet = new Set(sharedTokens);
    const privateOnlyTokens = allTokens.filter((token) => !sharedTokenSet.has(token));

    const keywordItems = [
      ...buildKeywordIndexItems(auth.userId, entry.entryId, entry.createdAt, sharedTokens, {
        visibilityScope: 'shared'
      }),
      ...buildKeywordIndexItems(auth.userId, entry.entryId, entry.createdAt, privateOnlyTokens, {
        visibilityScope: 'private'
      })
    ];

    if (keywordItems.length > 0) {
      await batchWriteItems(keywordItems);
    }

    const actionPackItems = buildActionPackIndexItems(entry);
    if (actionPackItems.length > 0) {
      await batchWriteItems(actionPackItems);
    }

    await upsertTechniqueCandidates(entry.rawTechniqueMentions, entry.entryId, nowIso);

    await putItem({
      Item: {
        PK: `ENTRY#${entry.entryId}`,
        SK: 'META',
        entityType: 'ENTRY_META',
        athleteId: auth.userId,
        createdAt: entry.createdAt
      }
    });

    return response(201, { entry });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('createEntry', baseHandler);
