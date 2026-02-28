import type { APIGatewayProxyHandler } from 'aws-lambda';


import { queryActionPackAthleteEntries } from '../../shared/actionPackIndex';
import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import { parseEntrySearchRequest, searchEntries } from '../../shared/entrySearch';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { listRecentOneThingCues } from '../../shared/sessionReview';
import type { Entry } from '../../shared/types';

const sanitizeForCoach = (entry: Entry): Omit<Entry, 'sections'> & { sections: { shared: string } } => ({
  ...entry,
  sections: {
    shared: entry.sections.shared
  }
});

const hasActionPackIndexParams = (searchRequest: ReturnType<typeof parseEntrySearchRequest>): boolean =>
  Boolean(searchRequest.actionPackField || searchRequest.actionPackToken || searchRequest.actionPackMinConfidence);

const parseRecentOneThingLimit = (
  value: string | undefined
): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'recentOneThingLimit must be a positive integer.',
      statusCode: 400
    });
  }

  return Math.min(parsed, 20);
};

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

    const searchRequest = parseEntrySearchRequest(event.queryStringParameters);
    const recentOneThingLimit = parseRecentOneThingLimit(event.queryStringParameters?.recentOneThingLimit);
    if (hasActionPackIndexParams(searchRequest) && (!searchRequest.actionPackField || !searchRequest.actionPackToken)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'actionPackField and actionPackToken are required together.',
        statusCode: 400
      });
    }

    const entries = searchRequest.actionPackField && searchRequest.actionPackToken
      ? await queryActionPackAthleteEntries({
          athleteId,
          field: searchRequest.actionPackField,
          token: searchRequest.actionPackToken,
          minConfidence: searchRequest.actionPackMinConfidence
        })
      : (
          await queryItems({
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
            ExpressionAttributeValues: {
              ':pk': `USER#${athleteId}`,
              ':entryPrefix': 'ENTRY#'
            },
            ScanIndexForward: false
          })
        ).Items?.filter((item) => item.entityType === 'ENTRY')
          .map((item) => parseEntryRecord(item as Record<string, unknown>)) ?? [];

    const searched = searchEntries(entries, searchRequest);

    return response(200, {
      entries: isCoachRequest ? searched.entries.map(sanitizeForCoach) : searched.entries,
      search: searched.meta,
      ...(recentOneThingLimit
        ? { recentOneThingCues: listRecentOneThingCues(entries, recentOneThingLimit) }
        : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getEntries', baseHandler);
