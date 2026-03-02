import type { APIGatewayProxyHandler } from 'aws-lambda';

import { buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { batchWriteItems, putItem } from '../../shared/db';
import { extractEntryTokens, buildKeywordIndexItems } from '../../shared/keywords';
import { finalizeLegacyImportEntry } from '../../shared/legacyImport';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { upsertTechniqueCandidates } from '../../shared/techniques';
import type { LegacyImportCommitRequest } from '../../shared/types';

const parseRequest = (body: string | null): LegacyImportCommitRequest => {
  if (!body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be an object.',
      statusCode: 400,
    });
  }

  return parsed as LegacyImportCommitRequest;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseRequest(event.body);
    if (payload.duplicateResolution === 'skip' && payload.preview.dedupStatus !== 'new') {
      return response(200, {
        skipped: true,
        reason: 'duplicate-detected',
        duplicateEntryIds: payload.preview.duplicateEntryIds,
      });
    }

    const nowIso = new Date().toISOString();
    const entry = finalizeLegacyImportEntry(auth.userId, payload, { nowIso });

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `ENTRY#${entry.createdAt}#${entry.entryId}`,
        entityType: 'ENTRY',
        ...entry,
      },
    });

    const sharedTokens = extractEntryTokens(entry, { includePrivate: false, maxTokens: 30 });
    const allTokens = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });
    const sharedTokenSet = new Set(sharedTokens);
    const privateOnlyTokens = allTokens.filter((token) => !sharedTokenSet.has(token));

    const keywordItems = [
      ...buildKeywordIndexItems(auth.userId, entry.entryId, entry.createdAt, sharedTokens, {
        visibilityScope: 'shared',
      }),
      ...buildKeywordIndexItems(auth.userId, entry.entryId, entry.createdAt, privateOnlyTokens, {
        visibilityScope: 'private',
      }),
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
        createdAt: entry.createdAt,
      },
    });

    await recomputeAndPersistProgressViews(auth.userId);

    return response(201, {
      skipped: false,
      entry,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('commitLegacyEntryImport', baseHandler);
