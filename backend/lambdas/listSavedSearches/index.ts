import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';
import { parseSavedEntrySearchRecord } from '../../shared/savedSearches';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const queryResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :savedSearchPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${auth.userId}`,
        ':savedSearchPrefix': 'SAVED_SEARCH#'
      },
      ScanIndexForward: false
    });

    const savedSearches = (queryResult.Items ?? [])
      .filter((item) => item.entityType === 'SAVED_SEARCH')
      .map((item) => parseSavedEntrySearchRecord(item as Record<string, unknown>));

    return response(200, { savedSearches });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listSavedSearches', baseHandler);
