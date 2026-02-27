import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

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

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const entryId = getEntryIdFromPath(event.pathParameters?.entryId);

    const metaResult = await getItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META'
      }
    });

    if (!metaResult.Item || typeof metaResult.Item.athleteId !== 'string') {
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

    const result = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ENTRY#${entryId}`,
        ':prefix': `CHECKOFF_EVIDENCE#${auth.userId}#`
      },
      ScanIndexForward: false
    });

    const evidence = result.Items?.filter((item) => item.entityType === 'ENTRY_CHECKOFF_EVIDENCE') ?? [];
    return response(200, { evidence });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getEntryCheckoffEvidence', baseHandler);
