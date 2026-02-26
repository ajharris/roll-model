import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { deleteItem, getItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { getSavedSearchIdFromPath } from '../../shared/savedSearches';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const savedSearchId = getSavedSearchIdFromPath(event.pathParameters?.savedSearchId);
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

    await deleteItem({ Key: key });
    return response(204, {});
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteSavedSearch', baseHandler);
