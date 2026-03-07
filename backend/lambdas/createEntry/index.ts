import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, putItem, queryItems } from '../../shared/db';
import { sanitizeMediaAttachments, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { parseEntryPayload } from '../../shared/entryPayload';
import { inferIntegrationContextForEntry, mergeConfirmedIntegrationTags, parseIntegrationSignalsFromItems } from '../../shared/integrations';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { hydratePartnerOutcomes } from '../../shared/partners';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { extractStructuredMetadata } from '../../shared/structuredExtraction';
import { sanitizeTechniqueMentions, upsertTechniqueCandidates } from '../../shared/techniques';
import type { CreateEntryRequest, Entry } from '../../shared/types';


export const buildEntry = (
  athleteId: string,
  input: CreateEntryRequest,
  nowIso: string,
  entryId = uuidv4()
): Entry =>
  (() => {
    const structuredExtraction = extractStructuredMetadata(input, { nowIso, actorRole: 'athlete' });
    return withCurrentEntrySchemaVersion({
    entryId,
    athleteId,
    createdAt: nowIso,
    updatedAt: nowIso,
    quickAdd: input.quickAdd,
    structured: structuredExtraction.structured,
    structuredExtraction: structuredExtraction.extraction,
    tags: input.tags,
    sections: input.sections,
    sessionMetrics: input.sessionMetrics,
    sessionContext: input.sessionContext,
    integrationContext: input.integrationContext,
    partnerOutcomes: input.partnerOutcomes,
    rawTechniqueMentions: sanitizeTechniqueMentions(input.rawTechniqueMentions),
    mediaAttachments: sanitizeMediaAttachments(input.mediaAttachments),
    templateId: input.templateId,
    actionPackDraft: input.actionPackDraft,
    actionPackFinal: input.actionPackFinal,
    sessionReviewDraft: input.sessionReviewDraft,
    sessionReviewFinal: input.sessionReviewFinal
    });
  })();

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseEntryPayload(event);
    const nowIso = new Date().toISOString();
    const signalItems = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :signalPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${auth.userId}`,
        ':signalPrefix': 'INTEGRATION_SIGNAL#'
      },
      ScanIndexForward: false
    });
    const integrationSignals = parseIntegrationSignalsFromItems((signalItems.Items ?? []) as Array<Record<string, unknown>>);
    const inferredIntegrationContext = inferIntegrationContextForEntry(payload, integrationSignals, nowIso);
    const payloadWithIntegration = mergeConfirmedIntegrationTags({
      ...payload,
      ...(inferredIntegrationContext ? { integrationContext: inferredIntegrationContext } : {})
    });
    const entry = buildEntry(
      auth.userId,
      {
        ...payloadWithIntegration,
        partnerOutcomes: await hydratePartnerOutcomes(auth.userId, payloadWithIntegration.partnerOutcomes)
      },
      nowIso
    );

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

    await recomputeAndPersistProgressViews(auth.userId);

    console.info(
      JSON.stringify({
        msg: 'createEntry.success',
        athleteId: auth.userId,
        entryId: entry.entryId,
        quickAddTime: entry.quickAdd.time,
        createdAt: entry.createdAt,
      }),
    );

    return response(201, { entry });
  } catch (error) {
    if (error instanceof ApiError) {
      const payloadSummary =
        typeof event.body === 'string' && event.body.trim().length > 0
          ? (() => {
              try {
                const parsed = JSON.parse(event.body) as Record<string, unknown>;
                return {
                  hasQuickAdd: Boolean(parsed.quickAdd && typeof parsed.quickAdd === 'object'),
                  hasTags: Array.isArray(parsed.tags),
                  hasSections: Boolean(parsed.sections && typeof parsed.sections === 'object'),
                  hasSessionMetrics: Boolean(parsed.sessionMetrics && typeof parsed.sessionMetrics === 'object'),
                  hasRawTechniqueMentions: Array.isArray(parsed.rawTechniqueMentions),
                };
              } catch {
                return { bodyLength: event.body.length };
              }
            })()
          : { bodyMissing: true };

      console.error(
        JSON.stringify({
          msg: 'createEntry.validation_failed',
          code: error.code,
          message: error.message,
          payloadSummary,
        }),
      );
    }
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('createEntry', baseHandler);
