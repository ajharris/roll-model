import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Checkoff, CheckoffEvidence } from '../../shared/types';

const getAthleteId = (eventAthleteId: string | undefined, authUserId: string): string => eventAthleteId ?? authUserId;

const buildEvidencePrefix = (checkoff: Checkoff): string =>
  `CHECKOFF#SKILL#${checkoff.skillId}#TYPE#${checkoff.evidenceType}#EVIDENCE#`;

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = getAthleteId(requestedAthleteId, auth.userId);

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

    const checkoffRows = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'CHECKOFF#SKILL#'
      }
    });

    const checkoffs =
      checkoffRows.Items?.filter((item) => item.entityType === 'CHECKOFF').map((item) => item as unknown as Checkoff) ?? [];

    const withEvidence = await Promise.all(
      checkoffs.map(async (checkoff) => {
        const evidenceRows = await queryItems({
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `USER#${athleteId}`,
            ':prefix': buildEvidencePrefix(checkoff)
          },
          ScanIndexForward: false
        });

        const evidence =
          evidenceRows.Items?.filter((item) => item.entityType === 'CHECKOFF_EVIDENCE').map((item) => item as unknown as CheckoffEvidence) ??
          [];

        return {
          ...checkoff,
          evidence
        };
      })
    );

    return response(200, { checkoffs: withEvidence });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listCheckoffs', baseHandler);
