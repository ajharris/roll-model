import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { parseNotificationRecord } from '../../shared/automation';
import { getItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const resolveAthleteId = (requestedAthleteId: string | undefined, authUserId: string): string => requestedAthleteId ?? authUserId;

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = resolveAthleteId(requestedAthleteId, auth.userId);

    if (!athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'athleteId is required for coach requests.',
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

    const rows = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'NOTIFICATION#'
      },
      ScanIndexForward: false,
      Limit: 20
    });

    const notifications = (rows.Items ?? [])
      .map((item) => parseNotificationRecord(item as Record<string, unknown>))
      .filter((item): item is NonNullable<ReturnType<typeof parseNotificationRecord>> => item !== null);

    return response(200, {
      notifications
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listAutomationNotifications', baseHandler);

