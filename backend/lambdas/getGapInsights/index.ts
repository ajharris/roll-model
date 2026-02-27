import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import {
  buildGapInsightsReport,
  parseGapInsightsThresholds,
  parseGapPriorityRows,
} from '../../shared/gapInsights';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Checkoff, CheckoffEvidence } from '../../shared/types';

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

    const thresholds = parseGapInsightsThresholds(event.queryStringParameters);

    const [entryRows, checkoffRows, priorityRows] = await Promise.all([
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'ENTRY#',
        },
        ScanIndexForward: false,
      }),
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'CHECKOFF#SKILL#',
        },
      }),
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'GAP_PRIORITY#',
        },
      }),
    ]);

    const checkoffs =
      checkoffRows.Items?.filter((item) => item.entityType === 'CHECKOFF').map((item) => item as unknown as Checkoff) ?? [];
    const evidence =
      checkoffRows.Items
        ?.filter((item) => item.entityType === 'CHECKOFF_EVIDENCE')
        .map((item) => item as unknown as CheckoffEvidence) ?? [];

    const report = buildGapInsightsReport({
      athleteId,
      entries: entryRows.Items ?? [],
      checkoffs,
      evidence,
      priorities: parseGapPriorityRows((priorityRows.Items ?? []) as Array<Record<string, unknown>>),
      thresholds,
    });

    return response(200, { report });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getGapInsights', baseHandler);
