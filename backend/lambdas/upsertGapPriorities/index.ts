import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { buildGapPrioritySk } from '../../shared/gapInsights';
import { parseUpsertGapPrioritiesPayload } from '../../shared/gapInsightsPayload';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { GapPriorityOverride } from '../../shared/types';

const resolveAthleteId = (requestedAthleteId: string | undefined, authUserId: string, canCoach: boolean): string => {
  if (requestedAthleteId && requestedAthleteId !== authUserId && canCoach) {
    return requestedAthleteId;
  }
  return authUserId;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = resolveAthleteId(requestedAthleteId, auth.userId, hasRole(auth, 'coach'));

    if (!athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'athleteId is required for coach requests.',
        statusCode: 400,
      });
    }

    if (coachMode) {
      const link = await getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: `COACH#${auth.userId}`,
        },
      });

      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403,
        });
      }
    }

    const payload = parseUpsertGapPrioritiesPayload(event);
    if (payload.priorities.length > 50) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'At most 50 priorities can be updated per request.',
        statusCode: 400,
      });
    }

    const nowIso = new Date().toISOString();
    const updatedByRole: GapPriorityOverride['updatedByRole'] = coachMode ? 'coach' : 'athlete';

    const saved: GapPriorityOverride[] = [];
    for (const item of payload.priorities) {
      const savedItem: GapPriorityOverride = {
        gapId: item.gapId,
        status: item.status,
        manualPriority: item.manualPriority,
        note: item.note,
        updatedAt: nowIso,
        updatedBy: auth.userId,
        updatedByRole,
      };

      await putItem({
        Item: {
          PK: `USER#${athleteId}`,
          SK: buildGapPrioritySk(item.gapId),
          entityType: 'GAP_PRIORITY',
          athleteId,
          ...savedItem,
          createdAt: nowIso,
        },
      });

      saved.push(savedItem);
    }

    return response(200, { saved });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertGapPriorities', baseHandler);
