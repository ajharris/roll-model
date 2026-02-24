import type { APIGatewayProxyHandler } from 'aws-lambda';


import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

interface RevokeCoachLinkRequest {
  coachId: string;
}

const parseBody = (rawBody: string | null): RevokeCoachLinkRequest => {
  if (!rawBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(rawBody) as Partial<RevokeCoachLinkRequest>;
  if (typeof parsed.coachId !== 'string' || parsed.coachId.length === 0) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'coachId is required.',
      statusCode: 400
    });
  }

  return parsed as RevokeCoachLinkRequest;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseBody(event.body);
    const link = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: `COACH#${payload.coachId}`
      }
    });

    if (!link.Item) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Coach link not found.',
        statusCode: 404
      });
    }

    const now = new Date().toISOString();

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `COACH#${payload.coachId}`,
        entityType: 'COACH_LINK',
        athleteId: auth.userId,
        coachId: payload.coachId,
        status: 'revoked',
        createdAt: typeof link.Item.createdAt === 'string' ? link.Item.createdAt : now,
        updatedAt: now,
        createdBy: typeof link.Item.createdBy === 'string' ? link.Item.createdBy : auth.userId
      }
    });

    return response(200, {
      revoked: true,
      athleteId: auth.userId,
      coachId: payload.coachId,
      status: 'revoked'
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('revokeCoachLink', baseHandler);
