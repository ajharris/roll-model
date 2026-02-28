import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { deleteItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const partnerId = event.pathParameters?.partnerId;
    if (!partnerId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'partnerId is required.',
        statusCode: 400
      });
    }

    await deleteItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: `PARTNER#${partnerId}`
      }
    });

    return response(204, {});
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deletePartner', baseHandler);
