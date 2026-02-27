import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, putItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Checkoff, CurriculumGraph, Entry, WeeklyPlan } from '../../shared/types';
import { parseBuildWeeklyPlanPayload } from '../../shared/weeklyPlanPayload';
import {
  buildGraphSk,
  buildWeeklyPlanFromSignals,
  buildWeeklyPlanMetaRecord,
  buildWeeklyPlanRecord,
  parseWeeklyPlanRecord
} from '../../shared/weeklyPlans';

const defaultWeekOf = (date: Date): string => date.toISOString().slice(0, 10);

const resolveAthleteId = (requestedAthleteId: string | undefined, authUserId: string): string => requestedAthleteId ?? authUserId;

const parseCurriculumGraph = (item?: Record<string, unknown>): CurriculumGraph | null => {
  if (!item || item.entityType !== 'CURRICULUM_GRAPH') {
    return null;
  }

  if (
    typeof item.athleteId !== 'string' ||
    typeof item.graphId !== 'string' ||
    typeof item.version !== 'number' ||
    typeof item.updatedAt !== 'string' ||
    !Array.isArray(item.nodes) ||
    !Array.isArray(item.edges)
  ) {
    return null;
  }

  return item as unknown as CurriculumGraph;
};

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

    const payload = parseBuildWeeklyPlanPayload(event);
    const nowIso = new Date().toISOString();
    const weekOf = payload.weekOf ?? defaultWeekOf(new Date(nowIso));

    const [entriesResult, checkoffsResult, graphResult, priorPlansResult] = await Promise.all([
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'ENTRY#'
        },
        ScanIndexForward: false,
        Limit: 40
      }),
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'CHECKOFF#SKILL#'
        },
        ScanIndexForward: false
      }),
      getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: buildGraphSk()
        }
      }),
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${athleteId}`,
          ':prefix': 'WEEKLY_PLAN#'
        },
        ScanIndexForward: false,
        Limit: 8
      })
    ]);

    const entries: Entry[] = (entriesResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => parseEntryRecord(item as Record<string, unknown>));

    const checkoffs: Checkoff[] = (checkoffsResult.Items ?? [])
      .filter((item) => item.entityType === 'CHECKOFF')
      .map((item) => item as unknown as Checkoff);

    const priorPlans: WeeklyPlan[] = (priorPlansResult.Items ?? [])
      .filter((item) => item.entityType === 'WEEKLY_PLAN')
      .map((item) => parseWeeklyPlanRecord(item as Record<string, unknown>));

    const plan = buildWeeklyPlanFromSignals({
      entries,
      checkoffs,
      curriculumGraph: parseCurriculumGraph(graphResult.Item as Record<string, unknown> | undefined),
      priorPlans,
      weekOf,
      nowIso
    });

    const persistedPlan: WeeklyPlan = {
      ...plan,
      athleteId,
      updatedAt: nowIso,
      generatedAt: nowIso
    };

    await putItem({
      Item: buildWeeklyPlanRecord(persistedPlan)
    });
    await putItem({
      Item: buildWeeklyPlanMetaRecord(persistedPlan)
    });

    return response(201, { plan: persistedPlan });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('buildWeeklyPlan', baseHandler);
