import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { getPartnerProfile } from '../../shared/partners';
import { ApiError, errorResponse, response } from '../../shared/responses';

const resolveAthleteId = (requestedAthleteId: string | undefined, authUserId: string): string => requestedAthleteId ?? authUserId;

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = resolveAthleteId(requestedAthleteId, auth.userId);
    const partnerId = event.pathParameters?.partnerId;
    if (!athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'athleteId is required for coach requests.',
        statusCode: 400
      });
    }
    if (!partnerId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'partnerId is required.',
        statusCode: 400
      });
    }

    if (coachMode) {
      const link = await getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: `COACH#${auth.userId}`
        }
      });
      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403
        });
      }
    }

    const partner = await getPartnerProfile(athleteId, partnerId);
    if (!partner || (coachMode && partner.visibility !== 'shared-with-coach')) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Partner not found.',
        statusCode: 404
      });
    }

    return response(200, { partner });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getPartner', baseHandler);
