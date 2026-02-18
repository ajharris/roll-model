import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { putItem } from '../../shared/db';
import { ApiError, errorResponse, response } from '../../shared/responses';

interface LinkCoachAthleteRequest {
  coachId: string;
}

const parseBody = (rawBody: string | null): LinkCoachAthleteRequest => {
  if (!rawBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(rawBody) as Partial<LinkCoachAthleteRequest>;
  if (typeof parsed.coachId !== 'string' || parsed.coachId.length === 0) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'coachId is required.',
      statusCode: 400
    });
  }

  return parsed as LinkCoachAthleteRequest;
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseBody(event.body);

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `COACH#${payload.coachId}`,
        entityType: 'COACH_LINK',
        athleteId: auth.userId,
        coachId: payload.coachId,
        createdAt: new Date().toISOString()
      }
    });

    return response(201, {
      linked: true,
      athleteId: auth.userId,
      coachId: payload.coachId
    });
  } catch (error) {
    return errorResponse(error);
  }
};
