import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Comment } from '../../shared/types';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const entryId = event.pathParameters?.entryId;
    const checkoffId = event.pathParameters?.checkoffId;
    if (!entryId && !checkoffId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Either entryId or checkoffId is required.',
        statusCode: 400,
      });
    }
    if (entryId && checkoffId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Only one target may be provided.',
        statusCode: 400,
      });
    }

    let athleteId: string;
    let pk: string;
    if (entryId) {
      const meta = await getItem({
        Key: {
          PK: `ENTRY#${entryId}`,
          SK: 'META',
        },
      });

      if (!meta.Item || typeof meta.Item.athleteId !== 'string') {
        throw new ApiError({
          code: 'NOT_FOUND',
          message: 'Entry not found.',
          statusCode: 404,
        });
      }
      athleteId = meta.Item.athleteId;
      pk = `ENTRY#${entryId}`;
    } else {
      const meta = await getItem({
        Key: {
          PK: `CHECKOFF#${checkoffId}`,
          SK: 'META',
        },
      });

      if (!meta.Item || typeof meta.Item.athleteId !== 'string') {
        throw new ApiError({
          code: 'NOT_FOUND',
          message: 'Checkoff not found.',
          statusCode: 404,
        });
      }
      athleteId = meta.Item.athleteId;
      pk = `CHECKOFF#${checkoffId}`;
    }

    const athleteMode = hasRole(auth, 'athlete') && auth.userId === athleteId;
    const coachMode = hasRole(auth, 'coach') && auth.userId !== athleteId;

    if (!athleteMode && !coachMode) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'User does not have permission for this action.',
        statusCode: 403,
      });
    }

    if (coachMode) {
      const link = await getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: `COACH#${auth.userId}`,
        },
      });
      if (!isCoachLinkActive(link.Item as Record<string, unknown> | undefined)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403,
        });
      }
    }

    const result = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': 'COMMENT#',
      },
      ScanIndexForward: false,
    });

    const comments: Comment[] = (result.Items ?? [])
      .filter((item) => item.entityType === 'COMMENT')
      .map((item) => {
        const { PK: _pk, SK: _sk, entityType: _entityType, ...comment } = item as Comment & {
          PK: string;
          SK: string;
          entityType: string;
        };
        void _pk;
        void _sk;
        void _entityType;
        return comment;
      })
      .filter((comment) => {
        if (!athleteMode) {
          return true;
        }
        return comment.visibility === 'visible';
      });

    return response(200, {
      comments,
      readOnly: coachMode,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listComments', baseHandler);
