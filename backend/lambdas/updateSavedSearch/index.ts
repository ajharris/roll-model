import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import {
  getSavedSearchIdFromPath,
  parseSavedEntrySearchRecord,
  parseUpsertSavedEntrySearchRequest
} from '../../shared/savedSearches';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const savedSearchId = getSavedSearchIdFromPath(event.pathParameters?.savedSearchId);
    const payload = parseUpsertSavedEntrySearchRequest(event);
    const key = {
      PK: `USER#${auth.userId}`,
      SK: `SAVED_SEARCH#${savedSearchId}`
    };

    const existingResult = await getItem({ Key: key });
    if (!existingResult.Item || existingResult.Item.entityType !== 'SAVED_SEARCH') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Saved search not found.',
        statusCode: 404
      });
    }

    const existing = parseSavedEntrySearchRecord(existingResult.Item as Record<string, unknown>);
    const updatedAt = new Date().toISOString();
    const savedSearch = {
      ...existing,
      name: payload.name,
      query: payload.query,
      tag: payload.tag,
      giOrNoGi: payload.giOrNoGi,
      minIntensity: payload.minIntensity,
      maxIntensity: payload.maxIntensity,
      sortBy: payload.sortBy,
      sortDirection: payload.sortDirection,
      updatedAt,
      ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
      ...(payload.isFavorite !== undefined ? { isFavorite: payload.isFavorite } : {})
    };

    // Remove optional flags if omitted in request to keep payload shape stable.
    if (payload.isPinned === undefined && 'isPinned' in savedSearch) {
      delete (savedSearch as { isPinned?: boolean }).isPinned;
    }
    if (payload.isFavorite === undefined && 'isFavorite' in savedSearch) {
      delete (savedSearch as { isFavorite?: boolean }).isFavorite;
    }

    await putItem({
      Item: {
        ...key,
        entityType: 'SAVED_SEARCH',
        ...savedSearch
      }
    });

    return response(200, { savedSearch });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateSavedSearch', baseHandler);
