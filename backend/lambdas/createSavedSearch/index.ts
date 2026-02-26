import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';
import { buildSavedEntrySearch, parseUpsertSavedEntrySearchRequest } from '../../shared/savedSearches';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseUpsertSavedEntrySearchRequest(event);
    const nowIso = new Date().toISOString();
    const savedSearch = buildSavedEntrySearch(auth.userId, payload, nowIso, uuidv4());

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `SAVED_SEARCH#${savedSearch.id}`,
        entityType: 'SAVED_SEARCH',
        ...savedSearch
      }
    });

    return response(201, { savedSearch });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('createSavedSearch', baseHandler);
