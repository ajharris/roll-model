import type { APIGatewayProxyHandler } from 'aws-lambda';
import { withRequestLogging } from '../../shared/logger';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem } from '../../shared/db';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Entry } from '../../shared/types';

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

    if (
      !metaResult.Item ||
      typeof metaResult.Item.athleteId !== 'string' ||
      typeof metaResult.Item.createdAt !== 'string'
    ) {
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

    const entryResult = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: `ENTRY#${metaResult.Item.createdAt}#${entryId}`
      }
    });

    if (!entryResult.Item || entryResult.Item.entityType !== 'ENTRY') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = entryResult.Item as Entry & {
      PK: string;
      SK: string;
      entityType: string;
    };
    void _pk;
    void _sk;
    void _entityType;

    return response(200, { entry });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getEntry', baseHandler);
