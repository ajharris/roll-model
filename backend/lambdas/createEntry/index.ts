import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, putItem } from '../../shared/db';
import { sanitizeMediaAttachments, withCurrentEntrySchemaVersion } from '../../shared/entries';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { sanitizeTechniqueMentions, upsertTechniqueCandidates } from '../../shared/techniques';
import type { CreateEntryRequest, Entry } from '../../shared/types';

const isActionPackLike = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Record<string, unknown>;
  return (
    Array.isArray(maybe.wins) &&
    Array.isArray(maybe.leaks) &&
    typeof maybe.oneFocus === 'string' &&
    Array.isArray(maybe.drills) &&
    Array.isArray(maybe.positionalRequests) &&
    typeof maybe.fallbackDecisionGuidance === 'string' &&
    Array.isArray(maybe.confidenceFlags)
  );
};

const parseBody = (event: APIGatewayProxyEvent): CreateEntryRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<CreateEntryRequest>;
  const mediaAttachmentsValid =
    parsed.mediaAttachments === undefined ||
    (Array.isArray(parsed.mediaAttachments) &&
      parsed.mediaAttachments.every((attachment) => typeof attachment === 'object' && attachment !== null));
  const templateValid =
    parsed.templateId === undefined ||
    parsed.templateId === 'class-notes' ||
    parsed.templateId === 'open-mat-rounds' ||
    parsed.templateId === 'drill-session';
  const actionPackDraftValid =
    parsed.actionPackDraft === undefined || isActionPackLike(parsed.actionPackDraft);
  const actionPackFinalValid =
    parsed.actionPackFinal === undefined ||
    (typeof parsed.actionPackFinal === 'object' &&
      parsed.actionPackFinal !== null &&
      typeof parsed.actionPackFinal.finalizedAt === 'string' &&
      isActionPackLike((parsed.actionPackFinal as { actionPack?: unknown }).actionPack));

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
        parsed.rawTechniqueMentions.some((mention) => typeof mention !== 'string'))) ||
    !mediaAttachmentsValid ||
    !templateValid ||
    !actionPackDraftValid ||
    !actionPackFinalValid
  ) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry payload is invalid.',
      statusCode: 400
    });
  }

  return parsed as CreateEntryRequest;
};

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
    sections: input.sections,
    sessionMetrics: input.sessionMetrics,
    rawTechniqueMentions: sanitizeTechniqueMentions(input.rawTechniqueMentions),
    mediaAttachments: sanitizeMediaAttachments(input.mediaAttachments),
    templateId: input.templateId,
    actionPackDraft: input.actionPackDraft,
    actionPackFinal: input.actionPackFinal
  });

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseBody(event);
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
