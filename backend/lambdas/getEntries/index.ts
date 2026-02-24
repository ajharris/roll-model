import type { APIGatewayProxyHandler } from 'aws-lambda';
import { withRequestLogging } from '../../shared/logger';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Entry } from '../../shared/types';

const sanitizeForCoach = (entry: Entry): Omit<Entry, 'sections'> & { sections: { shared: string } } => ({
  ...entry,
  sections: {
    shared: entry.sections.shared
  }
});

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const canAthlete = hasRole(auth, 'athlete');
    const canCoach = hasRole(auth, 'coach');
    const isCoachRequest = Boolean(
      requestedAthleteId && requestedAthleteId !== auth.userId && canCoach,
    );
    const athleteId = isCoachRequest ? requestedAthleteId : canAthlete ? auth.userId : requestedAthleteId;

    if (!athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'athleteId is required for coach requests.',
        statusCode: 400
      });
    }

    if (isCoachRequest) {
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

    const queryResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':entryPrefix': 'ENTRY#'
      },
      ScanIndexForward: false
    });

    const entries = (queryResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => {
        const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = item as Entry & {
          PK: string;
          SK: string;
          entityType: string;
        };
        void _pk;
        void _sk;
        void _entityType;
        return entry;
      });

    return response(200, {
      entries: isCoachRequest ? entries.map(sanitizeForCoach) : entries
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getEntries', baseHandler);
