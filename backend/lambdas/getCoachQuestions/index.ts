import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { parseRegenerateFlag } from '../../shared/coachQuestionPayload';
import {
  buildCoachQuestionMetaRecord,
  buildCoachQuestionSetRecord,
  COACH_QUESTION_SET_SK_PREFIX,
  generateCoachQuestionSet,
  parseCoachQuestionSetRecord
} from '../../shared/coachQuestions';
import { getItem, putItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

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

    const regenerate = parseRegenerateFlag(event);

    const latestResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': COACH_QUESTION_SET_SK_PREFIX
      },
      ScanIndexForward: false,
      Limit: 1
    });

    const latest = parseCoachQuestionSetRecord((latestResult.Items?.[0] ?? {}) as Record<string, unknown>);

    if (latest && !regenerate) {
      return response(200, {
        questionSet: latest,
        generation: {
          regenerated: false,
          confidenceLow: latest.qualitySummary.minScore < 70
        }
      });
    }

    const entriesResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'ENTRY#'
      },
      ScanIndexForward: false,
      Limit: 20
    });

    const entries = (entriesResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => parseEntryRecord(item as Record<string, unknown>));

    const nowIso = new Date().toISOString();
    const questionSet = await generateCoachQuestionSet({
      athleteId,
      entries,
      nowIso,
      generatedBy: auth.userId,
      generatedByRole: coachMode ? 'coach' : 'athlete',
      generationReason: regenerate
        ? latest && latest.qualitySummary.minScore < 70
          ? 'low-confidence-refresh'
          : 'regenerate'
        : 'initial'
    });

    await putItem({
      Item: buildCoachQuestionSetRecord(questionSet)
    });
    await putItem({
      Item: buildCoachQuestionMetaRecord(questionSet)
    });

    return response(latest ? 200 : 201, {
      questionSet,
      generation: {
        regenerated: Boolean(latest),
        confidenceLow: questionSet.qualitySummary.minScore < 70
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getCoachQuestions', baseHandler);
